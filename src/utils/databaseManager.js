const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const sqlValidator = require('./sqlValidator');
const databaseOptimizer = require('./databaseOptimizer');

class DatabaseManager {
    constructor(dataPath = null, options = {}) {
        this.dataPath = dataPath || path.join(__dirname, '..', '..', 'data');
        this.connections = new Map(); // Multiple database connections
        this.connectionTimestamps = new Map(); // Track connection creation times
        this.maxConnectionAge = options.maxConnectionAge || 30 * 60 * 1000; // 30 minutes
        this.maxConnections = options.maxConnections || 10;
        this.schemas = new Map(); // Track schemas for each database
        this.migrations = new Map(); // Track migrations
        
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
        
        this.initializeDataDirectory();
        this.startMaintenanceTasks();
        
        // Cleanup on process exit
        process.on('exit', () => this.cleanup());
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
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
     */
    releaseConnection(dbName, connection) {
        const poolKey = dbName;
        const pool = this.connectionPools.get(poolKey);
        
        if (!pool) {
            logger.warn('Attempted to release connection to non-existent pool', { poolKey });
            return;
        }
        
        pool.inUse.delete(connection);
        connection.lastUsed = Date.now();
        pool.available.push(connection);
        pool.stats.activeConnections--;
        
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
        const connection = {
            id: uuidv4(),
            dbName,
            db: new Database(dbPath),
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
     * Return connection to pool
     */
    releaseConnection(connection) {
        const poolKey = connection.dbName;
        const pool = this.connectionPools.get(poolKey);
        
        if (pool && pool.inUse.has(connection)) {
            pool.inUse.delete(connection);
            pool.stats.activeConnections--;
            connection.lastUsed = Date.now();
            
            // Check if connection should be closed (idle timeout)
            const idleTime = Date.now() - connection.lastUsed;
            if (idleTime > this.poolOptions.idleTimeout) {
                connection.db.close();
                pool.created--;
                logger.debug('Idle connection closed', { 
                    connectionId: connection.id,
                    database: connection.dbName,
                    idleTime
                });
            } else {
                pool.available.push(connection);
            }
        }
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
     * Start maintenance tasks
     */
    startMaintenanceTasks() {
        // Cleanup idle connections every 5 minutes
        setInterval(() => {
            this.cleanupIdleConnections();
        }, 5 * 60 * 1000);

        // Optimize databases every hour
        setInterval(() => {
            this.optimizeDatabases();
        }, 60 * 60 * 1000);

        // Clear query cache every 30 minutes
        setInterval(() => {
            this.cleanupQueryCache();
        }, 30 * 60 * 1000);
    }

    /**
     * Cleanup idle connections
     */
    cleanupIdleConnections() {
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
            
            const createTableSQL = `
                CREATE TABLE IF NOT EXISTS ${tableName} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ${columns}${constraints ? ', ' + constraints : ''},
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
     * Query data from table
     */
    async queryData(dbName, tableName, options = {}) {
        try {
            const db = await this.connectDatabase(dbName);
            
            let sql = `SELECT * FROM ${tableName}`;
            const params = [];
            
            // Add WHERE clause
            if (options.where) {
                const whereClause = this.buildWhereClause(options.where);
                sql += ` WHERE ${whereClause.sql}`;
                params.push(...whereClause.params);
            }
            
            // Add ORDER BY
            if (options.orderBy) {
                sql += ` ORDER BY ${options.orderBy}`;
                if (options.order && options.order.toLowerCase() === 'desc') {
                    sql += ' DESC';
                }
            }
            
            // Add LIMIT and OFFSET
            if (options.limit) {
                sql += ` LIMIT ${parseInt(options.limit)}`;
                if (options.offset) {
                    sql += ` OFFSET ${parseInt(options.offset)}`;
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
            
            const updates = Object.keys(validatedData).map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(validatedData), id];
            
            const updateSQL = `UPDATE ${tableName} SET ${updates} WHERE id = ?`;
            const stmt = db.prepare(updateSQL);
            const result = stmt.run(...values);
            
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
            
            const deleteSQL = `DELETE FROM ${tableName} WHERE id = ?`;
            const stmt = db.prepare(deleteSQL);
            const result = stmt.run(id);
            
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
            
            const stmt = db.prepare(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name NOT LIKE '_%'
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