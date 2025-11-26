const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const logger = require('./logger');

class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.sessionHistoryFile = null;
        this.maxHistoryItems = 50;
    }

    async initialize() {
        try {
            const userDataPath = app ? app.getPath('userData') : path.join(__dirname, '..', '..');
            this.sessionHistoryFile = path.join(userDataPath, 'session-history.json');
            
            // Load existing session history
            await this.loadSessionHistory();
            
            logger.info('Session manager initialized', { 
                historyFile: this.sessionHistoryFile,
                loadedSessions: this.sessions.size 
            });
            
        } catch (error) {
            logger.error('Failed to initialize session manager', error);
            throw error;
        }
    }

    async loadSessionHistory() {
        try {
            const data = await fs.readFile(this.sessionHistoryFile, 'utf8');
            const history = JSON.parse(data);
            
            history.forEach(session => {
                this.sessions.set(session.id, session);
            });
            
            logger.info('Session history loaded', { count: this.sessions.size });
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info('No existing session history found');
            } else {
                logger.error('Failed to load session history', error);
            }
        }
    }

    async saveSessionHistory() {
        try {
            const history = Array.from(this.sessions.values())
                .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
                .slice(0, this.maxHistoryItems);
            
            await fs.writeFile(this.sessionHistoryFile, JSON.stringify(history, null, 2));
            
            logger.debug('Session history saved', { count: history.length });
            
        } catch (error) {
            logger.error('Failed to save session history', error);
        }
    }

    createSession(sessionId, prompt = '', initialConfig = {}) {
        const session = {
            id: sessionId,
            created: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            prompt,
            generatedCode: null,
            packages: [],
            executionHistory: [],
            config: initialConfig,
            status: 'created',
            metadata: {
                totalExecutions: 0,
                successfulExecutions: 0,
                lastExecution: null,
                codeLength: 0
            }
        };

        this.sessions.set(sessionId, session);
        this.saveSessionHistory();
        
        logger.info('Session created', { sessionId, prompt: prompt.substring(0, 100) });
        
        return session;
    }

    updateSession(sessionId, updates) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            logger.warn('Attempted to update non-existent session', { sessionId });
            return null;
        }

        const updatedSession = {
            ...session,
            ...updates,
            lastModified: new Date().toISOString()
        };

        this.sessions.set(sessionId, updatedSession);
        this.saveSessionHistory();
        
        logger.debug('Session updated', { sessionId, updates: Object.keys(updates) });
        
        return updatedSession;
    }

    addCodeGeneration(sessionId, prompt, generatedCode, packages = []) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            logger.warn('Attempted to add code to non-existent session', { sessionId });
            return null;
        }

        const updatedSession = {
            ...session,
            prompt,
            generatedCode,
            packages,
            lastModified: new Date().toISOString(),
            status: 'code_generated',
            metadata: {
                ...session.metadata,
                codeLength: generatedCode ? generatedCode.length : 0
            }
        };

        this.sessions.set(sessionId, updatedSession);
        this.saveSessionHistory();
        
        logger.info('Code generation added to session', { 
            sessionId, 
            codeLength: generatedCode ? generatedCode.length : 0,
            packages: packages.length
        });
        
        return updatedSession;
    }

    /**
     * Truncate string to max length with indicator
     */
    truncateOutput(str, maxLength = 10000) {
        if (!str || typeof str !== 'string') {
            return str;
        }
        if (str.length <= maxLength) {
            return str;
        }
        return str.substring(0, maxLength) + '\n... [truncated - output exceeded ' + maxLength + ' characters]';
    }

    addExecution(sessionId, executionResult) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            logger.warn('Attempted to add execution to non-existent session', { sessionId });
            return null;
        }

        // Limit output size to prevent memory issues
        const MAX_OUTPUT_SIZE = 10000; // 10KB limit per execution output
        const MAX_ERROR_SIZE = 5000;   // 5KB limit per error output

        const execution = {
            timestamp: new Date().toISOString(),
            success: executionResult.success,
            output: this.truncateOutput(executionResult.output, MAX_OUTPUT_SIZE),
            errors: this.truncateOutput(executionResult.errors, MAX_ERROR_SIZE),
            duration: executionResult.duration || 0,
            truncated: {
                output: executionResult.output && executionResult.output.length > MAX_OUTPUT_SIZE,
                errors: executionResult.errors && executionResult.errors.length > MAX_ERROR_SIZE
            }
        };

        const executionHistory = [...(session.executionHistory || []), execution];

        // Keep only last 10 executions per session
        if (executionHistory.length > 10) {
            executionHistory.splice(0, executionHistory.length - 10);
        }

        const updatedSession = {
            ...session,
            executionHistory,
            lastModified: new Date().toISOString(),
            status: executionResult.success ? 'executed_success' : 'executed_failed',
            metadata: {
                ...session.metadata,
                totalExecutions: session.metadata.totalExecutions + 1,
                successfulExecutions: session.metadata.successfulExecutions + (executionResult.success ? 1 : 0),
                lastExecution: execution.timestamp
            }
        };

        this.sessions.set(sessionId, updatedSession);
        this.saveSessionHistory();

        logger.info('Execution added to session', {
            sessionId,
            success: executionResult.success,
            totalExecutions: updatedSession.metadata.totalExecutions,
            outputTruncated: execution.truncated.output,
            errorsTruncated: execution.truncated.errors
        });

        return updatedSession;
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    getAllSessions() {
        return Array.from(this.sessions.values())
            .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    }

    getSessionHistory(limit = 20) {
        return Array.from(this.sessions.values())
            .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
            .slice(0, limit)
            .map(session => ({
                id: session.id,
                created: session.created,
                lastModified: session.lastModified,
                prompt: session.prompt ? session.prompt.substring(0, 100) + '...' : '',
                status: session.status,
                metadata: session.metadata
            }));
    }

    deleteSession(sessionId) {
        const deleted = this.sessions.delete(sessionId);
        if (deleted) {
            this.saveSessionHistory();
            logger.info('Session deleted', { sessionId });
        } else {
            logger.warn('Attempted to delete non-existent session', { sessionId });
        }
        return deleted;
    }

    cleanupOldSessions(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days default
        const cutoffDate = new Date(Date.now() - maxAge);
        let deletedCount = 0;

        for (const [sessionId, session] of this.sessions.entries()) {
            if (new Date(session.lastModified) < cutoffDate) {
                this.sessions.delete(sessionId);
                deletedCount++;
            }
        }

        if (deletedCount > 0) {
            this.saveSessionHistory();
            logger.info('Old sessions cleaned up', { deletedCount, cutoffDate });
        }

        return deletedCount;
    }

    getSessionStats() {
        const sessions = Array.from(this.sessions.values());
        
        return {
            totalSessions: sessions.length,
            totalExecutions: sessions.reduce((sum, s) => sum + s.metadata.totalExecutions, 0),
            successfulExecutions: sessions.reduce((sum, s) => sum + s.metadata.successfulExecutions, 0),
            averageCodeLength: sessions.length > 0 
                ? Math.round(sessions.reduce((sum, s) => sum + s.metadata.codeLength, 0) / sessions.length)
                : 0,
            statusDistribution: sessions.reduce((dist, s) => {
                dist[s.status] = (dist[s.status] || 0) + 1;
                return dist;
            }, {}),
            recentActivity: sessions
                .filter(s => new Date(s.lastModified) > new Date(Date.now() - 24 * 60 * 60 * 1000))
                .length
        };
    }

    exportSessions() {
        const sessions = this.getAllSessions();
        return {
            exported: new Date().toISOString(),
            version: '1.0',
            sessions: sessions.map(session => ({
                ...session,
                // Remove sensitive data
                apiKey: undefined
            }))
        };
    }

    /**
     * Validate session object structure
     */
    validateSessionStructure(session) {
        // Required fields
        if (!session || typeof session !== 'object') {
            return { valid: false, error: 'Session must be an object' };
        }

        if (!session.id || typeof session.id !== 'string') {
            return { valid: false, error: 'Session must have a valid string id' };
        }

        // Validate id format (should be alphanumeric with dashes/underscores)
        if (!/^[a-zA-Z0-9_-]+$/.test(session.id)) {
            return { valid: false, error: 'Session id contains invalid characters' };
        }

        // Check for required metadata structure
        if (session.metadata && typeof session.metadata !== 'object') {
            return { valid: false, error: 'Session metadata must be an object' };
        }

        // Validate execution history if present
        if (session.executionHistory) {
            if (!Array.isArray(session.executionHistory)) {
                return { valid: false, error: 'Execution history must be an array' };
            }
            // Limit execution history size on import
            if (session.executionHistory.length > 100) {
                session.executionHistory = session.executionHistory.slice(-100);
            }
        }

        // Sanitize potentially dangerous fields
        if (session.prompt && typeof session.prompt === 'string' && session.prompt.length > 50000) {
            session.prompt = session.prompt.substring(0, 50000);
        }

        if (session.generatedCode && typeof session.generatedCode === 'string' && session.generatedCode.length > 500000) {
            session.generatedCode = session.generatedCode.substring(0, 500000);
        }

        return { valid: true };
    }

    async importSessions(data) {
        try {
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid import data: must be an object');
            }

            if (!data.sessions || !Array.isArray(data.sessions)) {
                throw new Error('Invalid session data format: sessions must be an array');
            }

            // Limit number of sessions that can be imported at once
            const MAX_IMPORT_SESSIONS = 1000;
            if (data.sessions.length > MAX_IMPORT_SESSIONS) {
                throw new Error(`Cannot import more than ${MAX_IMPORT_SESSIONS} sessions at once`);
            }

            let importedCount = 0;
            let skippedCount = 0;
            const errors = [];

            for (const session of data.sessions) {
                // Validate session structure
                const validation = this.validateSessionStructure(session);
                if (!validation.valid) {
                    skippedCount++;
                    errors.push({ sessionId: session?.id, error: validation.error });
                    continue;
                }

                // Don't overwrite existing sessions
                if (this.sessions.has(session.id)) {
                    skippedCount++;
                    continue;
                }

                // Ensure metadata has required fields
                const sanitizedSession = {
                    ...session,
                    metadata: {
                        totalExecutions: 0,
                        successfulExecutions: 0,
                        codeLength: 0,
                        ...session.metadata
                    },
                    importedAt: new Date().toISOString()
                };

                this.sessions.set(session.id, sanitizedSession);
                importedCount++;
            }

            await this.saveSessionHistory();
            logger.info('Sessions imported', { importedCount, skippedCount, errorCount: errors.length });

            return {
                success: true,
                importedCount,
                skippedCount,
                errors: errors.length > 0 ? errors.slice(0, 10) : undefined // Limit error reporting
            };

        } catch (error) {
            logger.error('Failed to import sessions', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new SessionManager();