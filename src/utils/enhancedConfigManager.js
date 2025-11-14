const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const crypto = require('crypto');
const yaml = require('js-yaml');
const Joi = require('joi');

/**
 * Enhanced Configuration Manager - Comprehensive configuration management
 * Extends basic config with validation, schemas, environments, and encryption
 */
class EnhancedConfigurationManager extends EventEmitter {
    constructor() {
        super();
        this.config = {};
        this.defaults = {};
        this.schemas = new Map();
        this.watchers = new Map();
        this.environment = process.env.NODE_ENV || 'development';
        this.configPath = '';
        this.secretsPath = '';
        this.isInitialized = false;
        this.configHistory = [];
        this.maxHistorySize = 50;
        this.configCache = new Map();
    }

    /**
     * Initialize enhanced configuration manager
     */
    async initialize(options = {}) {
        try {
            this.configPath = options.configPath || path.join(process.cwd(), 'config');
            this.secretsPath = options.secretsPath || path.join(this.configPath, 'secrets');
            
            // Create config directories
            await this.ensureDirectories();
            
            // Setup default configurations
            this.setupDefaults();
            
            // Setup validation schemas
            this.setupSchemas();
            
            // Load configurations
            await this.loadConfigurations();
            
            // Setup environment variables
            this.loadEnvironmentVariables();
            
            // Merge configurations
            this.mergeConfigurations();
            
            // Validate final configuration
            this.validateConfiguration();
            
            // Setup watchers if enabled
            if (options.watchFiles !== false) {
                this.setupFileWatchers();
            }
            
            this.isInitialized = true;
            this.emit('initialized', this.config);
            
            return { success: true, config: this.getPublicConfig() };
        } catch (error) {
            console.error('Failed to initialize enhanced configuration manager:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup comprehensive default configurations
     */
    setupDefaults() {
        this.defaults = {
            app: {
                name: 'Self-Building Desktop App',
                version: '1.0.0',
                environment: this.environment,
                debug: this.environment === 'development',
                logLevel: this.environment === 'development' ? 'debug' : 'info',
                theme: 'dark',
                language: 'en',
                autoUpdate: true
            },
            
            server: {
                port: 3000,
                host: 'localhost',
                cors: {
                    enabled: true,
                    origins: ['http://localhost:3000'],
                    credentials: true
                },
                rateLimit: {
                    enabled: true,
                    windowMs: 15 * 60 * 1000,
                    max: 100
                },
                ssl: {
                    enabled: false,
                    cert: null,
                    key: null
                }
            },
            
            database: {
                type: 'sqlite',
                path: './data/database.sqlite',
                connectionLimit: 10,
                enableWAL: true,
                busyTimeout: 5000,
                synchronous: 'NORMAL',
                journalMode: 'WAL',
                cache: {
                    enabled: true,
                    ttl: 300000,
                    maxSize: 1000
                },
                backup: {
                    enabled: true,
                    interval: 24 * 60 * 60 * 1000,
                    retention: 7
                }
            },
            
            api: {
                anthropic: {
                    endpoint: 'https://api.anthropic.com',
                    model: 'claude-3-opus-20240229',
                    maxTokens: 4096,
                    temperature: 0.7,
                    timeout: 30000,
                    retries: 3,
                    retryDelay: 1000,
                    rateLimit: {
                        requests: 100,
                        window: 60000
                    }
                },
                github: {
                    enabled: false,
                    endpoint: 'https://api.github.com',
                    token: null
                }
            },
            
            security: {
                encryption: {
                    enabled: true,
                    algorithm: 'aes-256-gcm',
                    keyRotation: true,
                    rotationInterval: 30 * 24 * 60 * 60 * 1000
                },
                authentication: {
                    enabled: true,
                    jwtExpiry: '15m',
                    refreshTokenExpiry: '7d',
                    maxLoginAttempts: 5,
                    lockoutDuration: 15 * 60 * 1000,
                    passwordMinLength: 8,
                    passwordRequirements: {
                        uppercase: true,
                        lowercase: true,
                        numbers: true,
                        symbols: true
                    },
                    twoFactorEnabled: false,
                    biometricEnabled: false
                },
                audit: {
                    enabled: true,
                    level: 'all',
                    retention: 90
                },
                cors: {
                    enabled: true,
                    origins: ['http://localhost:3000']
                },
                csp: {
                    enabled: true,
                    directives: {
                        defaultSrc: ["'self'"],
                        scriptSrc: ["'self'", "'unsafe-inline'"],
                        styleSrc: ["'self'", "'unsafe-inline'"],
                        imgSrc: ["'self'", 'data:', 'https:'],
                        connectSrc: ["'self'", 'https://api.anthropic.com']
                    }
                }
            },
            
            cache: {
                enabled: true,
                type: 'memory',
                maxSize: 100 * 1024 * 1024,
                ttl: 3600000,
                checkPeriod: 600000,
                compression: true,
                persistence: {
                    enabled: false,
                    path: './cache'
                }
            },
            
            performance: {
                monitoring: {
                    enabled: true,
                    interval: 5000,
                    metrics: ['cpu', 'memory', 'disk', 'network'],
                    threshold: {
                        cpu: 80,
                        memory: 90,
                        disk: 95
                    }
                },
                optimization: {
                    debounceDelay: 300,
                    throttleLimit: 100,
                    virtualScrolling: true,
                    lazyLoading: true,
                    codeMinification: true,
                    imageOptimization: true
                }
            },
            
            logging: {
                enabled: true,
                level: this.environment === 'development' ? 'debug' : 'info',
                console: true,
                file: {
                    enabled: true,
                    path: './logs',
                    maxSize: 10 * 1024 * 1024,
                    maxFiles: 5,
                    compression: true
                },
                remote: {
                    enabled: false,
                    endpoint: null,
                    apiKey: null
                },
                audit: {
                    enabled: true,
                    compliance: 'standard',
                    retention: 90 * 24 * 60 * 60 * 1000
                }
            },
            
            features: {
                collaboration: {
                    enabled: false,
                    maxUsers: 10,
                    autoSave: true,
                    saveInterval: 5000,
                    conflictResolution: 'last-write-wins'
                },
                versionControl: {
                    enabled: true,
                    autoCommit: false,
                    commitInterval: 300000,
                    provider: 'git'
                },
                templates: {
                    enabled: true,
                    customTemplates: true,
                    communityTemplates: false,
                    maxTemplateSize: 10 * 1024 * 1024
                },
                aiAssistant: {
                    enabled: true,
                    contextWindow: 4096,
                    streaming: true,
                    codeCompletion: true,
                    errorCorrection: true,
                    suggestions: true
                },
                plugins: {
                    enabled: true,
                    sandboxed: true,
                    autoLoad: false,
                    marketplace: false
                }
            },
            
            ui: {
                theme: 'dark',
                animations: true,
                fontSize: 14,
                fontFamily: 'Monaco, Consolas, monospace',
                layout: 'default',
                sidebar: {
                    visible: true,
                    position: 'left',
                    width: 250
                },
                editor: {
                    theme: 'monokai',
                    tabSize: 2,
                    wordWrap: true,
                    lineNumbers: true,
                    minimap: true
                }
            },
            
            paths: {
                data: './data',
                logs: './logs',
                temp: './temp',
                uploads: './uploads',
                downloads: './downloads',
                templates: './templates',
                plugins: './plugins',
                backup: './backup',
                cache: './cache'
            },
            
            limits: {
                maxFileSize: 50 * 1024 * 1024,
                maxUploadSize: 100 * 1024 * 1024,
                maxMemoryUsage: 512 * 1024 * 1024,
                maxConcurrentTasks: 10,
                maxSessionDuration: 24 * 60 * 60 * 1000,
                maxApiRequests: 1000,
                maxDatabaseConnections: 50,
                maxCacheEntries: 10000
            },
            
            experimental: {
                enabled: false,
                features: {
                    webAssembly: false,
                    webGPU: false,
                    serviceWorkers: false,
                    webRTC: false
                }
            }
        };
    }

    /**
     * Setup comprehensive validation schemas
     */
    setupSchemas() {
        // App configuration schema
        this.schemas.set('app', Joi.object({
            name: Joi.string().required(),
            version: Joi.string().pattern(/^\d+\.\d+\.\d+$/),
            environment: Joi.string().valid('development', 'staging', 'production'),
            debug: Joi.boolean(),
            logLevel: Joi.string().valid('debug', 'info', 'warning', 'error'),
            theme: Joi.string().valid('light', 'dark', 'auto'),
            language: Joi.string(),
            autoUpdate: Joi.boolean()
        }));

        // Server configuration schema
        this.schemas.set('server', Joi.object({
            port: Joi.number().port(),
            host: Joi.string().hostname(),
            cors: Joi.object({
                enabled: Joi.boolean(),
                origins: Joi.array().items(Joi.string()),
                credentials: Joi.boolean()
            }),
            rateLimit: Joi.object({
                enabled: Joi.boolean(),
                windowMs: Joi.number().positive(),
                max: Joi.number().positive()
            }),
            ssl: Joi.object({
                enabled: Joi.boolean(),
                cert: Joi.string().allow(null),
                key: Joi.string().allow(null)
            })
        }));

        // Database configuration schema
        this.schemas.set('database', Joi.object({
            type: Joi.string().valid('sqlite', 'postgresql', 'mysql', 'mongodb'),
            path: Joi.string().when('type', {
                is: 'sqlite',
                then: Joi.required()
            }),
            connectionLimit: Joi.number().positive(),
            enableWAL: Joi.boolean(),
            busyTimeout: Joi.number().positive(),
            cache: Joi.object({
                enabled: Joi.boolean(),
                ttl: Joi.number().positive(),
                maxSize: Joi.number().positive()
            }),
            backup: Joi.object({
                enabled: Joi.boolean(),
                interval: Joi.number().positive(),
                retention: Joi.number().positive()
            })
        }));

        // Security configuration schema
        this.schemas.set('security', Joi.object({
            encryption: Joi.object({
                enabled: Joi.boolean(),
                algorithm: Joi.string(),
                keyRotation: Joi.boolean(),
                rotationInterval: Joi.number().positive()
            }),
            authentication: Joi.object({
                enabled: Joi.boolean(),
                jwtExpiry: Joi.string(),
                refreshTokenExpiry: Joi.string(),
                maxLoginAttempts: Joi.number().positive(),
                lockoutDuration: Joi.number().positive(),
                passwordMinLength: Joi.number().min(8),
                passwordRequirements: Joi.object({
                    uppercase: Joi.boolean(),
                    lowercase: Joi.boolean(),
                    numbers: Joi.boolean(),
                    symbols: Joi.boolean()
                }),
                twoFactorEnabled: Joi.boolean(),
                biometricEnabled: Joi.boolean()
            }),
            audit: Joi.object({
                enabled: Joi.boolean(),
                level: Joi.string().valid('all', 'errors', 'warnings', 'none'),
                retention: Joi.number().positive()
            })
        }));

        // Performance configuration schema
        this.schemas.set('performance', Joi.object({
            monitoring: Joi.object({
                enabled: Joi.boolean(),
                interval: Joi.number().positive(),
                metrics: Joi.array().items(Joi.string()),
                threshold: Joi.object({
                    cpu: Joi.number().min(0).max(100),
                    memory: Joi.number().min(0).max(100),
                    disk: Joi.number().min(0).max(100)
                })
            }),
            optimization: Joi.object({
                debounceDelay: Joi.number().positive(),
                throttleLimit: Joi.number().positive(),
                virtualScrolling: Joi.boolean(),
                lazyLoading: Joi.boolean(),
                codeMinification: Joi.boolean(),
                imageOptimization: Joi.boolean()
            })
        }));

        // UI configuration schema
        this.schemas.set('ui', Joi.object({
            theme: Joi.string().valid('light', 'dark', 'auto'),
            animations: Joi.boolean(),
            fontSize: Joi.number().min(8).max(24),
            fontFamily: Joi.string(),
            layout: Joi.string(),
            sidebar: Joi.object({
                visible: Joi.boolean(),
                position: Joi.string().valid('left', 'right'),
                width: Joi.number().min(150).max(500)
            }),
            editor: Joi.object({
                theme: Joi.string(),
                tabSize: Joi.number().min(1).max(8),
                wordWrap: Joi.boolean(),
                lineNumbers: Joi.boolean(),
                minimap: Joi.boolean()
            })
        }));

        // Limits configuration schema
        this.schemas.set('limits', Joi.object({
            maxFileSize: Joi.number().positive(),
            maxUploadSize: Joi.number().positive(),
            maxMemoryUsage: Joi.number().positive(),
            maxConcurrentTasks: Joi.number().positive(),
            maxSessionDuration: Joi.number().positive(),
            maxApiRequests: Joi.number().positive(),
            maxDatabaseConnections: Joi.number().positive(),
            maxCacheEntries: Joi.number().positive()
        }));
    }

    /**
     * Ensure configuration directories exist
     */
    async ensureDirectories() {
        const dirs = [
            this.configPath,
            this.secretsPath,
            path.join(this.configPath, 'environments'),
            path.join(this.configPath, 'overrides'),
            path.join(this.configPath, 'backups')
        ];
        
        for (const dir of dirs) {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    /**
     * Load configurations from multiple sources
     */
    async loadConfigurations() {
        const configs = {};
        
        // Load base configuration
        const baseConfigPath = path.join(this.configPath, 'config.json');
        if (await this.fileExists(baseConfigPath)) {
            configs.base = await this.loadConfigFile(baseConfigPath);
        }
        
        // Load environment-specific configuration
        const envConfigPath = path.join(this.configPath, 'environments', `${this.environment}.json`);
        if (await this.fileExists(envConfigPath)) {
            configs.environment = await this.loadConfigFile(envConfigPath);
        }
        
        // Load local override configuration
        const localConfigPath = path.join(this.configPath, 'config.local.json');
        if (await this.fileExists(localConfigPath)) {
            configs.local = await this.loadConfigFile(localConfigPath);
        }
        
        // Load user preferences
        const userConfigPath = path.join(this.configPath, 'user.json');
        if (await this.fileExists(userConfigPath)) {
            configs.user = await this.loadConfigFile(userConfigPath);
        }
        
        // Load secrets
        const secretsPath = path.join(this.secretsPath, 'secrets.json');
        if (await this.fileExists(secretsPath)) {
            configs.secrets = await this.loadSecrets(secretsPath);
        }
        
        this.loadedConfigs = configs;
    }

    /**
     * Load configuration file with format detection
     */
    async loadConfigFile(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const ext = path.extname(filePath).toLowerCase();
            
            switch (ext) {
                case '.json':
                    return JSON.parse(content);
                case '.yaml':
                case '.yml':
                    return yaml.load(content);
                case '.js':
                    delete require.cache[require.resolve(filePath)];
                    return require(filePath);
                default:
                    throw new Error(`Unsupported config file format: ${ext}`);
            }
        } catch (error) {
            console.error(`Failed to load config file ${filePath}:`, error);
            return {};
        }
    }

    /**
     * Load and decrypt secrets
     */
    async loadSecrets(secretsPath) {
        try {
            const encrypted = await fs.readFile(secretsPath, 'utf8');
            const decrypted = this.decryptSecrets(encrypted);
            return JSON.parse(decrypted);
        } catch (error) {
            console.warn('Failed to load secrets:', error.message);
            return {};
        }
    }

    /**
     * Load environment variables with prefix
     */
    loadEnvironmentVariables() {
        const envConfig = {};
        const prefix = 'APP_';
        
        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith(prefix)) {
                const configKey = key
                    .slice(prefix.length)
                    .toLowerCase()
                    .replace(/_/g, '.');
                
                this.setNestedProperty(envConfig, configKey, this.parseEnvValue(value));
            }
        }
        
        this.envConfig = envConfig;
    }

    /**
     * Merge configurations with priority order
     */
    mergeConfigurations() {
        // Priority: env vars > user > local > secrets > environment > base > defaults
        this.config = this.deepMerge(
            this.defaults,
            this.loadedConfigs?.base || {},
            this.loadedConfigs?.environment || {},
            this.loadedConfigs?.secrets || {},
            this.loadedConfigs?.local || {},
            this.loadedConfigs?.user || {},
            this.envConfig || {}
        );
    }

    /**
     * Validate entire configuration
     */
    validateConfiguration() {
        const errors = [];
        
        for (const [section, schema] of this.schemas) {
            if (this.config[section]) {
                const result = schema.validate(this.config[section], {
                    abortEarly: false,
                    allowUnknown: true
                });
                
                if (result.error) {
                    errors.push({
                        section,
                        errors: result.error.details.map(d => d.message)
                    });
                }
            }
        }
        
        if (errors.length > 0) {
            console.warn('Configuration validation warnings:', errors);
            this.emit('validation-warnings', errors);
        }
        
        return errors.length === 0;
    }

    /**
     * Get configuration value with caching
     */
    get(key, defaultValue = undefined) {
        if (!key) return this.getPublicConfig();
        
        // Check cache first
        if (this.configCache.has(key)) {
            return this.configCache.get(key);
        }
        
        const keys = key.split('.');
        let value = this.config;
        
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue;
            }
        }
        
        // Cache the result
        this.configCache.set(key, value);
        
        return value;
    }

    /**
     * Set configuration value with validation
     */
    async set(key, value, options = {}) {
        try {
            // Store previous value for rollback
            const previousValue = this.get(key);
            
            // Set the new value
            this.setNestedProperty(this.config, key, value);
            
            // Clear cache
            this.configCache.delete(key);
            
            // Validate if schema exists
            const section = key.split('.')[0];
            if (this.schemas.has(section)) {
                const schema = this.schemas.get(section);
                const result = schema.validate(this.config[section]);
                
                if (result.error) {
                    // Rollback on validation failure
                    this.setNestedProperty(this.config, key, previousValue);
                    throw new Error(`Validation failed: ${result.error.message}`);
                }
            }
            
            // Add to history
            this.addToHistory({
                action: 'set',
                key,
                previousValue,
                newValue: value,
                timestamp: Date.now(),
                user: options.user || 'system'
            });
            
            // Persist if requested
            if (options.persist) {
                await this.saveConfiguration(options.target || 'user');
            }
            
            // Emit change event
            this.emit('config-changed', {
                key,
                previousValue,
                newValue: value,
                user: options.user
            });
            
            return { success: true, previousValue };
        } catch (error) {
            console.error('Failed to set configuration:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Batch update configuration values
     */
    async update(updates, options = {}) {
        try {
            const changes = [];
            const rollback = [];
            
            // Flatten nested updates
            const flatUpdates = this.flattenObject(updates);
            
            // Apply each update
            for (const [key, value] of Object.entries(flatUpdates)) {
                const previousValue = this.get(key);
                rollback.push({ key, value: previousValue });
                
                const result = await this.set(key, value, { persist: false });
                if (result.success) {
                    changes.push({ key, value, previousValue });
                } else {
                    // Rollback all changes on failure
                    for (const rb of rollback) {
                        this.setNestedProperty(this.config, rb.key, rb.value);
                    }
                    throw new Error(`Failed to update ${key}: ${result.error}`);
                }
            }
            
            // Persist if requested
            if (options.persist && changes.length > 0) {
                await this.saveConfiguration(options.target || 'user');
            }
            
            // Emit batch update event
            this.emit('config-batch-updated', { changes, user: options.user });
            
            return { success: true, changes };
        } catch (error) {
            console.error('Failed to update configuration:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Save configuration to file with backup
     */
    async saveConfiguration(target = 'user') {
        try {
            let filePath;
            let config;
            
            // Determine file and content based on target
            switch (target) {
                case 'base':
                    filePath = path.join(this.configPath, 'config.json');
                    config = this.config;
                    break;
                    
                case 'environment':
                    filePath = path.join(this.configPath, 'environments', `${this.environment}.json`);
                    config = this.getDifference(this.config, this.defaults);
                    break;
                    
                case 'local':
                    filePath = path.join(this.configPath, 'config.local.json');
                    config = this.getDifference(this.config, {
                        ...this.defaults,
                        ...this.loadedConfigs?.base
                    });
                    break;
                    
                case 'user':
                    filePath = path.join(this.configPath, 'user.json');
                    config = this.getUserPreferences();
                    break;
                    
                default:
                    throw new Error(`Unknown target: ${target}`);
            }
            
            // Create backup
            if (await this.fileExists(filePath)) {
                const backupPath = path.join(
                    this.configPath,
                    'backups',
                    `${path.basename(filePath)}.${Date.now()}.backup`
                );
                await fs.copyFile(filePath, backupPath);
            }
            
            // Save configuration
            await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
            
            this.emit('config-saved', { target, path: filePath });
            
            return { success: true, path: filePath };
        } catch (error) {
            console.error('Failed to save configuration:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get user preferences only
     */
    getUserPreferences() {
        const userKeys = [
            'app.theme',
            'app.language',
            'ui',
            'editor',
            'features.aiAssistant.codeCompletion'
        ];
        
        const preferences = {};
        
        for (const key of userKeys) {
            const value = this.get(key);
            if (value !== undefined) {
                this.setNestedProperty(preferences, key, value);
            }
        }
        
        return preferences;
    }

    /**
     * Export configuration in various formats
     */
    async export(format = 'json', options = {}) {
        try {
            const config = options.includeSecrets ? 
                this.config : 
                this.getPublicConfig();
            
            let output;
            
            switch (format) {
                case 'json':
                    output = JSON.stringify(config, null, 2);
                    break;
                    
                case 'yaml':
                    output = yaml.dump(config);
                    break;
                    
                case 'env':
                    output = this.toEnvFormat(config);
                    break;
                    
                case 'ini':
                    output = this.toIniFormat(config);
                    break;
                    
                default:
                    throw new Error(`Unsupported export format: ${format}`);
            }
            
            if (options.file) {
                await fs.writeFile(options.file, output, 'utf8');
                return { success: true, path: options.file };
            }
            
            return { success: true, data: output };
        } catch (error) {
            console.error('Failed to export configuration:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get public configuration without sensitive data
     */
    getPublicConfig() {
        const config = JSON.parse(JSON.stringify(this.config));
        
        // List of sensitive paths to remove
        const sensitivePaths = [
            'api.anthropic.apiKey',
            'api.github.token',
            'security.encryption.key',
            'security.authentication.secret',
            'database.password',
            'logging.remote.apiKey',
            'secrets'
        ];
        
        // Remove sensitive data
        for (const path of sensitivePaths) {
            this.removeNestedProperty(config, path);
        }
        
        return config;
    }

    /**
     * Deep merge multiple objects
     */
    deepMerge(...objects) {
        const result = {};
        
        for (const obj of objects) {
            if (!obj) continue;
            
            for (const [key, value] of Object.entries(obj)) {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    result[key] = this.deepMerge(result[key] || {}, value);
                } else {
                    result[key] = value;
                }
            }
        }
        
        return result;
    }

    /**
     * Get difference between two objects
     */
    getDifference(obj1, obj2) {
        const diff = {};
        
        for (const [key, value] of Object.entries(obj1)) {
            if (!(key in obj2) || JSON.stringify(value) !== JSON.stringify(obj2[key])) {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    const nested = this.getDifference(value, obj2[key] || {});
                    if (Object.keys(nested).length > 0) {
                        diff[key] = nested;
                    }
                } else {
                    diff[key] = value;
                }
            }
        }
        
        return diff;
    }

    /**
     * Helper methods for nested properties
     */
    setNestedProperty(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        
        let current = obj;
        for (const key of keys) {
            if (!(key in current) || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[lastKey] = value;
    }

    removeNestedProperty(obj, path) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        
        let current = obj;
        for (const key of keys) {
            if (!(key in current)) return;
            current = current[key];
        }
        
        delete current[lastKey];
    }

    flattenObject(obj, prefix = '') {
        const flattened = {};
        
        for (const [key, value] of Object.entries(obj)) {
            const newKey = prefix ? `${prefix}.${key}` : key;
            
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                Object.assign(flattened, this.flattenObject(value, newKey));
            } else {
                flattened[newKey] = value;
            }
        }
        
        return flattened;
    }

    /**
     * Format converters
     */
    toEnvFormat(config) {
        const flattened = this.flattenObject(config);
        const lines = [];
        
        for (const [key, value] of Object.entries(flattened)) {
            const envKey = `APP_${key.toUpperCase().replace(/\./g, '_')}`;
            const envValue = typeof value === 'string' ? value : JSON.stringify(value);
            lines.push(`${envKey}=${envValue}`);
        }
        
        return lines.join('\n');
    }

    toIniFormat(config) {
        const lines = [];
        
        for (const [section, values] of Object.entries(config)) {
            if (typeof values === 'object' && !Array.isArray(values)) {
                lines.push(`[${section}]`);
                
                for (const [key, value] of Object.entries(values)) {
                    if (typeof value !== 'object') {
                        lines.push(`${key}=${value}`);
                    }
                }
                
                lines.push('');
            }
        }
        
        return lines.join('\n');
    }

    parseEnvValue(value) {
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (/^\d+$/.test(value)) return parseInt(value);
        if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
        
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    /**
     * Encryption methods for secrets
     */
    encryptSecrets(data) {
        const algorithm = 'aes-256-gcm';
        const key = this.getSecretKey();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const tag = cipher.getAuthTag();
        
        return JSON.stringify({
            encrypted,
            iv: iv.toString('hex'),
            tag: tag.toString('hex')
        });
    }

    decryptSecrets(encryptedData) {
        const { encrypted, iv, tag } = JSON.parse(encryptedData);
        const algorithm = 'aes-256-gcm';
        const key = this.getSecretKey();
        
        const decipher = crypto.createDecipheriv(
            algorithm,
            key,
            Buffer.from(iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }

    getSecretKey() {
        const masterKey = process.env.CONFIG_MASTER_KEY || 'default-master-key-change-in-production';
        return crypto.scryptSync(masterKey, 'config-salt', 32);
    }

    /**
     * File system helpers
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * History management
     */
    addToHistory(entry) {
        this.configHistory.unshift(entry);
        
        if (this.configHistory.length > this.maxHistorySize) {
            this.configHistory.pop();
        }
    }

    getHistory(limit = 10) {
        return this.configHistory.slice(0, limit);
    }

    /**
     * Get configuration statistics
     */
    getStatistics() {
        const stats = {
            environment: this.environment,
            sectionsCount: Object.keys(this.config).length,
            schemasCount: this.schemas.size,
            watchersCount: this.watchers.size,
            historySize: this.configHistory.length,
            cacheSize: this.configCache.size,
            configSize: JSON.stringify(this.config).length,
            isInitialized: this.isInitialized
        };
        
        // Add section statistics
        stats.sections = {};
        for (const section of Object.keys(this.config)) {
            if (typeof this.config[section] === 'object') {
                stats.sections[section] = Object.keys(this.config[section]).length;
            }
        }
        
        return stats;
    }

    /**
     * Reset configuration section or all
     */
    async reset(section = null) {
        try {
            if (section) {
                if (this.defaults[section]) {
                    this.config[section] = JSON.parse(JSON.stringify(this.defaults[section]));
                    this.configCache.clear();
                    
                    this.addToHistory({
                        action: 'reset',
                        section,
                        timestamp: Date.now()
                    });
                }
            } else {
                this.config = JSON.parse(JSON.stringify(this.defaults));
                this.configCache.clear();
                
                this.addToHistory({
                    action: 'reset-all',
                    timestamp: Date.now()
                });
            }
            
            this.emit('config-reset', { section });
            
            return { success: true };
        } catch (error) {
            console.error('Failed to reset configuration:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup file watchers for hot-reloading
     */
    setupFileWatchers() {
        const fs = require('fs');
        const watchFiles = [
            path.join(this.configPath, 'config.json'),
            path.join(this.configPath, 'environments', `${this.environment}.json`),
            path.join(this.configPath, 'config.local.json'),
            path.join(this.configPath, 'user.json')
        ];
        
        watchFiles.forEach(file => {
            fs.access(file, fs.constants.F_OK, (err) => {
                if (!err) {
                    const watcher = fs.watch(file, async (eventType) => {
                        if (eventType === 'change') {
                            console.log(`Configuration file changed: ${file}`);
                            await this.reload();
                        }
                    });
                    
                    this.watchers.set(file, watcher);
                }
            });
        });
    }

    /**
     * Reload configuration from files
     */
    async reload() {
        try {
            this.configCache.clear();
            await this.loadConfigurations();
            this.loadEnvironmentVariables();
            this.mergeConfigurations();
            this.validateConfiguration();
            
            this.emit('config-reloaded', this.config);
            
            return { success: true };
        } catch (error) {
            console.error('Failed to reload configuration:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cleanup and shutdown
     */
    async cleanup() {
        // Close file watchers
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
        
        // Clear caches
        this.configCache.clear();
        
        // Save current configuration
        await this.saveConfiguration('user');
        
        this.emit('cleanup');
        
        return { success: true };
    }
}

module.exports = new EnhancedConfigurationManager();