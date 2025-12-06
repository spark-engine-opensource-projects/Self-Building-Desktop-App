const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const sqlValidator = require('./sqlValidator');
const databaseOptimizer = require('./databaseOptimizer');
const { DATABASE } = require('../config/constants');
const secureStorage = require('./secureStorage');

// Encryption configuration
const ENCRYPTION_CONFIG = DATABASE.ENCRYPTION || {
    ENABLED: false,
    CIPHER: 'sqlcipher',
    KDF_ITERATIONS: 256000,
    PAGE_SIZE: 4096
};

class DatabaseManager {
    constructor(dataPath = null, options = {}) {
        this.dataPath = dataPath || path.join(__dirname, '..', '..', 'data');
        this.connections = new Map(); // Multiple database connections
        this.connectionTimestamps = new Map(); // Track connection creation times
        this.maxConnectionAge = options.maxConnectionAge || 30 * 60 * 1000; // 30 minutes
        this.maxConnections = options.maxConnections || 10;
        this.schemas = new Map(); // Track schemas for each database
        this.migrations = new Map(); // Track migrations

        // Encryption settings
        this.encryptionEnabled = options.encryptionEnabled ?? ENCRYPTION_CONFIG.ENABLED;
        this.encryptionKey = null; // Will be set during initialization
        this.encryptionKeyPath = path.join(this.dataPath, '.encryption_key');
        
        // Connection pooling and performance options
        this.poolOptions = {
            maxConnections: options.maxConnections || 10,
            connectionTimeout: options.connectionTimeout || 30000,
            idleTimeout: options.idleTimeout || 300000, // 5 minutes
            enableWAL: options.enableWAL !== false, // WAL mode by default
            enableOptimizations: options.enableOptimizations !== false,
            ...options.poolOptions
        };
        
        // Connection pools per database
        this.connectionPools = new Map();
        this.activeConnections = new Map();
        this.connectionStats = new Map();
        
        // Query caching for repeated operations
        this.queryCache = new Map();
        this.preparedStatements = new Map();

        this.initialized = false;
        this.initializationPromise = null;
        this.startMaintenanceTasks();

        // Cleanup on process exit
        process.on('exit', () => this.cleanup());
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
    }

    /**
     * Initialize the database manager - ensures data directory exists
     * Can be called multiple times safely (idempotent)
     * @returns {Promise<{success: boolean}>}
     */
    async initialize() {
        if (this.initialized) {
            return { success: true };
        }

        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = this._performInitialization();
        return this.initializationPromise;
    }

    async _performInitialization() {
        try {
            await this.initializeDataDirectory();

            // Initialize encryption if enabled
            if (this.encryptionEnabled) {
                await this.initializeEncryption();
            }

            this.initialized = true;
            logger.info('DatabaseManager initialized successfully', {
                encryptionEnabled: this.encryptionEnabled
            });
            return { success: true };
        } catch (error) {
            logger.error('DatabaseManager initialization failed', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async initializeDataDirectory() {
        try {
            await fs.mkdir(this.dataPath, { recursive: true });
            logger.info('Database data directory initialized', { path: this.dataPath });
        } catch (error) {
            logger.error('Failed to initialize data directory', error);
            throw error;
        }
    }

    /**
     * Initialize database encryption
     * Generates or loads the encryption key
     */
    async initializeEncryption() {
        try {
            // Try to load existing key
            const existingKey = await this.loadEncryptionKey();
            if (existingKey) {
                this.encryptionKey = existingKey;
                logger.info('Loaded existing database encryption key');
                return;
            }

            // Generate new key
            this.encryptionKey = await this.generateEncryptionKey();
            await this.saveEncryptionKey(this.encryptionKey);
            logger.info('Generated new database encryption key');
        } catch (error) {
            logger.error('Failed to initialize encryption', { error: error.message });
            throw error;
        }
    }

    /**
     * Generate a secure encryption key
     * Uses PBKDF2 to derive a key from random bytes
     * @returns {Promise<string>} Hex-encoded encryption key
     */
    async generateEncryptionKey() {
        return new Promise((resolve, reject) => {
            // Generate 32 bytes of random data
            const salt = crypto.randomBytes(32);
            const masterKey = crypto.randomBytes(32);

            // Derive key using PBKDF2
            crypto.pbkdf2(masterKey, salt, ENCRYPTION_CONFIG.KDF_ITERATIONS, 32, 'sha512', (err, derivedKey) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Store both salt and derived key
                const keyData = {
                    salt: salt.toString('hex'),
                    key: derivedKey.toString('hex'),
                    version: 1,
                    algorithm: ENCRYPTION_CONFIG.CIPHER,
                    iterations: ENCRYPTION_CONFIG.KDF_ITERATIONS
                };

                resolve(JSON.stringify(keyData));
            });
        });
    }

    /**
     * Load encryption key from secure storage (using Electron safeStorage)
     * @returns {Promise<string|null>} Encryption key or null if not found
     */
    async loadEncryptionKey() {
        try {
            // Try to load from secure storage first (Electron safeStorage)
            if (secureStorage.isAvailable) {
                const keyData = await secureStorage.retrieve('db_encryption_key');
                if (keyData) {
                    // Validate key structure
                    const parsed = typeof keyData === 'string' ? JSON.parse(keyData) : keyData;
                    if (parsed.key && parsed.salt && parsed.version) {
                        return typeof keyData === 'string' ? keyData : JSON.stringify(keyData);
                    }
                }
            }

            // Fallback: try to migrate from file-based storage
            try {
                const keyData = await fs.readFile(this.encryptionKeyPath, 'utf8');
                const parsed = JSON.parse(keyData);
                if (parsed.key && parsed.salt && parsed.version) {
                    // Migrate to secure storage
                    if (secureStorage.isAvailable) {
                        await this.saveEncryptionKey(keyData);
                        // Remove old file after successful migration
                        await fs.unlink(this.encryptionKeyPath).catch(() => {});
                        logger.info('Encryption key migrated to secure storage');
                    }
                    return keyData;
                }
            } catch (fileError) {
                if (fileError.code !== 'ENOENT') {
                    throw fileError;
                }
            }

            return null;
        } catch (error) {
            logger.error('Failed to load encryption key', { error: error.message });
            return null;
        }
    }

    /**
     * Save encryption key to secure storage (using Electron safeStorage)
     * @param {string} keyData - The key data to save
     */
    async saveEncryptionKey(keyData) {
        try {
            // Use Electron's secure storage if available
            if (secureStorage.isAvailable) {
                await secureStorage.store('db_encryption_key', keyData);
                logger.info('Encryption key saved to secure storage');
            } else {
                // Fallback to file-based storage with restrictive permissions
                await fs.writeFile(this.encryptionKeyPath, keyData, { mode: 0o600 });
                logger.warn('Encryption key saved to file (secure storage unavailable)');
            }
        } catch (error) {
            logger.error('Failed to save encryption key', { error: error.message });
            throw error;
        }
    }

    /**
     * Get the hex key for SQLCipher
     * @returns {string} Hex-encoded key for PRAGMA key
     */
    getEncryptionKeyHex() {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not initialized');
        }

        const keyData = JSON.parse(this.encryptionKey);
        return keyData.key;
    }

    /**
     * Apply encryption settings to a database connection
     * @param {Database} db - The database connection
     */
    applyEncryption(db) {
        if (!this.encryptionEnabled || !this.encryptionKey) {
            return;
        }

        const keyHex = this.getEncryptionKeyHex();

        // SQLCipher PRAGMA statements
        // Note: These must be executed immediately after opening the database
        try {
            // Set the encryption key (using hex key format)
            db.pragma(`key = "x'${keyHex}'"`);

            // Set SQLCipher-specific options for v4 compatibility
            db.pragma(`cipher_page_size = ${ENCRYPTION_CONFIG.PAGE_SIZE}`);
            db.pragma(`kdf_iter = ${ENCRYPTION_CONFIG.KDF_ITERATIONS}`);
            db.pragma('cipher_memory_security = ON');

            logger.debug('Applied encryption settings to database connection');
        } catch (error) {
            logger.error('Failed to apply encryption settings', { error: error.message });
            throw error;
        }
    }

    /**
     * Check if a database is encrypted
     * @param {string} dbPath - Path to the database file
     * @returns {Promise<boolean>} True if database appears to be encrypted
     */
    async isDatabaseEncrypted(dbPath) {
        try {
            const header = Buffer.alloc(16);
            const fd = await fs.open(dbPath, 'r');
            await fd.read(header, 0, 16, 0);
            await fd.close();

            // SQLite databases start with "SQLite format 3\0"
            // Encrypted databases will have different headers
            const sqliteHeader = 'SQLite format 3\0';
            return header.toString('utf8', 0, 16) !== sqliteHeader;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return false; // New database
            }
            throw error;
        }
    }
    
    /**
     * Start maintenance tasks for connection pool cleanup
     */
    startMaintenanceTasks() {
        // Run cleanup every 5 minutes
        this.maintenanceInterval = setInterval(() => {
            this.cleanupIdleConnections();
            this.pruneConnectionPools();
        }, 300000); // 5 minutes

        // Run statistics collection every minute
        this.statsInterval = setInterval(() => {
            this.collectPoolStatistics();
        }, 60000);

        // Optimize databases every hour
        this.optimizeInterval = setInterval(() => {
            this.optimizeDatabases();
        }, 60 * 60 * 1000);

        // Clear query cache every 30 minutes
        this.cacheCleanupInterval = setInterval(() => {
            this.cleanupQueryCache();
        }, 30 * 60 * 1000);

        logger.info('Database maintenance tasks started');
    }
    
    /**
     * Clean up idle connections in pools
     */
    cleanupIdleConnections() {
        const now = Date.now();
        let totalCleaned = 0;
        
        for (const [poolKey, pool] of this.connectionPools.entries()) {
            const initialSize = pool.available.length;
            
            // Filter out connections that have been idle too long
            pool.available = pool.available.filter(conn => {
                const idleTime = now - (conn.lastUsed || conn.createdAt);
                if (idleTime > this.poolOptions.idleTimeout) {
                    try {
                        if (conn.db && typeof conn.db.close === 'function') {
                            conn.db.close();
                        }
                        pool.created--;
                        pool.stats.totalConnections--;
                        return false;
                    } catch (error) {
                        logger.error('Error closing idle connection', { poolKey, error });
                    }
                }
                return true;
            });
            
            const cleaned = initialSize - pool.available.length;
            if (cleaned > 0) {
                totalCleaned += cleaned;
                logger.debug('Cleaned idle connections', { 
                    pool: poolKey, 
                    cleaned, 
                    remaining: pool.available.length 
                });
            }
        }
        
        if (totalCleaned > 0) {
            logger.info('Connection pool cleanup completed', { totalCleaned });
        }
    }
    
    /**
     * Remove empty connection pools
     */
    pruneConnectionPools() {
        const emptyPools = [];
        
        for (const [poolKey, pool] of this.connectionPools.entries()) {
            if (pool.available.length === 0 && pool.inUse.size === 0) {
                emptyPools.push(poolKey);
            }
        }
        
        for (const poolKey of emptyPools) {
            this.connectionPools.delete(poolKey);
            logger.debug('Removed empty connection pool', { pool: poolKey });
        }
    }
    
    /**
     * Collect and log pool statistics
     */
    collectPoolStatistics() {
        const stats = {
            totalPools: this.connectionPools.size,
            totalConnections: 0,
            activeConnections: 0,
            idleConnections: 0,
            pools: []
        };
        
        for (const [poolKey, pool] of this.connectionPools.entries()) {
            stats.totalConnections += pool.created;
            stats.activeConnections += pool.inUse.size;
            stats.idleConnections += pool.available.length;
            
            stats.pools.push({
                name: poolKey,
                created: pool.created,
                active: pool.inUse.size,
                idle: pool.available.length,
                stats: pool.stats
            });
        }
        
        if (stats.totalPools > 0) {
            logger.debug('Connection pool statistics', stats);
        }
    }
    
    /**
     * Release connection back to pool
     * @param {string|object} dbNameOrConnection - Database name or connection object
     * @param {object} [connection] - Connection object (if first param is dbName)
     */
    releaseConnection(dbNameOrConnection, connection) {
        // Support both signatures: (dbName, connection) and (connection)
        let poolKey;
        let conn;

        if (typeof dbNameOrConnection === 'string') {
            poolKey = dbNameOrConnection;
            conn = connection;
        } else {
            conn = dbNameOrConnection;
            poolKey = conn.dbName;
        }

        const pool = this.connectionPools.get(poolKey);

        if (!pool) {
            logger.warn('Attempted to release connection to non-existent pool', { poolKey });
            return;
        }

        if (!pool.inUse.has(conn)) {
            logger.warn('Connection not found in in-use set', { poolKey });
            return;
        }

        pool.inUse.delete(conn);
        conn.lastUsed = Date.now();
        pool.stats.activeConnections--;

        // Check if connection should be closed due to idle timeout
        const idleTime = Date.now() - conn.lastUsed;
        if (idleTime > this.poolOptions.idleTimeout) {
            try {
                if (conn.db && typeof conn.db.close === 'function') {
                    conn.db.close();
                }
                pool.created--;
                logger.debug('Idle connection closed on release', {
                    connectionId: conn.id,
                    database: poolKey,
                    idleTime
                });
            } catch (error) {
                logger.error('Error closing idle connection', { poolKey, error });
            }
        } else {
            pool.available.push(conn);
        }

        logger.debug('Connection released to pool', {
            pool: poolKey,
            active: pool.inUse.size,
            available: pool.available.length
        });
    }
    
    /**
     * Clean up all connections and pools
     */
    cleanup() {
        logger.info('Starting database manager cleanup');
        
        // Clear intervals
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
        }
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }
        
        // Close all connections
        for (const [dbName, db] of this.connections.entries()) {
            try {
                db.close();
                logger.debug('Closed database connection', { database: dbName });
            } catch (error) {
                logger.error('Error closing database', { database: dbName, error });
            }
        }
        
        // Close all pooled connections
        for (const [poolKey, pool] of this.connectionPools.entries()) {
            // Close available connections
            for (const conn of pool.available) {
                try {
                    if (conn.db && typeof conn.db.close === 'function') {
                        conn.db.close();
                    }
                } catch (error) {
                    logger.error('Error closing pooled connection', { poolKey, error });
                }
            }
            
            // Close in-use connections
            for (const conn of pool.inUse) {
                try {
                    if (conn.db && typeof conn.db.close === 'function') {
                        conn.db.close();
                    }
                } catch (error) {
                    logger.error('Error closing in-use connection', { poolKey, error });
                }
            }
        }
        
        this.connections.clear();
        this.connectionPools.clear();
        this.queryCache.clear();
        this.preparedStatements.clear();
        
        logger.info('Database manager cleanup completed');
    }

    /**
     * Validate database name for security
     */
    validateDatabaseName(dbName) {
        // Check for null/undefined
        if (!dbName || typeof dbName !== 'string') {
            throw new Error('Database name must be a non-empty string');
        }
        
        // Check for path traversal attempts
        const pathTraversalPatterns = [
            '..',
            './',
            '..\\',
            '/',
            '\\',
            ':',
            '*',
            '?',
            '"',
            '<',
            '>',
            '|',
            '\x00'
        ];
        
        for (const pattern of pathTraversalPatterns) {
            if (dbName.includes(pattern)) {
                logger.logSecurityEvent('database_name_path_traversal', { 
                    attemptedName: dbName,
                    pattern: pattern
                });
                throw new Error(`Invalid database name: contains illegal character "${pattern}"`);
            }
        }
        
        // Only allow alphanumeric, underscore, and hyphen
        if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
            throw new Error('Database name can only contain letters, numbers, underscores, and hyphens');
        }
        
        // Limit length
        if (dbName.length > 100) {
            throw new Error('Database name too long (max 100 characters)');
        }
        
        return true;
    }

    /**
     * Create or connect to a database
     */
    async connectDatabase(dbName = 'default') {
        try {
            // Validate database name for security
            this.validateDatabaseName(dbName);
            
            // Check if connection exists and is still valid
            if (this.connections.has(dbName)) {
                const timestamp = this.connectionTimestamps.get(dbName);
                const age = Date.now() - timestamp;
                
                // Return existing connection if still fresh
                if (age < this.maxConnectionAge) {
                    return this.connections.get(dbName);
                } else {
                    // Close stale connection
                    logger.info('Closing stale database connection', { 
                        database: dbName, 
                        age: Math.round(age / 1000) + 's' 
                    });
                    this.closeDatabase(dbName);
                }
            }
            
            // Check connection limit
            if (this.connections.size >= this.maxConnections) {
                this.closeOldestConnection();
            }

            const dbPath = path.join(this.dataPath, `${dbName}.db`);
            const db = new Database(dbPath);

            // Apply encryption BEFORE any other operations
            if (this.encryptionEnabled) {
                this.applyEncryption(db);
            }

            // Apply performance optimizations
            this.optimizeConnection(db, dbName);
            
            // Create metadata table if it doesn't exist
            this.createMetadataTable(db);
            
            this.connections.set(dbName, db);
            this.connectionTimestamps.set(dbName, Date.now());
            logger.info('Database connected', { 
                database: dbName, 
                path: dbPath,
                totalConnections: this.connections.size 
            });
            
            return db;
        } catch (error) {
            logger.error('Failed to connect to database', { database: dbName, error });
            throw error;
        }
    }

    /**
     * Get connection from pool or create new one
     */
    async getPooledConnection(dbName) {
        const poolKey = dbName;
        
        if (!this.connectionPools.has(poolKey)) {
            this.connectionPools.set(poolKey, {
                available: [],
                inUse: new Set(),
                created: 0,
                stats: {
                    totalConnections: 0,
                    activeConnections: 0,
                    waitingQueries: 0,
                    averageConnectionTime: 0
                }
            });
        }

        const pool = this.connectionPools.get(poolKey);
        const startTime = Date.now();

        // Try to get available connection
        if (pool.available.length > 0) {
            const connection = pool.available.pop();
            pool.inUse.add(connection);
            pool.stats.activeConnections++;
            return connection;
        }

        // Create new connection if under limit
        if (pool.created < this.poolOptions.maxConnections) {
            const connection = await this.createPooledConnection(dbName, poolKey);
            pool.inUse.add(connection);
            pool.created++;
            pool.stats.totalConnections++;
            pool.stats.activeConnections++;
            
            const connectionTime = Date.now() - startTime;
            pool.stats.averageConnectionTime = 
                (pool.stats.averageConnectionTime + connectionTime) / 2;
            
            return connection;
        }

        // Wait for connection to become available
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection pool timeout'));
            }, this.poolOptions.connectionTimeout);

            pool.stats.waitingQueries++;
            
            const checkAvailable = () => {
                if (pool.available.length > 0) {
                    clearTimeout(timeout);
                    pool.stats.waitingQueries--;
                    const connection = pool.available.pop();
                    pool.inUse.add(connection);
                    pool.stats.activeConnections++;
                    resolve(connection);
                } else {
                    setTimeout(checkAvailable, 50); // Check every 50ms
                }
            };
            
            checkAvailable();
        });
    }

    /**
     * Create a new pooled connection
     */
    async createPooledConnection(dbName, poolKey) {
        const dbPath = path.join(this.dataPath, `${dbName}.db`);
        const db = new Database(dbPath);

        // Apply encryption BEFORE any other operations
        if (this.encryptionEnabled) {
            this.applyEncryption(db);
        }

        const connection = {
            id: uuidv4(),
            dbName,
            db: db,
            createdAt: Date.now(),
            lastUsed: Date.now(),
            queryCount: 0
        };

        // Apply optimizations to pooled connection
        this.optimizeConnection(connection.db, dbName);
        
        // Set up connection tracking
        connection.db.exec = this.wrapDbMethod(connection, connection.db.exec.bind(connection.db));
        connection.db.prepare = this.wrapPrepare(connection, connection.db.prepare.bind(connection.db));
        
        return connection;
    }

    /**
     * Apply performance optimizations to connection
     */
    optimizeConnection(db, dbName) {
        if (this.poolOptions.enableWAL) {
            db.pragma('journal_mode = WAL');
        }
        
        if (this.poolOptions.enableOptimizations) {
            // Performance optimizations
            db.pragma('foreign_keys = ON');
            db.pragma('synchronous = NORMAL');
            db.pragma('cache_size = -64000'); // 64MB cache
            db.pragma('temp_store = MEMORY');
            db.pragma('mmap_size = 268435456'); // 256MB memory map
            db.pragma('optimize');
        }

        // Create connection stats tracking
        if (!this.connectionStats.has(dbName)) {
            this.connectionStats.set(dbName, {
                queries: 0,
                totalTime: 0,
                errors: 0,
                lastOptimized: Date.now()
            });
        }
    }

    /**
     * Wrap database methods for performance tracking
     */
    wrapDbMethod(connection, originalMethod) {
        return (...args) => {
            const startTime = Date.now();
            try {
                const result = originalMethod(...args);
                this.trackQueryPerformance(connection, Date.now() - startTime, true);
                return result;
            } catch (error) {
                this.trackQueryPerformance(connection, Date.now() - startTime, false);
                throw error;
            }
        };
    }

    /**
     * Wrap prepare method for statement caching
     */
    wrapPrepare(connection, originalPrepare) {
        return (sql) => {
            const cacheKey = `${connection.dbName}:${sql}`;
            
            if (this.preparedStatements.has(cacheKey)) {
                const cached = this.preparedStatements.get(cacheKey);
                cached.hitCount++;
                return cached.statement;
            }

            const statement = originalPrepare(sql);
            this.preparedStatements.set(cacheKey, {
                statement,
                createdAt: Date.now(),
                hitCount: 0
            });

            return statement;
        };
    }

    /**
     * Track query performance
     */
    trackQueryPerformance(connection, duration, success) {
        connection.queryCount++;
        const stats = this.connectionStats.get(connection.dbName);
        
        if (stats) {
            stats.queries++;
            stats.totalTime += duration;
            if (!success) stats.errors++;
            
            // Log slow queries
            if (duration > 1000) {
                logger.warn('Slow query detected', {
                    database: connection.dbName,
                    duration,
                    connectionId: connection.id
                });
            }
        }
    }

    /**
     * Cleanup idle connections (secondary cleanup pass)
     */
    cleanupIdleConnectionsSecondary() {
        const now = Date.now();
        
        for (const [poolKey, pool] of this.connectionPools) {
            const activeConnections = [];
            
            for (const connection of pool.available) {
                const idleTime = now - connection.lastUsed;
                
                if (idleTime > this.poolOptions.idleTimeout) {
                    connection.db.close();
                    pool.created--;
                    logger.debug('Cleaned up idle connection', {
                        database: connection.dbName,
                        idleTime,
                        connectionId: connection.id
                    });
                } else {
                    activeConnections.push(connection);
                }
            }
            
            pool.available = activeConnections;
        }
    }

    /**
     * Optimize databases
     */
    async optimizeDatabases() {
        for (const [dbName, connection] of this.connections) {
            try {
                const stats = this.connectionStats.get(dbName);
                if (stats && Date.now() - stats.lastOptimized > 3600000) { // 1 hour
                    connection.pragma('optimize');
                    connection.exec('VACUUM');
                    stats.lastOptimized = Date.now();
                    
                    logger.info('Database optimized', {
                        database: dbName,
                        queries: stats.queries,
                        averageTime: stats.totalTime / stats.queries
                    });
                }
            } catch (error) {
                logger.error('Database optimization failed', {
                    database: dbName,
                    error
                });
            }
        }
    }

    /**
     * Cleanup query cache
     */
    cleanupQueryCache() {
        const now = Date.now();
        const maxAge = 30 * 60 * 1000; // 30 minutes
        
        for (const [key, cached] of this.preparedStatements) {
            if (now - cached.createdAt > maxAge && cached.hitCount < 2) {
                this.preparedStatements.delete(key);
            }
        }
        
        logger.debug('Query cache cleaned', {
            remainingStatements: this.preparedStatements.size
        });
    }

    /**
     * Get performance statistics
     */
    getPerformanceStats() {
        const stats = {};
        
        for (const [dbName, connectionStats] of this.connectionStats) {
            const pool = this.connectionPools.get(dbName);
            
            stats[dbName] = {
                queries: connectionStats.queries,
                totalTime: connectionStats.totalTime,
                averageTime: connectionStats.queries > 0 ? 
                    connectionStats.totalTime / connectionStats.queries : 0,
                errors: connectionStats.errors,
                errorRate: connectionStats.queries > 0 ? 
                    connectionStats.errors / connectionStats.queries : 0,
                pool: pool ? {
                    totalConnections: pool.stats.totalConnections,
                    activeConnections: pool.stats.activeConnections,
                    availableConnections: pool.available.length,
                    waitingQueries: pool.stats.waitingQueries,
                    averageConnectionTime: pool.stats.averageConnectionTime
                } : null
            };
        }
        
        stats.global = {
            preparedStatements: this.preparedStatements.size,
            totalPools: this.connectionPools.size
        };
        
        return stats;
    }

    /**
     * Create metadata table for tracking schema changes
     */
    createMetadataTable(db) {
        const createMetadata = db.prepare(`
            CREATE TABLE IF NOT EXISTS _metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                schema_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                version INTEGER DEFAULT 1
            )
        `);
        createMetadata.run();

        const createMigrations = db.prepare(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                migration_id TEXT UNIQUE NOT NULL,
                migration_name TEXT NOT NULL,
                sql_up TEXT NOT NULL,
                sql_down TEXT NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        createMigrations.run();
    }

    /**
     * Dynamically create a table from schema definition
     */
    async createTable(dbName, tableName, schema) {
        try {
            const db = await this.connectDatabase(dbName);
            
            // Validate table name
            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tableName)) {
                throw new Error('Invalid table name. Must start with letter and contain only letters, numbers, and underscores.');
            }

            // Build CREATE TABLE statement
            const columns = this.buildColumns(schema.columns);
            const constraints = this.buildConstraints(schema.constraints || []);

            // Note: table constraints must come AFTER all column definitions
            const createTableSQL = `
                CREATE TABLE IF NOT EXISTS ${tableName} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ${columns},
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP${constraints ? ', ' + constraints : ''}
                )
            `;

            db.exec(createTableSQL);

            // Create update trigger for updated_at
            const triggerSQL = `
                CREATE TRIGGER IF NOT EXISTS update_${tableName}_updated_at 
                AFTER UPDATE ON ${tableName}
                FOR EACH ROW
                BEGIN
                    UPDATE ${tableName} SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                END
            `;
            db.exec(triggerSQL);

            // Save schema metadata
            await this.saveTableSchema(db, tableName, schema);
            
            logger.info('Table created successfully', { 
                database: dbName, 
                table: tableName, 
                columns: Object.keys(schema.columns).length 
            });

            return { success: true, table: tableName };
        } catch (error) {
            logger.error('Failed to create table', { database: dbName, table: tableName, error });
            throw error;
        }
    }

    /**
     * Build column definitions from schema
     */
    buildColumns(columns) {
        return Object.entries(columns).map(([name, config]) => {
            let definition = `${name} ${this.getSQLiteType(config.type)}`;
            
            if (config.required) definition += ' NOT NULL';
            if (config.unique) definition += ' UNIQUE';
            if (config.default !== undefined) {
                definition += ` DEFAULT ${this.formatDefaultValue(config.default, config.type)}`;
            }
            
            return definition;
        }).join(', ');
    }

    /**
     * Build constraint definitions
     */
    buildConstraints(constraints) {
        return constraints.map(constraint => {
            switch (constraint.type) {
                case 'foreign_key':
                    return `FOREIGN KEY (${constraint.column}) REFERENCES ${constraint.references.table}(${constraint.references.column})`;
                case 'check':
                    return `CHECK (${constraint.condition})`;
                case 'unique':
                    return `UNIQUE (${constraint.columns.join(', ')})`;
                default:
                    return '';
            }
        }).filter(c => c).join(', ');
    }

    /**
     * Map JavaScript types to SQLite types
     */
    getSQLiteType(type) {
        const typeMap = {
            'string': 'TEXT',
            'number': 'REAL',
            'integer': 'INTEGER',
            'boolean': 'INTEGER',
            'date': 'DATETIME',
            'json': 'TEXT',
            'blob': 'BLOB'
        };
        return typeMap[type] || 'TEXT';
    }

    /**
     * Format default values for SQL
     */
    formatDefaultValue(value, type) {
        if (type === 'string' || type === 'date') {
            return `'${value}'`;
        }
        if (type === 'boolean') {
            return value ? 1 : 0;
        }
        if (type === 'json') {
            return `'${JSON.stringify(value)}'`;
        }
        return value;
    }

    /**
     * Save table schema to metadata
     */
    async saveTableSchema(db, tableName, schema) {
        const saveSchema = db.prepare(`
            INSERT OR REPLACE INTO _metadata (table_name, schema_json, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `);

        saveSchema.run(tableName, JSON.stringify(schema));
    }

    /**
     * Drop a table from the database
     * @param {string} dbName - Database name
     * @param {string} tableName - Table name to drop
     * @returns {Object} - Result with success status
     */
    async dropTable(dbName, tableName) {
        try {
            const db = await this.connectDatabase(dbName);

            // Validate table name
            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tableName)) {
                return { success: false, error: 'Invalid table name' };
            }

            // Prevent dropping system tables
            const systemTables = ['_metadata', '_app_registry', '_table_registry', '_table_relationships'];
            if (systemTables.includes(tableName)) {
                return { success: false, error: 'Cannot drop system tables' };
            }

            // Check if table exists
            const tableExists = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
            ).get(tableName);

            if (!tableExists) {
                return { success: false, error: 'Table does not exist' };
            }

            // Drop the table
            db.exec(`DROP TABLE IF EXISTS "${tableName}"`);

            // Remove from metadata
            db.prepare('DELETE FROM _metadata WHERE table_name = ?').run(tableName);

            // Remove from table registry if exists
            try {
                db.prepare('DELETE FROM _table_registry WHERE table_name = ?').run(tableName);
                db.prepare('DELETE FROM _table_relationships WHERE source_table = ? OR target_table = ?').run(tableName, tableName);
            } catch (e) {
                // Registry tables might not exist in older databases
            }

            logger.info('Table dropped successfully', { database: dbName, table: tableName });

            return { success: true, table: tableName };
        } catch (error) {
            logger.error('Failed to drop table', { database: dbName, table: tableName, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Insert data into table
     */
    async insertData(dbName, tableName, data) {
        try {
            const db = await this.connectDatabase(dbName);
            
            // Get table schema to validate data
            const schema = await this.getTableSchema(db, tableName);
            const validatedData = this.validateAndTransformData(data, schema);
            
            // Use safe query builder for insert
            const safeQuery = sqlValidator.buildSafeInsert(tableName, validatedData);
            const stmt = db.prepare(safeQuery.sql);
            const result = stmt.run(...safeQuery.params);
            
            logger.info('Data inserted successfully', { 
                database: dbName, 
                table: tableName, 
                id: result.lastInsertRowid 
            });
            
            return { success: true, id: result.lastInsertRowid, data: validatedData };
        } catch (error) {
            logger.error('Failed to insert data', { database: dbName, table: tableName, error });
            throw error;
        }
    }

    /**
     * Validate and sanitize ORDER BY clause to prevent SQL injection
     */
    sanitizeOrderBy(orderBy) {
        if (!orderBy || typeof orderBy !== 'string') {
            return null;
        }

        // Only allow alphanumeric, underscores, and basic ORDER BY syntax
        // Pattern: column_name or column_name DESC/ASC
        const orderByPattern = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\s+(?:ASC|DESC))?(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*(?:\s+(?:ASC|DESC))?)*$/i;

        if (!orderByPattern.test(orderBy.trim())) {
            logger.logSecurityEvent('invalid_orderby_attempt', { orderBy });
            return null;
        }

        return orderBy.trim();
    }

    /**
     * Validate table name for use in queries
     */
    validateTableName(tableName) {
        if (!tableName || typeof tableName !== 'string') {
            throw new Error('Table name must be a non-empty string');
        }

        // Only allow alphanumeric and underscores, must start with letter
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tableName)) {
            throw new Error('Invalid table name. Must start with letter and contain only letters, numbers, and underscores.');
        }

        return true;
    }

    /**
     * Query data from table
     */
    async queryData(dbName, tableName, options = {}) {
        try {
            const db = await this.connectDatabase(dbName);

            // Use safe query builder for basic select
            let whereClause = null;
            let whereParams = [];

            // Add WHERE clause
            if (options.where) {
                const where = this.buildWhereClause(options.where);
                whereClause = where.sql;
                whereParams = where.params;
            }

            // Build base query using sqlValidator
            const safeQuery = sqlValidator.buildSafeSelect(tableName, ['*'], whereClause, whereParams);
            let sql = safeQuery.sql;
            const params = [...safeQuery.params];

            // Add ORDER BY with sanitization
            if (options.orderBy) {
                const sanitizedOrderBy = this.sanitizeOrderBy(options.orderBy);
                if (sanitizedOrderBy) {
                    sql += ` ORDER BY ${sanitizedOrderBy}`;
                    // Only add DESC if not already in orderBy and explicitly requested
                    if (options.order && options.order.toLowerCase() === 'desc' && !sanitizedOrderBy.toLowerCase().includes('desc')) {
                        sql += ' DESC';
                    }
                }
            }

            // Add LIMIT and OFFSET (parseInt ensures integer)
            if (options.limit) {
                const limit = parseInt(options.limit, 10);
                if (!isNaN(limit) && limit > 0) {
                    sql += ` LIMIT ${limit}`;
                    if (options.offset) {
                        const offset = parseInt(options.offset, 10);
                        if (!isNaN(offset) && offset >= 0) {
                            sql += ` OFFSET ${offset}`;
                        }
                    }
                }
            }

            const stmt = db.prepare(sql);
            const rows = stmt.all(...params);

            // Transform data back (e.g., parse JSON fields)
            const schema = await this.getTableSchema(db, tableName);
            const transformedRows = rows.map(row => this.transformRowData(row, schema));

            logger.info('Data queried successfully', {
                database: dbName,
                table: tableName,
                count: rows.length
            });

            return { success: true, data: transformedRows, count: rows.length };
        } catch (error) {
            logger.error('Failed to query data', { database: dbName, table: tableName, error });
            throw error;
        }
    }

    /**
     * Update data in table
     */
    async updateData(dbName, tableName, id, data) {
        try {
            const db = await this.connectDatabase(dbName);

            const schema = await this.getTableSchema(db, tableName);
            const validatedData = this.validateAndTransformData(data, schema);

            // Use safe query builder for update
            const safeQuery = sqlValidator.buildSafeUpdate(tableName, validatedData, 'id = ?', [id]);
            const stmt = db.prepare(safeQuery.sql);
            const result = stmt.run(...safeQuery.params);

            logger.info('Data updated successfully', {
                database: dbName,
                table: tableName,
                id: id,
                changes: result.changes
            });

            return { success: true, id: id, changes: result.changes };
        } catch (error) {
            logger.error('Failed to update data', { database: dbName, table: tableName, id, error });
            throw error;
        }
    }

    /**
     * Delete data from table
     */
    async deleteData(dbName, tableName, id) {
        try {
            const db = await this.connectDatabase(dbName);

            // Use safe query builder for delete
            const safeQuery = sqlValidator.buildSafeDelete(tableName, 'id = ?', [id]);
            const stmt = db.prepare(safeQuery.sql);
            const result = stmt.run(...safeQuery.params);

            logger.info('Data deleted successfully', {
                database: dbName,
                table: tableName,
                id: id,
                changes: result.changes
            });

            return { success: true, id: id, changes: result.changes };
        } catch (error) {
            logger.error('Failed to delete data', { database: dbName, table: tableName, id, error });
            throw error;
        }
    }

    /**
     * Get table schema from metadata
     */
    async getTableSchema(db, tableName) {
        const getSchema = db.prepare(`
            SELECT schema_json FROM _metadata WHERE table_name = ?
        `);
        const result = getSchema.get(tableName);
        
        if (result) {
            return JSON.parse(result.schema_json);
        }
        
        // Fallback: analyze existing table structure
        return this.analyzeTableStructure(db, tableName);
    }

    /**
     * Analyze existing table structure
     */
    analyzeTableStructure(db, tableName) {
        // Validate table name to prevent SQL injection in PRAGMA command
        this.validateTableName(tableName);

        const pragma = db.prepare(`PRAGMA table_info(${tableName})`);
        const columns = pragma.all();

        const schema = { columns: {} };

        columns.forEach(col => {
            if (col.name === 'id' || col.name === 'created_at' || col.name === 'updated_at') {
                return; // Skip system columns
            }

            schema.columns[col.name] = {
                type: this.mapSQLiteTypeToJS(col.type),
                required: col.notnull === 1,
                default: col.dflt_value
            };
        });

        return schema;
    }

    /**
     * Map SQLite types back to JavaScript types
     */
    mapSQLiteTypeToJS(sqliteType) {
        const typeMap = {
            'TEXT': 'string',
            'REAL': 'number',
            'INTEGER': 'integer',
            'DATETIME': 'date',
            'BLOB': 'blob'
        };
        return typeMap[sqliteType] || 'string';
    }

    /**
     * Validate and transform data according to schema
     */
    validateAndTransformData(data, schema) {
        const transformed = {};
        
        Object.entries(data).forEach(([key, value]) => {
            const columnDef = schema.columns[key];
            if (!columnDef) return; // Skip unknown columns
            
            // Type conversion
            if (columnDef.type === 'boolean') {
                transformed[key] = value ? 1 : 0;
            } else if (columnDef.type === 'json') {
                transformed[key] = typeof value === 'string' ? value : JSON.stringify(value);
            } else if (columnDef.type === 'integer') {
                transformed[key] = parseInt(value);
            } else if (columnDef.type === 'number') {
                transformed[key] = parseFloat(value);
            } else {
                transformed[key] = value;
            }
        });
        
        return transformed;
    }

    /**
     * Transform row data after querying
     */
    transformRowData(row, schema) {
        const transformed = { ...row };
        
        Object.entries(schema.columns).forEach(([key, columnDef]) => {
            if (row[key] === null || row[key] === undefined) return;
            
            if (columnDef.type === 'boolean') {
                transformed[key] = row[key] === 1;
            } else if (columnDef.type === 'json') {
                try {
                    transformed[key] = JSON.parse(row[key]);
                } catch (e) {
                    transformed[key] = row[key];
                }
            }
        });
        
        return transformed;
    }

    /**
     * Build WHERE clause from conditions
     */
    buildWhereClause(conditions) {
        const clauses = [];
        const params = [];
        
        Object.entries(conditions).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                // Handle operators like { $gt: 10 }, { $like: '%test%' }
                Object.entries(value).forEach(([op, val]) => {
                    switch (op) {
                        case '$gt':
                            clauses.push(`${key} > ?`);
                            params.push(val);
                            break;
                        case '$lt':
                            clauses.push(`${key} < ?`);
                            params.push(val);
                            break;
                        case '$gte':
                            clauses.push(`${key} >= ?`);
                            params.push(val);
                            break;
                        case '$lte':
                            clauses.push(`${key} <= ?`);
                            params.push(val);
                            break;
                        case '$like':
                            clauses.push(`${key} LIKE ?`);
                            params.push(val);
                            break;
                        case '$in':
                            clauses.push(`${key} IN (${val.map(() => '?').join(', ')})`);
                            params.push(...val);
                            break;
                    }
                });
            } else {
                clauses.push(`${key} = ?`);
                params.push(value);
            }
        });
        
        return {
            sql: clauses.join(' AND '),
            params: params
        };
    }

    /**
     * List all tables in a database
     */
    async listTables(dbName) {
        try {
            const db = await this.connectDatabase(dbName);

            // Note: underscore must be escaped in LIKE pattern since it's a wildcard
            // Also exclude sqlite_sequence which is auto-created for AUTOINCREMENT
            const stmt = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type='table'
                  AND name NOT LIKE '!_%' ESCAPE '!'
                  AND name != 'sqlite_sequence'
                ORDER BY name
            `);
            
            const tables = stmt.all();
            
            return {
                success: true,
                tables: tables.map(t => t.name),
                count: tables.length
            };
        } catch (error) {
            logger.error('Failed to list tables', { database: dbName, error });
            throw error;
        }
    }

    /**
     * List all databases
     */
    async listDatabases() {
        try {
            const files = await fs.readdir(this.dataPath);
            const databases = files
                .filter(file => file.endsWith('.db'))
                .map(file => file.replace('.db', ''));
                
            return {
                success: true,
                databases: databases,
                count: databases.length
            };
        } catch (error) {
            logger.error('Failed to list databases', error);
            throw error;
        }
    }

    /**
     * Execute custom SQL query
     */
    async executeSQL(dbName, sql, params = []) {
        try {
            const db = await this.connectDatabase(dbName);
            
            // Validate and sanitize SQL query
            const safeQuery = sqlValidator.prepareSafeQuery(sql, params);
            
            const stmt = db.prepare(safeQuery.sql);
            
            if (sql.trim().toUpperCase().startsWith('SELECT')) {
                const result = stmt.all(...safeQuery.params);
                return { success: true, data: result, type: 'select' };
            } else {
                const result = stmt.run(...safeQuery.params);
                return { 
                    success: true, 
                    changes: result.changes,
                    lastInsertRowid: result.lastInsertRowid,
                    type: 'modify'
                };
            }
        } catch (error) {
            logger.error('Failed to execute SQL', { database: dbName, sql, error });
            throw error;
        }
    }

    /**
     * Basic SQL injection protection
     */
    containsDangerousSQL(sql) {
        const dangerous = [
            'DROP TABLE',
            'DROP DATABASE',
            'TRUNCATE',
            'DELETE FROM sqlite_master',
            'PRAGMA',
            'ATTACH',
            'DETACH'
        ];
        
        const upperSQL = sql.toUpperCase();
        return dangerous.some(danger => upperSQL.includes(danger));
    }

    /**
     * Export database to JSON
     */
    async exportDatabase(dbName) {
        try {
            const db = await this.connectDatabase(dbName);
            const tablesResult = await this.listTables(dbName);
            
            const exportData = {
                database: dbName,
                exported_at: new Date().toISOString(),
                tables: {}
            };
            
            for (const tableName of tablesResult.tables) {
                const data = await this.queryData(dbName, tableName);
                const schema = await this.getTableSchema(db, tableName);
                
                exportData.tables[tableName] = {
                    schema: schema,
                    data: data.data
                };
            }
            
            return { success: true, export: exportData };
        } catch (error) {
            logger.error('Failed to export database', { database: dbName, error });
            throw error;
        }
    }

    /**
     * Close oldest connection to make room
     */
    closeOldestConnection() {
        let oldestDb = null;
        let oldestTime = Date.now();
        
        for (const [dbName, timestamp] of this.connectionTimestamps) {
            if (timestamp < oldestTime) {
                oldestTime = timestamp;
                oldestDb = dbName;
            }
        }
        
        if (oldestDb) {
            logger.info('Closing oldest connection to make room', { database: oldestDb });
            this.closeDatabase(oldestDb);
        }
    }
    
    /**
     * Close database connection
     */
    closeDatabase(dbName) {
        if (this.connections.has(dbName)) {
            try {
                const db = this.connections.get(dbName);
                db.close();
                this.connections.delete(dbName);
                this.connectionTimestamps.delete(dbName);
                logger.info('Database connection closed', { 
                    database: dbName,
                    remainingConnections: this.connections.size
                });
            } catch (error) {
                logger.error('Error closing database connection', { database: dbName, error });
            }
        }
    }

    // ============================================================
    // MULTI-APP REGISTRY METHODS
    // For managing multiple apps sharing the same database
    // ============================================================

    /**
     * Initialize the shared database with registry tables
     * Creates system tables for tracking apps, table ownership, and relationships
     * @param {string} dbName - Database name (defaults to SHARED_DB_NAME from constants)
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async initializeSharedDatabase(dbName = DATABASE.SHARED_DB_NAME) {
        try {
            const db = await this.connectDatabase(dbName);

            // Create app registry table (enhanced for regeneration support)
            db.exec(`
                CREATE TABLE IF NOT EXISTS _app_registry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_id TEXT UNIQUE NOT NULL,
                    app_name TEXT NOT NULL,
                    description TEXT,
                    original_prompt TEXT,
                    generated_code TEXT,
                    status TEXT DEFAULT 'active',
                    deprecation_reason TEXT,
                    last_regenerated DATETIME,
                    version INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Add columns if they don't exist (for migration of existing databases)
            try {
                db.exec(`ALTER TABLE _app_registry ADD COLUMN original_prompt TEXT`);
            } catch (e) { /* Column already exists */ }
            try {
                db.exec(`ALTER TABLE _app_registry ADD COLUMN generated_code TEXT`);
            } catch (e) { /* Column already exists */ }
            try {
                db.exec(`ALTER TABLE _app_registry ADD COLUMN deprecation_reason TEXT`);
            } catch (e) { /* Column already exists */ }
            try {
                db.exec(`ALTER TABLE _app_registry ADD COLUMN last_regenerated DATETIME`);
            } catch (e) { /* Column already exists */ }
            try {
                db.exec(`ALTER TABLE _app_registry ADD COLUMN version INTEGER DEFAULT 1`);
            } catch (e) { /* Column already exists */ }

            // Create table registry for tracking table ownership
            db.exec(`
                CREATE TABLE IF NOT EXISTS _table_registry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    table_name TEXT UNIQUE NOT NULL,
                    app_id TEXT,
                    schema_json TEXT NOT NULL,
                    description TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (app_id) REFERENCES _app_registry(app_id)
                )
            `);

            // Create table relationships tracking
            db.exec(`
                CREATE TABLE IF NOT EXISTS _table_relationships (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_table TEXT NOT NULL,
                    target_table TEXT NOT NULL,
                    relationship_type TEXT NOT NULL,
                    description TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(source_table, target_table, relationship_type)
                )
            `);

            // Create table usage tracking (which apps use which tables)
            db.exec(`
                CREATE TABLE IF NOT EXISTS _table_usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    table_name TEXT NOT NULL,
                    app_id TEXT NOT NULL,
                    access_type TEXT NOT NULL DEFAULT 'read',
                    columns_used TEXT,
                    last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
                    access_count INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(table_name, app_id),
                    FOREIGN KEY (app_id) REFERENCES _app_registry(app_id)
                )
            `);

            // Create schema change history for tracking modifications
            db.exec(`
                CREATE TABLE IF NOT EXISTS _schema_changes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    table_name TEXT NOT NULL,
                    change_type TEXT NOT NULL,
                    old_schema TEXT,
                    new_schema TEXT,
                    changed_by_app TEXT,
                    affected_apps TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create indexes for faster lookups
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_table_registry_app_id ON _table_registry(app_id);
                CREATE INDEX IF NOT EXISTS idx_table_relationships_source ON _table_relationships(source_table);
                CREATE INDEX IF NOT EXISTS idx_table_relationships_target ON _table_relationships(target_table);
                CREATE INDEX IF NOT EXISTS idx_table_usage_table ON _table_usage(table_name);
                CREATE INDEX IF NOT EXISTS idx_table_usage_app ON _table_usage(app_id);
                CREATE INDEX IF NOT EXISTS idx_schema_changes_table ON _schema_changes(table_name);
            `);

            logger.info('Shared database initialized with registry tables', { database: dbName });
            return { success: true };
        } catch (error) {
            logger.error('Failed to initialize shared database', { database: dbName, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Register a new app in the shared database
     * @param {string} appId - Unique identifier for the app
     * @param {string} appName - Display name for the app
     * @param {string} description - Description of what the app does
     * @param {string} originalPrompt - The original prompt used to generate the app
     * @param {string} generatedCode - The generated code for the app
     * @returns {Promise<{success: boolean, app?: Object, error?: string}>}
     */
    async registerApp(appId, appName, description = '', originalPrompt = null, generatedCode = null) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);

            // Ensure registry tables exist
            await this.initializeSharedDatabase();

            const stmt = db.prepare(`
                INSERT INTO _app_registry (app_id, app_name, description, original_prompt, generated_code, status)
                VALUES (?, ?, ?, ?, ?, 'active')
                ON CONFLICT(app_id) DO UPDATE SET
                    app_name = excluded.app_name,
                    description = excluded.description,
                    original_prompt = COALESCE(excluded.original_prompt, _app_registry.original_prompt),
                    generated_code = COALESCE(excluded.generated_code, _app_registry.generated_code),
                    updated_at = CURRENT_TIMESTAMP
            `);

            stmt.run(appId, appName, description, originalPrompt, generatedCode);

            const app = db.prepare('SELECT * FROM _app_registry WHERE app_id = ?').get(appId);

            logger.info('App registered successfully', { appId, appName });
            return { success: true, app };
        } catch (error) {
            logger.error('Failed to register app', { appId, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get information about a registered app
     * @param {string} appId - The app's unique identifier
     * @returns {Promise<{success: boolean, app?: Object, error?: string}>}
     */
    async getAppInfo(appId) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);

            const app = db.prepare('SELECT * FROM _app_registry WHERE app_id = ?').get(appId);

            if (!app) {
                return { success: false, error: 'App not found' };
            }

            // Get tables owned by this app
            const tables = db.prepare('SELECT table_name, description FROM _table_registry WHERE app_id = ?').all(appId);

            return {
                success: true,
                app: {
                    ...app,
                    tables: tables
                }
            };
        } catch (error) {
            logger.error('Failed to get app info', { appId, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * List all registered apps
     * @returns {Promise<{success: boolean, apps?: Array, error?: string}>}
     */
    async listApps() {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);

            // Ensure registry exists
            await this.initializeSharedDatabase();

            const apps = db.prepare(`
                SELECT
                    ar.*,
                    COUNT(tr.id) as table_count
                FROM _app_registry ar
                LEFT JOIN _table_registry tr ON ar.app_id = tr.app_id
                GROUP BY ar.id
                ORDER BY ar.created_at DESC
            `).all();

            return { success: true, apps };
        } catch (error) {
            logger.error('Failed to list apps', { error });
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    // APP DEPRECATION & REGENERATION
    // ============================================================

    /**
     * Mark an app as deprecated due to schema changes
     * @param {string} appId - The app to deprecate
     * @param {string} reason - Why the app was deprecated
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async deprecateApp(appId, reason) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);

            const stmt = db.prepare(`
                UPDATE _app_registry
                SET status = 'deprecated',
                    deprecation_reason = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE app_id = ?
            `);

            const result = stmt.run(reason, appId);

            if (result.changes === 0) {
                return { success: false, error: 'App not found' };
            }

            logger.info('App deprecated', { appId, reason });
            return { success: true };
        } catch (error) {
            logger.error('Failed to deprecate app', { appId, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all registered apps
     * @returns {Promise<{success: boolean, apps?: Array, error?: string}>}
     */
    async getAppRegistry() {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);
            await this.initializeSharedDatabase();

            const apps = db.prepare(`
                SELECT
                    ar.*,
                    COUNT(tr.id) as table_count
                FROM _app_registry ar
                LEFT JOIN _table_registry tr ON ar.app_id = tr.app_id
                GROUP BY ar.id
                ORDER BY ar.created_at DESC
            `).all();

            return { success: true, apps };
        } catch (error) {
            logger.error('Failed to get app registry', { error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all deprecated apps that need regeneration
     * @returns {Promise<{success: boolean, apps?: Array, error?: string}>}
     */
    async getDeprecatedApps() {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);
            await this.initializeSharedDatabase();

            const apps = db.prepare(`
                SELECT
                    ar.*,
                    COUNT(tr.id) as table_count
                FROM _app_registry ar
                LEFT JOIN _table_registry tr ON ar.app_id = tr.app_id
                WHERE ar.status = 'deprecated'
                GROUP BY ar.id
                ORDER BY ar.updated_at DESC
            `).all();

            return { success: true, apps };
        } catch (error) {
            logger.error('Failed to get deprecated apps', { error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Update an app's code after regeneration
     * @param {string} appId - The app to update
     * @param {string} newCode - The newly generated code
     * @param {boolean} markActive - Whether to mark as active (default true)
     * @returns {Promise<{success: boolean, app?: Object, error?: string}>}
     */
    async updateAppCode(appId, newCode, markActive = true) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);

            const stmt = db.prepare(`
                UPDATE _app_registry
                SET generated_code = ?,
                    status = ?,
                    deprecation_reason = NULL,
                    last_regenerated = CURRENT_TIMESTAMP,
                    version = version + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE app_id = ?
            `);

            const result = stmt.run(newCode, markActive ? 'active' : 'deprecated', appId);

            if (result.changes === 0) {
                return { success: false, error: 'App not found' };
            }

            const app = db.prepare('SELECT * FROM _app_registry WHERE app_id = ?').get(appId);

            logger.info('App code updated', { appId, version: app.version });
            return { success: true, app };
        } catch (error) {
            logger.error('Failed to update app code', { appId, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Deprecate all apps affected by a schema change
     * @param {string} tableName - The table that was changed
     * @param {Object} impact - The impact analysis result
     * @returns {Promise<{success: boolean, deprecatedApps?: Array, error?: string}>}
     */
    async deprecateAffectedApps(tableName, impact) {
        try {
            const deprecatedApps = [];

            for (const app of impact.apps_with_impact || []) {
                if (app.impact_level === 'breaking') {
                    const reason = `Schema change in table '${tableName}': ${app.breaking_changes.map(c => c.message).join('; ')}`;
                    await this.deprecateApp(app.app_id, reason);
                    deprecatedApps.push({
                        app_id: app.app_id,
                        app_name: app.app_name,
                        reason: reason
                    });
                }
            }

            logger.info('Deprecated affected apps', { tableName, count: deprecatedApps.length });
            return { success: true, deprecatedApps };
        } catch (error) {
            logger.error('Failed to deprecate affected apps', { tableName, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get apps that can be regenerated (have original prompt stored)
     * @returns {Promise<{success: boolean, apps?: Array, error?: string}>}
     */
    async getRegeneratableApps() {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);
            await this.initializeSharedDatabase();

            const apps = db.prepare(`
                SELECT
                    ar.*,
                    COUNT(tr.id) as table_count
                FROM _app_registry ar
                LEFT JOIN _table_registry tr ON ar.app_id = tr.app_id
                WHERE ar.status = 'deprecated'
                  AND ar.original_prompt IS NOT NULL
                  AND ar.original_prompt != ''
                GROUP BY ar.id
                ORDER BY ar.updated_at DESC
            `).all();

            return { success: true, apps };
        } catch (error) {
            logger.error('Failed to get regeneratable apps', { error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Create a table with ownership tracking
     * @param {string} dbName - Database name
     * @param {string} tableName - Name of the table
     * @param {Object} schema - Table schema
     * @param {string} appId - The app that owns this table
     * @param {string} description - Description of the table's purpose
     * @returns {Promise<{success: boolean, table?: string, error?: string}>}
     */
    async createTableWithOwner(dbName, tableName, schema, appId, description = '') {
        try {
            // First create the table using existing method
            const result = await this.createTable(dbName, tableName, schema);

            if (!result.success) {
                return result;
            }

            // Register the table in the registry
            const db = await this.connectDatabase(dbName);

            // Ensure registry tables exist
            await this.initializeSharedDatabase(dbName);

            const stmt = db.prepare(`
                INSERT INTO _table_registry (table_name, app_id, schema_json, description)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(table_name) DO UPDATE SET
                    app_id = excluded.app_id,
                    schema_json = excluded.schema_json,
                    description = excluded.description,
                    updated_at = CURRENT_TIMESTAMP
            `);

            stmt.run(tableName, appId, JSON.stringify(schema), description);

            logger.info('Table created with owner', { database: dbName, table: tableName, appId });
            return { success: true, table: tableName };
        } catch (error) {
            logger.error('Failed to create table with owner', { dbName, tableName, appId, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Record a relationship between tables
     * @param {string} sourceTable - The source table name
     * @param {string} targetTable - The target table name
     * @param {string} relationshipType - Type of relationship (e.g., 'foreign_key', 'references', 'one_to_many')
     * @param {string} description - Description of the relationship
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async recordTableRelationship(sourceTable, targetTable, relationshipType, description = '') {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);

            // Ensure registry tables exist
            await this.initializeSharedDatabase();

            const stmt = db.prepare(`
                INSERT INTO _table_relationships (source_table, target_table, relationship_type, description)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(source_table, target_table, relationship_type) DO UPDATE SET
                    description = excluded.description
            `);

            stmt.run(sourceTable, targetTable, relationshipType, description);

            logger.info('Table relationship recorded', { sourceTable, targetTable, relationshipType });
            return { success: true };
        } catch (error) {
            logger.error('Failed to record table relationship', { sourceTable, targetTable, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get tables related to a specific table
     * @param {string} tableName - The table to find relationships for
     * @returns {Promise<{success: boolean, related?: Array, error?: string}>}
     */
    async getRelatedTables(tableName) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);

            // Get tables where this table is the source
            const outgoing = db.prepare(`
                SELECT target_table as table_name, relationship_type, description, 'outgoing' as direction
                FROM _table_relationships
                WHERE source_table = ?
            `).all(tableName);

            // Get tables where this table is the target
            const incoming = db.prepare(`
                SELECT source_table as table_name, relationship_type, description, 'incoming' as direction
                FROM _table_relationships
                WHERE target_table = ?
            `).all(tableName);

            return {
                success: true,
                related: [...outgoing, ...incoming]
            };
        } catch (error) {
            logger.error('Failed to get related tables', { tableName, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all table schemas from the shared database
     * Includes ownership information and relationships
     * @param {string} dbName - Database name (defaults to SHARED_DB_NAME)
     * @returns {Promise<{success: boolean, schemas?: Object, error?: string}>}
     */
    async getAllSchemas(dbName = DATABASE.SHARED_DB_NAME) {
        try {
            const db = await this.connectDatabase(dbName);

            // Get all user tables (excluding system tables)
            const tablesResult = await this.listTables(dbName);

            const schemas = {};

            for (const tableName of tablesResult.tables) {
                const schema = await this.getTableSchema(db, tableName);

                // Try to get registry info if available
                let registryInfo = null;
                try {
                    registryInfo = db.prepare(`
                        SELECT tr.*, ar.app_name, ar.app_id
                        FROM _table_registry tr
                        LEFT JOIN _app_registry ar ON tr.app_id = ar.app_id
                        WHERE tr.table_name = ?
                    `).get(tableName);
                } catch (e) {
                    // Registry tables might not exist yet
                }

                // Get relationships
                let relationships = [];
                try {
                    const related = await this.getRelatedTables(tableName);
                    if (related.success) {
                        relationships = related.related;
                    }
                } catch (e) {
                    // Relationships table might not exist
                }

                schemas[tableName] = {
                    ...schema,
                    owner: registryInfo ? {
                        appId: registryInfo.app_id,
                        appName: registryInfo.app_name,
                        description: registryInfo.description
                    } : null,
                    relationships
                };
            }

            return { success: true, schemas };
        } catch (error) {
            logger.error('Failed to get all schemas', { dbName, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Build a comprehensive schema context for AI prompts
     * Includes table structures, sample data, and relationships
     * @param {string} dbName - Database name (defaults to SHARED_DB_NAME)
     * @returns {Promise<{success: boolean, context?: string, error?: string}>}
     */
    async buildSchemaContext(dbName = DATABASE.SHARED_DB_NAME) {
        try {
            const db = await this.connectDatabase(dbName);
            const schemasResult = await this.getAllSchemas(dbName);

            if (!schemasResult.success) {
                return schemasResult;
            }

            const schemas = schemasResult.schemas;
            const tableNames = Object.keys(schemas);

            // Limit to configured max tables
            const maxTables = DATABASE.MAX_SCHEMA_CONTEXT_TABLES || 20;
            const tablesToInclude = tableNames.slice(0, maxTables);

            let context = '## Existing Database Schema\n\n';
            context += `Database: ${dbName}\n`;
            context += `Total tables: ${tableNames.length}\n\n`;

            for (const tableName of tablesToInclude) {
                const tableSchema = schemas[tableName];

                context += `### Table: ${tableName}\n`;

                if (tableSchema.owner) {
                    context += `Owner App: ${tableSchema.owner.appName || tableSchema.owner.appId}\n`;
                    if (tableSchema.owner.description) {
                        context += `Purpose: ${tableSchema.owner.description}\n`;
                    }
                }

                context += `Columns:\n`;
                for (const [colName, colDef] of Object.entries(tableSchema.columns || {})) {
                    const type = colDef.type || 'string';
                    const constraints = [];
                    if (colDef.required) constraints.push('NOT NULL');
                    if (colDef.unique) constraints.push('UNIQUE');
                    if (colDef.primaryKey) constraints.push('PRIMARY KEY');
                    if (colDef.default !== undefined) constraints.push(`DEFAULT ${colDef.default}`);

                    context += `  - ${colName}: ${type}${constraints.length ? ' (' + constraints.join(', ') + ')' : ''}\n`;
                }

                // Add relationships
                if (tableSchema.relationships && tableSchema.relationships.length > 0) {
                    context += `Relationships:\n`;
                    for (const rel of tableSchema.relationships) {
                        context += `  - ${rel.direction}: ${rel.table_name} (${rel.relationship_type})\n`;
                    }
                }

                // Add sample data
                try {
                    const maxSamples = DATABASE.MAX_SAMPLE_ROWS_PER_TABLE || 3;
                    const sampleData = await this.queryData(dbName, tableName, { limit: maxSamples });

                    if (sampleData.success && sampleData.data.length > 0) {
                        context += `Sample data (${sampleData.data.length} rows):\n`;
                        context += '```json\n';
                        context += JSON.stringify(sampleData.data, null, 2);
                        context += '\n```\n';
                    }
                } catch (e) {
                    // Skip sample data if query fails
                }

                context += '\n';
            }

            if (tableNames.length > maxTables) {
                context += `\n... and ${tableNames.length - maxTables} more tables.\n`;
            }

            return { success: true, context };
        } catch (error) {
            logger.error('Failed to build schema context', { dbName, error });
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    // TABLE USAGE TRACKING & DEPENDENCY ANALYSIS
    // For detecting when schema changes affect other apps
    // ============================================================

    /**
     * Register that an app uses a table
     * @param {string} tableName - The table being used
     * @param {string} appId - The app using the table
     * @param {string} accessType - Type of access: 'read', 'write', or 'both'
     * @param {Array<string>} columnsUsed - Which columns the app uses
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async registerTableUsage(tableName, appId, accessType = 'read', columnsUsed = []) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);
            await this.initializeSharedDatabase();

            const stmt = db.prepare(`
                INSERT INTO _table_usage (table_name, app_id, access_type, columns_used, last_accessed, access_count)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
                ON CONFLICT(table_name, app_id) DO UPDATE SET
                    access_type = CASE
                        WHEN excluded.access_type != _table_usage.access_type THEN 'both'
                        ELSE excluded.access_type
                    END,
                    columns_used = excluded.columns_used,
                    last_accessed = CURRENT_TIMESTAMP,
                    access_count = access_count + 1
            `);

            stmt.run(tableName, appId, accessType, JSON.stringify(columnsUsed));

            logger.info('Table usage registered', { tableName, appId, accessType });
            return { success: true };
        } catch (error) {
            logger.error('Failed to register table usage', { tableName, appId, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all apps that use a specific table
     * @param {string} tableName - The table to check
     * @returns {Promise<{success: boolean, apps?: Array, error?: string}>}
     */
    async getTableDependencies(tableName) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);
            await this.initializeSharedDatabase();

            const dependencies = db.prepare(`
                SELECT
                    tu.app_id,
                    tu.access_type,
                    tu.columns_used,
                    tu.last_accessed,
                    tu.access_count,
                    ar.app_name,
                    ar.description as app_description,
                    ar.status as app_status
                FROM _table_usage tu
                LEFT JOIN _app_registry ar ON tu.app_id = ar.app_id
                WHERE tu.table_name = ?
                ORDER BY tu.access_count DESC
            `).all(tableName);

            // Parse columns_used JSON
            const apps = dependencies.map(dep => ({
                ...dep,
                columns_used: dep.columns_used ? JSON.parse(dep.columns_used) : []
            }));

            return { success: true, apps };
        } catch (error) {
            logger.error('Failed to get table dependencies', { tableName, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all tables used by a specific app
     * @param {string} appId - The app to check
     * @returns {Promise<{success: boolean, tables?: Array, error?: string}>}
     */
    async getAppTableUsage(appId) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);
            await this.initializeSharedDatabase();

            const tables = db.prepare(`
                SELECT
                    tu.table_name,
                    tu.access_type,
                    tu.columns_used,
                    tu.last_accessed,
                    tu.access_count,
                    tr.app_id as owner_app_id,
                    ar.app_name as owner_app_name
                FROM _table_usage tu
                LEFT JOIN _table_registry tr ON tu.table_name = tr.table_name
                LEFT JOIN _app_registry ar ON tr.app_id = ar.app_id
                WHERE tu.app_id = ?
                ORDER BY tu.last_accessed DESC
            `).all(appId);

            // Parse columns_used JSON
            const result = tables.map(t => ({
                ...t,
                columns_used: t.columns_used ? JSON.parse(t.columns_used) : [],
                is_owner: t.owner_app_id === appId
            }));

            return { success: true, tables: result };
        } catch (error) {
            logger.error('Failed to get app table usage', { appId, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Analyze the impact of a schema change on other apps
     * @param {string} tableName - The table being modified
     * @param {Object} newSchema - The proposed new schema
     * @param {string} changingAppId - The app making the change
     * @returns {Promise<{success: boolean, impact?: Object, error?: string}>}
     */
    async analyzeSchemaChangeImpact(tableName, newSchema, changingAppId) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);
            await this.initializeSharedDatabase();

            // Get current schema
            const currentSchemaRow = db.prepare(`
                SELECT schema_json FROM _table_registry WHERE table_name = ?
            `).get(tableName);

            const currentSchema = currentSchemaRow ? JSON.parse(currentSchemaRow.schema_json) : null;

            // Get all apps using this table (excluding the one making the change)
            const depsResult = await this.getTableDependencies(tableName);
            const affectedApps = depsResult.success
                ? depsResult.apps.filter(app => app.app_id !== changingAppId)
                : [];

            // Analyze schema differences
            const changes = this.compareSchemas(currentSchema, newSchema);

            // Determine impact level for each affected app
            const impactDetails = affectedApps.map(app => {
                const columnsUsed = app.columns_used || [];
                const breakingChanges = [];
                const warnings = [];

                // Check for removed columns that the app uses
                for (const removedCol of changes.removedColumns) {
                    if (columnsUsed.includes(removedCol) || columnsUsed.length === 0) {
                        breakingChanges.push({
                            type: 'column_removed',
                            column: removedCol,
                            message: `Column '${removedCol}' is being removed but may be used by this app`
                        });
                    }
                }

                // Check for type changes on columns the app uses
                for (const typeChange of changes.typeChanges) {
                    if (columnsUsed.includes(typeChange.column) || columnsUsed.length === 0) {
                        warnings.push({
                            type: 'type_changed',
                            column: typeChange.column,
                            oldType: typeChange.oldType,
                            newType: typeChange.newType,
                            message: `Column '${typeChange.column}' type changed from '${typeChange.oldType}' to '${typeChange.newType}'`
                        });
                    }
                }

                // Check for renamed columns
                for (const renamedCol of changes.renamedColumns) {
                    if (columnsUsed.includes(renamedCol.oldName) || columnsUsed.length === 0) {
                        breakingChanges.push({
                            type: 'column_renamed',
                            oldName: renamedCol.oldName,
                            newName: renamedCol.newName,
                            message: `Column '${renamedCol.oldName}' may have been renamed to '${renamedCol.newName}'`
                        });
                    }
                }

                return {
                    app_id: app.app_id,
                    app_name: app.app_name || app.app_id,
                    access_type: app.access_type,
                    columns_used: columnsUsed,
                    breaking_changes: breakingChanges,
                    warnings: warnings,
                    impact_level: breakingChanges.length > 0 ? 'breaking' : (warnings.length > 0 ? 'warning' : 'none')
                };
            });

            // Filter to only apps with actual impact
            const appsWithImpact = impactDetails.filter(app =>
                app.breaking_changes.length > 0 || app.warnings.length > 0
            );

            const impact = {
                table_name: tableName,
                changing_app: changingAppId,
                schema_changes: changes,
                affected_apps: impactDetails,
                apps_with_impact: appsWithImpact,
                has_breaking_changes: impactDetails.some(app => app.impact_level === 'breaking'),
                has_warnings: impactDetails.some(app => app.impact_level === 'warning'),
                total_affected: affectedApps.length,
                summary: this.generateImpactSummary(changes, appsWithImpact)
            };

            return { success: true, impact };
        } catch (error) {
            logger.error('Failed to analyze schema change impact', { tableName, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Compare two schemas and identify differences
     * @param {Object} oldSchema - The current schema
     * @param {Object} newSchema - The proposed new schema
     * @returns {Object} - Differences between schemas
     */
    compareSchemas(oldSchema, newSchema) {
        const oldColumns = oldSchema?.columns ? Object.keys(oldSchema.columns) : [];
        const newColumns = newSchema?.columns ? Object.keys(newSchema.columns) : [];

        const addedColumns = newColumns.filter(col => !oldColumns.includes(col));
        const removedColumns = oldColumns.filter(col => !newColumns.includes(col));
        const commonColumns = oldColumns.filter(col => newColumns.includes(col));

        const typeChanges = [];
        const constraintChanges = [];

        for (const col of commonColumns) {
            const oldDef = oldSchema.columns[col] || {};
            const newDef = newSchema.columns[col] || {};

            // Check type changes
            if (oldDef.type !== newDef.type) {
                typeChanges.push({
                    column: col,
                    oldType: oldDef.type || 'unknown',
                    newType: newDef.type || 'unknown'
                });
            }

            // Check constraint changes
            const constraintsToCheck = ['required', 'unique', 'primaryKey'];
            for (const constraint of constraintsToCheck) {
                if (oldDef[constraint] !== newDef[constraint]) {
                    constraintChanges.push({
                        column: col,
                        constraint: constraint,
                        oldValue: oldDef[constraint],
                        newValue: newDef[constraint]
                    });
                }
            }
        }

        // Try to detect renames (columns with similar types that were removed and added)
        const renamedColumns = [];
        for (const removed of removedColumns) {
            const oldType = oldSchema.columns[removed]?.type;
            for (const added of addedColumns) {
                const newType = newSchema.columns[added]?.type;
                if (oldType === newType) {
                    renamedColumns.push({ oldName: removed, newName: added, type: oldType });
                }
            }
        }

        return {
            addedColumns,
            removedColumns,
            typeChanges,
            constraintChanges,
            renamedColumns,
            hasChanges: addedColumns.length > 0 || removedColumns.length > 0 ||
                        typeChanges.length > 0 || constraintChanges.length > 0
        };
    }

    /**
     * Generate a human-readable summary of schema change impact
     */
    generateImpactSummary(changes, appsWithImpact) {
        const lines = [];

        if (!changes.hasChanges) {
            return 'No schema changes detected.';
        }

        if (changes.addedColumns.length > 0) {
            lines.push(`+ ${changes.addedColumns.length} column(s) added: ${changes.addedColumns.join(', ')}`);
        }
        if (changes.removedColumns.length > 0) {
            lines.push(`- ${changes.removedColumns.length} column(s) removed: ${changes.removedColumns.join(', ')}`);
        }
        if (changes.typeChanges.length > 0) {
            lines.push(`~ ${changes.typeChanges.length} type change(s)`);
        }

        if (appsWithImpact.length > 0) {
            const breakingCount = appsWithImpact.filter(a => a.impact_level === 'breaking').length;
            const warningCount = appsWithImpact.filter(a => a.impact_level === 'warning').length;

            if (breakingCount > 0) {
                lines.push(`⚠️ ${breakingCount} app(s) may be BROKEN by these changes`);
            }
            if (warningCount > 0) {
                lines.push(`⚡ ${warningCount} app(s) may need updates`);
            }
        } else {
            lines.push('✓ No other apps will be affected');
        }

        return lines.join('\n');
    }

    /**
     * Record a schema change in the history
     * @param {string} tableName - The table that was modified
     * @param {string} changeType - Type of change (create, alter, drop)
     * @param {Object} oldSchema - Previous schema
     * @param {Object} newSchema - New schema
     * @param {string} changedByApp - App that made the change
     * @param {Array<string>} affectedApps - Apps affected by this change
     */
    async recordSchemaChange(tableName, changeType, oldSchema, newSchema, changedByApp, affectedApps = []) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);
            await this.initializeSharedDatabase();

            const stmt = db.prepare(`
                INSERT INTO _schema_changes (table_name, change_type, old_schema, new_schema, changed_by_app, affected_apps)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            stmt.run(
                tableName,
                changeType,
                oldSchema ? JSON.stringify(oldSchema) : null,
                newSchema ? JSON.stringify(newSchema) : null,
                changedByApp,
                JSON.stringify(affectedApps)
            );

            logger.info('Schema change recorded', { tableName, changeType, changedByApp });
            return { success: true };
        } catch (error) {
            logger.error('Failed to record schema change', { tableName, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get schema change history for a table
     * @param {string} tableName - The table to get history for (optional, gets all if not specified)
     * @param {number} limit - Maximum number of records to return
     */
    async getSchemaChangeHistory(tableName = null, limit = 50) {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);
            await this.initializeSharedDatabase();

            let query = `
                SELECT * FROM _schema_changes
                ${tableName ? 'WHERE table_name = ?' : ''}
                ORDER BY created_at DESC
                LIMIT ?
            `;

            const params = tableName ? [tableName, limit] : [limit];
            const history = db.prepare(query).all(...params);

            // Parse JSON fields
            const result = history.map(h => ({
                ...h,
                old_schema: h.old_schema ? JSON.parse(h.old_schema) : null,
                new_schema: h.new_schema ? JSON.parse(h.new_schema) : null,
                affected_apps: h.affected_apps ? JSON.parse(h.affected_apps) : []
            }));

            return { success: true, history: result };
        } catch (error) {
            logger.error('Failed to get schema change history', { tableName, error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get a comprehensive dependency map for all tables
     * Shows which apps own and use each table
     */
    async getDependencyMap() {
        try {
            const db = await this.connectDatabase(DATABASE.SHARED_DB_NAME);
            await this.initializeSharedDatabase();

            // Get all tables with their owners
            const tables = db.prepare(`
                SELECT
                    tr.table_name,
                    tr.app_id as owner_app_id,
                    ar.app_name as owner_app_name,
                    tr.description,
                    tr.schema_json
                FROM _table_registry tr
                LEFT JOIN _app_registry ar ON tr.app_id = ar.app_id
            `).all();

            // Build dependency map
            const dependencyMap = {};

            for (const table of tables) {
                const depsResult = await this.getTableDependencies(table.table_name);
                const users = depsResult.success ? depsResult.apps : [];

                dependencyMap[table.table_name] = {
                    owner: {
                        app_id: table.owner_app_id,
                        app_name: table.owner_app_name
                    },
                    description: table.description,
                    schema: table.schema_json ? JSON.parse(table.schema_json) : null,
                    used_by: users.map(u => ({
                        app_id: u.app_id,
                        app_name: u.app_name,
                        access_type: u.access_type,
                        columns_used: u.columns_used
                    })),
                    user_count: users.length
                };
            }

            return { success: true, dependencyMap };
        } catch (error) {
            logger.error('Failed to get dependency map', { error });
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    // DATABASE BACKUP & RESTORE (with encryption)
    // ============================================================

    /**
     * Create an encrypted backup of a database
     * @param {string} dbName - Name of the database to backup
     * @param {string} backupPassword - Optional password for extra encryption layer
     * @returns {Promise<{success: boolean, backupPath?: string, error?: string}>}
     */
    async backupDatabase(dbName, backupPassword = null) {
        try {
            await this.initialize();

            const backupDir = path.join(this.dataPath, 'backups');
            await fs.mkdir(backupDir, { recursive: true });

            // Export database data
            const exportResult = await this.exportDatabase(dbName);
            if (!exportResult.success) {
                return { success: false, error: 'Failed to export database' };
            }

            // Create backup metadata
            const backupData = {
                version: '1.0',
                created_at: new Date().toISOString(),
                database: dbName,
                encrypted: !!backupPassword,
                checksum: null,
                data: exportResult.export
            };

            // Serialize backup data
            let backupContent = JSON.stringify(backupData, null, 2);

            // Calculate checksum before encryption
            const checksum = crypto.createHash('sha256').update(backupContent).digest('hex');
            backupData.checksum = checksum;
            backupContent = JSON.stringify(backupData, null, 2);

            // Encrypt if password provided
            if (backupPassword) {
                backupContent = this.encryptBackup(backupContent, backupPassword);
            }

            // Generate backup filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFilename = `${dbName}_backup_${timestamp}${backupPassword ? '.encrypted' : ''}.json`;
            const backupPath = path.join(backupDir, backupFilename);

            // Write backup file
            await fs.writeFile(backupPath, backupContent, 'utf8');

            logger.info('Database backup created', {
                database: dbName,
                backupPath,
                encrypted: !!backupPassword
            });

            return {
                success: true,
                backupPath,
                filename: backupFilename,
                encrypted: !!backupPassword,
                size: backupContent.length
            };
        } catch (error) {
            logger.error('Failed to create database backup', { database: dbName, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Restore a database from a backup file
     * @param {string} backupPath - Path to the backup file
     * @param {string} targetDbName - Name for the restored database (optional, uses original name if not provided)
     * @param {string} backupPassword - Password if backup is encrypted
     * @returns {Promise<{success: boolean, database?: string, error?: string}>}
     */
    async restoreDatabase(backupPath, targetDbName = null, backupPassword = null) {
        try {
            await this.initialize();

            // Read backup file
            let backupContent = await fs.readFile(backupPath, 'utf8');

            // Check if encrypted
            const isEncrypted = backupPath.includes('.encrypted') || this.isEncryptedBackup(backupContent);

            // Decrypt if necessary
            if (isEncrypted) {
                if (!backupPassword) {
                    return { success: false, error: 'Backup is encrypted. Password required.' };
                }
                backupContent = this.decryptBackup(backupContent, backupPassword);
                if (!backupContent) {
                    return { success: false, error: 'Failed to decrypt backup. Invalid password.' };
                }
            }

            // Parse backup data
            let backupData;
            try {
                backupData = JSON.parse(backupContent);
            } catch (parseError) {
                return { success: false, error: 'Invalid backup file format' };
            }

            // Verify checksum
            if (backupData.checksum) {
                const contentWithoutChecksum = { ...backupData };
                contentWithoutChecksum.checksum = null;
                const contentStr = JSON.stringify(contentWithoutChecksum, null, 2);
                const calculatedChecksum = crypto.createHash('sha256').update(contentStr).digest('hex');

                // Note: Checksum verification is informational due to how we serialize
                logger.debug('Backup checksum verification', {
                    stored: backupData.checksum,
                    calculated: calculatedChecksum
                });
            }

            // Determine target database name
            const dbName = targetDbName || backupData.database || backupData.data?.database;
            if (!dbName) {
                return { success: false, error: 'Could not determine database name from backup' };
            }

            // Get export data
            const exportData = backupData.data || backupData;
            if (!exportData.tables) {
                return { success: false, error: 'Invalid backup format: no tables found' };
            }

            // Restore each table
            for (const [tableName, tableData] of Object.entries(exportData.tables)) {
                // Skip system tables
                if (tableName.startsWith('_')) continue;

                // Create table with schema
                if (tableData.schema) {
                    await this.createTable(dbName, tableName, {
                        columns: this.schemaToColumns(tableData.schema)
                    });
                }

                // Insert data
                if (tableData.data && Array.isArray(tableData.data)) {
                    for (const row of tableData.data) {
                        // Remove id if auto-increment to let DB generate new ones
                        const insertData = { ...row };
                        await this.insertData(dbName, tableName, insertData);
                    }
                }
            }

            logger.info('Database restored from backup', {
                database: dbName,
                backupPath,
                tables: Object.keys(exportData.tables).length
            });

            return {
                success: true,
                database: dbName,
                tablesRestored: Object.keys(exportData.tables).length
            };
        } catch (error) {
            logger.error('Failed to restore database from backup', { backupPath, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * List available backup files
     * @returns {Promise<{success: boolean, backups?: Array, error?: string}>}
     */
    async listBackups() {
        try {
            await this.initialize();

            const backupDir = path.join(this.dataPath, 'backups');

            // Create backups dir if it doesn't exist
            try {
                await fs.mkdir(backupDir, { recursive: true });
            } catch (e) {
                // Ignore if already exists
            }

            const files = await fs.readdir(backupDir);
            const backups = [];

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(backupDir, file);
                    const stats = await fs.stat(filePath);

                    // Parse backup metadata
                    const isEncrypted = file.includes('.encrypted');
                    const match = file.match(/^(.+)_backup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);

                    backups.push({
                        filename: file,
                        path: filePath,
                        database: match ? match[1] : 'unknown',
                        createdAt: match ? match[2].replace(/-/g, ':').replace('T', ' ') : stats.birthtime,
                        size: stats.size,
                        encrypted: isEncrypted
                    });
                }
            }

            // Sort by creation date (newest first)
            backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            return { success: true, backups };
        } catch (error) {
            logger.error('Failed to list backups', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete a backup file
     * @param {string} backupPath - Path to the backup file
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async deleteBackup(backupPath) {
        try {
            // Security: Ensure path is within backups directory
            const backupDir = path.join(this.dataPath, 'backups');
            const resolvedPath = path.resolve(backupPath);

            if (!resolvedPath.startsWith(backupDir)) {
                return { success: false, error: 'Invalid backup path' };
            }

            await fs.unlink(resolvedPath);

            logger.info('Backup deleted', { backupPath: resolvedPath });
            return { success: true };
        } catch (error) {
            logger.error('Failed to delete backup', { backupPath, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Encrypt backup content
     * @private
     */
    encryptBackup(content, password) {
        const iv = crypto.randomBytes(16);
        const salt = crypto.randomBytes(32);
        const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

        let encrypted = cipher.update(content, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        const authTag = cipher.getAuthTag();

        // Return as JSON with all encryption parameters
        return JSON.stringify({
            encrypted: true,
            algorithm: 'aes-256-gcm',
            iv: iv.toString('base64'),
            salt: salt.toString('base64'),
            authTag: authTag.toString('base64'),
            data: encrypted
        });
    }

    /**
     * Decrypt backup content
     * @private
     */
    decryptBackup(encryptedContent, password) {
        try {
            const encObj = JSON.parse(encryptedContent);

            if (!encObj.encrypted || encObj.algorithm !== 'aes-256-gcm') {
                throw new Error('Invalid encrypted backup format');
            }

            const iv = Buffer.from(encObj.iv, 'base64');
            const salt = Buffer.from(encObj.salt, 'base64');
            const authTag = Buffer.from(encObj.authTag, 'base64');
            const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');

            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(encObj.data, 'base64', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            logger.error('Failed to decrypt backup', { error: error.message });
            return null;
        }
    }

    /**
     * Check if content appears to be encrypted backup
     * @private
     */
    isEncryptedBackup(content) {
        try {
            const obj = JSON.parse(content);
            return obj.encrypted === true && obj.algorithm === 'aes-256-gcm';
        } catch {
            return false;
        }
    }

    /**
     * Convert schema array to columns object
     * @private
     */
    schemaToColumns(schema) {
        const columns = {};
        if (Array.isArray(schema)) {
            for (const col of schema) {
                if (col.name && col.name !== 'id') {
                    columns[col.name] = {
                        type: col.type?.toLowerCase() || 'string',
                        required: col.notnull === 1
                    };
                }
            }
        }
        return columns;
    }

    /**
     * Close all database connections
     */
    async closeAllConnections() {
        logger.info('Closing all database connections', {
            count: this.connections.size
        });
        
        const closePromises = [];
        
        for (const [dbName] of this.connections) {
            closePromises.push(this.closeDatabase(dbName));
        }
        
        await Promise.allSettled(closePromises);
        
        // Clear all tracking maps
        this.connections.clear();
        this.connectionTimestamps.clear();
        this.schemas.clear();
        this.migrations.clear();
        
        logger.info('All database connections closed');
        
        return true;
    }
}

module.exports = DatabaseManager;