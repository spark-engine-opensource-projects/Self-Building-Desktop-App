const path = require('path');

// Load environment variables
try {
  require('dotenv').config({
    path: path.join(process.cwd(), '.env')
  });
} catch (error) {
  // dotenv not available or .env file doesn't exist
  // Only log in development to avoid production noise
  if (process.env.NODE_ENV === 'development') {
    console.warn('Environment file not loaded:', error.message);
  }
}

/**
 * Environment Configuration Manager
 * Provides typed access to environment variables with defaults
 */
class EnvConfig {
  constructor() {
    this.config = this.loadConfig();
  }

  loadConfig() {
    return {
      // Application
      nodeEnv: this.getString('NODE_ENV', 'development'),
      logLevel: this.getString('LOG_LEVEL', 'info'),
      
      // API Configuration
      anthropicApiKey: this.getString('ANTHROPIC_API_KEY', ''),
      
      // Security
      enableSandbox: this.getBoolean('ENABLE_SANDBOX', true),
      maxPromptLength: this.getNumber('MAX_PROMPT_LENGTH', 10000),
      maxCodeLength: this.getNumber('MAX_CODE_LENGTH', 100000),
      
      // Performance
      maxConcurrentExecutions: this.getNumber('MAX_CONCURRENT_EXECUTIONS', 3),
      executionTimeout: this.getNumber('EXECUTION_TIMEOUT', 30000),
      maxMemoryMB: this.getNumber('MAX_MEMORY_MB', 512),
      
      // Cache
      cacheEnabled: this.getBoolean('CACHE_ENABLED', true),
      cacheTtl: this.getNumber('CACHE_TTL', 3600000),
      cacheMaxSize: this.getNumber('CACHE_MAX_SIZE', 100),
      
      // Monitoring
      enableMetrics: this.getBoolean('ENABLE_METRICS', true),
      healthCheckInterval: this.getNumber('HEALTH_CHECK_INTERVAL', 10000),
      
      // Development
      enableDevTools: this.getBoolean('ENABLE_DEV_TOOLS', false),
      autoReload: this.getBoolean('AUTO_RELOAD', false),
      
      // Paths
      tempDir: this.getString('TEMP_DIR', './temp'),
      logDir: this.getString('LOG_DIR', './logs'),
      configDir: this.getString('CONFIG_DIR', './config'),
      
      // External Services
      sentryDsn: this.getString('SENTRY_DSN', ''),
      analyticsApiKey: this.getString('ANALYTICS_API_KEY', '')
    };
  }

  /**
   * Get string environment variable with default
   */
  getString(key, defaultValue = '') {
    const value = process.env[key];
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Get number environment variable with default
   */
  getNumber(key, defaultValue = 0) {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Get boolean environment variable with default
   */
  getBoolean(key, defaultValue = false) {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    
    const lower = value.toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(lower);
  }

  /**
   * Get array environment variable with default
   */
  getArray(key, defaultValue = [], separator = ',') {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    
    return value.split(separator).map(item => item.trim()).filter(Boolean);
  }

  /**
   * Get all configuration
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Get specific config value
   */
  get(key) {
    return this.config[key];
  }

  /**
   * Check if running in development mode
   */
  isDevelopment() {
    return this.config.nodeEnv === 'development';
  }

  /**
   * Check if running in production mode
   */
  isProduction() {
    return this.config.nodeEnv === 'production';
  }

  /**
   * Check if running in test mode
   */
  isTest() {
    return this.config.nodeEnv === 'test';
  }

  /**
   * Validate required environment variables
   */
  validate() {
    const errors = [];
    
    // Required in production
    if (this.isProduction()) {
      if (!this.config.anthropicApiKey) {
        errors.push('ANTHROPIC_API_KEY is required in production');
      }
    }
    
    // Validate ranges
    if (this.config.maxConcurrentExecutions < 1 || this.config.maxConcurrentExecutions > 10) {
      errors.push('MAX_CONCURRENT_EXECUTIONS must be between 1 and 10');
    }
    
    if (this.config.executionTimeout < 1000 || this.config.executionTimeout > 300000) {
      errors.push('EXECUTION_TIMEOUT must be between 1000ms and 300000ms');
    }
    
    if (this.config.maxMemoryMB < 128 || this.config.maxMemoryMB > 4096) {
      errors.push('MAX_MEMORY_MB must be between 128MB and 4096MB');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Override config values (useful for testing)
   */
  override(overrides) {
    this.config = { ...this.config, ...overrides };
  }

  /**
   * Reset to original config
   */
  reset() {
    this.config = this.loadConfig();
  }

  /**
   * Get environment-specific database URL
   */
  getDatabaseUrl() {
    const base = this.getString('DATABASE_URL', '');
    if (!base) return null;
    
    // Add environment suffix for non-production
    if (!this.isProduction()) {
      return `${base}_${this.config.nodeEnv}`;
    }
    
    return base;
  }

  /**
   * Get log configuration based on environment
   */
  getLogConfig() {
    return {
      level: this.config.logLevel,
      silent: this.isTest(),
      format: this.isProduction() ? 'json' : 'simple',
      colorize: !this.isProduction(),
      timestamp: true
    };
  }

  /**
   * Get security configuration
   */
  getSecurityConfig() {
    return {
      sandbox: this.config.enableSandbox,
      maxPromptLength: this.config.maxPromptLength,
      maxCodeLength: this.config.maxCodeLength,
      enableResourceMonitoring: this.config.enableMetrics,
      logAllExecutions: !this.isTest()
    };
  }

  /**
   * Get performance configuration
   */
  getPerformanceConfig() {
    return {
      maxConcurrentExecutions: this.config.maxConcurrentExecutions,
      executionTimeout: this.config.executionTimeout,
      maxMemoryMB: this.config.maxMemoryMB,
      healthCheckInterval: this.config.healthCheckInterval
    };
  }
}

// Export singleton instance
module.exports = new EnvConfig();