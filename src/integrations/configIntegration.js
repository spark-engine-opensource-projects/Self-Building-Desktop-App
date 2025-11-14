const enhancedConfigManager = require('../utils/enhancedConfigManager');
const DatabaseManager = require('../utils/databaseManager');
const AuthenticationModule = require('../modules/AuthenticationModule');
const EncryptionModule = require('../modules/EncryptionModule');
const AuditModule = require('../modules/AuditModule');
const logger = require('../utils/logger');

class ConfigurationIntegration {
    constructor() {
        this.modules = new Map();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            // Ensure enhanced config manager is initialized
            await enhancedConfigManager.initialize();

            // Register all modules
            this.registerModules();

            // Apply configurations to all modules
            await this.applyConfigurations();

            // Setup config watchers
            this.setupConfigWatchers();

            this.initialized = true;
            logger.info('Configuration integration initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize configuration integration', error);
            throw error;
        }
    }

    registerModules() {
        // Register core modules that need configuration
        this.modules.set('database', DatabaseManager);
        this.modules.set('authentication', new AuthenticationModule());
        this.modules.set('encryption', new EncryptionModule());
        this.modules.set('audit', new AuditModule());
    }

    async applyConfigurations() {
        // Apply database configuration
        const dbConfig = enhancedConfigManager.get('database');
        if (dbConfig && this.modules.get('database')) {
            const dbManager = this.modules.get('database');
            if (dbManager.applyConfig) {
                await dbManager.applyConfig(dbConfig);
            }
        }

        // Apply authentication configuration
        const authConfig = enhancedConfigManager.get('authentication');
        if (authConfig) {
            const authModule = this.modules.get('authentication');
            await authModule.updateConfig({
                jwtSecret: authConfig.jwtSecret || enhancedConfigManager.getSecret('JWT_SECRET'),
                jwtExpiry: authConfig.jwtExpiry || '24h',
                sessionTimeout: authConfig.sessionTimeout || 3600000,
                maxLoginAttempts: authConfig.maxLoginAttempts || 5,
                lockoutDuration: authConfig.lockoutDuration || 900000,
                passwordPolicy: authConfig.passwordPolicy || {
                    minLength: 12,
                    requireUppercase: true,
                    requireLowercase: true,
                    requireNumbers: true,
                    requireSpecialChars: true
                },
                oauth: authConfig.oauth || {},
                twoFactorEnabled: authConfig.twoFactorEnabled !== false
            });
        }

        // Apply encryption configuration
        const encryptionConfig = enhancedConfigManager.get('encryption');
        if (encryptionConfig) {
            const encryptionModule = this.modules.get('encryption');
            await encryptionModule.updateConfig({
                algorithm: encryptionConfig.algorithm || 'aes-256-gcm',
                keyRotationInterval: encryptionConfig.keyRotationInterval || 2592000000,
                rsaKeySize: encryptionConfig.rsaKeySize || 4096,
                saltRounds: encryptionConfig.saltRounds || 12,
                enableFileEncryption: encryptionConfig.enableFileEncryption !== false,
                enableDatabaseEncryption: encryptionConfig.enableDatabaseEncryption !== false
            });
        }

        // Apply audit configuration
        const auditConfig = enhancedConfigManager.get('audit');
        if (auditConfig) {
            const auditModule = this.modules.get('audit');
            await auditModule.updateConfig({
                enabled: auditConfig.enabled !== false,
                retentionDays: auditConfig.retentionDays || 90,
                logLevel: auditConfig.logLevel || 'info',
                includeSystemEvents: auditConfig.includeSystemEvents !== false,
                includeUserEvents: auditConfig.includeUserEvents !== false,
                includeSecurityEvents: auditConfig.includeSecurityEvents !== false,
                complianceMode: auditConfig.complianceMode || 'standard',
                encryptLogs: auditConfig.encryptLogs !== false,
                remoteLogging: auditConfig.remoteLogging || null
            });
        }

        logger.info('Configuration applied to all modules');
    }

    setupConfigWatchers() {
        // Watch for configuration changes and apply them dynamically
        enhancedConfigManager.watch(async (change) => {
            logger.info('Configuration change detected', { 
                section: change.section,
                key: change.key 
            });

            try {
                // Handle specific configuration changes
                switch (change.section) {
                    case 'database':
                        await this.updateDatabaseConfig(change);
                        break;
                    case 'authentication':
                        await this.updateAuthenticationConfig(change);
                        break;
                    case 'encryption':
                        await this.updateEncryptionConfig(change);
                        break;
                    case 'audit':
                        await this.updateAuditConfig(change);
                        break;
                    case 'security':
                        await this.updateSecurityConfig(change);
                        break;
                    case 'performance':
                        await this.updatePerformanceConfig(change);
                        break;
                    default:
                        logger.debug('No specific handler for config section', { 
                            section: change.section 
                        });
                }

                // Notify all modules of configuration change
                for (const [name, module] of this.modules) {
                    if (module.onConfigChange && typeof module.onConfigChange === 'function') {
                        await module.onConfigChange(change);
                    }
                }
            } catch (error) {
                logger.error('Failed to apply configuration change', error, {
                    section: change.section,
                    key: change.key
                });
            }
        });
    }

    async updateDatabaseConfig(change) {
        const dbManager = this.modules.get('database');
        if (!dbManager) return;

        const dbConfig = enhancedConfigManager.get('database');
        
        // Update connection pool settings
        if (change.key === 'maxConnections' || change.key === 'connectionTimeout') {
            if (dbManager.updateConnectionPool) {
                await dbManager.updateConnectionPool({
                    max: dbConfig.maxConnections,
                    timeout: dbConfig.connectionTimeout
                });
            }
        }

        // Update query settings
        if (change.key === 'queryTimeout' || change.key === 'maxQuerySize') {
            if (dbManager.updateQuerySettings) {
                await dbManager.updateQuerySettings({
                    timeout: dbConfig.queryTimeout,
                    maxSize: dbConfig.maxQuerySize
                });
            }
        }

        logger.info('Database configuration updated', { key: change.key });
    }

    async updateAuthenticationConfig(change) {
        const authModule = this.modules.get('authentication');
        if (!authModule) return;

        const authConfig = enhancedConfigManager.get('authentication');
        
        // Update JWT settings
        if (change.key === 'jwtSecret' || change.key === 'jwtExpiry') {
            await authModule.updateJWTConfig({
                secret: authConfig.jwtSecret || enhancedConfigManager.getSecret('JWT_SECRET'),
                expiry: authConfig.jwtExpiry
            });
        }

        // Update password policy
        if (change.key === 'passwordPolicy') {
            await authModule.updatePasswordPolicy(authConfig.passwordPolicy);
        }

        // Update OAuth settings
        if (change.key === 'oauth') {
            await authModule.updateOAuthConfig(authConfig.oauth);
        }

        // Update 2FA settings
        if (change.key === 'twoFactorEnabled') {
            await authModule.updateTwoFactorSettings({
                enabled: authConfig.twoFactorEnabled
            });
        }

        logger.info('Authentication configuration updated', { key: change.key });
    }

    async updateEncryptionConfig(change) {
        const encryptionModule = this.modules.get('encryption');
        if (!encryptionModule) return;

        const encryptionConfig = enhancedConfigManager.get('encryption');
        
        // Update encryption algorithm
        if (change.key === 'algorithm') {
            await encryptionModule.updateAlgorithm(encryptionConfig.algorithm);
        }

        // Update key rotation settings
        if (change.key === 'keyRotationInterval') {
            await encryptionModule.updateKeyRotation({
                interval: encryptionConfig.keyRotationInterval
            });
        }

        // Update RSA key size
        if (change.key === 'rsaKeySize') {
            await encryptionModule.regenerateRSAKeys(encryptionConfig.rsaKeySize);
        }

        logger.info('Encryption configuration updated', { key: change.key });
    }

    async updateAuditConfig(change) {
        const auditModule = this.modules.get('audit');
        if (!auditModule) return;

        const auditConfig = enhancedConfigManager.get('audit');
        
        // Update retention policy
        if (change.key === 'retentionDays') {
            await auditModule.updateRetentionPolicy({
                days: auditConfig.retentionDays
            });
        }

        // Update compliance mode
        if (change.key === 'complianceMode') {
            await auditModule.setComplianceMode(auditConfig.complianceMode);
        }

        // Update remote logging
        if (change.key === 'remoteLogging') {
            await auditModule.updateRemoteLogging(auditConfig.remoteLogging);
        }

        logger.info('Audit configuration updated', { key: change.key });
    }

    async updateSecurityConfig(change) {
        const securityConfig = enhancedConfigManager.get('security');
        
        // Update rate limiting
        if (change.key === 'rateLimiting') {
            // Update all rate limiters across modules
            for (const [name, module] of this.modules) {
                if (module.updateRateLimiting) {
                    await module.updateRateLimiting(securityConfig.rateLimiting);
                }
            }
        }

        // Update CORS settings
        if (change.key === 'cors') {
            // Update CORS configuration for API modules
            for (const [name, module] of this.modules) {
                if (module.updateCORS) {
                    await module.updateCORS(securityConfig.cors);
                }
            }
        }

        logger.info('Security configuration updated', { key: change.key });
    }

    async updatePerformanceConfig(change) {
        const perfConfig = enhancedConfigManager.get('performance');
        
        // Update caching settings
        if (change.key === 'caching') {
            // Update cache configuration across modules
            for (const [name, module] of this.modules) {
                if (module.updateCaching) {
                    await module.updateCaching(perfConfig.caching);
                }
            }
        }

        // Update threading settings
        if (change.key === 'maxWorkers' || change.key === 'workerTimeout') {
            // Update worker pool configuration
            for (const [name, module] of this.modules) {
                if (module.updateWorkerPool) {
                    await module.updateWorkerPool({
                        max: perfConfig.maxWorkers,
                        timeout: perfConfig.workerTimeout
                    });
                }
            }
        }

        logger.info('Performance configuration updated', { key: change.key });
    }

    // Helper methods for modules to access configuration
    async getModuleConfig(moduleName) {
        const config = enhancedConfigManager.get(moduleName);
        
        // Enhance with secrets if needed
        if (moduleName === 'authentication') {
            config.jwtSecret = config.jwtSecret || enhancedConfigManager.getSecret('JWT_SECRET');
        }
        
        if (moduleName === 'database') {
            config.password = config.password || enhancedConfigManager.getSecret('DB_PASSWORD');
        }
        
        return config;
    }

    async updateModuleConfig(moduleName, updates) {
        await enhancedConfigManager.update(moduleName, updates);
    }

    async validateModuleConfig(moduleName, config) {
        return enhancedConfigManager.validate(config, moduleName);
    }

    // Export current configuration
    async exportConfiguration(format = 'json') {
        return await enhancedConfigManager.export(format);
    }

    // Import configuration
    async importConfiguration(data, format = 'json') {
        return await enhancedConfigManager.import(data, format);
    }

    // Get configuration history
    getConfigHistory() {
        return enhancedConfigManager.getHistory();
    }

    // Rollback to previous configuration
    async rollbackConfig(version) {
        return await enhancedConfigManager.rollback(version);
    }

    // Health check for configuration system
    async healthCheck() {
        const checks = {
            configManager: false,
            modules: {},
            watchers: false
        };

        try {
            // Check config manager
            checks.configManager = enhancedConfigManager.isInitialized();

            // Check module configurations
            for (const [name, module] of this.modules) {
                checks.modules[name] = {
                    registered: true,
                    configured: false
                };
                
                if (module.isConfigured && typeof module.isConfigured === 'function') {
                    checks.modules[name].configured = await module.isConfigured();
                }
            }

            // Check watchers
            checks.watchers = enhancedConfigManager.getWatcherCount() > 0;

            return {
                healthy: checks.configManager && Object.values(checks.modules).every(m => m.registered),
                details: checks
            };
        } catch (error) {
            logger.error('Configuration health check failed', error);
            return {
                healthy: false,
                error: error.message,
                details: checks
            };
        }
    }

    // Cleanup and shutdown
    async shutdown() {
        try {
            // Remove all watchers
            enhancedConfigManager.clearWatchers();

            // Cleanup modules
            for (const [name, module] of this.modules) {
                if (module.shutdown && typeof module.shutdown === 'function') {
                    await module.shutdown();
                }
            }

            // Clear module registry
            this.modules.clear();

            this.initialized = false;
            logger.info('Configuration integration shut down successfully');
        } catch (error) {
            logger.error('Failed to shut down configuration integration', error);
            throw error;
        }
    }
}

module.exports = new ConfigurationIntegration();