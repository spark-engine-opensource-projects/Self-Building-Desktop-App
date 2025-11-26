const ipcValidator = require('./ipcValidator');
const logger = require('./logger');
const crypto = require('crypto');

/**
 * IPC Security Middleware
 * Provides comprehensive security validation for all IPC handlers
 *
 * Features:
 * - Input validation and sanitization
 * - CSRF token validation
 * - Sender verification
 * - Error sanitization
 * - Security event logging
 */
class IPCSecurityMiddleware {
    constructor() {
        this.validSenders = new Set();
        this.csrfTokens = new Map();
        this.auditModule = null;
    }

    /**
     * Initialize middleware with audit module
     */
    initialize(auditModule) {
        this.auditModule = auditModule;
        logger.info('IPC Security Middleware initialized');
    }

    /**
     * Register a valid sender (window)
     */
    registerSender(senderId) {
        this.validSenders.add(senderId);
        logger.debug('Registered valid IPC sender', { senderId });
    }

    /**
     * Unregister sender
     */
    unregisterSender(senderId) {
        this.validSenders.delete(senderId);
        this.csrfTokens.delete(senderId);
        logger.debug('Unregistered IPC sender', { senderId });
    }

    /**
     * Generate CSRF token for sender
     */
    generateCSRFToken(senderId) {
        const token = crypto.randomBytes(32).toString('hex');
        this.csrfTokens.set(senderId, token);
        return token;
    }

    /**
     * Validate CSRF token with proper error handling
     */
    validateCSRFToken(senderId, token) {
        try {
            // Validate inputs
            if (!token || typeof token !== 'string') {
                return false;
            }

            const validToken = this.csrfTokens.get(senderId);
            if (!validToken) {
                return false;
            }

            // Validate hex format before creating buffers
            const hexPattern = /^[a-fA-F0-9]+$/;
            if (!hexPattern.test(token) || !hexPattern.test(validToken)) {
                logger.logSecurityEvent('invalid_csrf_token_format', { senderId });
                return false;
            }

            // Ensure tokens are same length (required for timingSafeEqual)
            if (token.length !== validToken.length) {
                return false;
            }

            const tokenBuffer = Buffer.from(token, 'hex');
            const validTokenBuffer = Buffer.from(validToken, 'hex');

            // Double-check buffer lengths match
            if (tokenBuffer.length !== validTokenBuffer.length) {
                return false;
            }

            return crypto.timingSafeEqual(tokenBuffer, validTokenBuffer);
        } catch (error) {
            // Log but don't expose error details
            logger.logSecurityEvent('csrf_validation_error', {
                senderId,
                error: error.message
            });
            return false;
        }
    }

    /**
     * Verify sender is authorized
     */
    verifySender(event) {
        const senderId = event.sender.id;
        if (!this.validSenders.has(senderId)) {
            logger.logSecurityEvent('unauthorized_ipc_sender', {
                senderId,
                processId: event.sender.processId
            });
            return false;
        }
        return true;
    }

    /**
     * Validate input parameters based on schema
     */
    validateInput(params, schema) {
        try {
            // Type validation
            for (const [key, rules] of Object.entries(schema)) {
                const value = params[key];

                // Required check
                if (rules.required && (value === undefined || value === null)) {
                    throw new Error(`Missing required parameter: ${key}`);
                }

                // Type check
                if (value !== undefined && value !== null) {
                    const actualType = Array.isArray(value) ? 'array' : typeof value;
                    if (rules.type && actualType !== rules.type) {
                        throw new Error(`Invalid type for ${key}: expected ${rules.type}, got ${actualType}`);
                    }

                    // String validations
                    if (rules.type === 'string') {
                        if (rules.maxLength && value.length > rules.maxLength) {
                            throw new Error(`${key} exceeds maximum length of ${rules.maxLength}`);
                        }
                        if (rules.minLength && value.length < rules.minLength) {
                            throw new Error(`${key} is shorter than minimum length of ${rules.minLength}`);
                        }
                        if (rules.pattern && !rules.pattern.test(value)) {
                            throw new Error(`${key} does not match required pattern`);
                        }
                    }

                    // Number validations
                    if (rules.type === 'number') {
                        if (rules.min !== undefined && value < rules.min) {
                            throw new Error(`${key} is less than minimum value of ${rules.min}`);
                        }
                        if (rules.max !== undefined && value > rules.max) {
                            throw new Error(`${key} exceeds maximum value of ${rules.max}`);
                        }
                        if (rules.integer && !Number.isInteger(value)) {
                            throw new Error(`${key} must be an integer`);
                        }
                    }

                    // Array validations
                    if (rules.type === 'array') {
                        if (rules.maxItems && value.length > rules.maxItems) {
                            throw new Error(`${key} exceeds maximum items of ${rules.maxItems}`);
                        }
                        if (rules.minItems && value.length < rules.minItems) {
                            throw new Error(`${key} has fewer than minimum items of ${rules.minItems}`);
                        }
                    }

                    // Object validations
                    if (rules.type === 'object') {
                        // Check for prototype pollution
                        // Use Object.keys and check for forbidden property names
                        const forbiddenProps = ['__proto__', 'constructor', 'prototype'];
                        const objKeys = Object.keys(value);
                        for (const prop of forbiddenProps) {
                            if (objKeys.includes(prop) || prop in value && Object.prototype.hasOwnProperty.call(value, prop)) {
                                throw new Error(`${key} contains forbidden properties`);
                            }
                        }
                        // Also check if the object's prototype was modified
                        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
                            throw new Error(`${key} contains forbidden properties`);
                        }

                        // Validate nested schema
                        if (rules.schema) {
                            this.validateInput(value, rules.schema);
                        }
                    }

                    // Custom validator
                    if (rules.validator && !rules.validator(value)) {
                        throw new Error(`${key} failed custom validation`);
                    }
                }
            }

            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                error: error.message
            };
        }
    }

    /**
     * Sanitize error for client response
     */
    sanitizeError(error, includeDetails = false) {
        const sanitized = {
            message: 'An error occurred while processing your request'
        };

        if (includeDetails && error.message) {
            // Remove sensitive information
            let message = error.message;

            // Remove file paths
            message = message.replace(/\/[^\s]+/g, '[path]');
            message = message.replace(/[A-Z]:\\[^\s]+/g, '[path]');

            // Remove potential secrets
            message = message.replace(/([a-zA-Z0-9]{32,})/g, '[redacted]');

            // Remove database details
            message = message.replace(/SQLITE_[A-Z_]+/g, 'DATABASE_ERROR');

            sanitized.message = message;
        }

        // Log full error internally
        logger.error('IPC handler error', {
            error: error.message,
            stack: error.stack,
            sanitizedMessage: sanitized.message
        });

        return sanitized;
    }

    /**
     * Wrap IPC handler with security checks
     */
    secureHandler(handlerName, schema, handler, options = {}) {
        const {
            requireCSRF = false,
            logAccess = true,
            rateLimit = null,
            includeErrorDetails = false
        } = options;

        return async (event, ...args) => {
            const startTime = Date.now();
            const senderId = event.sender.id;

            try {
                // 1. Verify sender
                if (!this.verifySender(event)) {
                    if (this.auditModule) {
                        await this.auditModule.logSecurityEvent('unauthorized_ipc_access', {
                            handler: handlerName,
                            senderId
                        });
                    }
                    return {
                        success: false,
                        error: 'Unauthorized access'
                    };
                }

                // 2. Check rate limit
                if (rateLimit) {
                    const allowed = await rateLimit.checkLimit(senderId);
                    if (!allowed) {
                        if (this.auditModule) {
                            await this.auditModule.logSecurityEvent('rate_limit_exceeded', {
                                handler: handlerName,
                                senderId
                            });
                        }
                        return {
                            success: false,
                            error: 'Rate limit exceeded. Please try again later.'
                        };
                    }
                }

                // 3. Validate CSRF token if required
                if (requireCSRF) {
                    const csrfToken = args[0]?.csrfToken;
                    if (!csrfToken || !this.validateCSRFToken(senderId, csrfToken)) {
                        if (this.auditModule) {
                            await this.auditModule.logSecurityEvent('csrf_validation_failed', {
                                handler: handlerName,
                                senderId
                            });
                        }
                        return {
                            success: false,
                            error: 'CSRF validation failed'
                        };
                    }
                }

                // 4. Validate input parameters
                if (schema) {
                    const params = args[0] || {};
                    const validation = this.validateInput(params, schema);

                    if (!validation.valid) {
                        logger.warn('IPC input validation failed', {
                            handler: handlerName,
                            error: validation.error,
                            senderId
                        });

                        if (this.auditModule) {
                            await this.auditModule.logSecurityEvent('input_validation_failed', {
                                handler: handlerName,
                                error: validation.error,
                                senderId
                            });
                        }

                        return {
                            success: false,
                            error: `Validation error: ${validation.error}`
                        };
                    }
                }

                // 5. Log access if enabled
                if (logAccess) {
                    logger.debug('IPC handler accessed', {
                        handler: handlerName,
                        senderId
                    });

                    if (this.auditModule) {
                        await this.auditModule.logEvent('ipc_access', {
                            handler: handlerName,
                            senderId,
                            timestamp: new Date().toISOString()
                        });
                    }
                }

                // 6. Execute handler
                const result = await handler(event, ...args);

                // 7. Log success
                const duration = Date.now() - startTime;
                logger.debug('IPC handler completed', {
                    handler: handlerName,
                    duration,
                    success: result?.success !== false
                });

                return result;

            } catch (error) {
                // 8. Handle errors
                const duration = Date.now() - startTime;

                logger.error('IPC handler error', {
                    handler: handlerName,
                    error: error.message,
                    stack: error.stack,
                    duration,
                    senderId
                });

                if (this.auditModule) {
                    await this.auditModule.logSecurityEvent('ipc_handler_error', {
                        handler: handlerName,
                        error: error.message,
                        senderId
                    });
                }

                // Return sanitized error
                const sanitizedError = this.sanitizeError(error, includeErrorDetails);
                return {
                    success: false,
                    error: sanitizedError.message
                };
            }
        };
    }

    /**
     * Create validation schema helpers
     */
    static schemas = {
        string: (options = {}) => ({
            type: 'string',
            ...options
        }),
        number: (options = {}) => ({
            type: 'number',
            ...options
        }),
        integer: (options = {}) => ({
            type: 'number',
            integer: true,
            ...options
        }),
        boolean: (options = {}) => ({
            type: 'boolean',
            ...options
        }),
        array: (options = {}) => ({
            type: 'array',
            ...options
        }),
        object: (options = {}) => ({
            type: 'object',
            ...options
        }),
        dbName: () => ({
            type: 'string',
            required: true,
            pattern: /^[a-zA-Z0-9_-]+$/,
            maxLength: 255,
            minLength: 1
        }),
        tableName: () => ({
            type: 'string',
            required: true,
            pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/,
            maxLength: 64,
            minLength: 1
        }),
        sessionId: () => ({
            type: 'string',
            required: true,
            pattern: /^[a-f0-9-]{36}$/,
            minLength: 36,
            maxLength: 36
        }),
        prompt: () => ({
            type: 'string',
            required: true,
            minLength: 1,
            maxLength: 10000
        }),
        code: () => ({
            type: 'string',
            required: true,
            minLength: 1,
            maxLength: 100000
        })
    };
}

const instance = new IPCSecurityMiddleware();
// Expose static schemas through instance for convenience
instance.schemas = IPCSecurityMiddleware.schemas;
module.exports = instance;
