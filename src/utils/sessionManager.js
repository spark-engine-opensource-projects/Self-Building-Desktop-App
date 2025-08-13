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

    addExecution(sessionId, executionResult) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            logger.warn('Attempted to add execution to non-existent session', { sessionId });
            return null;
        }

        const execution = {
            timestamp: new Date().toISOString(),
            success: executionResult.success,
            output: executionResult.output,
            errors: executionResult.errors,
            duration: executionResult.duration || 0
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
            totalExecutions: updatedSession.metadata.totalExecutions
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

    async importSessions(data) {
        try {
            if (!data.sessions || !Array.isArray(data.sessions)) {
                throw new Error('Invalid session data format');
            }

            let importedCount = 0;
            for (const session of data.sessions) {
                if (session.id && !this.sessions.has(session.id)) {
                    this.sessions.set(session.id, session);
                    importedCount++;
                }
            }

            await this.saveSessionHistory();
            logger.info('Sessions imported', { importedCount });
            
            return { success: true, importedCount };
            
        } catch (error) {
            logger.error('Failed to import sessions', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new SessionManager();