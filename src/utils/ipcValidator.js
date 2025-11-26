const logger = require('./logger');

/**
 * IPC Input Validation Module
 * Validates and sanitizes all IPC handler inputs
 */
class IPCValidator {
    constructor() {
        // Maximum input sizes
        this.MAX_STRING_LENGTH = 100000;
        this.MAX_ARRAY_LENGTH = 10000;
        this.MAX_OBJECT_DEPTH = 10;
        
        // Dangerous patterns to block
        this.dangerousPatterns = [
            /<script[^>]*>.*?<\/script>/gi,  // Script tags
            /javascript:/gi,                   // JavaScript protocol
            /on\w+\s*=/gi,                   // Event handlers
            /eval\s*\(/gi,                   // Eval calls
            /new\s+Function/gi,               // Function constructor
            /__proto__/gi,                     // Prototype pollution
            /constructor\[/gi,                // Constructor access
        ];
        
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
                apiKey: { 
                    type: 'string', 
                    minLength: 1, 
                    maxLength: 200,
                    pattern: /^[a-zA-Z0-9-_]+$/,
                    sanitize: true
                }
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
     * Sanitize a string value
     */
    sanitizeString(value, maxLength = this.MAX_STRING_LENGTH) {
        if (typeof value !== 'string') return '';
        
        // Truncate to max length
        let sanitized = value.substring(0, maxLength);
        
        // Remove dangerous patterns
        for (const pattern of this.dangerousPatterns) {
            sanitized = sanitized.replace(pattern, '');
        }
        
        // Remove control characters except newlines and tabs
        sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        
        // Escape HTML entities
        sanitized = sanitized
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
        
        return sanitized;
    }

    /**
     * Sanitize an object recursively
     */
    sanitizeObject(obj, depth = 0) {
        if (depth > this.MAX_OBJECT_DEPTH) {
            throw new Error('Object depth exceeds maximum allowed');
        }
        
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        
        if (Array.isArray(obj)) {
            if (obj.length > this.MAX_ARRAY_LENGTH) {
                obj = obj.slice(0, this.MAX_ARRAY_LENGTH);
            }
            return obj.map(item => this.sanitizeObject(item, depth + 1));
        }
        
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            // Skip dangerous keys
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                continue;
            }
            
            // Sanitize key
            const sanitizedKey = this.sanitizeString(key, 100);
            
            // Sanitize value based on type
            if (typeof value === 'string') {
                sanitized[sanitizedKey] = this.sanitizeString(value);
            } else if (typeof value === 'object') {
                sanitized[sanitizedKey] = this.sanitizeObject(value, depth + 1);
            } else if (typeof value === 'number') {
                sanitized[sanitizedKey] = isFinite(value) ? value : 0;
            } else if (typeof value === 'boolean') {
                sanitized[sanitizedKey] = value;
            }
            // Skip functions and undefined values
        }
        
        return sanitized;
    }

    /**
     * Validate email format
     */
    isValidEmail(email) {
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return emailRegex.test(email) && email.length <= 254;
    }

    /**
     * Validate URL format
     */
    isValidUrl(url) {
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol);
        } catch {
            return false;
        }
    }

    /**
     * Validate UUID format
     */
    isValidUuid(uuid) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(uuid);
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

const instance = new IPCValidator();

// Export standalone validation functions for convenience
function validateInput(input, options = {}) {
    if (input === null || input === undefined) {
        throw new Error('Input cannot be null or undefined');
    }
    if (typeof input === 'string') {
        if (options.maxLength && input.length > options.maxLength) {
            throw new Error('Input exceeds maximum length');
        }
        // Check for dangerous patterns
        const dangerousPatterns = [
            /<script[^>]*>.*?<\/script>/gi,
            /javascript:/gi,
            /data:text\/html/gi,
            /\$\{.*\}/,
            /require\s*\(['"]/,
            /eval\s*\(/gi,
            /\.\.[\\/]/,
            /DROP\s+TABLE/gi,
            /DELETE\s+FROM/gi,
            /INSERT\s+INTO/gi,
            /TRUNCATE\s+TABLE/gi
        ];
        for (const pattern of dangerousPatterns) {
            if (pattern.test(input)) {
                throw new Error('Input contains dangerous pattern');
            }
        }
    }
    return input;
}

function sanitizeInput(input, options = {}) {
    if (typeof input === 'string') {
        return instance.sanitizeString(input, options);
    }
    if (typeof input === 'object' && input !== null) {
        return instance.sanitizeObject(input);
    }
    return input;
}

function validatePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt cannot be empty');
    }
    if (prompt.trim() === '') {
        throw new Error('Prompt cannot be empty');
    }

    const dangerousPatterns = [
        /\bpasswd\b/i,
        /\bshadow\b/i,
        /\bshell\s*command/i,
        /\bexecut(e|ing)\s+(shell|system|command)/i,
        /\bfile\s*system/i,
        /\bexternal\s*api/i,
        /\bmodif(y|ies)\s+system/i,
        /\bkeylogger/i,
        /\bnetwork\s*scanner/i,
        /\bbypass\s+security/i,
        /\bmalware/i,
        /\bvirus/i,
        /\bpassword\s*crack/i,
        /\bddos/i,
        /\bsql\s*injection/i,
        /\bcross-site\s*script/i,
        /\bxss\b/i,
        /\bcryptocurrency\s*min/i
    ];

    for (const pattern of dangerousPatterns) {
        if (pattern.test(prompt)) {
            throw new Error('Prompt contains dangerous content');
        }
    }
    return prompt;
}

function validateFileName(fileName, options = {}) {
    if (!fileName || typeof fileName !== 'string') {
        throw new Error('File name cannot be empty');
    }

    // Check for path traversal
    if (/\.\.[\\/]|[\\/]\.\./.test(fileName)) {
        throw new Error('Path traversal detected');
    }

    // Check for absolute paths
    if (/^[\/\\]|^[a-zA-Z]:[\/\\]/.test(fileName)) {
        throw new Error('Absolute paths not allowed');
    }

    // Check for dangerous extensions
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.dll', '.msi'];
    const ext = fileName.toLowerCase().split('.').pop();
    if (dangerousExtensions.some(e => fileName.toLowerCase().endsWith(e))) {
        throw new Error('Dangerous file extension');
    }

    // Check for Windows reserved names
    const reserved = ['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'lpt1', 'lpt2', 'lpt3'];
    const baseName = fileName.split(/[\/\\]/).pop().split('.')[0].toLowerCase();
    if (reserved.includes(baseName)) {
        throw new Error('Reserved file name');
    }

    return fileName;
}

// Export instance and standalone functions
module.exports = instance;
module.exports.validateInput = validateInput;
module.exports.sanitizeInput = sanitizeInput;
module.exports.validatePrompt = validatePrompt;
module.exports.validateFileName = validateFileName;