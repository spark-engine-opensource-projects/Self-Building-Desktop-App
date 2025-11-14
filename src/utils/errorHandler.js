const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const stackTrace = require('stack-trace');

/**
 * Enhanced Error Handler with comprehensive error management
 * Provides structured error handling, recovery strategies, and detailed logging
 */
class ErrorHandler extends EventEmitter {
    constructor() {
        super();
        this.errors = [];
        this.errorTypes = new Map();
        this.errorHandlers = new Map();
        this.recoveryStrategies = new Map();
        this.errorMetrics = {
            total: 0,
            byType: {},
            byModule: {},
            bySeverity: {},
            recovered: 0,
            unrecovered: 0
        };
        this.maxErrorHistory = 1000;
        this.setupDefaultHandlers();
        this.setupRecoveryStrategies();
    }

    /**
     * Initialize error handler
     */
    async initialize(config = {}) {
        this.config = {
            logErrors: config.logErrors !== false,
            logPath: config.logPath || path.join(process.cwd(), 'logs', 'errors'),
            notifyUser: config.notifyUser !== false,
            autoRecover: config.autoRecover !== false,
            stackTraceLimit: config.stackTraceLimit || 10,
            contextCapture: config.contextCapture !== false,
            ...config
        };

        // Create error log directory
        if (this.config.logErrors) {
            await fs.mkdir(this.config.logPath, { recursive: true });
        }

        // Set stack trace limit
        Error.stackTraceLimit = this.config.stackTraceLimit;

        // Setup global error handlers
        this.setupGlobalHandlers();

        return { success: true };
    }

    /**
     * Setup default error type handlers
     */
    setupDefaultHandlers() {
        // Network errors
        this.registerErrorType('NetworkError', {
            severity: 'medium',
            recoverable: true,
            handler: async (error) => {
                return {
                    message: 'Network connection issue detected',
                    suggestion: 'Please check your internet connection',
                    retry: true
                };
            }
        });

        // Database errors
        this.registerErrorType('DatabaseError', {
            severity: 'high',
            recoverable: true,
            handler: async (error) => {
                return {
                    message: 'Database operation failed',
                    suggestion: 'The system will attempt to reconnect',
                    retry: true
                };
            }
        });

        // Validation errors
        this.registerErrorType('ValidationError', {
            severity: 'low',
            recoverable: false,
            handler: async (error) => {
                return {
                    message: 'Input validation failed',
                    suggestion: 'Please check your input and try again',
                    fields: error.fields || []
                };
            }
        });

        // Permission errors
        this.registerErrorType('PermissionError', {
            severity: 'medium',
            recoverable: false,
            handler: async (error) => {
                return {
                    message: 'Permission denied',
                    suggestion: 'You do not have permission to perform this action',
                    required: error.required || []
                };
            }
        });

        // File system errors
        this.registerErrorType('FileSystemError', {
            severity: 'medium',
            recoverable: true,
            handler: async (error) => {
                return {
                    message: 'File system operation failed',
                    suggestion: 'Check file permissions and disk space',
                    path: error.path
                };
            }
        });

        // API errors
        this.registerErrorType('APIError', {
            severity: 'medium',
            recoverable: true,
            handler: async (error) => {
                return {
                    message: 'API request failed',
                    suggestion: 'The request will be retried',
                    statusCode: error.statusCode,
                    endpoint: error.endpoint
                };
            }
        });

        // Memory errors
        this.registerErrorType('MemoryError', {
            severity: 'critical',
            recoverable: true,
            handler: async (error) => {
                return {
                    message: 'Memory limit exceeded',
                    suggestion: 'Clearing cache and optimizing memory usage',
                    memoryUsage: process.memoryUsage()
                };
            }
        });

        // Timeout errors
        this.registerErrorType('TimeoutError', {
            severity: 'medium',
            recoverable: true,
            handler: async (error) => {
                return {
                    message: 'Operation timed out',
                    suggestion: 'The operation took too long and was cancelled',
                    duration: error.duration
                };
            }
        });
    }

    /**
     * Setup recovery strategies
     */
    setupRecoveryStrategies() {
        // Retry strategy
        this.registerRecoveryStrategy('retry', async (error, context) => {
            const maxRetries = context.maxRetries || 3;
            const delay = context.delay || 1000;
            const backoff = context.backoff || 2;

            for (let i = 0; i < maxRetries; i++) {
                try {
                    if (context.operation) {
                        const result = await context.operation();
                        return { success: true, result, attempts: i + 1 };
                    }
                } catch (retryError) {
                    if (i < maxRetries - 1) {
                        await this.delay(delay * Math.pow(backoff, i));
                    } else {
                        throw retryError;
                    }
                }
            }
        });

        // Fallback strategy
        this.registerRecoveryStrategy('fallback', async (error, context) => {
            if (context.fallback) {
                const result = await context.fallback();
                return { success: true, result, fallbackUsed: true };
            }
            throw error;
        });

        // Circuit breaker strategy
        this.registerRecoveryStrategy('circuitBreaker', async (error, context) => {
            const threshold = context.threshold || 5;
            const timeout = context.timeout || 60000;
            const key = context.key || 'default';

            if (!this.circuitBreakers) {
                this.circuitBreakers = new Map();
            }

            let breaker = this.circuitBreakers.get(key);
            if (!breaker) {
                breaker = {
                    failures: 0,
                    lastFailure: 0,
                    state: 'closed'
                };
                this.circuitBreakers.set(key, breaker);
            }

            if (breaker.state === 'open') {
                if (Date.now() - breaker.lastFailure > timeout) {
                    breaker.state = 'half-open';
                } else {
                    throw new Error('Circuit breaker is open');
                }
            }

            try {
                const result = await context.operation();
                if (breaker.state === 'half-open') {
                    breaker.state = 'closed';
                    breaker.failures = 0;
                }
                return { success: true, result };
            } catch (err) {
                breaker.failures++;
                breaker.lastFailure = Date.now();
                
                if (breaker.failures >= threshold) {
                    breaker.state = 'open';
                }
                
                throw err;
            }
        });

        // Cache fallback strategy
        this.registerRecoveryStrategy('cacheFallback', async (error, context) => {
            if (context.cache && context.cacheKey) {
                const cached = await context.cache.get(context.cacheKey);
                if (cached) {
                    return { 
                        success: true, 
                        result: cached, 
                        fromCache: true,
                        stale: true 
                    };
                }
            }
            throw error;
        });

        // Graceful degradation strategy
        this.registerRecoveryStrategy('degradation', async (error, context) => {
            if (context.degradedOperation) {
                const result = await context.degradedOperation();
                return { 
                    success: true, 
                    result, 
                    degraded: true,
                    features: context.disabledFeatures || []
                };
            }
            throw error;
        });
    }

    /**
     * Handle error with appropriate strategy
     */
    async handle(error, context = {}) {
        try {
            // Enhance error with additional information
            const enhancedError = this.enhanceError(error, context);
            
            // Log error
            await this.logError(enhancedError);
            
            // Update metrics
            this.updateMetrics(enhancedError);
            
            // Store error in history
            this.addToHistory(enhancedError);
            
            // Get error type handler
            const errorType = this.identifyErrorType(error);
            const typeHandler = this.errorTypes.get(errorType);
            
            let handled = false;
            let result = null;
            
            // Try type-specific handler
            if (typeHandler && typeHandler.handler) {
                result = await typeHandler.handler(enhancedError);
                handled = true;
            }
            
            // Try recovery if configured
            if (this.config.autoRecover && typeHandler && typeHandler.recoverable) {
                const recovery = await this.attemptRecovery(enhancedError, context);
                if (recovery.success) {
                    this.errorMetrics.recovered++;
                    this.emit('error-recovered', { error: enhancedError, recovery });
                    return recovery;
                }
            }
            
            // Mark as unrecovered
            this.errorMetrics.unrecovered++;
            
            // Notify if needed
            if (this.config.notifyUser) {
                this.emit('error-notification', { error: enhancedError, result });
            }
            
            // Emit error event
            this.emit('error-handled', { error: enhancedError, handled, result });
            
            return {
                success: false,
                error: enhancedError,
                handled,
                result
            };
        } catch (handlingError) {
            console.error('Error in error handler:', handlingError);
            return {
                success: false,
                error: error,
                handlingError: handlingError.message
            };
        }
    }

    /**
     * Enhance error with additional information
     */
    enhanceError(error, context = {}) {
        const enhanced = {
            ...error,
            id: this.generateErrorId(),
            timestamp: Date.now(),
            type: this.identifyErrorType(error),
            severity: this.determineSeverity(error),
            context: this.config.contextCapture ? this.captureContext(context) : {},
            stack: this.parseStackTrace(error),
            module: this.identifyModule(error),
            environment: {
                node: process.version,
                platform: process.platform,
                memory: process.memoryUsage(),
                uptime: process.uptime()
            }
        };

        // Add error code if available
        if (error.code) enhanced.code = error.code;
        if (error.statusCode) enhanced.statusCode = error.statusCode;
        if (error.errno) enhanced.errno = error.errno;
        if (error.syscall) enhanced.syscall = error.syscall;

        return enhanced;
    }

    /**
     * Identify error type
     */
    identifyErrorType(error) {
        // Check explicit type
        if (error.type) return error.type;
        
        // Check error name
        if (error.name) {
            if (this.errorTypes.has(error.name)) {
                return error.name;
            }
        }
        
        // Pattern matching
        const message = error.message || '';
        
        if (message.match(/network|connection|ECONNREFUSED|ETIMEDOUT/i)) {
            return 'NetworkError';
        }
        
        if (message.match(/database|sqlite|postgres|mysql|mongodb/i)) {
            return 'DatabaseError';
        }
        
        if (message.match(/validation|invalid|required/i)) {
            return 'ValidationError';
        }
        
        if (message.match(/permission|denied|unauthorized|forbidden/i)) {
            return 'PermissionError';
        }
        
        if (message.match(/ENOENT|EACCES|EISDIR|ENOTDIR/i)) {
            return 'FileSystemError';
        }
        
        if (message.match(/timeout|timed out/i)) {
            return 'TimeoutError';
        }
        
        if (error.statusCode && error.statusCode >= 400) {
            return 'APIError';
        }
        
        return 'UnknownError';
    }

    /**
     * Determine error severity
     */
    determineSeverity(error) {
        const type = this.identifyErrorType(error);
        const typeConfig = this.errorTypes.get(type);
        
        if (typeConfig && typeConfig.severity) {
            return typeConfig.severity;
        }
        
        // Default severity based on error characteristics
        if (error.critical || error.severity === 'critical') return 'critical';
        if (error.statusCode >= 500) return 'high';
        if (error.statusCode >= 400) return 'medium';
        if (error.warning) return 'low';
        
        return 'medium';
    }

    /**
     * Parse stack trace
     */
    parseStackTrace(error) {
        if (!error.stack) return [];
        
        try {
            const trace = stackTrace.parse(error);
            return trace.slice(0, this.config.stackTraceLimit).map(frame => ({
                file: frame.getFileName(),
                line: frame.getLineNumber(),
                column: frame.getColumnNumber(),
                function: frame.getFunctionName() || '<anonymous>',
                method: frame.getMethodName(),
                native: frame.isNative()
            }));
        } catch {
            return error.stack.split('\n').slice(0, this.config.stackTraceLimit);
        }
    }

    /**
     * Identify module from error
     */
    identifyModule(error) {
        if (error.module) return error.module;
        
        const stack = this.parseStackTrace(error);
        if (stack.length > 0 && stack[0].file) {
            const match = stack[0].file.match(/src[\\\/](\w+)[\\\/]/);
            if (match) return match[1];
        }
        
        return 'unknown';
    }

    /**
     * Capture context
     */
    captureContext(context) {
        const captured = { ...context };
        
        // Add request context if available
        if (context.request) {
            captured.request = {
                method: context.request.method,
                url: context.request.url,
                headers: this.sanitizeHeaders(context.request.headers),
                query: context.request.query,
                params: context.request.params
            };
        }
        
        // Add user context if available
        if (context.user) {
            captured.user = {
                id: context.user.id,
                role: context.user.role,
                email: context.user.email
            };
        }
        
        // Add operation context
        if (context.operation) {
            captured.operation = context.operation;
        }
        
        return captured;
    }

    /**
     * Sanitize headers for logging
     */
    sanitizeHeaders(headers) {
        if (!headers) return {};
        
        const sanitized = { ...headers };
        const sensitive = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
        
        sensitive.forEach(key => {
            if (sanitized[key]) {
                sanitized[key] = '***';
            }
        });
        
        return sanitized;
    }

    /**
     * Attempt recovery
     */
    async attemptRecovery(error, context) {
        const strategies = context.recoveryStrategies || ['retry', 'fallback'];
        
        for (const strategy of strategies) {
            const recoveryFn = this.recoveryStrategies.get(strategy);
            
            if (recoveryFn) {
                try {
                    const result = await recoveryFn(error, context);
                    if (result.success) {
                        return {
                            success: true,
                            strategy,
                            ...result
                        };
                    }
                } catch (recoveryError) {
                    console.error(`Recovery strategy '${strategy}' failed:`, recoveryError);
                }
            }
        }
        
        return { success: false };
    }

    /**
     * Log error to file
     */
    async logError(error) {
        if (!this.config.logErrors) return;
        
        try {
            const logEntry = {
                id: error.id,
                timestamp: new Date(error.timestamp).toISOString(),
                type: error.type,
                severity: error.severity,
                message: error.message,
                stack: error.stack,
                context: error.context,
                environment: error.environment
            };
            
            const logFile = path.join(
                this.config.logPath,
                `errors_${new Date().toISOString().split('T')[0]}.log`
            );
            
            await fs.appendFile(
                logFile,
                JSON.stringify(logEntry) + '\n',
                'utf8'
            );
        } catch (logError) {
            console.error('Failed to log error:', logError);
        }
    }

    /**
     * Update error metrics
     */
    updateMetrics(error) {
        this.errorMetrics.total++;
        
        // By type
        this.errorMetrics.byType[error.type] = 
            (this.errorMetrics.byType[error.type] || 0) + 1;
        
        // By module
        this.errorMetrics.byModule[error.module] = 
            (this.errorMetrics.byModule[error.module] || 0) + 1;
        
        // By severity
        this.errorMetrics.bySeverity[error.severity] = 
            (this.errorMetrics.bySeverity[error.severity] || 0) + 1;
    }

    /**
     * Add error to history
     */
    addToHistory(error) {
        this.errors.unshift({
            id: error.id,
            timestamp: error.timestamp,
            type: error.type,
            message: error.message,
            severity: error.severity,
            recovered: false
        });
        
        // Limit history size
        if (this.errors.length > this.maxErrorHistory) {
            this.errors.pop();
        }
    }

    /**
     * Setup global error handlers
     */
    setupGlobalHandlers() {
        // Uncaught exceptions
        process.on('uncaughtException', async (error) => {
            console.error('Uncaught Exception:', error);
            await this.handle(error, { 
                global: true, 
                type: 'uncaughtException' 
            });
            
            // Graceful shutdown
            if (this.config.exitOnUncaught) {
                process.exit(1);
            }
        });

        // Unhandled rejections
        process.on('unhandledRejection', async (reason, promise) => {
            console.error('Unhandled Rejection:', reason);
            await this.handle(reason instanceof Error ? reason : new Error(reason), {
                global: true,
                type: 'unhandledRejection',
                promise
            });
        });

        // Warning events
        process.on('warning', async (warning) => {
            console.warn('Warning:', warning);
            await this.handle(warning, {
                global: true,
                type: 'warning'
            });
        });
    }

    /**
     * Register custom error type
     */
    registerErrorType(name, config) {
        this.errorTypes.set(name, config);
    }

    /**
     * Register recovery strategy
     */
    registerRecoveryStrategy(name, strategy) {
        this.recoveryStrategies.set(name, strategy);
    }

    /**
     * Create custom error class
     */
    createErrorClass(name, config = {}) {
        const errorClass = class extends Error {
            constructor(message, data = {}) {
                super(message);
                this.name = name;
                this.type = name;
                this.severity = config.severity || 'medium';
                this.recoverable = config.recoverable !== false;
                Object.assign(this, data);
                Error.captureStackTrace(this, errorClass);
            }
        };
        
        // Register the error type
        this.registerErrorType(name, config);
        
        return errorClass;
    }

    /**
     * Wrap function with error handling
     */
    wrap(fn, context = {}) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                const result = await this.handle(error, {
                    ...context,
                    function: fn.name || '<anonymous>',
                    args
                });
                
                if (result.success) {
                    return result.result;
                }
                
                throw error;
            }
        };
    }

    /**
     * Create error boundary
     */
    createBoundary(options = {}) {
        return {
            try: async (operation) => {
                try {
                    return await operation();
                } catch (error) {
                    return this.handle(error, options);
                }
            },
            
            catch: (handler) => {
                return async (operation) => {
                    try {
                        return await operation();
                    } catch (error) {
                        const result = await this.handle(error, options);
                        return handler(result);
                    }
                };
            }
        };
    }

    /**
     * Get error history
     */
    getHistory(filter = {}) {
        let filtered = [...this.errors];
        
        if (filter.type) {
            filtered = filtered.filter(e => e.type === filter.type);
        }
        
        if (filter.severity) {
            filtered = filtered.filter(e => e.severity === filter.severity);
        }
        
        if (filter.since) {
            const since = new Date(filter.since).getTime();
            filtered = filtered.filter(e => e.timestamp >= since);
        }
        
        if (filter.limit) {
            filtered = filtered.slice(0, filter.limit);
        }
        
        return filtered;
    }

    /**
     * Get error metrics
     */
    getMetrics() {
        return {
            ...this.errorMetrics,
            errorRate: this.calculateErrorRate(),
            recoveryRate: this.errorMetrics.total > 0 ? 
                (this.errorMetrics.recovered / this.errorMetrics.total * 100).toFixed(2) + '%' : '0%',
            topErrors: this.getTopErrors(),
            recentErrors: this.errors.slice(0, 10)
        };
    }

    /**
     * Calculate error rate
     */
    calculateErrorRate() {
        const now = Date.now();
        const hourAgo = now - 3600000;
        const recentErrors = this.errors.filter(e => e.timestamp >= hourAgo);
        return recentErrors.length;
    }

    /**
     * Get top errors
     */
    getTopErrors() {
        return Object.entries(this.errorMetrics.byType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([type, count]) => ({ type, count }));
    }

    /**
     * Clear error history
     */
    clearHistory() {
        this.errors = [];
        this.errorMetrics = {
            total: 0,
            byType: {},
            byModule: {},
            bySeverity: {},
            recovered: 0,
            unrecovered: 0
        };
    }

    /**
     * Delay utility
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Generate error ID
     */
    generateErrorId() {
        return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Export error data
     */
    async export(format = 'json') {
        const data = {
            errors: this.errors,
            metrics: this.getMetrics(),
            timestamp: new Date().toISOString()
        };
        
        if (format === 'json') {
            return JSON.stringify(data, null, 2);
        }
        
        // Add other formats as needed
        return data;
    }

    /**
     * Cleanup
     */
    async cleanup() {
        this.errors = [];
        this.errorHandlers.clear();
        this.recoveryStrategies.clear();
        this.removeAllListeners();
        
        return { success: true };
    }
}

module.exports = new ErrorHandler();