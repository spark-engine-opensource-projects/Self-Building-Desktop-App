const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const logger = require('./utils/logger');
const systemMonitor = require('./utils/systemMonitor');
const configManager = require('./utils/configManager');
const securitySandbox = require('./utils/securitySandbox');
const sessionManager = require('./utils/sessionManager');
const codeEnhancer = require('./utils/codeEnhancer');
const jsonParser = require('./utils/jsonParser');
const errorRecovery = require('./utils/errorRecovery');
const cacheManager = require('./utils/cacheManager');
const ipcValidator = require('./utils/ipcValidator');
const CircuitBreaker = require('./utils/circuitBreaker');
const secureStorage = require('./utils/secureStorage');
const envConfig = require('./utils/envConfig');
const performanceMonitor = require('./utils/performanceMonitor');
const requestInterceptor = require('./utils/requestInterceptor');
const scheduler = require('./utils/scheduler');
const DatabaseManager = require('./utils/databaseManager');
const AISchemaGenerator = require('./utils/aiSchemaGenerator');
const { autoUpdater } = require('electron-updater');
const RateLimiter = require('./utils/rateLimiter');
const crypto = require('crypto');
const PerformanceDashboard = require('./modules/PerformanceDashboard');
const CodeGenerationModule = require('./modules/CodeGenerationModule');
const CodeExecutionModule = require('./modules/CodeExecutionModule');

const execAsync = promisify(exec);

class DynamicAppBuilder {
    constructor() {
        this.mainWindow = null;
        this.anthropic = null;
        this.tempDir = path.join(__dirname, '..', 'temp');
        this.allowedPackages = [
            'lodash', 'axios', 'chart.js', 'moment', 'uuid',
            'express', 'cors', 'body-parser', 'helmet'
        ];
        this.activeSessions = new Map();
        this.databaseManager = new DatabaseManager();
        this.aiSchemaGenerator = null;
        this.performanceDashboard = new PerformanceDashboard();
        this.codeGenerationModule = null;
        this.codeExecutionModule = null;
        this.apiKeyRateLimiter = new RateLimiter({
            maxRequests: 5,
            windowMs: 60000, // 1 minute
            algorithm: 'sliding_window'
        });
        this.config = {
            maxConcurrentExecutions: 3,
            executionTimeout: 30000,
            maxMemoryMB: 512,
            maxOutputSize: 1048576 // 1MB
        };
    }

    async initialize() {
        logger.info('Initializing Dynamic App Builder');
        
        // Initialize configuration
        await configManager.initialize();
        
        // Initialize session manager
        await sessionManager.initialize();
        
        // Update config from loaded settings
        const execConfig = configManager.get('execution');
        this.config = { ...this.config, ...execConfig };
        
        await this.ensureTempDir();
        await systemMonitor.startMonitoring(configManager.get('monitoring', 'healthCheckInterval'));
        this.setupIPC();
        this.setupAutoUpdater();
        
        logger.info('Dynamic App Builder initialized successfully', { config: this.config });
    }

    async ensureTempDir() {
        try {
            await fs.access(this.tempDir);
        } catch {
            await fs.mkdir(this.tempDir, { recursive: true });
        }
    }

    createWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                sandbox: true, // Enhanced security - sandbox enabled
                webSecurity: true, // Enforce web security
                allowRunningInsecureContent: false, // Block insecure content
                experimentalFeatures: false // Disable experimental features
            },
            icon: path.join(__dirname, '..', 'assets', 'icon.png')
        });

        this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

        // Open DevTools in development
        if (process.argv.includes('--dev')) {
            this.mainWindow.webContents.openDevTools();
        }
    }

    setupIPC() {
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
                this.anthropic = new Anthropic({ apiKey });
                this.aiSchemaGenerator = new AISchemaGenerator(this.anthropic);
                this.codeGenerationModule = new CodeGenerationModule(this.anthropic);
                this.codeExecutionModule = new CodeExecutionModule(this.config);
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('generate-code', async (event, prompt) => {
            return await this.generateCode(prompt);
        });

        ipcMain.handle('execute-code', async (event, { packages, code, sessionId }) => {
            return await this.executeCode(packages, code, sessionId);
        });

        ipcMain.handle('execute-dom-code', async (event, { code, sessionId }) => {
            return await this.executeDOMCode(code, sessionId);
        });

        ipcMain.handle('cleanup-session', async (event, sessionId) => {
            return await this.cleanupSession(sessionId);
        });

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
                await configManager.update(newConfig);
                
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
        }

        // Check prompt length limit
        const securityConfig = configManager.get('security');
        if (prompt.length > securityConfig.maxPromptLength) {
            logger.logSecurityEvent('prompt_length_exceeded', { length: prompt.length, limit: securityConfig.maxPromptLength });
            return { success: false, error: 'Prompt exceeds maximum length limit' };
        }

        try {
            const resourceCheck = await systemMonitor.checkResourceLimits();
            if (!resourceCheck.safe) {
                logger.logSecurityEvent('resource_limit_exceeded', resourceCheck);
                return { success: false, error: 'System resources insufficient for code generation' };
            }

            const result = await this.attemptCodeGeneration(prompt, retryCount, startTime);
            
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
            const systemPrompt = `You are an advanced UI component generation assistant. Generate complete, production-ready, interactive web components for desktop applications.

Respond with a JSON object in this EXACT format:
{
  "packages": [],
  "code": "your complete JavaScript code here",
  "description": "Brief description of the component functionality"
}

CRITICAL REQUIREMENTS:

🏗️ ARCHITECTURE:
- Generate complete, self-contained UI components
- Use modern JavaScript (ES6+) with proper DOM manipulation
- Create responsive, accessible, and visually appealing interfaces
- Include comprehensive error handling and input validation
- Implement proper event delegation and cleanup

🎨 STYLING:
- Use inline styles or inject CSS via <style> elements
- Follow modern design principles (clean, minimal, intuitive)
- Ensure mobile-responsive design (use flexbox/grid)
- Include hover states, transitions, and micro-interactions
- Use consistent color scheme and typography

🔒 SECURITY & VALIDATION:
- Sanitize all user inputs
- Validate data types and ranges
- Include proper error messages and user feedback
- Handle edge cases gracefully
- Prevent XSS and injection vulnerabilities

♿ ACCESSIBILITY:
- Include ARIA labels and roles
- Ensure keyboard navigation support
- Use semantic HTML elements
- Provide screen reader compatibility
- Include focus indicators

📱 EXAMPLES:

1. DATA CALCULATOR:
   - Input fields with validation
   - Real-time calculation display
   - Error handling and user feedback
   - Professional styling with animations

2. INTERACTIVE DASHBOARD:
   - Data visualization components
   - Filter and search functionality
   - Responsive grid layout
   - Loading states and transitions

3. FORM COMPONENTS:
   - Multi-step forms with validation
   - Dynamic field generation
   - Progress indicators
   - Submission handling

4. CONTENT MANAGEMENT:
   - CRUD operations interface
   - Drag-and-drop functionality
   - Modal dialogs and confirmations
   - Data persistence simulation

🚀 PERFORMANCE:
- Optimize DOM operations
- Use event delegation
- Implement debouncing for inputs
- Minimize reflows and repaints
- Include loading states for async operations

CODE STRUCTURE:
- Start with container creation
- Define styles first, then HTML structure
- Add event handlers and functionality
- Include initialization and cleanup
- End with DOM insertion

NO COMMENTS in code - make it self-explanatory through good naming and structure.`;

            const response = await this.anthropic.messages.create({
                model: aiConfig.model,
                max_tokens: aiConfig.maxTokens,
                temperature: aiConfig.temperature,
                system: systemPrompt,
                messages: [
                    { role: "user", content: prompt }
                ]
            });

            const content = response.content[0].text;
            logger.debug('AI response received', { contentLength: content.length });
            
            // Use enhanced JSON parser
            const parseResult = await jsonParser.parseAIResponse(content);
            if (!parseResult.success) {
                logger.error('JSON parsing failed', parseResult);
                return {
                    success: false,
                    error: `Failed to parse AI response: ${parseResult.error}`,
                    details: parseResult.details,
                    suggestions: jsonParser.generateSuggestions(content, parseResult.error)
                };
            }

            const result = parseResult.data;
            
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
            await fs.rmdir(sessionDir, { recursive: true });
            
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
    logger.error('Unhandled Promise Rejection', null, {
        reason: reason,
        promise: promise,
        critical: true
    });
});

app.whenReady().then(async () => {
    await builder.initialize();
    builder.createWindow();
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

// Cleanup on exit
app.on('before-quit', async () => {
    logger.info('Application shutting down, cleaning up...');
    
    // Clean up active sessions
    for (const sessionId of builder.activeSessions.keys()) {
        try {
            await builder.cleanupSession(sessionId);
        } catch (error) {
            logger.error('Failed to cleanup session during shutdown', error, { sessionId });
        }
    }
    
    // Clean up temp directory
    try {
        const tempDir = path.join(__dirname, '..', 'temp');
        await fs.rmdir(tempDir, { recursive: true });
        logger.info('Cleanup completed successfully');
    } catch (error) {
        logger.error('Cleanup error during shutdown', error);
    }
});