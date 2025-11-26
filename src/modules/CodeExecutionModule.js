const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');
const systemMonitor = require('../utils/systemMonitor');
const securitySandbox = require('../utils/securitySandbox');
const sessionManager = require('../utils/sessionManager');

/**
 * Module responsible for code execution functionality
 */
class CodeExecutionModule {
    constructor(config) {
        this.config = config;
        this.activeSessions = new Map();
        this.tempDir = path.join(__dirname, '..', '..', 'temp');
    }

    async executeDOMCode(code, sessionId, mainWindow) {
        const startTime = Date.now();
        
        logger.info('Starting DOM code execution', {
            session_id: sessionId,
            code_length: code.length
        });

        // Security scan for DOM code
        const securityScan = securitySandbox.scanCode(code);
        if (!securityScan.safe) {
            logger.logSecurityEvent('unsafe_dom_code', {
                session_id: sessionId,
                issues: securityScan.issues,
                riskLevel: securityScan.riskLevel
            });
            return {
                success: false,
                error: `Code failed security validation: ${securityScan.issues.map(i => i.description).join(', ')}`,
                securityIssues: securityScan.issues
            };
        }

        try {
            // Send code to renderer for execution
            mainWindow.webContents.send('execute-dom-code', { code, sessionId });
            
            const duration = Date.now() - startTime;
            const result = {
                success: true,
                output: 'DOM code injected successfully',
                errors: null
            };

            systemMonitor.recordExecution(duration, true);
            logger.logCodeExecution(sessionId, [], code.length, result, duration);
            
            // Update session with successful execution
            sessionManager.addExecution(sessionId, {
                ...result,
                duration
            });

            return result;

        } catch (error) {
            const duration = Date.now() - startTime;
            const result = {
                success: false,
                error: error.message
            };

            systemMonitor.recordExecution(duration, false);
            logger.error('DOM code execution failed', error, {
                session_id: sessionId,
                code_length: code.length,
                duration
            });
            
            // Update session with failed execution
            sessionManager.addExecution(sessionId, {
                ...result,
                duration
            });

            return result;
        }
    }

    async executeCode(packages, code, sessionId) {
        const sessionDir = path.join(this.tempDir, sessionId);
        const startTime = Date.now();
        
        logger.info('Starting code execution', {
            session_id: sessionId,
            packages: packages || [],
            code_length: code.length
        });

        // Check if we're exceeding concurrent execution limits
        if (this.activeSessions.size >= this.config.maxConcurrentExecutions) {
            logger.logSecurityEvent('concurrent_execution_limit', {
                active_sessions: this.activeSessions.size,
                limit: this.config.maxConcurrentExecutions
            });
            return {
                success: false,
                error: 'Maximum concurrent executions reached'
            };
        }

        // Check system resources
        const resourceCheck = await systemMonitor.checkResourceLimits();
        if (!resourceCheck.safe) {
            logger.logSecurityEvent('execution_blocked_resources', resourceCheck);
            return {
                success: false,
                error: 'System resources insufficient for execution'
            };
        }

        this.activeSessions.set(sessionId, { startTime, packages, codeLength: code.length });
        
        // Update session with execution start
        sessionManager.updateSession(sessionId, {
            status: 'executing',
            lastExecutionStart: new Date().toISOString()
        });
        
        try {
            // Create secure sandbox environment
            const sandboxResult = await securitySandbox.createSandboxEnvironment(sessionId);
            if (!sandboxResult.success) {
                throw new Error(`Failed to create sandbox: ${sandboxResult.error}`);
            }

            // Execute in sandbox with security controls
            const executionResult = await securitySandbox.executeInSandbox(
                sandboxResult.sessionDir,
                code,
                packages
            );

            if (!executionResult.success) {
                throw new Error(executionResult.error);
            }

            const { stdout, stderr } = {
                stdout: executionResult.output,
                stderr: executionResult.errors
            };

            const duration = Date.now() - startTime;
            const result = {
                success: true,
                output: stdout,
                errors: stderr || null
            };

            systemMonitor.recordExecution(duration, true);
            logger.logCodeExecution(sessionId, packages, code.length, result, duration);
            
            // Update session with successful execution
            sessionManager.addExecution(sessionId, {
                ...result,
                duration
            });

            return result;

        } catch (error) {
            const duration = Date.now() - startTime;
            const result = {
                success: false,
                error: error.message
            };

            systemMonitor.recordExecution(duration, false);
            logger.error('Code execution failed', error, {
                session_id: sessionId,
                packages,
                code_length: code.length,
                duration
            });
            
            // Update session with failed execution
            sessionManager.addExecution(sessionId, {
                ...result,
                duration
            });

            return result;
        } finally {
            this.activeSessions.delete(sessionId);
            
            // Clean up sandbox environment
            try {
                await securitySandbox.cleanupSandbox(sessionDir);
            } catch (cleanupError) {
                logger.error('Sandbox cleanup failed', cleanupError, { sessionId });
            }
        }
    }

    async cleanupSession(sessionId) {
        const sessionDir = path.join(this.tempDir, sessionId);
        logger.info('Cleaning up session', { session_id: sessionId });
        
        try {
            // Force cleanup of active session tracking
            this.activeSessions.delete(sessionId);
            
            // Remove session directory
            await fs.rm(sessionDir, { recursive: true, force: true });
            
            logger.info('Session cleanup completed', { session_id: sessionId });
            return { success: true };
        } catch (error) {
            logger.error('Session cleanup failed', error, { session_id: sessionId });
            return { success: false, error: error.message };
        }
    }

    getActiveSessions() {
        return Array.from(this.activeSessions.entries()).map(([id, data]) => ({
            id,
            ...data,
            duration: Date.now() - data.startTime
        }));
    }
}

module.exports = CodeExecutionModule;