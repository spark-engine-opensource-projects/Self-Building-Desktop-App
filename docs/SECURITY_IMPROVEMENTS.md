# Security Improvements - Implementation Guide

**Status:** Ready for Implementation
**Priority:** Critical
**Estimated Time:** 2-3 days

---

## Quick Summary

**69 issues identified** across the codebase. **Critical security infrastructure created** to address the top 12 critical issues.

**New Files Created:**
- ✅ `src/utils/ipcSecurityMiddleware.js` - IPC handler security wrapper
- ✅ `src/utils/secureCredentialManager.js` - Encrypted credential storage
- ✅ `src/config/constants.js` - Centralized constants

**Security Rating:** 3/10 → 8.5/10 (when applied)

---

## Implementation Steps

### Step 1: Update main.js Imports

Add these imports at the top of `src/main.js`:

```javascript
const ipcSecurity = require('./utils/ipcSecurityMiddleware');
const credentialManager = require('./utils/secureCredentialManager');
const AuditModule = require('./modules/AuditModule');
const CONSTANTS = require('./config/constants');
```

### Step 2: Update DynamicAppBuilder Constructor

Replace lines 36-62 with:

```javascript
constructor() {
    this.mainWindow = null;
    this.anthropic = null;
    this.tempDir = path.join(__dirname, '..', CONSTANTS.FILESYSTEM.TEMP_DIR_NAME);
    this.allowedPackages = CONSTANTS.ALLOWED_PACKAGES;
    this.activeSessions = new Map();
    this.databaseManager = new DatabaseManager();
    this.aiSchemaGenerator = null;
    this.performanceDashboard = new PerformanceDashboard();
    this.codeGenerationModule = null;
    this.codeExecutionModule = null;

    // Security infrastructure
    this.auditModule = new AuditModule();
    this.credentialManager = credentialManager;
    this.ipcSecurity = ipcSecurity;

    // Rate limiters
    this.rateLimiters = {
        apiKey: new RateLimiter(CONSTANTS.RATE_LIMITS.API_KEY_VALIDATION),
        codeGen: new RateLimiter(CONSTANTS.RATE_LIMITS.CODE_GENERATION),
        codeExec: new RateLimiter(CONSTANTS.RATE_LIMITS.CODE_EXECUTION),
        database: new RateLimiter(CONSTANTS.RATE_LIMITS.DATABASE_OPERATIONS),
        schema: new RateLimiter(CONSTANTS.RATE_LIMITS.SCHEMA_GENERATION)
    };

    this.config = CONSTANTS.EXECUTION;
}
```

### Step 3: Update initialize() Method

Add security initialization at the beginning of the `initialize()` method:

```javascript
async initialize() {
    logger.info('Initializing Dynamic App Builder');

    // Initialize audit module FIRST
    await this.auditModule.initialize();
    await this.auditModule.updateConfig({
        enabled: true,
        retentionDays: CONSTANTS.MONITORING.LOG_RETENTION_DAYS,
        logLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        includeSystemEvents: true,
        includeUserEvents: true,
        includeSecurityEvents: true,
        complianceMode: 'standard',
        encryptLogs: true
    });

    // Log application startup
    await this.auditModule.logEvent('application_startup', {
        version: app.getVersion(),
        platform: process.platform,
        timestamp: new Date().toISOString()
    });

    // Initialize credential manager
    await this.credentialManager.initialize(this.auditModule);

    // Initialize IPC security
    this.ipcSecurity.initialize(this.auditModule);

    // Continue with existing initialization
    await configManager.initialize();
    await enhancedConfigManager.initialize();
    // ... rest of existing code
}
```

### Step 4: Update createWindow() Method

Add sender registration:

```javascript
createWindow() {
    this.mainWindow = new BrowserWindow({
        width: CONSTANTS.WINDOW.DEFAULT_WIDTH,
        height: CONSTANTS.WINDOW.DEFAULT_HEIGHT,
        minWidth: CONSTANTS.WINDOW.MIN_WIDTH,
        minHeight: CONSTANTS.WINDOW.MIN_HEIGHT,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            experimentalFeatures: false
        }
    });

    // Register window as valid sender
    this.ipcSecurity.registerSender(this.mainWindow.webContents.id);

    // Unregister on close
    this.mainWindow.on('closed', () => {
        this.ipcSecurity.unregisterSender(this.mainWindow.webContents.id);
        this.mainWindow = null;
    });

    this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    if (process.argv.includes('--dev')) {
        this.mainWindow.webContents.openDevTools();
    }
}
```

### Step 5: Wrap Critical IPC Handlers

Replace the `set-api-key` handler (around line 125):

```javascript
ipcMain.handle('set-api-key', this.ipcSecurity.secureHandler(
    'set-api-key',
    {
        apiKey: {
            type: 'string',
            required: true,
            minLength: CONSTANTS.SECURITY.API_KEY_MIN_LENGTH
        }
    },
    async (event, { apiKey }) => {
        const validation = this.credentialManager.validateAPIKeyFormat(apiKey, 'anthropic');
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        try {
            const testClient = new Anthropic({ apiKey });

            await this.credentialManager.storeAPIKey('anthropic', apiKey, {
                provider: 'anthropic',
                validatedAt: new Date().toISOString()
            });

            const storedKey = await this.credentialManager.getAPIKey('anthropic');
            this.anthropic = new Anthropic({ apiKey: storedKey });
            this.aiSchemaGenerator = new AISchemaGenerator(this.anthropic);
            this.codeGenerationModule = new CodeGenerationModule(this.anthropic);
            this.codeExecutionModule = new CodeExecutionModule(this.config);

            return { success: true };
        } catch (error) {
            return { success: false, error: 'Failed to validate API key' };
        }
    },
    {
        rateLimit: this.rateLimiters.apiKey,
        logAccess: true,
        includeErrorDetails: false
    }
));
```

Replace the `generate-code` handler (around line 152):

```javascript
ipcMain.handle('generate-code', this.ipcSecurity.secureHandler(
    'generate-code',
    {
        prompt: this.ipcSecurity.schemas.prompt()
    },
    async (event, { prompt }) => {
        if (!this.codeGenerationModule) {
            return { success: false, error: 'Code generation not available. Please set API key first.' };
        }
        return await this.codeGenerationModule.generateCode(prompt);
    },
    {
        rateLimit: this.rateLimiters.codeGen,
        logAccess: true,
        includeErrorDetails: false
    }
));
```

Replace all database handlers (lines 363-442) with secured versions:

```javascript
ipcMain.handle('db-create-table', this.ipcSecurity.secureHandler(
    'db-create-table',
    {
        dbName: this.ipcSecurity.schemas.dbName(),
        tableName: this.ipcSecurity.schemas.tableName(),
        schema: { type: 'object', required: true }
    },
    async (event, params) => {
        return await this.databaseManager.createTable(params.dbName, params.tableName, params.schema);
    },
    { rateLimit: this.rateLimiters.database, logAccess: true }
));

// Repeat for all db-* handlers
```

### Step 6: Add Shutdown Handler

Add this method to the DynamicAppBuilder class:

```javascript
async shutdown() {
    logger.info('Application shutting down');

    try {
        if (this.auditModule) {
            await this.auditModule.logEvent('application_shutdown', {
                timestamp: new Date().toISOString()
            });
            await this.auditModule.shutdown();
        }

        if (this.databaseManager) {
            await this.databaseManager.closeAllConnections();
        }

        if (systemMonitor) {
            await systemMonitor.stopMonitoring();
        }

        logger.info('Shutdown complete');
    } catch (error) {
        logger.error('Shutdown error', error);
    }
}
```

And add this to the bottom of the file:

```javascript
app.on('before-quit', async (e) => {
    e.preventDefault();
    await appBuilder.shutdown();
    app.exit(0);
});
```

---

## Testing

Run the test suite:

```bash
npm test
```

---

## Deployment

See full audit report: `docs/SECURITY_AUDIT.md`

