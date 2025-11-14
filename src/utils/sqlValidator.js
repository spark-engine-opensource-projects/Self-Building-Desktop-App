const logger = require('./logger');

/**
 * SQL Query Validator and Sanitizer
 * Prevents SQL injection attacks by validating and sanitizing queries
 */
class SQLValidator {
    constructor() {
        // Whitelist of allowed SQL operations
        this.allowedOperations = [
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 
            'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE',
            'CREATE INDEX', 'DROP INDEX'
        ];

        // Dangerous SQL keywords that should be blocked
        this.dangerousKeywords = [
            'EXEC', 'EXECUTE', 'SCRIPT', 'SHUTDOWN', 
            'GRANT', 'REVOKE', 'ATTACH', 'DETACH',
            'PRAGMA', 'LOAD_EXTENSION'
        ];

        // Patterns that might indicate SQL injection
        this.suspiciousPatterns = [
            /(\-\-|\/\*|\*\/|xp_|sp_|0x)/gi,  // Comments and hex
            /(\bunion\b.*\bselect\b)/gi,        // Union attacks
            /(\bor\b\s*\d+\s*=\s*\d+)/gi,       // OR 1=1 attacks
            /(;\s*(drop|delete|insert|update)\s)/gi, // Multiple statements
            /(\binto\s+(outfile|dumpfile)\b)/gi, // File operations
        ];
    }

    /**
     * Validate SQL query for safety
     */
    validateQuery(sql, params = []) {
        if (!sql || typeof sql !== 'string') {
            throw new Error('Invalid SQL query provided');
        }

        const upperSQL = sql.toUpperCase().trim();
        
        // Check if operation is allowed
        const operation = this.getOperation(upperSQL);
        if (!this.isOperationAllowed(operation)) {
            logger.logSecurityEvent('blocked_sql_operation', {
                operation,
                query: sql.substring(0, 100)
            });
            throw new Error(`SQL operation '${operation}' is not allowed`);
        }

        // Check for dangerous keywords
        for (const keyword of this.dangerousKeywords) {
            if (upperSQL.includes(keyword)) {
                logger.logSecurityEvent('dangerous_sql_keyword', {
                    keyword,
                    query: sql.substring(0, 100)
                });
                throw new Error(`Dangerous SQL keyword '${keyword}' detected`);
            }
        }

        // Check for suspicious patterns
        for (const pattern of this.suspiciousPatterns) {
            if (pattern.test(sql)) {
                logger.logSecurityEvent('suspicious_sql_pattern', {
                    pattern: pattern.toString(),
                    query: sql.substring(0, 100)
                });
                throw new Error('Suspicious SQL pattern detected');
            }
        }

        // Validate parameter count matches placeholders
        this.validateParameters(sql, params);

        return true;
    }

    /**
     * Get SQL operation from query
     */
    getOperation(sql) {
        const match = sql.match(/^\s*(\w+(?:\s+\w+)?)/);
        return match ? match[1] : 'UNKNOWN';
    }

    /**
     * Check if operation is allowed
     */
    isOperationAllowed(operation) {
        return this.allowedOperations.includes(operation);
    }

    /**
     * Validate parameters match placeholders
     */
    validateParameters(sql, params) {
        const placeholders = (sql.match(/\?/g) || []).length;
        
        if (placeholders !== params.length) {
            logger.logSecurityEvent('sql_parameter_mismatch', {
                expected: placeholders,
                provided: params.length,
                query: sql.substring(0, 100)
            });
            throw new Error(`Parameter count mismatch: expected ${placeholders}, got ${params.length}`);
        }

        // Validate parameter types
        params.forEach((param, index) => {
            if (!this.isValidParameter(param)) {
                logger.logSecurityEvent('invalid_sql_parameter', {
                    index,
                    type: typeof param,
                    query: sql.substring(0, 100)
                });
                throw new Error(`Invalid parameter at index ${index}`);
            }
        });
    }

    /**
     * Check if parameter is valid
     */
    isValidParameter(param) {
        // Allow null, string, number, boolean, Date
        if (param === null || param === undefined) return true;
        if (typeof param === 'string') return param.length <= 10000;
        if (typeof param === 'number') return isFinite(param);
        if (typeof param === 'boolean') return true;
        if (param instanceof Date) return true;
        if (Buffer.isBuffer(param)) return param.length <= 1048576; // 1MB max
        
        return false;
    }

    /**
     * Create a prepared statement wrapper
     */
    prepareSafeQuery(sql, params = []) {
        this.validateQuery(sql, params);
        
        return {
            sql: sql,
            params: this.sanitizeParameters(params),
            validated: true,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Sanitize parameters
     */
    sanitizeParameters(params) {
        return params.map(param => {
            if (typeof param === 'string') {
                // Remove potential SQL injection characters
                return param.replace(/['";\\]/g, '');
            }
            return param;
        });
    }

    /**
     * Escape identifier (table/column names)
     */
    escapeIdentifier(identifier) {
        if (!identifier || typeof identifier !== 'string') {
            throw new Error('Invalid identifier');
        }

        // Only allow alphanumeric and underscore
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
            throw new Error(`Invalid identifier format: ${identifier}`);
        }

        return `"${identifier}"`;
    }

    /**
     * Build safe INSERT query
     */
    buildSafeInsert(table, data) {
        const safeTable = this.escapeIdentifier(table);
        const columns = Object.keys(data);
        const values = Object.values(data);
        
        const safeColumns = columns.map(col => this.escapeIdentifier(col)).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        
        const sql = `INSERT INTO ${safeTable} (${safeColumns}) VALUES (${placeholders})`;
        return this.prepareSafeQuery(sql, values);
    }

    /**
     * Build safe UPDATE query
     */
    buildSafeUpdate(table, data, whereClause, whereParams = []) {
        const safeTable = this.escapeIdentifier(table);
        const columns = Object.keys(data);
        const values = Object.values(data);
        
        const setClause = columns.map(col => 
            `${this.escapeIdentifier(col)} = ?`
        ).join(', ');
        
        const sql = `UPDATE ${safeTable} SET ${setClause} WHERE ${whereClause}`;
        return this.prepareSafeQuery(sql, [...values, ...whereParams]);
    }

    /**
     * Build safe SELECT query
     */
    buildSafeSelect(table, columns = ['*'], whereClause = null, whereParams = []) {
        const safeTable = this.escapeIdentifier(table);
        
        let safeColumns;
        if (columns[0] === '*') {
            safeColumns = '*';
        } else {
            safeColumns = columns.map(col => this.escapeIdentifier(col)).join(', ');
        }
        
        let sql = `SELECT ${safeColumns} FROM ${safeTable}`;
        
        if (whereClause) {
            sql += ` WHERE ${whereClause}`;
        }
        
        return this.prepareSafeQuery(sql, whereParams);
    }

    /**
     * Build safe DELETE query
     */
    buildSafeDelete(table, whereClause, whereParams = []) {
        const safeTable = this.escapeIdentifier(table);
        const sql = `DELETE FROM ${safeTable} WHERE ${whereClause}`;
        return this.prepareSafeQuery(sql, whereParams);
    }

    /**
     * Validate table schema for CREATE TABLE
     */
    validateTableSchema(schema) {
        if (!schema || typeof schema !== 'object') {
            throw new Error('Invalid table schema');
        }

        // Validate column definitions
        Object.entries(schema).forEach(([columnName, columnDef]) => {
            // Validate column name
            this.escapeIdentifier(columnName);
            
            // Validate column type
            const validTypes = ['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NULL', 'BOOLEAN', 'DATE', 'JSON'];
            const columnType = columnDef.type?.toUpperCase();
            
            if (!validTypes.includes(columnType)) {
                throw new Error(`Invalid column type: ${columnType}`);
            }
        });

        return true;
    }

    /**
     * Create query execution wrapper with logging
     */
    wrapQueryExecution(queryFn) {
        return async (sql, params = []) => {
            const startTime = Date.now();
            const queryId = this.generateQueryId();
            
            try {
                // Validate before execution
                const safeQuery = this.prepareSafeQuery(sql, params);
                
                logger.debug('Executing validated SQL query', {
                    queryId,
                    operation: this.getOperation(sql),
                    paramCount: params.length
                });
                
                const result = await queryFn(safeQuery.sql, safeQuery.params);
                
                logger.debug('SQL query executed successfully', {
                    queryId,
                    duration: Date.now() - startTime
                });
                
                return result;
                
            } catch (error) {
                logger.error('SQL query execution failed', error, {
                    queryId,
                    sql: sql.substring(0, 100),
                    duration: Date.now() - startTime
                });
                throw error;
            }
        };
    }

    /**
     * Generate unique query ID for tracking
     */
    generateQueryId() {
        return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Export singleton instance
module.exports = new SQLValidator();