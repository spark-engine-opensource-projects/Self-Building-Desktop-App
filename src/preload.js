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
    
    // Utility functions
    generateSessionId: () => {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
});