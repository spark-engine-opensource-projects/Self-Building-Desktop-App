const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const logger = require('./logger');

class ConfigManager {
    constructor() {
        this.config = null;
        this.configPath = null;
        this.watchers = [];
    }

    async initialize() {
        try {
            const userDataPath = app ? app.getPath('userData') : path.join(__dirname, '..', '..');
            this.configPath = path.join(userDataPath, 'config.json');
            
            // Load default config
            const defaultConfigPath = path.join(__dirname, '..', 'config', 'default.json');
            const defaultConfig = JSON.parse(await fs.readFile(defaultConfigPath, 'utf8'));
            
            // Try to load user config
            let userConfig = {};
            try {
                const userConfigData = await fs.readFile(this.configPath, 'utf8');
                userConfig = JSON.parse(userConfigData);
            } catch (error) {
                // User config doesn't exist, will create it
                logger.info('No user config found, using defaults');
            }
            
            // Merge configs
            this.config = this.mergeConfigs(defaultConfig, userConfig);
            
            // Save merged config
            await this.saveConfig();
            
            logger.info('Configuration loaded successfully', { configPath: this.configPath });
            
        } catch (error) {
            logger.error('Failed to initialize configuration', error);
            throw error;
        }
    }

    mergeConfigs(defaultConfig, userConfig) {
        const merged = JSON.parse(JSON.stringify(defaultConfig));
        
        Object.keys(userConfig).forEach(section => {
            if (typeof userConfig[section] === 'object' && !Array.isArray(userConfig[section])) {
                merged[section] = { ...merged[section], ...userConfig[section] };
            } else {
                merged[section] = userConfig[section];
            }
        });
        
        return merged;
    }

    async saveConfig() {
        try {
            await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
            logger.debug('Configuration saved', { configPath: this.configPath });
        } catch (error) {
            logger.error('Failed to save configuration', error);
            throw error;
        }
    }

    get(section, key = null) {
        if (!this.config) {
            throw new Error('Configuration not initialized');
        }
        
        if (key) {
            return this.config[section]?.[key];
        }
        
        return this.config[section] || this.config;
    }

    async set(section, key, value = null) {
        if (!this.config) {
            throw new Error('Configuration not initialized');
        }

        if (value !== null) {
            // Setting a specific key
            if (!this.config[section]) {
                this.config[section] = {};
            }
            this.config[section][key] = value;
        } else {
            // Setting entire section
            this.config[section] = key;
        }

        await this.saveConfig();
        this.notifyWatchers(section, key, value);
        
        logger.info('Configuration updated', { section, key, value });
    }

    async update(updates) {
        if (!this.config) {
            throw new Error('Configuration not initialized');
        }

        Object.keys(updates).forEach(section => {
            if (typeof updates[section] === 'object' && !Array.isArray(updates[section])) {
                this.config[section] = { ...this.config[section], ...updates[section] };
            } else {
                this.config[section] = updates[section];
            }
        });

        await this.saveConfig();
        this.notifyWatchers('bulk', updates);
        
        logger.info('Configuration bulk updated', { updates });
    }

    watch(callback) {
        this.watchers.push(callback);
        return () => {
            const index = this.watchers.indexOf(callback);
            if (index > -1) {
                this.watchers.splice(index, 1);
            }
        };
    }

    notifyWatchers(section, key, value) {
        this.watchers.forEach(callback => {
            try {
                callback({ section, key, value, config: this.config });
            } catch (error) {
                logger.error('Config watcher error', error);
            }
        });
    }

    validateConfig() {
        const errors = [];
        
        // Validate execution settings
        const exec = this.config.execution;
        if (exec.maxConcurrentExecutions < 1 || exec.maxConcurrentExecutions > 10) {
            errors.push('maxConcurrentExecutions must be between 1 and 10');
        }
        
        if (exec.executionTimeout < 5000 || exec.executionTimeout > 300000) {
            errors.push('executionTimeout must be between 5 seconds and 5 minutes');
        }
        
        if (exec.maxMemoryMB < 128 || exec.maxMemoryMB > 2048) {
            errors.push('maxMemoryMB must be between 128MB and 2GB');
        }
        
        // Validate AI settings
        const ai = this.config.ai;
        if (ai.temperature < 0 || ai.temperature > 2) {
            errors.push('AI temperature must be between 0 and 2');
        }
        
        if (ai.maxTokens < 100 || ai.maxTokens > 4000) {
            errors.push('AI maxTokens must be between 100 and 4000');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    getAll() {
        return { ...this.config };
    }
}

module.exports = new ConfigManager();