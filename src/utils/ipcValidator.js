const logger = require('./logger');

/**
 * IPC Input Validation Module
 * Validates and sanitizes all IPC handler inputs
 */
class IPCValidator {
    constructor() {
        this.validators = {
            string: (value, options = {}) => {
                if (typeof value !== 'string') return false;
                if (options.minLength && value.length < options.minLength) return false;
                if (options.maxLength && value.length > options.maxLength) return false;
                if (options.pattern && !options.pattern.test(value)) return false;
                return true;
            },
            number: (value, options = {}) => {
                if (typeof value !== 'number' || isNaN(value)) return false;
                if (options.min !== undefined && value < options.min) return false;
                if (options.max !== undefined && value > options.max) return false;
                return true;
            },
            boolean: (value) => {
                return typeof value === 'boolean';
            },
            object: (value, options = {}) => {
                if (typeof value !== 'object' || value === null) return false;
                if (options.required) {
                    for (const field of options.required) {
                        if (!(field in value)) return false;
                    }
                }
                return true;
            },
            array: (value, options = {}) => {
                if (!Array.isArray(value)) return false;
                if (options.minLength && value.length < options.minLength) return false;
                if (options.maxLength && value.length > options.maxLength) return false;
                return true;
            }
        };

        // Schema definitions for each IPC endpoint
        this.schemas = {
            'set-api-key': {
                apiKey: { type: 'string', minLength: 1, maxLength: 200 }
            },
            'generate-code': {
                prompt: { type: 'string', minLength: 1, maxLength: 10000 }
            },
            'execute-code': {
                code: { type: 'string', minLength: 1, maxLength: 100000 },
                packages: { type: 'array', maxLength: 50, optional: true },
                sessionId: { type: 'string', pattern: /^session_\d+_[a-z0-9]+$/ }
            },
            'execute-dom-code': {
                code: { type: 'string', minLength: 1, maxLength: 100000 },
                sessionId: { type: 'string', pattern: /^session_\d+_[a-z0-9]+$/ }
            },
            'cleanup-session': {
                sessionId: { type: 'string', pattern: /^session_\d+_[a-z0-9]+$/ }
            },
            'update-config': {
                config: { type: 'object', required: [] }
            },
            'scan-code-security': {
                code: { type: 'string', minLength: 1, maxLength: 100000 }
            },
            'create-session': {
                sessionId: { type: 'string', pattern: /^session_\d+_[a-z0-9]+$/ },
                prompt: { type: 'string', maxLength: 10000, optional: true }
            },
            'get-session': {
                sessionId: { type: 'string', pattern: /^session_\d+_[a-z0-9]+$/ }
            },
            'get-session-history': {
                limit: { type: 'number', min: 1, max: 100, optional: true }
            },
            'submit-feedback': {
                feedback: {
                    type: 'object',
                    required: ['sessionId', 'rating']
                }
            },
            'update-cache-config': {
                config: { type: 'object' }
            }
        };
    }

    /**
     * Validate input against schema
     */
    validate(channel, input) {
        const schema = this.schemas[channel];
        if (!schema) {
            logger.warn('No validation schema for IPC channel', { channel });
            return { valid: true, sanitized: input }; // Allow unvalidated channels for backward compatibility
        }

        const errors = [];
        const sanitized = {};

        // Handle single parameter channels
        if (typeof input !== 'object' || input === null) {
            const firstKey = Object.keys(schema)[0];
            if (firstKey) {
                input = { [firstKey]: input };
            }
        }

        // Validate each field
        for (const [field, rules] of Object.entries(schema)) {
            const value = input[field];

            // Check if field is required
            if (value === undefined || value === null) {
                if (!rules.optional) {
                    errors.push(`Field '${field}' is required`);
                }
                continue;
            }

            // Validate type
            const validator = this.validators[rules.type];
            if (!validator) {
                errors.push(`Unknown type '${rules.type}' for field '${field}'`);
                continue;
            }

            if (!validator(value, rules)) {
                errors.push(`Field '${field}' failed validation (type: ${rules.type})`);
                continue;
            }

            // Sanitize string values
            if (rules.type === 'string') {
                sanitized[field] = this.sanitizeString(value, rules);
            } else if (rules.type === 'array' && value.every(item => typeof item === 'string')) {
                sanitized[field] = value.map(item => this.sanitizeString(item));
            } else {
                sanitized[field] = value;
            }
        }

        if (errors.length > 0) {
            logger.warn('IPC validation failed', { channel, errors });
            return { valid: false, errors, sanitized: null };
        }

        return { valid: true, errors: [], sanitized };
    }

    /**
     * Sanitize string input
     */
    sanitizeString(str, rules = {}) {
        // Remove null bytes
        let sanitized = str.replace(/\0/g, '');

        // Trim whitespace
        sanitized = sanitized.trim();

        // Apply max length if specified
        if (rules.maxLength) {
            sanitized = sanitized.substring(0, rules.maxLength);
        }

        // Remove dangerous patterns for specific fields
        if (rules.removeDangerous) {
            // Remove script tags
            sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
            // Remove event handlers
            sanitized = sanitized.replace(/on\w+\s*=\s*"[^"]*"/gi, '');
            sanitized = sanitized.replace(/on\w+\s*=\s*'[^']*'/gi, '');
        }

        return sanitized;
    }

    /**
     * Create validated IPC handler wrapper
     */
    createValidatedHandler(channel, handler) {
        return async (event, ...args) => {
            try {
                // Combine args into single input object
                const input = args.length === 1 ? args[0] : args;

                // Validate input
                const validation = this.validate(channel, input);
                if (!validation.valid) {
                    logger.logSecurityEvent('ipc_validation_failed', {
                        channel,
                        errors: validation.errors
                    });
                    return {
                        success: false,
                        error: 'Invalid input parameters',
                        details: validation.errors
                    };
                }

                // Call original handler with sanitized input
                const result = await handler(event, validation.sanitized);
                return result;

            } catch (error) {
                logger.error('IPC handler error', error, { channel });
                return {
                    success: false,
                    error: error.message || 'Internal error'
                };
            }
        };
    }

    /**
     * Add rate limiting to IPC handler
     */
    createRateLimitedHandler(channel, handler, options = {}) {
        const { maxCalls = 10, windowMs = 60000 } = options;
        const calls = new Map();

        return async (event, ...args) => {
            const now = Date.now();
            const key = `${channel}:${event.sender.id}`;

            // Clean old entries
            const windowStart = now - windowMs;
            const callTimes = calls.get(key) || [];
            const recentCalls = callTimes.filter(time => time > windowStart);

            if (recentCalls.length >= maxCalls) {
                logger.logSecurityEvent('ipc_rate_limit_exceeded', {
                    channel,
                    calls: recentCalls.length,
                    limit: maxCalls
                });
                return {
                    success: false,
                    error: 'Rate limit exceeded. Please try again later.'
                };
            }

            recentCalls.push(now);
            calls.set(key, recentCalls);

            return handler(event, ...args);
        };
    }
}

module.exports = new IPCValidator();