/**
 * Conditional logger for renderer process
 * Only logs in development mode to avoid polluting production logs
 */
class RendererLogger {
    constructor() {
        this.isDevelopment = process.env.NODE_ENV === 'development' || 
                           window.location.hostname === 'localhost' ||
                           window.location.protocol === 'file:';
    }

    /**
     * Log info messages (development only)
     */
    info(...args) {
        if (this.isDevelopment) {
            console.info('[DEV]', ...args);
        }
    }

    /**
     * Log debug messages (development only) 
     */
    debug(...args) {
        if (this.isDevelopment) {
            console.log('[DEBUG]', ...args);
        }
    }

    /**
     * Log warnings (always shown)
     */
    warn(...args) {
        console.warn('[WARN]', ...args);
    }

    /**
     * Log errors (always shown)
     */
    error(...args) {
        console.error('[ERROR]', ...args);
    }

    /**
     * Log feature usage for analytics (development only)
     */
    logFeatureUsage(feature, details = {}) {
        if (this.isDevelopment) {
            console.log('[USAGE]', feature, details);
        }
    }

    /**
     * Log performance metrics (development only)
     */
    logPerformance(operation, duration, details = {}) {
        if (this.isDevelopment) {
            console.log('[PERF]', operation, `${duration}ms`, details);
        }
    }
}

// Create singleton instance
const rendererLogger = new RendererLogger();

// Make available globally for existing code
window.devLog = {
    info: rendererLogger.info.bind(rendererLogger),
    debug: rendererLogger.debug.bind(rendererLogger),
    warn: rendererLogger.warn.bind(rendererLogger),
    error: rendererLogger.error.bind(rendererLogger),
    usage: rendererLogger.logFeatureUsage.bind(rendererLogger),
    perf: rendererLogger.logPerformance.bind(rendererLogger)
};

module.exports = rendererLogger;