const { contextBridge, ipcRenderer } = require('electron');

// Default database name for simplified API - shared across all apps
const DEFAULT_DB = 'shared';

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
    checkApiStatus: () => ipcRenderer.invoke('check-api-status'),
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

    // CSRF Token for secure API calls
    getCsrfToken: () => ipcRenderer.invoke('get-csrf-token'),
    
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

    // Database Backup & Restore
    dbBackupDatabase: (dbName, password) => ipcRenderer.invoke('db-backup-database', { dbName, password }),
    dbRestoreDatabase: (backupPath, targetDbName, password) => ipcRenderer.invoke('db-restore-database', { backupPath, targetDbName, password }),
    dbListBackups: () => ipcRenderer.invoke('db-list-backups'),
    dbDeleteBackup: (backupPath) => ipcRenderer.invoke('db-delete-backup', { backupPath }),

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
     * Drop (delete) a table from the default database
     * @param {string} tableName - Name of the table to drop
     * @returns {Promise<{success: boolean, table?: string, error?: string}>}
     */
    dropTable: (tableName) => {
        return ipcRenderer.invoke('db-drop-table', {
            dbName: DEFAULT_DB,
            tableName
        });
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

    // ============================================================
    // MULTI-APP REGISTRY API
    // For managing multiple apps sharing the same database
    // ============================================================

    /**
     * Register a new app in the shared database
     * @param {string} appId - Unique identifier for the app
     * @param {string} appName - Display name for the app
     * @param {string} description - Description of what the app does
     * @param {string} originalPrompt - The original prompt used to generate the app (for regeneration)
     * @param {string} generatedCode - The generated code for the app
     * @returns {Promise<{success: boolean, app?: Object, error?: string}>}
     */
    registerApp: (appId, appName, description, originalPrompt = null, generatedCode = null) => {
        return ipcRenderer.invoke('db-register-app', { appId, appName, description, originalPrompt, generatedCode });
    },

    /**
     * Get information about a registered app
     * @param {string} appId - The app's unique identifier
     * @returns {Promise<{success: boolean, app?: Object, error?: string}>}
     */
    getAppInfo: (appId) => {
        return ipcRenderer.invoke('db-get-app-info', appId);
    },

    /**
     * List all registered apps
     * @returns {Promise<{success: boolean, apps?: Array, error?: string}>}
     */
    listApps: () => {
        return ipcRenderer.invoke('db-list-apps');
    },

    /**
     * Get all table schemas from the shared database
     * @returns {Promise<{success: boolean, schemas?: Object, error?: string}>}
     */
    getAllSchemas: () => {
        return ipcRenderer.invoke('db-get-all-schemas');
    },

    /**
     * Get formatted schema context for AI prompts
     * Includes table structures, sample data, and relationships
     * @returns {Promise<{success: boolean, context?: string, error?: string}>}
     */
    getSchemaContext: () => {
        return ipcRenderer.invoke('db-get-schema-context');
    },

    /**
     * Get tables related to a specific table
     * @param {string} tableName - The table to find relationships for
     * @returns {Promise<{success: boolean, related?: Array, error?: string}>}
     */
    getRelatedTables: (tableName) => {
        return ipcRenderer.invoke('db-get-related-tables', tableName);
    },

    /**
     * Create a table with ownership tracking
     * @param {string} tableName - Name of the table
     * @param {Object} schema - Table schema
     * @param {string} appId - The app that owns this table
     * @param {string} description - Description of the table's purpose
     * @returns {Promise<{success: boolean, table?: string, error?: string}>}
     */
    createTableWithOwner: (tableName, schema, appId, description) => {
        const transformedSchema = transformSchema(schema);
        return ipcRenderer.invoke('db-create-table-with-owner', {
            dbName: DEFAULT_DB,
            tableName,
            schema: transformedSchema,
            appId,
            description
        });
    },

    /**
     * Record a relationship between tables
     * @param {string} sourceTable - The source table name
     * @param {string} targetTable - The target table name
     * @param {string} relationshipType - Type of relationship (e.g., 'foreign_key', 'references')
     * @param {string} description - Description of the relationship
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    recordTableRelationship: (sourceTable, targetTable, relationshipType, description) => {
        return ipcRenderer.invoke('db-record-relationship', {
            sourceTable,
            targetTable,
            relationshipType,
            description
        });
    },

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
    registerTableUsage: (tableName, appId, accessType = 'read', columnsUsed = []) => {
        return ipcRenderer.invoke('db-register-table-usage', {
            tableName,
            appId,
            accessType,
            columnsUsed
        });
    },

    /**
     * Get all apps that use a specific table
     * @param {string} tableName - The table to check
     * @returns {Promise<{success: boolean, apps?: Array, error?: string}>}
     */
    getTableDependencies: (tableName) => {
        return ipcRenderer.invoke('db-get-table-dependencies', { tableName });
    },

    /**
     * Get all tables used by a specific app
     * @param {string} appId - The app to check
     * @returns {Promise<{success: boolean, tables?: Array, error?: string}>}
     */
    getAppTableUsage: (appId) => {
        return ipcRenderer.invoke('db-get-app-table-usage', { appId });
    },

    /**
     * Analyze the impact of a schema change on other apps
     * @param {string} tableName - The table being modified
     * @param {Object} newSchema - The proposed new schema
     * @param {string} changingAppId - The app making the change
     * @returns {Promise<{success: boolean, impact?: Object, error?: string}>}
     */
    analyzeSchemaImpact: (tableName, newSchema, changingAppId) => {
        return ipcRenderer.invoke('db-analyze-schema-impact', {
            tableName,
            newSchema,
            changingAppId
        });
    },

    /**
     * Record a schema change in the history
     * @param {string} tableName - The table that was modified
     * @param {string} changeType - Type of change (create, alter, drop)
     * @param {Object} oldSchema - Previous schema
     * @param {Object} newSchema - New schema
     * @param {string} changedByApp - App that made the change
     * @param {Array<string>} affectedApps - Apps affected by this change
     */
    recordSchemaChange: (tableName, changeType, oldSchema, newSchema, changedByApp, affectedApps = []) => {
        return ipcRenderer.invoke('db-record-schema-change', {
            tableName,
            changeType,
            oldSchema,
            newSchema,
            changedByApp,
            affectedApps
        });
    },

    /**
     * Get schema change history for a table
     * @param {string} tableName - The table to get history for (optional, gets all if null)
     * @param {number} limit - Maximum number of records to return
     */
    getSchemaHistory: (tableName = null, limit = 50) => {
        return ipcRenderer.invoke('db-get-schema-history', { tableName, limit });
    },

    /**
     * Get a comprehensive dependency map for all tables
     * Shows which apps own and use each table
     */
    getDependencyMap: () => {
        return ipcRenderer.invoke('db-get-dependency-map');
    },

    // ============================================================
    // APP DEPRECATION & REGENERATION
    // ============================================================

    /**
     * Mark an app as deprecated
     * @param {string} appId - The app to deprecate
     * @param {string} reason - Why the app was deprecated
     */
    deprecateApp: (appId, reason) => {
        return ipcRenderer.invoke('db-deprecate-app', { appId, reason });
    },

    /**
     * Get all registered apps
     * @returns {Promise<{success: boolean, apps?: Array}>}
     */
    getAppRegistry: () => {
        return ipcRenderer.invoke('db-get-app-registry');
    },

    /**
     * Get all deprecated apps
     * @returns {Promise<{success: boolean, apps?: Array}>}
     */
    getDeprecatedApps: () => {
        return ipcRenderer.invoke('db-get-deprecated-apps');
    },

    /**
     * Get apps that can be regenerated (have original prompt)
     * @returns {Promise<{success: boolean, apps?: Array}>}
     */
    getRegeneratableApps: () => {
        return ipcRenderer.invoke('db-get-regeneratable-apps');
    },

    /**
     * Update an app's code after regeneration
     * @param {string} appId - The app to update
     * @param {string} newCode - The new code
     * @param {boolean} markActive - Whether to mark as active
     */
    updateAppCode: (appId, newCode, markActive = true) => {
        return ipcRenderer.invoke('db-update-app-code', { appId, newCode, markActive });
    },

    /**
     * Deprecate all apps affected by a schema change
     * @param {string} tableName - The table that was changed
     * @param {Object} impact - The impact analysis result
     */
    deprecateAffectedApps: (tableName, impact) => {
        return ipcRenderer.invoke('db-deprecate-affected-apps', { tableName, impact });
    },

    /**
     * Regenerate an app using its original prompt and current schema
     * @param {string} appId - The app to regenerate
     * @returns {Promise<{success: boolean, app?: Object, code?: string, error?: string}>}
     */
    regenerateApp: (appId) => {
        return ipcRenderer.invoke('db-regenerate-app', { appId });
    },

    // Database-driven Code Generation
    dbGenerateCodeWithData: (prompt, dbName, includeData) => ipcRenderer.invoke('db-generate-code-with-data', { prompt, dbName, includeData }),
    
    // Session ID generation - request from main process for security
    generateSessionId: () => ipcRenderer.invoke('generate-session-id'),
    
    // Performance Dashboard
    getPerformanceDashboard: () => ipcRenderer.invoke('get-performance-dashboard'),
    acknowledgeAlert: (alertId) => ipcRenderer.invoke('acknowledge-alert', alertId),
    exportPerformanceData: (format) => ipcRenderer.invoke('export-performance-data', format),
    openPerformanceDashboard: () => ipcRenderer.invoke('open-performance-dashboard'),

    // App Password Protection (Optional)
    checkAppPasswordStatus: () => ipcRenderer.invoke('check-app-password-status'),
    setAppPassword: (password) => ipcRenderer.invoke('set-app-password', { password }),
    verifyAppPassword: (password) => ipcRenderer.invoke('verify-app-password', { password }),
    changeAppPassword: (currentPassword, newPassword) => ipcRenderer.invoke('change-app-password', { currentPassword, newPassword }),
    removeAppPassword: (currentPassword) => ipcRenderer.invoke('remove-app-password', { currentPassword })
});