/**
 * Application Constants
 * Centralizes all magic numbers and configuration constants
 */

module.exports = {
    // Rate Limiting
    RATE_LIMITS: {
        API_KEY_VALIDATION: {
            MAX_REQUESTS: 5,
            WINDOW_MS: 60000 // 1 minute
        },
        CODE_GENERATION: {
            MAX_REQUESTS: 10,
            WINDOW_MS: 60000 // 1 minute
        },
        CODE_EXECUTION: {
            MAX_REQUESTS: 20,
            WINDOW_MS: 60000 // 1 minute
        },
        DATABASE_OPERATIONS: {
            MAX_REQUESTS: 50,
            WINDOW_MS: 60000 // 1 minute
        },
        SCHEMA_GENERATION: {
            MAX_REQUESTS: 5,
            WINDOW_MS: 60000 // 1 minute
        }
    },

    // Execution Configuration
    EXECUTION: {
        MAX_CONCURRENT: 3,
        TIMEOUT_MS: 30000, // 30 seconds
        MAX_MEMORY_MB: 512,
        MAX_OUTPUT_SIZE_BYTES: 1048576 // 1MB
    },

    // Input Validation Limits
    INPUT_LIMITS: {
        MAX_PROMPT_LENGTH: 10000,
        MIN_PROMPT_LENGTH: 1,
        MAX_CODE_LENGTH: 100000,
        MIN_CODE_LENGTH: 1,
        MAX_DB_NAME_LENGTH: 255,
        MAX_TABLE_NAME_LENGTH: 64,
        MAX_FEEDBACK_LENGTH: 5000,
        MAX_SESSION_HISTORY: 1000,
        MAX_CONFIG_SIZE_KB: 100
    },

    // Session Management
    SESSION: {
        MAX_ACTIVE_SESSIONS: 100,
        SESSION_TIMEOUT_MS: 3600000, // 1 hour
        CLEANUP_INTERVAL_MS: 300000 // 5 minutes
    },

    // Cache Configuration
    CACHE: {
        DEFAULT_TTL_MS: 300000, // 5 minutes
        MAX_CACHE_SIZE_MB: 100,
        CLEANUP_INTERVAL_MS: 60000 // 1 minute
    },

    // Monitoring
    MONITORING: {
        HEALTH_CHECK_INTERVAL_MS: 10000, // 10 seconds
        METRICS_COLLECTION_INTERVAL_MS: 5000, // 5 seconds
        LOG_RETENTION_DAYS: 30
    },

    // Security
    SECURITY: {
        CSRF_TOKEN_LENGTH: 32,
        ENCRYPTION_ALGORITHM: 'aes-256-gcm',
        KEY_ROTATION_INTERVAL_MS: 2592000000, // 30 days
        PASSWORD_MIN_LENGTH: 12,
        API_KEY_MIN_LENGTH: 20
    },

    // File System
    FILESYSTEM: {
        TEMP_DIR_NAME: 'temp',
        MAX_FILE_SIZE_MB: 10,
        ALLOWED_EXTENSIONS: ['.js', '.json', '.txt', '.md', '.sql']
    },

    // Database Configuration (Multi-App Shared Database)
    DATABASE: {
        SHARED_DB_NAME: 'shared',
        MAX_SCHEMA_CONTEXT_TABLES: 20,
        MAX_SAMPLE_ROWS_PER_TABLE: 3,
        SCHEMA_CACHE_TTL_MS: 60000, // 1 minute
        MAX_APPS: 50,
        MAX_TABLES_PER_APP: 100
    },

    // Network
    NETWORK: {
        REQUEST_TIMEOUT_MS: 30000, // 30 seconds
        MAX_RETRIES: 3,
        RETRY_DELAY_MS: 1000
    },

    // Allowed npm packages for code generation
    ALLOWED_PACKAGES: [
        'lodash',
        'axios',
        'chart.js',
        'moment',
        'uuid',
        'express',
        'cors',
        'body-parser',
        'helmet',
        'date-fns',
        'ramda',
        'validator'
    ],

    // Error Messages
    ERRORS: {
        UNAUTHORIZED: 'Unauthorized access',
        RATE_LIMIT_EXCEEDED: 'Rate limit exceeded. Please try again later.',
        VALIDATION_FAILED: 'Input validation failed',
        INTERNAL_ERROR: 'An internal error occurred',
        NOT_INITIALIZED: 'Service not initialized',
        INVALID_CREDENTIALS: 'Invalid credentials',
        SESSION_EXPIRED: 'Session expired',
        CSRF_FAILED: 'CSRF validation failed'
    },

    // Window Configuration
    WINDOW: {
        DEFAULT_WIDTH: 1200,
        DEFAULT_HEIGHT: 800,
        MIN_WIDTH: 800,
        MIN_HEIGHT: 600
    }
};
