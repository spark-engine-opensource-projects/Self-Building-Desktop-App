const { contextBridge, ipcRenderer } = require('electron');

// Default database name for simplified API
const DEFAULT_DB = 'app';

/**
 * Transform array-based schema to object-based schema
 * Supports multiple input formats:
 * 1. { columns: ['name1', 'name2'] } - array of strings (AI-generated simple format)
 * 2. { columns: [{name: 'id', type: 'INTEGER', ...}] } - array of objects
 * 3. { columns: {name: {type: 'string', ...}} } - object format (already correct)
 */
function transformSchema(schema) {
    if (!schema || !schema.columns) return schema;

    // If columns is already an object (not array), return as-is
    if (!Array.isArray(schema.columns)) return schema;

    const transformedColumns = {};
    for (const col of schema.columns) {
        // Handle simple string format: ['name1', 'name2']
        if (typeof col === 'string') {
            transformedColumns[col] = { type: 'string' }; // Default to TEXT/string
            continue;
        }

        // Handle object format: [{name: 'id', type: 'INTEGER', ...}]
        const { name, ...rest } = col;
        if (name) {
            // Convert type to lowercase for consistency
            if (rest.type) {
                rest.type = rest.type.toLowerCase();
            } else {
                rest.type = 'string'; // Default type
            }
            transformedColumns[name] = rest;
        }
    }

    return {
        ...schema,
        columns: transformedColumns
    };
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Core functionality
    setApiKey: (apiKey) => ipcRenderer.invoke('set-api-key', apiKey),
    generateCode: (prompt) => ipcRenderer.invoke('generate-code', prompt),
    executeCode: (data) => ipcRenderer.invoke('execute-code', data),
    executeDOMCode: (data) => ipcRenderer.invoke('execute-dom-code', data),
    cleanupSession: (sessionId) => ipcRenderer.invoke('cleanup-session', sessionId),
    selectApiKeyFile: () => ipcRenderer.invoke('select-api-key-file'),
    
    // Monitoring and system health
    getSystemHealth: () => ipcRenderer.invoke('get-system-health'),
    getActiveSessions: () => ipcRenderer.invoke('get-active-sessions'),
    
    // Configuration management
    getConfig: () => ipcRenderer.invoke('get-config'),
    updateConfig: (config) => ipcRenderer.invoke('update-config', config),
    
    // Security
    scanCodeSecurity: (code) => ipcRenderer.invoke('scan-code-security', code),
    
    // Session management
    createSession: (sessionId, prompt) => ipcRenderer.invoke('create-session', sessionId, prompt),
    getSession: (sessionId) => ipcRenderer.invoke('get-session', sessionId),
    getSessionHistory: (limit) => ipcRenderer.invoke('get-session-history', limit),
    getSessionStats: () => ipcRenderer.invoke('get-session-stats'),
    exportSessions: () => ipcRenderer.invoke('export-sessions'),
    
    // Auto-updater
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    
    // User feedback
    submitFeedback: (feedback) => ipcRenderer.invoke('submit-feedback', feedback),
    
    // Database Management (full API with explicit database name)
    dbListDatabases: () => ipcRenderer.invoke('db-list-databases'),
    dbListTables: (dbName) => ipcRenderer.invoke('db-list-tables', dbName),
    dbCreateTable: (dbName, tableName, schema) => ipcRenderer.invoke('db-create-table', { dbName, tableName, schema }),
    dbInsertData: (dbName, tableName, data) => ipcRenderer.invoke('db-insert-data', { dbName, tableName, data }),
    dbQueryData: (dbName, tableName, options) => ipcRenderer.invoke('db-query-data', { dbName, tableName, options }),
    dbUpdateData: (dbName, tableName, id, data) => ipcRenderer.invoke('db-update-data', { dbName, tableName, id, data }),
    dbDeleteData: (dbName, tableName, id) => ipcRenderer.invoke('db-delete-data', { dbName, tableName, id }),
    dbExecuteSQL: (dbName, sql, params) => ipcRenderer.invoke('db-execute-sql', { dbName, sql, params }),
    dbExportDatabase: (dbName) => ipcRenderer.invoke('db-export-database', dbName),

    // ============================================================
    // SIMPLIFIED DATABASE API (for AI-generated code)
    // Uses default 'app' database and accepts array-based schemas
    // ============================================================

    /**
     * Create a table in the default database
     * @param {string} tableName - Name of the table
     * @param {Object} schema - Schema with columns array or object
     * @example
     * await window.electronAPI.createTable('todos', {
     *   columns: [
     *     {name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true},
     *     {name: 'task', type: 'TEXT', required: true},
     *     {name: 'completed', type: 'INTEGER', default: 0}
     *   ]
     * });
     */
    createTable: (tableName, schema) => {
        const transformedSchema = transformSchema(schema);
        return ipcRenderer.invoke('db-create-table', {
            dbName: DEFAULT_DB,
            tableName,
            schema: transformedSchema
        });
    },

    /**
     * Insert data into a table
     * @param {string} tableName - Name of the table
     * @param {Object} data - Data to insert
     * @returns {Promise<{success: boolean, id?: number, error?: string}>}
     */
    insertData: (tableName, data) => {
        return ipcRenderer.invoke('db-insert-data', {
            dbName: DEFAULT_DB,
            tableName,
            data
        });
    },

    /**
     * Query data from a table
     * @param {string} tableName - Name of the table
     * @param {Object} options - Query options (where, orderBy, limit, offset)
     * @returns {Promise<Array>} - Returns array of rows directly (empty array if no data)
     * @example
     * const todos = await window.electronAPI.queryData('todos', {
     *   where: {completed: 0},
     *   orderBy: 'id DESC',
     *   limit: 10
     * });
     * // todos is an array: [{id: 1, task: 'Buy milk'}, ...]
     */
    queryData: async (tableName, options = {}) => {
        const result = await ipcRenderer.invoke('db-query-data', {
            dbName: DEFAULT_DB,
            tableName,
            options
        });
        // Return the data array directly for simpler AI-generated code
        // If there's an error or no data, return empty array
        if (result && result.success && Array.isArray(result.data)) {
            return result.data;
        }
        return [];
    },

    /**
     * Update data in a table
     * @param {string} tableName - Name of the table
     * @param {number} id - ID of the record to update
     * @param {Object} data - Fields to update
     * @returns {Promise<{success: boolean, changes?: number, error?: string}>}
     */
    updateData: (tableName, id, data) => {
        return ipcRenderer.invoke('db-update-data', {
            dbName: DEFAULT_DB,
            tableName,
            id,
            data
        });
    },

    /**
     * Delete data from a table
     * @param {string} tableName - Name of the table
     * @param {number} id - ID of the record to delete
     * @returns {Promise<{success: boolean, changes?: number, error?: string}>}
     */
    deleteData: (tableName, id) => {
        return ipcRenderer.invoke('db-delete-data', {
            dbName: DEFAULT_DB,
            tableName,
            id
        });
    },

    /**
     * List all tables in the default database
     * @returns {Promise<{success: boolean, tables?: string[], error?: string}>}
     */
    listTables: () => {
        return ipcRenderer.invoke('db-list-tables', DEFAULT_DB);
    },

    /**
     * Execute raw SQL query on the default database
     * @param {string} sql - SQL query to execute
     * @param {Array} params - Optional parameters for prepared statement
     * @returns {Promise<Array|{changes: number}>} - Query results or changes count
     * @example
     * // SELECT query
     * const rows = await window.electronAPI.executeQuery('SELECT * FROM users WHERE age > ?', [18]);
     * // INSERT/UPDATE/DELETE
     * await window.electronAPI.executeQuery('INSERT INTO users (name) VALUES (?)', ['John']);
     */
    executeQuery: async (sql, params = []) => {
        const result = await ipcRenderer.invoke('db-execute-sql', {
            dbName: DEFAULT_DB,
            sql,
            params
        });
        // Return the data directly for easier use
        if (result.success) {
            return result.data !== undefined ? result.data : result;
        }
        throw new Error(result.error || 'Query failed');
    },

    // AI Schema Generation
    dbGenerateSchema: (description) => ipcRenderer.invoke('db-generate-schema', description),
    dbGenerateDatabaseScript: (description) => ipcRenderer.invoke('db-generate-database-script', description),
    dbSuggestImprovements: (schema, context) => ipcRenderer.invoke('db-suggest-improvements', { schema, context }),
    
    // Database-driven Code Generation
    dbGenerateCodeWithData: (prompt, dbName, includeData) => ipcRenderer.invoke('db-generate-code-with-data', { prompt, dbName, includeData }),
    
    // Session ID generation - request from main process for security
    generateSessionId: () => ipcRenderer.invoke('generate-session-id'),
    
    // Performance Dashboard
    getPerformanceDashboard: () => ipcRenderer.invoke('get-performance-dashboard'),
    acknowledgeAlert: (alertId) => ipcRenderer.invoke('acknowledge-alert', alertId),
    exportPerformanceData: (format) => ipcRenderer.invoke('export-performance-data', format),
    openPerformanceDashboard: () => ipcRenderer.invoke('open-performance-dashboard')
});