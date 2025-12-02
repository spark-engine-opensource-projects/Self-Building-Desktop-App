const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const logger = require('./utils/logger');
const systemMonitor = require('./utils/systemMonitor');
const configManager = require('./utils/configManager');
const enhancedConfigManager = require('./utils/enhancedConfigManager');
const securitySandbox = require('./utils/securitySandbox');
const sessionManager = require('./utils/sessionManager');
const codeEnhancer = require('./utils/codeEnhancer');
const jsonParser = require('./utils/jsonParser');
const errorRecovery = require('./utils/errorRecovery');
const cacheManager = require('./utils/cacheManager');
const ipcValidator = require('./utils/ipcValidator');
const ipcSecurityMiddleware = require('./utils/ipcSecurityMiddleware');
const secureStorage = require('./utils/secureStorage');
const performanceMonitor = require('./utils/performanceMonitor');
const DatabaseManager = require('./utils/databaseManager');
const AISchemaGenerator = require('./utils/aiSchemaGenerator');
const SchemaContextBuilder = require('./utils/schemaContextBuilder');
const { autoUpdater } = require('electron-updater');
const { RateLimiter } = require('./utils/rateLimiter');
const PerformanceDashboard = require('./modules/PerformanceDashboard');
const CodeGenerationModule = require('./modules/CodeGenerationModule');
const CodeExecutionModule = require('./modules/CodeExecutionModule');
const requestDeduplicator = require('./utils/requestDeduplicator');
const CONSTANTS = require('./config/constants');

/**
 * @typedef {Object} ExecutionConfig
 * @property {number} maxConcurrentExecutions - Maximum concurrent code executions
 * @property {number} executionTimeout - Timeout in milliseconds for code execution
 * @property {number} maxMemoryMB - Maximum memory limit in MB
 * @property {number} maxOutputSize - Maximum output size in bytes
 */

/**
 * @typedef {Object} GenerationResult
 * @property {boolean} success - Whether generation succeeded
 * @property {Object} [data] - Generated code data
 * @property {string} [error] - Error message if failed
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {boolean} success - Whether execution succeeded
 * @property {string} [output] - Execution output
 * @property {string} [error] - Error message if failed
 * @property {number} [duration] - Execution duration in ms
 */

/**
 * Main application class for the AI Dynamic Application Builder
 *
 * RESPONSIBILITIES (organized by concern):
 *
 * 1. WINDOW MANAGEMENT
 *    - createWindow(): Create and configure main Electron window
 *    - setupAutoUpdater(): Configure auto-update functionality
 *
 * 2. IPC COMMUNICATION
 *    - setupIPC(): Register all IPC handlers
 *    - Note: Consider using src/handlers/ipcHandlers.js for new handlers
 *
 * 3. AI CODE GENERATION
 *    - generateCode(): Main entry point for AI code generation
 *    - attemptCodeGeneration(): Core generation logic with Anthropic API
 *    - handleGenerationError(): Error recovery and retry logic
 *
 * 4. CODE EXECUTION
 *    - executeCode(): Execute generated code in sandbox
 *    - executeDOMCode(): Execute DOM-related code
 *    - detectAndAutoCreateTables(): Auto-create database tables
 *
 * 5. SESSION MANAGEMENT
 *    - activeSessions: Map of active execution sessions
 *    - cleanupSession(): Clean up session resources
 *
 * 6. DATABASE OPERATIONS
 *    - databaseManager: Handles all database operations
 *    - buildDatabaseContext(): Build context for AI prompts
 *
 * @class
 * @see src/handlers/ipcHandlers.js - Extracted IPC handlers for reuse
 * @see src/modules/CodeGenerationModule.js - Code generation utilities
 * @see src/modules/CodeExecutionModule.js - Code execution utilities
 */
class DynamicAppBuilder {
    /**
     * Create a new DynamicAppBuilder instance
     * @constructor
     */
    constructor() {
        this.mainWindow = null;
        this.anthropic = null;
        this.tempDir = path.join(__dirname, '..', CONSTANTS.FILESYSTEM.TEMP_DIR_NAME);
        this.allowedPackages = CONSTANTS.ALLOWED_PACKAGES;
        this.activeSessions = new Map();
        this.databaseManager = new DatabaseManager();
        this.schemaContextBuilder = new SchemaContextBuilder(this.databaseManager);
        this.aiSchemaGenerator = null;
        this.performanceDashboard = new PerformanceDashboard();
        this.codeGenerationModule = null;
        this.codeExecutionModule = null;
        this.apiKeyRateLimiter = new RateLimiter({
            maxRequests: CONSTANTS.RATE_LIMITS.API_KEY_VALIDATION.MAX_REQUESTS,
            windowMs: CONSTANTS.RATE_LIMITS.API_KEY_VALIDATION.WINDOW_MS,
            algorithm: 'sliding_window'
        });
        this.config = {
            maxConcurrentExecutions: CONSTANTS.EXECUTION.MAX_CONCURRENT,
            executionTimeout: CONSTANTS.EXECUTION.TIMEOUT_MS,
            maxMemoryMB: CONSTANTS.EXECUTION.MAX_MEMORY_MB,
            maxOutputSize: CONSTANTS.EXECUTION.MAX_OUTPUT_SIZE_BYTES
        };
    }

    /**
     * Fix quote conflicts in generated code
     * Only fixes simple cases - avoids breaking template literals with expressions
     * @param {string} code - The generated code
     * @returns {string} - Fixed code
     */
    fixQuoteConflicts(code) {
        let fixed = code;

        // IMPORTANT: Only fix attributes that DON'T contain template expressions ${}
        // Converting type='${...}' to type="${...}" will break the code!

        // Helper function to safely convert quotes only if no template expressions
        const safeConvertQuotes = (attrName) => {
            const pattern = new RegExp(`${attrName}='([^']*)'`, 'g');
            fixed = fixed.replace(pattern, (match, value) => {
                // DON'T convert if it contains template expressions or double quotes
                if (value.includes('${') || value.includes('"')) {
                    return match; // Leave as-is
                }
                return `${attrName}="${value}"`;
            });
        };

        // Only fix simple static attributes (no template expressions)
        safeConvertQuotes('style');
        safeConvertQuotes('class');
        safeConvertQuotes('id');
        safeConvertQuotes('type');
        safeConvertQuotes('placeholder');
        safeConvertQuotes('value');
        safeConvertQuotes('href');
        safeConvertQuotes('src');
        safeConvertQuotes('name');
        safeConvertQuotes('data-id');

        if (fixed !== code) {
            logger.info('Fixed quote conflicts in generated code', {
                originalLength: code.length,
                fixedLength: fixed.length
            });
        }

        return fixed;
    }

    /**
     * Initialize the application and all required services
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        logger.info('Initializing Dynamic App Builder');

        // Initialize configuration
        await configManager.initialize();

        // Initialize enhanced configuration
        await enhancedConfigManager.initialize();

        // Initialize session manager
        await sessionManager.initialize();

        // Initialize secure storage for API keys
        await secureStorage.initialize();

        // Initialize database manager
        await this.databaseManager.initialize();

        // Initialize shared database with registry tables for multi-app support
        await this.databaseManager.initializeSharedDatabase();

        // Try to restore API key from secure storage
        await this.restoreApiKeyFromSecureStorage();

        // Update config from loaded settings
        const execConfig = configManager.get('execution');
        this.config = { ...this.config, ...execConfig };

        await this.ensureTempDir();
        await systemMonitor.startMonitoring(configManager.get('monitoring', 'healthCheckInterval'));
        this.setupIPC();
        this.setupAutoUpdater();

        logger.info('Dynamic App Builder initialized successfully', { config: this.config });
    }

    async restoreApiKeyFromSecureStorage() {
        try {
            if (await secureStorage.hasApiKey()) {
                const storedApiKey = await secureStorage.getApiKey();
                if (storedApiKey) {
                    // Initialize Anthropic client with stored key
                    this.anthropic = new Anthropic({
                        apiKey: storedApiKey,
                        fetch: fetch,
                        timeout: 30000,
                        maxRetries: 0
                    });
                    this.aiSchemaGenerator = new AISchemaGenerator(this.anthropic);
                    this.codeGenerationModule = new CodeGenerationModule(this.anthropic);
                    this.codeExecutionModule = new CodeExecutionModule(this.config);
                    logger.info('API key restored from secure storage');
                }
            }
        } catch (error) {
            logger.warn('Failed to restore API key from secure storage', { error: error.message });
        }
    }

    /**
     * Ensure the temporary directory exists
     * @async
     * @returns {Promise<void>}
     * @private
     */
    async ensureTempDir() {
        try {
            await fs.access(this.tempDir);
        } catch {
            await fs.mkdir(this.tempDir, { recursive: true });
        }
    }

    /**
     * Get the application icon path, checking multiple formats
     * @returns {string|null} Path to icon or null if not found
     */
    getIconPath() {
        const assetsDir = path.join(__dirname, '..', 'assets');
        const iconFormats = ['icon.png', 'icon.ico', 'icon.svg', 'icon.icns'];

        for (const iconFile of iconFormats) {
            const iconPath = path.join(assetsDir, iconFile);
            try {
                require('fs').accessSync(iconPath);
                return iconPath;
            } catch {
                // Icon not found, try next format
            }
        }

        logger.warn('No application icon found in assets directory');
        return null;
    }

    /**
     * Create and configure the main application window
     * @returns {void}
     */
    createWindow() {
        // Determine icon path with fallback
        const iconPath = this.getIconPath();

        const windowOptions = {
            width: CONSTANTS.WINDOW.DEFAULT_WIDTH,
            height: CONSTANTS.WINDOW.DEFAULT_HEIGHT,
            minWidth: CONSTANTS.WINDOW.MIN_WIDTH,
            minHeight: CONSTANTS.WINDOW.MIN_HEIGHT,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                sandbox: true, // Enabled for security - renderer cannot access Node.js APIs
                webSecurity: true, // Enforce web security
                allowRunningInsecureContent: false, // Block insecure content
                experimentalFeatures: false // Disable experimental features
            }
        };

        // Only set icon if it exists
        if (iconPath) {
            windowOptions.icon = iconPath;
        }

        this.mainWindow = new BrowserWindow(windowOptions);

        this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

        // Register this window as a valid IPC sender for CSRF protection
        this.mainWindow.webContents.on('did-finish-load', () => {
            const senderId = this.mainWindow.webContents.id;
            ipcSecurityMiddleware.registerSender(senderId);
            logger.info('Window registered for IPC security', { senderId });
        });

        // Unregister on close
        this.mainWindow.on('closed', () => {
            if (this.mainWindow && this.mainWindow.webContents) {
                ipcSecurityMiddleware.unregisterSender(this.mainWindow.webContents.id);
            }
        });

        // Open DevTools in development
        if (process.argv.includes('--dev')) {
            this.mainWindow.webContents.openDevTools();
        }
    }

    setupIPC() {
        // CSRF token endpoint - renderer should call this on load
        ipcMain.handle('get-csrf-token', async (event) => {
            const senderId = event.sender.id;
            const token = ipcSecurityMiddleware.generateCSRFToken(senderId);
            return { success: true, token };
        });

        // Check if API is already configured (for restoring sessions)
        ipcMain.handle('check-api-status', async (event) => {
            return {
                success: true,
                configured: this.anthropic !== null,
                hasStoredKey: await secureStorage.hasApiKey()
            };
        });

        ipcMain.handle('set-api-key', async (event, apiKey) => {
            // Rate limiting for API key validation
            const clientId = event.sender.id.toString();
            const allowed = await this.apiKeyRateLimiter.checkLimit(clientId);
            
            if (!allowed) {
                logger.logSecurityEvent('api_key_rate_limit_exceeded', { 
                    clientId,
                    timestamp: new Date().toISOString()
                });
                return { 
                    success: false, 
                    error: 'Too many API key validation attempts. Please wait before trying again.' 
                };
            }
            
            try {
                // Validate API key format
                if (!apiKey || typeof apiKey !== 'string') {
                    return { success: false, error: 'Invalid API key format' };
                }

                if (!apiKey.trim()) {
                    return { success: false, error: 'API key cannot be empty' };
                }

                // Initialize Anthropic client with Electron-compatible settings
                // Use node-fetch explicitly for better Electron compatibility
                this.anthropic = new Anthropic({
                    apiKey,
                    fetch: fetch,  // Explicitly use node-fetch for Electron compatibility
                    // Add timeout and other options for better error handling
                    timeout: 30000,
                    maxRetries: 0  // Disable retries for immediate error feedback
                });

                // Test the API key with a minimal request
                try {
                    logger.info('Testing API key with validation request...');
                    const aiConfig = configManager.get('ai');
                    const testModel = aiConfig.testModel || 'claude-3-haiku-20240307';
                    const response = await this.anthropic.messages.create({
                        model: testModel,
                        max_tokens: 10,
                        messages: [{ role: 'user', content: 'test' }]
                    });
                    logger.info('API key validated successfully', { responseId: response.id });
                } catch (testError) {
                    this.anthropic = null;

                    // Sanitized error logging - avoid exposing sensitive details
                    logger.error('API key validation failed', {
                        status: testError.status || testError.statusCode,
                        code: testError.code,
                        type: testError.type,
                        // Only log message in development
                        ...(process.env.NODE_ENV === 'development' && { message: testError.message })
                    });

                    // Check for specific error types
                    if (testError.status === 401 || testError.statusCode === 401) {
                        return { success: false, error: 'Invalid API key. Please check your Anthropic API key and try again.' };
                    }

                    // Check for model not found error
                    if (testError.status === 404 || testError.statusCode === 404) {
                        return { success: false, error: 'Model not found. Please update the application configuration with a valid Claude model name.' };
                    }

                    // Check for network/connection errors
                    if (testError.code === 'ENOTFOUND' || testError.code === 'ECONNREFUSED' ||
                        testError.code === 'ETIMEDOUT' || testError.code === 'EAI_AGAIN') {
                        return {
                            success: false,
                            error: `Network error: ${testError.code}. Please check your internet connection.`
                        };
                    }

                    if (testError.message && testError.message.toLowerCase().includes('connection')) {
                        return {
                            success: false,
                            error: `Connection error: ${testError.message}. Check your network settings.`
                        };
                    }

                    if (testError.message && testError.message.toLowerCase().includes('fetch')) {
                        return {
                            success: false,
                            error: `Fetch error: ${testError.message}. This may be an Electron networking issue.`
                        };
                    }

                    return {
                        success: false,
                        error: `API key validation failed: ${testError.message || testError.toString()}`
                    };
                }

                this.aiSchemaGenerator = new AISchemaGenerator(this.anthropic);
                this.codeGenerationModule = new CodeGenerationModule(this.anthropic);
                this.codeExecutionModule = new CodeExecutionModule(this.config);

                // Store API key securely for future sessions
                try {
                    await secureStorage.storeApiKey(apiKey);
                    logger.info('API key stored securely');
                } catch (storageError) {
                    // Non-fatal - key works but won't persist
                    logger.warn('Failed to store API key securely', { error: storageError.message });
                }

                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('generate-code', ipcValidator.createValidatedHandler('generate-code', async (event, input) => {
            return await this.generateCode(input.prompt);
        }));

        ipcMain.handle('execute-code', ipcValidator.createValidatedHandler('execute-code', async (event, input) => {
            return await this.executeCode(input.packages, input.code, input.sessionId);
        }));

        ipcMain.handle('execute-dom-code', ipcValidator.createValidatedHandler('execute-dom-code', async (event, input) => {
            return await this.executeDOMCode(input.code, input.sessionId);
        }));

        ipcMain.handle('cleanup-session', ipcValidator.createValidatedHandler('cleanup-session', async (event, input) => {
            return await this.cleanupSession(input.sessionId);
        }));

        ipcMain.handle('select-api-key-file', async () => {
            const result = await dialog.showOpenDialog(this.mainWindow, {
                properties: ['openFile'],
                filters: [
                    { name: 'Text files', extensions: ['txt'] },
                    { name: 'All files', extensions: ['*'] }
                ]
            });

            if (!result.canceled && result.filePaths.length > 0) {
                try {
                    const apiKey = await fs.readFile(result.filePaths[0], 'utf8');
                    return { success: true, apiKey: apiKey.trim() };
                } catch (error) {
                    return { success: false, error: error.message };
                }
            }
            return { success: false, error: 'No file selected' };
        });

        ipcMain.handle('get-system-health', async () => {
            try {
                const health = await systemMonitor.getSystemHealth();
                const stats = systemMonitor.getExecutionStats();
                return { success: true, health, stats };
            } catch (error) {
                logger.error('Failed to get system health', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('get-active-sessions', async () => {
            const sessions = Array.from(this.activeSessions.entries()).map(([id, data]) => ({
                id,
                ...data,
                duration: Date.now() - data.startTime
            }));
            return { success: true, sessions };
        });

        ipcMain.handle('update-config', async (event, newConfig) => {
            try {
                // Validate config structure - only allow known configuration sections
                const allowedSections = ['execution', 'security', 'monitoring', 'ai', 'ui'];
                const allowedKeys = {
                    execution: ['maxConcurrentExecutions', 'executionTimeout', 'maxMemoryMB', 'maxOutputSize', 'maxDiskSpaceMB'],
                    security: ['enableResourceMonitoring', 'logAllExecutions', 'blockSuspiciousPackages', 'maxPromptLength'],
                    monitoring: ['healthCheckInterval', 'maxLogFileSize', 'maxLogFiles', 'enableMetrics'],
                    ai: ['model', 'temperature', 'maxTokens', 'enableCodeValidation'],
                    ui: ['enableDevTools', 'autoSavePrompts', 'maxHistoryItems']
                };

                // Validate incoming config
                if (typeof newConfig !== 'object' || newConfig === null) {
                    return { success: false, error: 'Invalid configuration format' };
                }

                // Check for prototype pollution
                if ('__proto__' in newConfig || 'constructor' in newConfig || 'prototype' in newConfig) {
                    logger.logSecurityEvent('config_update_prototype_pollution', { keys: Object.keys(newConfig) });
                    return { success: false, error: 'Invalid configuration - forbidden properties detected' };
                }

                // Filter to only allowed sections and keys
                const sanitizedConfig = {};
                for (const [section, values] of Object.entries(newConfig)) {
                    if (!allowedSections.includes(section)) {
                        logger.warn('Rejected unknown config section', { section });
                        continue;
                    }

                    if (typeof values !== 'object' || values === null) {
                        continue;
                    }

                    sanitizedConfig[section] = {};
                    const sectionAllowedKeys = allowedKeys[section] || [];

                    for (const [key, value] of Object.entries(values)) {
                        if (!sectionAllowedKeys.includes(key)) {
                            logger.warn('Rejected unknown config key', { section, key });
                            continue;
                        }

                        // Type validation for specific keys
                        if (['maxConcurrentExecutions', 'executionTimeout', 'maxMemoryMB', 'maxOutputSize', 'maxDiskSpaceMB',
                             'maxPromptLength', 'healthCheckInterval', 'maxLogFileSize', 'maxLogFiles', 'maxTokens', 'maxHistoryItems'].includes(key)) {
                            if (typeof value !== 'number' || value < 0 || value > 1000000000) {
                                continue;
                            }
                        }

                        if (key === 'temperature' && (typeof value !== 'number' || value < 0 || value > 2)) {
                            continue;
                        }

                        if (['enableResourceMonitoring', 'logAllExecutions', 'blockSuspiciousPackages', 'enableCodeValidation',
                             'enableDevTools', 'autoSavePrompts', 'enableMetrics'].includes(key)) {
                            if (typeof value !== 'boolean') {
                                continue;
                            }
                        }

                        sanitizedConfig[section][key] = value;
                    }
                }

                await configManager.update(sanitizedConfig);

                // Update local config cache
                const execConfig = configManager.get('execution');
                this.config = { ...this.config, ...execConfig };

                logger.info('Configuration updated', { config: this.config });
                return { success: true, config: configManager.getAll() };
            } catch (error) {
                logger.error('Failed to update configuration', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('get-config', async () => {
            try {
                return { success: true, config: configManager.getAll() };
            } catch (error) {
                logger.error('Failed to get configuration', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('scan-code-security', async (event, code) => {
            try {
                const result = securitySandbox.scanCode(code);
                return { success: true, scan: result };
            } catch (error) {
                logger.error('Code security scan failed', error);
                return { success: false, error: error.message };
            }
        });

        // Session management
        ipcMain.handle('create-session', async (event, sessionId, prompt) => {
            try {
                const session = sessionManager.createSession(sessionId, prompt);
                return { success: true, session };
            } catch (error) {
                logger.error('Failed to create session', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('get-session', async (event, sessionId) => {
            try {
                const session = sessionManager.getSession(sessionId);
                return { success: true, session };
            } catch (error) {
                logger.error('Failed to get session', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('get-session-history', async (event, limit) => {
            try {
                const history = sessionManager.getSessionHistory(limit);
                return { success: true, history };
            } catch (error) {
                logger.error('Failed to get session history', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('get-session-stats', async () => {
            try {
                const stats = sessionManager.getSessionStats();
                return { success: true, stats };
            } catch (error) {
                logger.error('Failed to get session stats', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('export-sessions', async () => {
            try {
                const data = sessionManager.exportSessions();
                return { success: true, data };
            } catch (error) {
                logger.error('Failed to export sessions', error);
                return { success: false, error: error.message };
            }
        });

        // Auto-updater
        ipcMain.handle('check-for-updates', async () => {
            try {
                const result = await autoUpdater.checkForUpdatesAndNotify();
                return { success: true, result };
            } catch (error) {
                logger.error('Update check failed', error);
                return { success: false, error: error.message };
            }
        });

        // User feedback
        ipcMain.handle('submit-feedback', async (event, feedback) => {
            try {
                logger.info('User feedback received', {
                    sessionId: feedback.sessionId,
                    rating: feedback.rating,
                    promptLength: feedback.prompt ? feedback.prompt.length : 0,
                    timestamp: feedback.timestamp
                });
                
                // Store feedback in session manager
                sessionManager.addFeedback(feedback.sessionId, {
                    rating: feedback.rating,
                    prompt: feedback.prompt,
                    timestamp: feedback.timestamp
                });
                
                return { success: true };
            } catch (error) {
                logger.error('Failed to process feedback', error);
                return { success: false, error: error.message };
            }
        });

        // Cache management
        ipcMain.handle('get-cache-stats', async () => {
            try {
                const stats = cacheManager.getStats();
                return { success: true, stats };
            } catch (error) {
                logger.error('Failed to get cache stats', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('clear-cache', async () => {
            try {
                cacheManager.clear();
                logger.info('Cache cleared by user request');
                return { success: true };
            } catch (error) {
                logger.error('Failed to clear cache', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('update-cache-config', async (event, config) => {
            try {
                cacheManager.updateConfig(config);
                logger.info('Cache configuration updated', { config });
                return { success: true, config: cacheManager.config };
            } catch (error) {
                logger.error('Failed to update cache config', error);
                return { success: false, error: error.message };
            }
        });

        // Database Management IPC Handlers
        ipcMain.handle('db-list-databases', async () => {
            try {
                return await this.databaseManager.listDatabases();
            } catch (error) {
                logger.error('Failed to list databases', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-list-tables', async (event, dbName) => {
            try {
                return await this.databaseManager.listTables(dbName);
            } catch (error) {
                logger.error('Failed to list tables', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-create-table', async (event, { dbName, tableName, schema }) => {
            try {
                return await this.databaseManager.createTable(dbName, tableName, schema);
            } catch (error) {
                logger.error('Failed to create table', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-insert-data', async (event, { dbName, tableName, data }) => {
            try {
                return await this.databaseManager.insertData(dbName, tableName, data);
            } catch (error) {
                logger.error('Failed to insert data', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-query-data', async (event, { dbName, tableName, options }) => {
            try {
                return await this.databaseManager.queryData(dbName, tableName, options);
            } catch (error) {
                logger.error('Failed to query data', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-update-data', async (event, { dbName, tableName, id, data }) => {
            try {
                return await this.databaseManager.updateData(dbName, tableName, id, data);
            } catch (error) {
                logger.error('Failed to update data', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-delete-data', async (event, { dbName, tableName, id }) => {
            try {
                return await this.databaseManager.deleteData(dbName, tableName, id);
            } catch (error) {
                logger.error('Failed to delete data', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-execute-sql', async (event, { dbName, sql, params }) => {
            try {
                return await this.databaseManager.executeSQL(dbName, sql, params);
            } catch (error) {
                logger.error('Failed to execute SQL', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-export-database', async (event, dbName) => {
            try {
                return await this.databaseManager.exportDatabase(dbName);
            } catch (error) {
                logger.error('Failed to export database', error);
                return { success: false, error: error.message };
            }
        });

        // ============================================================
        // Multi-App Registry IPC Handlers
        // ============================================================

        ipcMain.handle('db-register-app', async (event, { appId, appName, description }) => {
            try {
                return await this.databaseManager.registerApp(appId, appName, description);
            } catch (error) {
                logger.error('Failed to register app', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-get-app-info', async (event, appId) => {
            try {
                return await this.databaseManager.getAppInfo(appId);
            } catch (error) {
                logger.error('Failed to get app info', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-list-apps', async () => {
            try {
                return await this.databaseManager.listApps();
            } catch (error) {
                logger.error('Failed to list apps', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-get-all-schemas', async () => {
            try {
                return await this.databaseManager.getAllSchemas();
            } catch (error) {
                logger.error('Failed to get all schemas', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-get-schema-context', async () => {
            try {
                return await this.databaseManager.buildSchemaContext();
            } catch (error) {
                logger.error('Failed to build schema context', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-get-related-tables', async (event, tableName) => {
            try {
                return await this.databaseManager.getRelatedTables(tableName);
            } catch (error) {
                logger.error('Failed to get related tables', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-create-table-with-owner', async (event, { dbName, tableName, schema, appId, description }) => {
            try {
                return await this.databaseManager.createTableWithOwner(dbName, tableName, schema, appId, description);
            } catch (error) {
                logger.error('Failed to create table with owner', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-record-relationship', async (event, { sourceTable, targetTable, relationshipType, description }) => {
            try {
                return await this.databaseManager.recordTableRelationship(sourceTable, targetTable, relationshipType, description);
            } catch (error) {
                logger.error('Failed to record table relationship', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-drop-table', async (event, { dbName, tableName }) => {
            try {
                return await this.databaseManager.dropTable(dbName, tableName);
            } catch (error) {
                logger.error('Failed to drop table', error);
                return { success: false, error: error.message };
            }
        });

        // AI Schema Generation IPC Handlers
        ipcMain.handle('db-generate-schema', async (event, description) => {
            try {
                if (!this.aiSchemaGenerator) {
                    return { success: false, error: 'AI schema generator not available. Please set API key first.' };
                }
                return await this.aiSchemaGenerator.generateSchema(description);
            } catch (error) {
                logger.error('Failed to generate schema', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-generate-database-script', async (event, description) => {
            try {
                if (!this.aiSchemaGenerator) {
                    return { success: false, error: 'AI schema generator not available. Please set API key first.' };
                }
                return await this.aiSchemaGenerator.generateDatabaseScript(description);
            } catch (error) {
                logger.error('Failed to generate database script', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('db-suggest-improvements', async (event, { schema, context }) => {
            try {
                if (!this.aiSchemaGenerator) {
                    return { success: false, error: 'AI schema generator not available. Please set API key first.' };
                }
                return await this.aiSchemaGenerator.suggestImprovements(schema, context);
            } catch (error) {
                logger.error('Failed to suggest improvements', error);
                return { success: false, error: error.message };
            }
        });

        // Database-driven Code Generation
        ipcMain.handle('db-generate-code-with-data', async (event, { prompt, dbName, includeData }) => {
            try {
                if (!this.anthropic) {
                    return { success: false, error: 'Anthropic API key not configured' };
                }

                let enhancedPrompt = prompt;
                
                if (includeData && dbName) {
                    // Get database structure and sample data
                    const tablesResult = await this.databaseManager.listTables(dbName);
                    const dbContext = await this.buildDatabaseContext(dbName, tablesResult.tables);
                    
                    enhancedPrompt = `${prompt}

AVAILABLE DATABASE: ${dbName}
${dbContext}

Please generate code that can interact with this database structure. Use the provided table schemas and sample data as context.`;
                }

                return await this.generateCode(enhancedPrompt);
            } catch (error) {
                logger.error('Failed to generate code with database context', error);
                return { success: false, error: error.message };
            }
        });
        
        // Secure session ID generation
        ipcMain.handle('generate-session-id', async () => {
            const timestamp = Date.now();
            const randomBytes = crypto.randomBytes(16).toString('hex');
            return `session_${timestamp}_${randomBytes}`;
        });
        
        // Performance Dashboard IPC Handlers
        ipcMain.handle('get-performance-dashboard', async () => {
            try {
                const data = this.performanceDashboard.getDashboardData();
                return { success: true, ...data };
            } catch (error) {
                logger.error('Failed to get performance dashboard data', error);
                return { success: false, error: error.message };
            }
        });
        
        ipcMain.handle('acknowledge-alert', async (event, alertId) => {
            try {
                this.performanceDashboard.acknowledgeAlert(alertId);
                return { success: true };
            } catch (error) {
                logger.error('Failed to acknowledge alert', error);
                return { success: false, error: error.message };
            }
        });
        
        ipcMain.handle('export-performance-data', async (event, format = 'json') => {
            try {
                const data = this.performanceDashboard.exportData(format);
                return { success: true, data };
            } catch (error) {
                logger.error('Failed to export performance data', error);
                return { success: false, error: error.message };
            }
        });
        
        ipcMain.handle('open-performance-dashboard', async () => {
            try {
                const dashboardWindow = new BrowserWindow({
                    width: 1400,
                    height: 900,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true,
                        preload: path.join(__dirname, 'preload.js'),
                        sandbox: true,
                        webSecurity: true
                    },
                    title: 'Performance Dashboard'
                });
                
                dashboardWindow.loadFile(path.join(__dirname, 'renderer', 'performanceDashboard.html'));
                
                if (process.argv.includes('--dev')) {
                    dashboardWindow.webContents.openDevTools();
                }
                
                return { success: true };
            } catch (error) {
                logger.error('Failed to open performance dashboard', error);
                return { success: false, error: error.message };
            }
        });
    }

    /**
     * Generate code from a natural language prompt using Claude AI
     * @async
     * @param {string} prompt - The natural language description of the code to generate
     * @param {number} [retryCount=0] - Current retry attempt number
     * @returns {Promise<GenerationResult>} Result containing generated code or error
     */
    async generateCode(prompt, retryCount = 0) {
        if (!this.anthropic) {
            logger.warn('Code generation attempted without API key');
            return { success: false, error: 'Anthropic API key not configured' };
        }

        const startTime = Date.now();
        logger.info('Starting code generation', { prompt_length: prompt.length, retryCount });

        // Check cache first (only for initial requests, not retries)
        if (retryCount === 0) {
            const cachedResult = cacheManager.get(prompt);
            if (cachedResult) {
                logger.info('Cache hit - returning cached result', {
                    promptLength: prompt.length,
                    cacheAge: Date.now() - cachedResult.metadata?.processingTime || 0
                });

                return {
                    ...cachedResult,
                    fromCache: true,
                    metadata: {
                        ...cachedResult.metadata,
                        cacheHit: true,
                        totalTime: Date.now() - startTime
                    }
                };
            }

            // Deduplicate concurrent requests for the same prompt
            if (requestDeduplicator.isPending('code-generation', { prompt })) {
                logger.info('Duplicate code generation request detected, waiting for existing request');
                return requestDeduplicator.dedupe('code-generation', { prompt }, async () => {
                    return this._executeCodeGeneration(prompt, retryCount, startTime);
                });
            }
        }

        // Use deduplication for the actual generation
        return requestDeduplicator.dedupe('code-generation', { prompt, retryCount }, async () => {
            return this._executeCodeGeneration(prompt, retryCount, startTime);
        });
    }

    /**
     * Internal method to execute code generation
     * @private
     */
    async _executeCodeGeneration(prompt, retryCount, startTime) {
        // Check if API key is configured
        if (!this.anthropic) {
            logger.warn('Code generation attempted without API key');
            return {
                success: false,
                error: 'API key not configured. Please set your Anthropic API key first.',
                errorType: 'authentication'
            };
        }

        // Check prompt length limit
        const securityConfig = configManager.get('security');
        if (prompt.length > securityConfig.maxPromptLength) {
            logger.logSecurityEvent('prompt_length_exceeded', { length: prompt.length, limit: securityConfig.maxPromptLength });
            return { success: false, error: 'Prompt exceeds maximum length limit' };
        }

        try {
            // Enhance prompt with database schema context for multi-app awareness
            let enhancedPrompt = prompt;
            try {
                const schemaContext = await this.schemaContextBuilder.buildPromptAwareContext(prompt);
                if (schemaContext) {
                    enhancedPrompt = `${prompt}\n\n${schemaContext}`;
                    logger.info('Enhanced prompt with schema context', {
                        originalLength: prompt.length,
                        enhancedLength: enhancedPrompt.length
                    });
                }
            } catch (contextError) {
                logger.warn('Failed to build schema context, proceeding without it', { error: contextError.message });
            }

            // TEMP: Commented out resource check - too strict for development
            // const resourceCheck = await systemMonitor.checkResourceLimits();
            // if (!resourceCheck.safe) {
            //     logger.logSecurityEvent('resource_limit_exceeded', resourceCheck);
            //     return { success: false, error: 'System resources insufficient for code generation' };
            // }

            const result = await this.attemptCodeGeneration(enhancedPrompt, retryCount, startTime);
            
            // Cache successful results (only for initial requests)
            if (result.success && retryCount === 0) {
                cacheManager.set(prompt, result);
            }
            
            return result;

        } catch (error) {
            return await this.handleGenerationError(error, prompt, retryCount, startTime);
        }
    }

    async attemptCodeGeneration(prompt, retryCount, startTime) {
        try {
            const aiConfig = configManager.get('ai');
            const systemPrompt = `You are a UI component generator for an Electron desktop app. Generate complete, working JavaScript code.

Respond with ONLY a valid JSON object - NO markdown, NO explanations:
{
  "packages": [],
  "code": "your JavaScript code here",
  "description": "Brief description"
}

CRITICAL - CODE PATTERN:
Use a simple async IIFE pattern. DO NOT use Custom Elements (class extends HTMLElement).

CORRECT PATTERN:
(async () => {
  const root = document.getElementById('execution-root');

  root.innerHTML = \\\`
    <div class="container">
      <h1>Title</h1>
      <button id="myBtn">Click</button>
    </div>
  \\\`;

  document.getElementById('myBtn').addEventListener('click', () => {
    alert('Clicked!');
  });
})();

FORBIDDEN - DO NOT USE:
- class MyApp extends HTMLElement (causes constructor errors)
- customElements.define() (causes constructor errors)
- attachShadow() (causes constructor errors)
- localStorage or sessionStorage (use database API instead)

DATABASE API - For data persistence, use:
- await window.electronAPI.createTable(tableName, { columns: ['col1', 'col2'] })
- await window.electronAPI.insertData(tableName, { col1: 'value1', col2: 'value2' })
- await window.electronAPI.queryData(tableName) // returns array of objects
- await window.electronAPI.updateData(tableName, id, { col1: 'newValue' })
- await window.electronAPI.deleteData(tableName, id)

DATABASE EXAMPLE:
(async () => {
  const root = document.getElementById('execution-root');

  await window.electronAPI.createTable('tasks', { columns: ['title', 'done'] });

  async function loadTasks() {
    const tasks = await window.electronAPI.queryData('tasks');
    renderTasks(tasks);
  }

  function renderTasks(tasks) {
    const list = document.getElementById('taskList');
    list.innerHTML = tasks.map(t => \\\`<li>\${t.title}</li>\\\`).join('');
  }

  root.innerHTML = \\\`
    <div class="container">
      <input type="text" id="taskInput" placeholder="New task">
      <button id="addBtn">Add</button>
      <ul id="taskList"></ul>
    </div>
  \\\`;

  document.getElementById('addBtn').addEventListener('click', async () => {
    const input = document.getElementById('taskInput');
    if (input.value.trim()) {
      await window.electronAPI.insertData('tasks', { title: input.value, done: false });
      input.value = '';
      loadTasks();
    }
  });

  loadTasks();
})();

JSON STRING RULES:
- Use backticks (\\\`) for template literals containing HTML
- Use double quotes for HTML attributes: class="container"
- Escape special characters in the JSON string

STYLING:
- Inject a <style> tag or use inline styles
- Use flexbox/grid for layouts
- Include hover states and transitions

REQUIREMENTS:
- Self-contained, complete code
- Error handling with try/catch
- Input validation
- Event delegation where appropriate
- NO comments in code`;

            const response = await this.anthropic.messages.create({
                model: aiConfig.model,
                max_tokens: aiConfig.maxTokens,
                temperature: aiConfig.temperature,
                system: systemPrompt,
                messages: [
                    { role: "user", content: prompt }
                ]
            });

            let content = response.content[0].text;

            logger.debug('AI response received', { contentLength: content.length });

            // Extract JSON object from the response (between first { and last })
            const jsonStart = content.indexOf('{');
            const jsonEnd = content.lastIndexOf('}') + 1;
            if (jsonStart !== -1 && jsonEnd > jsonStart) {
                content = content.substring(jsonStart, jsonEnd);

                // Fix: Claude sometimes returns literal newlines in JSON strings which is invalid
                // We need to properly escape them. Use a state machine to track if we're inside a string.
                let fixed = '';
                let inString = false;
                let escapeNext = false;

                for (let i = 0; i < content.length; i++) {
                    const char = content[i];

                    if (escapeNext) {
                        fixed += char;
                        escapeNext = false;
                        continue;
                    }

                    if (char === '\\') {
                        fixed += char;
                        escapeNext = true;
                        continue;
                    }

                    if (char === '"') {
                        fixed += char;
                        inString = !inString;
                        continue;
                    }

                    if (inString) {
                        // We're inside a string - escape control characters
                        if (char === '\n') {
                            fixed += '\\n';
                        } else if (char === '\r') {
                            fixed += '\\r';
                        } else if (char === '\t') {
                            fixed += '\\t';
                        } else {
                            fixed += char;
                        }
                    } else {
                        // Outside string - copy as-is
                        fixed += char;
                    }
                }

                content = fixed;

                // Additional fix: Convert HTML attribute double quotes to single quotes in the code field
                // This prevents JSON parsing errors when Claude uses class="foo" instead of class='foo'
                try {
                    const tempParse = JSON.parse(content);
                    if (tempParse.code && typeof tempParse.code === 'string') {
                        // Convert HTML attributes from double to single quotes
                        //Pattern: word= "value" -> word='value'
                        let codeFixed = tempParse.code.replace(/(\s+\w+(?:-\w+)*)\s*=\s*"([^"]*)"/g, "$1='$2'");
                        tempParse.code = codeFixed;
                        content = JSON.stringify(tempParse);
                    }
                } catch (e) {
                    // If parsing fails at this stage, we'll continue with the original content
                    // and let the main parser handle it
                    logger.debug('Skipped HTML quote conversion', { error: e.message });
                }
            }

            // Use enhanced JSON parser
            const parseResult = await jsonParser.parseAIResponse(content);
            if (!parseResult.success) {
                logger.error('JSON parsing failed', {
                    error: parseResult.error,
                    contentLength: content.length
                });
                return {
                    success: false,
                    error: `Failed to parse AI response: ${parseResult.error}`,
                    details: parseResult.details,
                    suggestions: jsonParser.generateSuggestions(content, parseResult.error)
                };
            }

            const result = parseResult.data;

            // FIX QUOTE CONFLICTS: Convert single-quoted HTML strings to template literals
            // This fixes errors like "Unexpected identifier 'padding'" caused by:
            // innerHTML = '<div style='padding: 10px;'>' (wrong - nested quotes)
            result.code = this.fixQuoteConflicts(result.code);

            // CRITICAL: Reject Custom Elements - they cause constructor errors
            const customElementPatterns = [
                /extends\s+HTMLElement/i,
                /customElements\s*\.\s*define/i,
                /class\s+\w+\s+extends\s+\w*Element/i,
                /attachShadow\s*\(/i
            ];
            const hasCustomElement = customElementPatterns.some(p => p.test(result.code));

            if (hasCustomElement) {
                logger.warn('Generated code uses Custom Elements - REJECTING', {
                    prompt: prompt.substring(0, 100)
                });

                if (retryCount < 2) {
                    const modifiedPrompt = `CRITICAL: DO NOT use Custom Elements (class extends HTMLElement). Use a simple IIFE pattern with innerHTML instead.

WRONG - Custom Elements (will be rejected):
class MyApp extends HTMLElement { ... }
customElements.define('my-app', MyApp);

CORRECT - Simple IIFE pattern:
(async () => {
  const root = document.getElementById('execution-root');
  root.innerHTML = \`<div class="container">...</div>\`;
  // Add event listeners...
})();

${prompt}`;
                    return await this.generateCodeWithRetry(modifiedPrompt, retryCount + 1);
                }

                return {
                    success: false,
                    error: 'Generated code uses Custom Elements which cause errors. Please try again.',
                    suggestions: ['The system will retry with a simpler code pattern']
                };
            }

            // CRITICAL: Reject localStorage/sessionStorage - must use database
            if (result.code.includes('localStorage') || result.code.includes('sessionStorage')) {
                logger.warn('Generated code uses localStorage instead of database', { prompt });

                if (retryCount < 2) {
                    const modifiedPrompt = `CRITICAL: DO NOT use localStorage or sessionStorage. Use the database API instead:
- await window.electronAPI.createTable(tableName, { columns: [...] })
- await window.electronAPI.insertData(tableName, data)
- await window.electronAPI.queryData(tableName)

${prompt}`;
                    return await this.generateCodeWithRetry(modifiedPrompt, retryCount + 1);
                }

                return {
                    success: false,
                    error: 'Code uses localStorage. Please use window.electronAPI database instead.',
                    suggestions: ['Use window.electronAPI.createTable/insertData/queryData for data persistence']
                };
            }

            // Enhanced code validation and enhancement pipeline
            if (aiConfig.enableCodeValidation) {
                const securityScan = securitySandbox.scanCode(result.code);
                if (!securityScan.safe) {
                    logger.logSecurityEvent('unsafe_code_generated', {
                        prompt_length: prompt.length,
                        issues: securityScan.issues,
                        riskLevel: securityScan.riskLevel
                    });
                    return {
                        success: false,
                        error: `Generated code failed security validation: ${securityScan.issues.map(i => i.description).join(', ')}`,
                        securityIssues: securityScan.issues
                    };
                }
            }

            // Enhance code quality with post-processing
            const enhancementResult = await codeEnhancer.enhanceCode(result.code, {
                addErrorHandling: true,
                addAccessibility: true,
                addInputValidation: true,
                optimizePerformance: true,
                validateSyntax: true
            });

            if (!enhancementResult.success) {
                logger.warn('Code enhancement failed, using original code', {
                    issues: enhancementResult.issues,
                    message: enhancementResult.message
                });
                // Continue with original code but log the issues
            } else {
                result.code = enhancementResult.code;
                logger.info('Code enhancement successful', {
                    enhancements: enhancementResult.enhancements,
                    issuesFound: enhancementResult.issues.length
                });
            }
            
            // Log package usage for monitoring
            if (result.packages && result.packages.length > 0) {
                logger.info('Generated code requires packages', { packages: result.packages });
            }

            const duration = Date.now() - startTime;
            logger.logCodeGeneration(prompt, { success: true, data: result }, duration);

            return {
                success: true,
                data: result,
                metadata: {
                    processingTime: duration,
                    retryCount,
                    enhanced: true
                }
            };

        } catch (error) {
            throw error; // Re-throw to be handled by error recovery
        }
    }

    async handleGenerationError(error, originalPrompt, retryCount, startTime) {
        const duration = Date.now() - startTime;

        logger.error('Code generation failed', error, {
            prompt_length: originalPrompt.length,
            duration,
            retryCount
        });

        // Handle API overload errors with exponential backoff
        if (error.status === 529 || error.statusCode === 529 ||
            error.message?.includes('Overloaded') || error.message?.includes('529')) {

            if (retryCount < 3) {
                const waitTime = Math.pow(2, retryCount) * 2000; // 2s, 4s, 8s
                logger.info(`API overloaded, waiting ${waitTime}ms before retry ${retryCount + 1}/3`);

                await new Promise(resolve => setTimeout(resolve, waitTime));

                return await this.generateCode(originalPrompt, retryCount + 1);
            } else {
                return {
                    success: false,
                    error: 'The Anthropic API is currently overloaded. Please try again in a few moments.',
                    technical: error.message,
                    suggestions: [
                        'Wait 30-60 seconds before trying again',
                        'Try a simpler or shorter prompt',
                        'Check Anthropic status page for service issues'
                    ],
                    canRetry: true,
                    errorType: 'overloaded'
                };
            }
        }

        // Attempt error recovery
        const recoveryContext = {
            originalPrompt,
            retryCount,
            error: error.message,
            temperature: configManager.get('ai', 'temperature'),
            maxTokens: configManager.get('ai', 'maxTokens')
        };

        const recoveryResult = await errorRecovery.attemptRecovery(error, recoveryContext);

        if (recoveryResult.canRecover && retryCount < 3) {
            logger.info('Attempting error recovery', {
                strategy: recoveryResult.strategy,
                retryCount: retryCount + 1
            });

            // Update AI config if adjustments are suggested
            if (recoveryResult.adjustments) {
                const currentConfig = configManager.get('ai');
                const tempConfig = { ...currentConfig, ...recoveryResult.adjustments };
                // Temporarily update config for this retry
                configManager.update({ ai: tempConfig });
            }

            try {
                // Retry with recovered prompt
                const retryResult = await this.generateCode(recoveryResult.newPrompt, retryCount + 1);
                
                // Restore original config
                const originalConfig = configManager.get('ai');
                delete originalConfig.temperature;
                delete originalConfig.maxTokens;
                
                return retryResult;
            } catch (retryError) {
                // If retry fails, continue to return user-friendly error
                logger.error('Recovery attempt failed', retryError);
            }
        }

        // Generate user-friendly error message
        const friendlyError = errorRecovery.generateUserFriendlyError(error, recoveryContext);
        
        return {
            success: false,
            error: friendlyError.message,
            technical: friendlyError.technical,
            suggestions: friendlyError.suggestions,
            canRetry: friendlyError.canRetry,
            errorType: friendlyError.type,
            retryCount
        };
    }

    async executeDOMCode(code, sessionId) {
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
            this.mainWindow.webContents.send('execute-dom-code', { code, sessionId });
            
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

    /**
     * Detect and auto-create tables referenced in code but not yet created
     */
    async detectAndAutoCreateTables(code, sessionId) {
        try {
            // Extract table names from database operations in code
            const tablePatterns = [
                /electronAPI\.(insertData|queryData|updateData|deleteData)\(['"](\w+)['"]/g,
                /createTable\(['"](\w+)['"]/g
            ];

            const tablesUsed = new Set();
            const tablesCreated = new Set();

            tablePatterns.forEach(pattern => {
                let match;
                const regex = new RegExp(pattern);
                while ((match = regex.exec(code)) !== null) {
                    const tableName = match[2];
                    if (match[1] === 'insertData' || match[1] === 'queryData' || match[1] === 'updateData' || match[1] === 'deleteData') {
                        tablesUsed.add(tableName);
                    } else {
                        tablesCreated.add(tableName);
                    }
                }
            });

            // Check which tables are used but not created in the code
            const tablesToCheck = Array.from(tablesUsed).filter(t => !tablesCreated.has(t));

            if (tablesToCheck.length > 0) {
                logger.info('Detected tables that might need creation', {
                    tables: tablesToCheck,
                    sessionId
                });

                // Check if tables already exist in database
                for (const tableName of tablesToCheck) {
                    try {
                        const dbName = sessionId; // Use sessionId as database name
                        const exists = await this.databaseManager.tableExists(dbName, tableName);

                        if (!exists) {
                            logger.warn(`Table ${tableName} referenced but not created. Code should create it.`);
                        }
                    } catch (error) {
                        // Database doesn't exist yet, that's okay - code will create it
                        logger.debug(`Database check skipped for ${tableName}:`, error.message);
                    }
                }
            }

            return { success: true, tablesDetected: Array.from(tablesUsed) };
        } catch (error) {
            logger.error('Table detection failed', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Execute generated code in a sandboxed environment
     * @async
     * @param {string[]} packages - List of npm packages required by the code
     * @param {string} code - The JavaScript code to execute
     * @param {string} sessionId - Unique session identifier
     * @returns {Promise<ExecutionResult>} Result containing output or error
     */
    async executeCode(packages, code, sessionId) {
        const sessionDir = path.join(this.tempDir, sessionId);
        const startTime = Date.now();

        logger.info('Starting code execution', {
            session_id: sessionId,
            packages: packages || [],
            code_length: code.length
        });

        // Detect tables referenced in code
        await this.detectAndAutoCreateTables(code, sessionId);

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
            // Detect if this is DOM/browser code
            const isDOMCode = /HTMLElement|customElements|document\.|window\.|DOM|attachShadow|shadowRoot/i.test(code);

            let executionResult;

            if (isDOMCode) {
                // Execute in renderer/browser context
                logger.info('Detected DOM code, executing in renderer context', { sessionId });

                // Send code to renderer for execution
                const rendererWindow = this.mainWindow;
                if (!rendererWindow || rendererWindow.isDestroyed()) {
                    throw new Error('Renderer window not available');
                }

                executionResult = await rendererWindow.webContents.executeJavaScript(code, true);

                // Format result to match sandbox result structure
                executionResult = {
                    success: true,
                    output: 'Code executed successfully in browser context',
                    errors: null
                };
            } else {
                // Execute in Node.js sandbox for backend code
                logger.info('Detected Node.js code, executing in sandbox', { sessionId });

                // Create secure sandbox environment
                const sandboxResult = await securitySandbox.createSandboxEnvironment(sessionId);
                if (!sandboxResult.success) {
                    throw new Error(`Failed to create sandbox: ${sandboxResult.error}`);
                }

                // Execute in sandbox with security controls
                executionResult = await securitySandbox.executeInSandbox(
                    sandboxResult.sessionDir,
                    code,
                    packages
                );

                if (!executionResult.success) {
                    throw new Error(executionResult.error);
                }
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

    setupAutoUpdater() {
        if (process.env.NODE_ENV === 'development') {
            logger.info('Auto-updater disabled in development mode');
            return;
        }

        autoUpdater.checkForUpdatesAndNotify();
        
        autoUpdater.on('checking-for-update', () => {
            logger.info('Checking for application updates');
        });
        
        autoUpdater.on('update-available', (info) => {
            logger.info('Update available', { version: info.version });
            if (this.mainWindow) {
                this.mainWindow.webContents.send('update-available', info);
            }
        });
        
        autoUpdater.on('update-not-available', (info) => {
            logger.info('Application is up to date', { version: info.version });
        });
        
        autoUpdater.on('error', (error) => {
            logger.error('Auto-updater error', error);
        });
        
        autoUpdater.on('download-progress', (progress) => {
            logger.debug('Download progress', { 
                percent: progress.percent,
                transferred: progress.transferred,
                total: progress.total
            });
            if (this.mainWindow) {
                this.mainWindow.webContents.send('download-progress', progress);
            }
        });
        
        autoUpdater.on('update-downloaded', (info) => {
            logger.info('Update downloaded', { version: info.version });
            if (this.mainWindow) {
                this.mainWindow.webContents.send('update-downloaded', info);
            }
        });
    }

    /**
     * Build database context for AI code generation
     */
    async buildDatabaseContext(dbName, tables) {
        try {
            let context = `\nDATABASE STRUCTURE:\n`;
            
            for (const tableName of tables) {
                // Get table schema
                const db = await this.databaseManager.connectDatabase(dbName);
                const schema = await this.databaseManager.getTableSchema(db, tableName);
                
                context += `\nTable: ${tableName}\n`;
                context += `Columns:\n`;
                
                Object.entries(schema.columns).forEach(([colName, colDef]) => {
                    context += `  - ${colName}: ${colDef.type}${colDef.required ? ' (required)' : ''}${colDef.unique ? ' (unique)' : ''}\n`;
                });
                
                // Get sample data (limited to 3 rows)
                const sampleData = await this.databaseManager.queryData(dbName, tableName, { limit: 3 });
                if (sampleData.success && sampleData.data.length > 0) {
                    context += `Sample data:\n`;
                    sampleData.data.forEach((row, index) => {
                        context += `  Row ${index + 1}: ${JSON.stringify(row, null, 2)}\n`;
                    });
                }
                context += `\n`;
            }
            
            return context;
        } catch (error) {
            logger.error('Failed to build database context', { dbName, error });
            return '\nDatabase context unavailable due to error.\n';
        }
    }
}

// App initialization
const builder = new DynamicAppBuilder();

// Global error handlers
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', error, {
        stack: error.stack,
        critical: true
    });
    // Optionally show dialog to user
    dialog.showErrorBox('Unexpected Error', 
        'An unexpected error occurred. The application may be unstable.\n\n' + error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    // Convert reason to Error if it isn't one
    const error = reason instanceof Error ? reason : new Error(String(reason));

    logger.error('Unhandled Promise Rejection', error, {
        reasonType: typeof reason,
        reasonString: String(reason),
        critical: true
    });

    // Also log to console for immediate visibility
    console.error('Unhandled Promise Rejection:', reason);
});

app.whenReady().then(async () => {
    try {
        await builder.initialize();
        builder.createWindow();
    } catch (error) {
        logger.error('Failed to initialize application', error, {
            critical: true,
            stack: error.stack
        });
        console.error('Application initialization failed:', error);
        dialog.showErrorBox('Initialization Error',
            'Failed to start the application.\n\n' + error.message);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        builder.createWindow();
    }
});

// Comprehensive cleanup on exit
let isCleaningUp = false;
let cleanupCompleted = false;

async function performCleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;
    
    logger.info('Application shutting down, performing comprehensive cleanup...');
    
    const cleanupTasks = [];
    
    // 1. Clean up active sessions
    for (const sessionId of builder.activeSessions.keys()) {
        cleanupTasks.push(
            builder.cleanupSession(sessionId).catch(error => {
                logger.error('Failed to cleanup session during shutdown', error, { sessionId });
            })
        );
    }
    
    // 2. Close all database connections
    if (builder.databaseManager) {
        cleanupTasks.push(
            builder.databaseManager.closeAllConnections().catch(error => {
                logger.error('Failed to close database connections', error);
            })
        );
    }

    // 3. Stop performance monitoring
    if (builder.performanceDashboard) {
        cleanupTasks.push(
            Promise.resolve(builder.performanceDashboard.cleanup()).catch(error => {
                logger.error('Failed to cleanup performance dashboard', error);
            })
        );
    }
    
    // 4. Stop system monitoring  
    if (systemMonitor) {
        cleanupTasks.push(
            Promise.resolve(systemMonitor.stop()).catch(error => {
                logger.error('Failed to stop system monitor', error);
            })
        );
    }
    
    // 5. Save session history
    if (sessionManager) {
        cleanupTasks.push(
            sessionManager.saveHistory().catch(error => {
                logger.error('Failed to save session history', error);
            })
        );
    }
    
    // 6. Flush logger
    cleanupTasks.push(
        new Promise(resolve => {
            logger.info('Flushing log buffers...');
            // Give logger time to flush
            setTimeout(resolve, 100);
        })
    );
    
    // Wait for all cleanup tasks with timeout
    await Promise.race([
        Promise.allSettled(cleanupTasks),
        new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout
    ]);
    
    // 7. Clean up temp directory (after other cleanup)
    try {
        const tempDir = path.join(__dirname, '..', 'temp');
        await fs.rm(tempDir, { recursive: true, force: true });
        logger.info('Temp directory cleaned');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            logger.error('Failed to clean temp directory', error);
        }
    }
    
    logger.info('Cleanup completed successfully');
}

// Register cleanup handlers
app.on('before-quit', async (event) => {
    // If cleanup is already done, allow quit to proceed
    if (cleanupCompleted) {
        return;
    }

    // If cleanup is in progress, prevent quit but don't start another cleanup
    if (isCleaningUp) {
        event.preventDefault();
        return;
    }

    // Start cleanup
    event.preventDefault();
    isCleaningUp = true;

    try {
        await performCleanup();
        cleanupCompleted = true;
    } catch (error) {
        logger.error('Cleanup failed, forcing quit', { error: error.message });
        cleanupCompleted = true;
    }

    // Now quit - this will trigger before-quit again but cleanupCompleted will be true
    app.quit();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle uncaught errors during shutdown
process.on('SIGTERM', async () => {
    if (isCleaningUp || cleanupCompleted) {
        process.exit(0);
        return;
    }
    isCleaningUp = true;
    logger.info('SIGTERM received, shutting down gracefully');
    await performCleanup();
    cleanupCompleted = true;
    process.exit(0);
});

process.on('SIGINT', async () => {
    if (isCleaningUp || cleanupCompleted) {
        process.exit(0);
        return;
    }
    isCleaningUp = true;
    logger.info('SIGINT received, shutting down gracefully');
    await performCleanup();
    cleanupCompleted = true;
    process.exit(0);
});