const Database = require('better-sqlite3-multiple-ciphers');
const logger = require('./logger');
const advancedCache = require('./advancedCache');

/**
 * Database Query Optimizer and Batch Operations Manager
 * Improves database performance through query optimization and batching
 */
class DatabaseOptimizer {
    constructor() {
        this.queryCache = new Map();
        this.preparedStatements = new Map();
        this.batchQueue = new Map();
        this.indexSuggestions = new Map();
        this.queryStats = new Map();
        
        // Batch configuration
        this.batchConfig = {
            maxBatchSize: 1000,
            flushInterval: 100, // ms
            maxQueueSize: 10000
        };
        
        // Query optimization config
        this.optimizationConfig = {
            enableQueryCache: true,
            enableIndexSuggestions: true,
            enableQueryRewriting: true,
            analyzeTreshold: 100 // Analyze after N executions
        };
        
        // Start batch processing
        this.startBatchProcessor();
    }
    
    /**
     * Optimize a SQL query
     */
    optimizeQuery(sql, params = []) {
        // Remove unnecessary whitespace
        let optimized = sql.replace(/\s+/g, ' ').trim();
        
        // Query rewriting optimizations
        if (this.optimizationConfig.enableQueryRewriting) {
            optimized = this.rewriteQuery(optimized);
        }
        
        // Suggest indices if needed
        if (this.optimizationConfig.enableIndexSuggestions) {
            this.analyzeForIndexes(optimized);
        }
        
        return { sql: optimized, params };
    }
    
    /**
     * Rewrite query for better performance
     */
    rewriteQuery(sql) {
        let rewritten = sql;
        
        // Convert NOT IN to NOT EXISTS (more efficient)
        rewritten = rewritten.replace(
            /NOT\s+IN\s*\((SELECT.*?)\)/gi,
            'NOT EXISTS ($1)'
        );
        
        // Convert OR to UNION where beneficial
        if (rewritten.includes(' OR ') && rewritten.includes('WHERE')) {
            const orConditions = this.extractOrConditions(rewritten);
            if (orConditions.length > 2) {
                // Consider UNION for multiple OR conditions
                // This is a simplified example
            }
        }
        
        // Add LIMIT if not present for SELECT without aggregation
        if (rewritten.startsWith('SELECT') && 
            !rewritten.includes('LIMIT') && 
            !rewritten.includes('COUNT') &&
            !rewritten.includes('SUM') &&
            !rewritten.includes('AVG')) {
            // Add a reasonable default limit
            rewritten += ' LIMIT 1000';
        }
        
        return rewritten;
    }
    
    /**
     * Analyze query for potential index improvements
     */
    analyzeForIndexes(sql) {
        const whereMatch = sql.match(/WHERE\s+(.*?)(?:GROUP|ORDER|LIMIT|$)/i);
        if (!whereMatch) return;
        
        const conditions = whereMatch[1];
        const columns = this.extractColumns(conditions);
        
        columns.forEach(column => {
            if (!this.indexSuggestions.has(column)) {
                this.indexSuggestions.set(column, 0);
            }
            this.indexSuggestions.set(column, this.indexSuggestions.get(column) + 1);
        });
        
        // Log suggestions when threshold is met
        for (const [column, count] of this.indexSuggestions) {
            if (count > this.optimizationConfig.analyzeTreshold) {
                logger.info('Index suggestion', {
                    column,
                    queryCount: count,
                    suggestion: `CREATE INDEX idx_${column} ON table_name(${column})`
                });
            }
        }
    }
    
    /**
     * Extract column names from WHERE clause
     */
    extractColumns(whereClause) {
        const columnPattern = /(\w+)\s*[=<>]/g;
        const columns = [];
        let match;
        
        while ((match = columnPattern.exec(whereClause)) !== null) {
            columns.push(match[1]);
        }
        
        return columns;
    }
    
    /**
     * Extract OR conditions
     */
    extractOrConditions(sql) {
        const whereMatch = sql.match(/WHERE\s+(.*?)(?:GROUP|ORDER|LIMIT|$)/i);
        if (!whereMatch) return [];
        
        return whereMatch[1].split(/\s+OR\s+/i);
    }
    
    /**
     * Create prepared statement with caching
     */
    prepareCachedStatement(db, sql) {
        const cacheKey = `${db.name}:${sql}`;
        
        if (this.preparedStatements.has(cacheKey)) {
            return this.preparedStatements.get(cacheKey);
        }
        
        const stmt = db.prepare(sql);
        this.preparedStatements.set(cacheKey, stmt);
        
        // Limit cache size
        if (this.preparedStatements.size > 100) {
            const firstKey = this.preparedStatements.keys().next().value;
            this.preparedStatements.delete(firstKey);
        }
        
        return stmt;
    }
    
    /**
     * Execute query with caching
     */
    async executeWithCache(db, sql, params = [], options = {}) {
        if (!this.optimizationConfig.enableQueryCache) {
            return this.executeDirectly(db, sql, params);
        }
        
        // Generate cache key
        const cacheKey = this.generateCacheKey(sql, params);
        
        // Check cache for SELECT queries
        if (sql.trim().toUpperCase().startsWith('SELECT')) {
            const cached = advancedCache.get(cacheKey);
            if (cached) {
                logger.debug('Query cache hit', { sql: sql.substring(0, 50) });
                return cached;
            }
        }
        
        // Execute query
        const result = await this.executeDirectly(db, sql, params);
        
        // Cache result for SELECT queries
        if (sql.trim().toUpperCase().startsWith('SELECT')) {
            advancedCache.set(cacheKey, result, {
                ttl: options.cacheTtl || 60000, // 1 minute default
                type: 'query'
            });
        }
        
        return result;
    }
    
    /**
     * Execute query directly
     */
    async executeDirectly(db, sql, params = []) {
        const startTime = performance.now();
        
        try {
            const stmt = this.prepareCachedStatement(db, sql);
            
            let result;
            if (sql.trim().toUpperCase().startsWith('SELECT')) {
                result = stmt.all(...params);
            } else {
                result = stmt.run(...params);
            }
            
            const duration = performance.now() - startTime;
            this.trackQueryStats(sql, duration, true);
            
            return result;
            
        } catch (error) {
            const duration = performance.now() - startTime;
            this.trackQueryStats(sql, duration, false);
            throw error;
        }
    }
    
    /**
     * Track query statistics
     */
    trackQueryStats(sql, duration, success) {
        const key = sql.substring(0, 100);
        
        if (!this.queryStats.has(key)) {
            this.queryStats.set(key, {
                count: 0,
                totalDuration: 0,
                avgDuration: 0,
                maxDuration: 0,
                minDuration: Infinity,
                errors: 0
            });
        }
        
        const stats = this.queryStats.get(key);
        stats.count++;
        stats.totalDuration += duration;
        stats.avgDuration = stats.totalDuration / stats.count;
        stats.maxDuration = Math.max(stats.maxDuration, duration);
        stats.minDuration = Math.min(stats.minDuration, duration);
        
        if (!success) {
            stats.errors++;
        }
        
        // Log slow queries
        if (duration > 100) {
            logger.warn('Slow query detected', {
                sql: key,
                duration: duration.toFixed(2) + 'ms',
                avgDuration: stats.avgDuration.toFixed(2) + 'ms'
            });
        }
    }
    
    /**
     * Generate cache key
     */
    generateCacheKey(sql, params) {
        return `query:${sql}:${JSON.stringify(params)}`;
    }
    
    /**
     * Add operation to batch queue
     */
    addToBatch(tableName, operation, data) {
        if (!this.batchQueue.has(tableName)) {
            this.batchQueue.set(tableName, {
                inserts: [],
                updates: [],
                deletes: []
            });
        }
        
        const queue = this.batchQueue.get(tableName);
        
        switch (operation) {
            case 'insert':
                queue.inserts.push(data);
                break;
            case 'update':
                queue.updates.push(data);
                break;
            case 'delete':
                queue.deletes.push(data);
                break;
        }
        
        // Check if we should flush
        const totalSize = queue.inserts.length + queue.updates.length + queue.deletes.length;
        if (totalSize >= this.batchConfig.maxBatchSize) {
            this.flushBatch(tableName);
        }
        
        return true;
    }
    
    /**
     * Execute batch operations
     */
    async flushBatch(tableName, db = null) {
        const queue = this.batchQueue.get(tableName);
        if (!queue || (!queue.inserts.length && !queue.updates.length && !queue.deletes.length)) {
            return { success: true, operations: 0 };
        }
        
        if (!db) {
            logger.warn('No database provided for batch flush', { tableName });
            return { success: false, error: 'No database connection' };
        }
        
        let totalOperations = 0;
        const startTime = performance.now();
        
        try {
            // Use transaction for atomicity
            db.exec('BEGIN TRANSACTION');
            
            // Process inserts
            if (queue.inserts.length > 0) {
                totalOperations += await this.executeBatchInserts(db, tableName, queue.inserts);
                queue.inserts = [];
            }
            
            // Process updates
            if (queue.updates.length > 0) {
                totalOperations += await this.executeBatchUpdates(db, tableName, queue.updates);
                queue.updates = [];
            }
            
            // Process deletes
            if (queue.deletes.length > 0) {
                totalOperations += await this.executeBatchDeletes(db, tableName, queue.deletes);
                queue.deletes = [];
            }
            
            db.exec('COMMIT');
            
            const duration = performance.now() - startTime;
            logger.info('Batch operations completed', {
                tableName,
                operations: totalOperations,
                duration: duration.toFixed(2) + 'ms',
                opsPerSecond: (totalOperations / (duration / 1000)).toFixed(0)
            });
            
            return { success: true, operations: totalOperations, duration };
            
        } catch (error) {
            db.exec('ROLLBACK');
            logger.error('Batch operation failed', error, { tableName });
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Execute batch inserts
     */
    async executeBatchInserts(db, tableName, inserts) {
        if (inserts.length === 0) return 0;
        
        // Get columns from first record
        const columns = Object.keys(inserts[0]);
        const placeholders = columns.map(() => '?').join(',');
        
        const sql = `INSERT INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders})`;
        const stmt = db.prepare(sql);
        
        // Use transaction for performance
        const insertMany = db.transaction((items) => {
            for (const item of items) {
                stmt.run(...columns.map(col => item[col]));
            }
        });
        
        insertMany(inserts);
        return inserts.length;
    }
    
    /**
     * Execute batch updates
     */
    async executeBatchUpdates(db, tableName, updates) {
        if (updates.length === 0) return 0;
        
        let count = 0;
        for (const update of updates) {
            const { id, data } = update;
            const columns = Object.keys(data);
            const setClause = columns.map(col => `${col} = ?`).join(',');
            
            const sql = `UPDATE ${tableName} SET ${setClause} WHERE id = ?`;
            const stmt = db.prepare(sql);
            stmt.run(...columns.map(col => data[col]), id);
            count++;
        }
        
        return count;
    }
    
    /**
     * Execute batch deletes
     */
    async executeBatchDeletes(db, tableName, deletes) {
        if (deletes.length === 0) return 0;
        
        const ids = deletes.map(d => d.id);
        const placeholders = ids.map(() => '?').join(',');
        
        const sql = `DELETE FROM ${tableName} WHERE id IN (${placeholders})`;
        const stmt = db.prepare(sql);
        const result = stmt.run(...ids);
        
        return result.changes;
    }
    
    /**
     * Start batch processor
     */
    startBatchProcessor() {
        this.batchInterval = setInterval(() => {
            this.flushAllBatches();
        }, this.batchConfig.flushInterval);
    }
    
    /**
     * Stop batch processor
     */
    stopBatchProcessor() {
        if (this.batchInterval) {
            clearInterval(this.batchInterval);
            this.flushAllBatches();
        }
    }
    
    /**
     * Flush all pending batches
     */
    async flushAllBatches() {
        const tables = Array.from(this.batchQueue.keys());
        
        for (const tableName of tables) {
            // Note: In production, you'd pass the appropriate db connection
            // await this.flushBatch(tableName, db);
        }
    }
    
    /**
     * Get query statistics
     */
    getQueryStats() {
        const stats = [];
        
        for (const [query, data] of this.queryStats) {
            stats.push({
                query,
                ...data,
                errorRate: data.errors / data.count * 100
            });
        }
        
        // Sort by total duration
        stats.sort((a, b) => b.totalDuration - a.totalDuration);
        
        return stats;
    }
    
    /**
     * Get index suggestions
     */
    getIndexSuggestions() {
        const suggestions = [];
        
        for (const [column, count] of this.indexSuggestions) {
            if (count > this.optimizationConfig.analyzeTreshold) {
                suggestions.push({
                    column,
                    queryCount: count,
                    priority: count > 1000 ? 'high' : count > 500 ? 'medium' : 'low',
                    sql: `CREATE INDEX idx_${column} ON table_name(${column})`
                });
            }
        }
        
        return suggestions.sort((a, b) => b.queryCount - a.queryCount);
    }
    
    /**
     * Clear all caches and stats
     */
    clear() {
        this.queryCache.clear();
        this.preparedStatements.clear();
        this.batchQueue.clear();
        this.queryStats.clear();
        this.indexSuggestions.clear();
    }
}

// Export singleton instance
module.exports = new DatabaseOptimizer();