const winston = require('winston');
const path = require('path');
const { app } = require('electron');

class Logger {
    constructor() {
        const logDir = app ? app.getPath('logs') : path.join(__dirname, '..', '..', 'logs');
        
        // Generate correlation ID for request tracking
        this.correlationId = null;
        
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            defaultMeta: { 
                service: 'dynamic-app-builder',
                version: require('../../package.json').version 
            },
            transports: [
                new winston.transports.File({ 
                    filename: path.join(logDir, 'error.log'), 
                    level: 'error',
                    maxsize: 10485760,
                    maxFiles: 5
                }),
                new winston.transports.File({ 
                    filename: path.join(logDir, 'combined.log'),
                    maxsize: 10485760, 
                    maxFiles: 5
                }),
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                })
            ]
        });
    }

    /**
     * Set correlation ID for current request/operation
     */
    setCorrelationId(id = null) {
        this.correlationId = id || this.generateCorrelationId();
        return this.correlationId;
    }

    /**
     * Generate a new correlation ID
     */
    generateCorrelationId() {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Add correlation ID to metadata
     */
    addCorrelation(meta = {}) {
        if (this.correlationId) {
            return { ...meta, correlationId: this.correlationId };
        }
        return meta;
    }

    info(message, meta = {}) {
        this.logger.info(message, this.addCorrelation(meta));
    }

    error(message, error = null, meta = {}) {
        const logData = this.addCorrelation(meta);
        if (error) {
            logData.error = {
                message: error.message,
                stack: error.stack,
                name: error.name
            };
        }
        this.logger.error(message, logData);
    }

    warn(message, meta = {}) {
        this.logger.warn(message, this.addCorrelation(meta));
    }

    debug(message, meta = {}) {
        this.logger.debug(message, this.addCorrelation(meta));
    }

    logCodeGeneration(prompt, result, duration) {
        this.info('Code generation completed', {
            action: 'code_generation',
            prompt_length: prompt.length,
            success: result.success,
            duration_ms: duration,
            packages: result.data?.packages || [],
            code_length: result.data?.code?.length || 0
        });
    }

    logCodeExecution(sessionId, packages, codeLength, result, duration) {
        this.info('Code execution completed', {
            action: 'code_execution',
            session_id: sessionId,
            packages,
            code_length: codeLength,
            success: result.success,
            duration_ms: duration,
            output_length: result.output?.length || 0
        });
    }

    logSecurityEvent(event, details) {
        this.warn('Security event detected', {
            action: 'security_event',
            event,
            ...details
        });
    }
}

module.exports = new Logger();