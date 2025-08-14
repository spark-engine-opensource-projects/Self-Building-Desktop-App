const { contextBridge, ipcRenderer } = require('electron');

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
    
    // Database Management
    dbListDatabases: () => ipcRenderer.invoke('db-list-databases'),
    dbListTables: (dbName) => ipcRenderer.invoke('db-list-tables', dbName),
    dbCreateTable: (dbName, tableName, schema) => ipcRenderer.invoke('db-create-table', { dbName, tableName, schema }),
    dbInsertData: (dbName, tableName, data) => ipcRenderer.invoke('db-insert-data', { dbName, tableName, data }),
    dbQueryData: (dbName, tableName, options) => ipcRenderer.invoke('db-query-data', { dbName, tableName, options }),
    dbUpdateData: (dbName, tableName, id, data) => ipcRenderer.invoke('db-update-data', { dbName, tableName, id, data }),
    dbDeleteData: (dbName, tableName, id) => ipcRenderer.invoke('db-delete-data', { dbName, tableName, id }),
    dbExecuteSQL: (dbName, sql, params) => ipcRenderer.invoke('db-execute-sql', { dbName, sql, params }),
    dbExportDatabase: (dbName) => ipcRenderer.invoke('db-export-database', dbName),
    
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