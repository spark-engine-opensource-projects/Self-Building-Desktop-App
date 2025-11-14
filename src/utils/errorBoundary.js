/**
 * Error Boundary Component for better error handling and user experience
 * Provides graceful error recovery and user-friendly error messages
 */
class ErrorBoundary {
    constructor(options = {}) {
        this.options = {
            fallbackUI: options.fallbackUI || this.createDefaultFallback,
            onError: options.onError || this.defaultErrorHandler,
            enableRecovery: options.enableRecovery !== false,
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000,
            logErrors: options.logErrors !== false,
            showErrorDetails: options.showErrorDetails || false,
            ...options
        };
        
        this.errorCount = 0;
        this.retryAttempts = 0;
        this.boundComponents = new Map();
        this.errorHistory = [];
        
        this.setupGlobalErrorHandlers();
    }

    /**
     * Wrap a function with error boundary
     */
    wrap(fn, context = {}) {
        const self = this;
        return function wrappedFunction(...args) {
            try {
                const result = fn.apply(this, args);
                
                // Handle promises
                if (result && typeof result.catch === 'function') {
                    return result.catch(error => {
                        self.handleError(error, { 
                            function: fn.name,
                            args: args.length,
                            context,
                            async: true
                        });
                        return self.createErrorResult(error, context);
                    });
                }
                
                return result;
            } catch (error) {
                self.handleError(error, { 
                    function: fn.name,
                    args: args.length,
                    context,
                    async: false
                });
                return self.createErrorResult(error, context);
            }
        };
    }

    /**
     * Wrap a DOM element with error boundary
     */
    wrapElement(element, context = {}) {
        const componentId = this.generateComponentId();
        const originalHandlers = {};
        
        // Store original event handlers
        const events = ['click', 'submit', 'change', 'input', 'focus', 'blur'];
        events.forEach(eventType => {
            const handler = element[`on${eventType}`];
            if (handler) {
                originalHandlers[eventType] = handler;
                element[`on${eventType}`] = this.wrap(handler, { 
                    ...context, 
                    element: element.tagName,
                    event: eventType 
                });
            }
        });

        // Store component metadata
        this.boundComponents.set(componentId, {
            element,
            context,
            originalHandlers,
            errorCount: 0,
            lastError: null
        });

        // Add error boundary attributes
        element.setAttribute('data-error-boundary', componentId);
        
        return componentId;
    }

    /**
     * Handle errors with context and recovery options
     */
    handleError(error, context = {}) {
        this.errorCount++;
        const errorInfo = {
            error,
            context,
            timestamp: new Date().toISOString(),
            errorId: this.generateErrorId(),
            stackTrace: error.stack,
            userAgent: navigator.userAgent,
            url: window.location.href
        };

        // Add to error history with proper cleanup
        this.errorHistory.push(errorInfo);
        
        // Keep only last 50 errors to prevent memory growth
        const MAX_ERROR_HISTORY = 50;
        if (this.errorHistory.length > MAX_ERROR_HISTORY) {
            // Remove oldest errors
            this.errorHistory = this.errorHistory.slice(-MAX_ERROR_HISTORY);
        }
        
        // Clean up old error UI elements
        this.cleanupOldErrorUI();

        // Log error if enabled
        if (this.options.logErrors) {
            this.logError(errorInfo);
        }

        // Call custom error handler
        this.options.onError(errorInfo);

        // Attempt recovery if enabled
        if (this.options.enableRecovery) {
            this.attemptRecovery(errorInfo);
        }

        // Show user-friendly error message
        this.showErrorUI(errorInfo);
    }

    /**
     * Attempt to recover from error
     */
    async attemptRecovery(errorInfo) {
        if (this.retryAttempts >= this.options.maxRetries) {
            this.showMaxRetriesExceeded(errorInfo);
            return false;
        }

        this.retryAttempts++;
        
        try {
            // Wait before retry
            await this.delay(this.options.retryDelay * this.retryAttempts);
            
            // Different recovery strategies based on error type
            const recovered = await this.performRecovery(errorInfo);
            
            if (recovered) {
                this.retryAttempts = 0;
                this.hideErrorUI();
                this.showRecoverySuccess();
                return true;
            }
        } catch (recoveryError) {
            errorInfo.recoveryError = recoveryError;
            this.logError({
                ...errorInfo,
                message: 'Recovery attempt failed',
                error: recoveryError
            });
        }

        return false;
    }

    /**
     * Perform recovery based on error context
     */
    async performRecovery(errorInfo) {
        const { context, error } = errorInfo;
        
        try {
            // Network errors
            if (this.isNetworkError(error)) {
                return await this.recoverFromNetworkError(errorInfo);
            }
            
            // Database errors
            if (this.isDatabaseError(error)) {
                return await this.recoverFromDatabaseError(errorInfo);
            }
            
            // UI errors
            if (this.isUIError(error)) {
                return await this.recoverFromUIError(errorInfo);
            }
            
            // API errors
            if (this.isAPIError(error)) {
                return await this.recoverFromAPIError(errorInfo);
            }
            
            // Generic recovery
            return await this.recoverGeneric(errorInfo);
            
        } catch (error) {
            return false;
        }
    }

    /**
     * Network error recovery
     */
    async recoverFromNetworkError(errorInfo) {
        // Check if online
        if (!navigator.onLine) {
            this.showOfflineMessage();
            return new Promise(resolve => {
                window.addEventListener('online', () => {
                    this.hideOfflineMessage();
                    resolve(true);
                }, { once: true });
            });
        }
        
        // Retry network request
        if (errorInfo.context.retryFunction) {
            try {
                await errorInfo.context.retryFunction();
                return true;
            } catch (retryError) {
                return false;
            }
        }
        
        return false;
    }

    /**
     * Database error recovery
     */
    async recoverFromDatabaseError(errorInfo) {
        // Try to reconnect to database
        if (window.electronAPI && window.electronAPI.dbReconnect) {
            try {
                await window.electronAPI.dbReconnect();
                return true;
            } catch (error) {
                return false;
            }
        }
        
        return false;
    }

    /**
     * UI error recovery
     */
    async recoverFromUIError(errorInfo) {
        const { context } = errorInfo;
        
        // Try to reset component state
        if (context.element && context.resetFunction) {
            try {
                context.resetFunction();
                return true;
            } catch (error) {
                return false;
            }
        }
        
        // Reload component
        if (context.componentId) {
            return this.reloadComponent(context.componentId);
        }
        
        return false;
    }

    /**
     * API error recovery
     */
    async recoverFromAPIError(errorInfo) {
        const { error } = errorInfo;
        
        // Handle rate limiting
        if (error.status === 429) {
            const retryAfter = error.headers?.['retry-after'] || 60;
            await this.delay(retryAfter * 1000);
            return true;
        }
        
        // Handle temporary server errors
        if (error.status >= 500 && error.status < 600) {
            return true; // Will retry
        }
        
        return false;
    }

    /**
     * Generic recovery
     */
    async recoverGeneric(errorInfo) {
        // Clear any cached data that might be corrupted
        if (typeof localStorage !== 'undefined') {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('temp_') || key.startsWith('cache_')) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
        }
        
        return false;
    }

    /**
     * Show error UI to user
     */
    showErrorUI(errorInfo) {
        // Remove existing error UI
        this.hideErrorUI();
        
        const errorContainer = this.createErrorContainer(errorInfo);
        document.body.appendChild(errorContainer);
        
        // Auto-hide after 10 seconds for non-critical errors
        if (!this.isCriticalError(errorInfo.error)) {
            setTimeout(() => {
                this.hideErrorUI();
            }, 10000);
        }
    }

    /**
     * Create error UI container
     */
    createErrorContainer(errorInfo) {
        const container = document.createElement('div');
        container.className = 'error-boundary-container';
        container.setAttribute('data-error-id', errorInfo.errorId);
        
        const severity = this.getErrorSeverity(errorInfo.error);
        container.classList.add(`error-${severity}`);
        
        container.innerHTML = `
            <div class="error-boundary-content">
                <div class="error-header">
                    <span class="error-icon">${this.getErrorIcon(severity)}</span>
                    <h3 class="error-title">${this.getErrorTitle(errorInfo)}</h3>
                    <button class="error-close" onclick="this.parentElement.parentElement.parentElement.remove()">×</button>
                </div>
                <div class="error-message">${this.getErrorMessage(errorInfo)}</div>
                ${this.options.enableRecovery ? this.createRecoveryButtons(errorInfo) : ''}
                ${this.options.showErrorDetails ? this.createErrorDetails(errorInfo) : ''}
            </div>
        `;
        
        return container;
    }

    /**
     * Create recovery action buttons
     */
    createRecoveryButtons(errorInfo) {
        const canRetry = this.retryAttempts < this.options.maxRetries;
        
        return `
            <div class="error-actions">
                ${canRetry ? `<button class="error-retry" onclick="window.errorBoundary.retry('${errorInfo.errorId}')">Try Again</button>` : ''}
                <button class="error-reload" onclick="window.location.reload()">Reload Page</button>
                <button class="error-report" onclick="window.errorBoundary.reportError('${errorInfo.errorId}')">Report Issue</button>
            </div>
        `;
    }

    /**
     * Create error details section
     */
    createErrorDetails(errorInfo) {
        return `
            <details class="error-details">
                <summary>Technical Details</summary>
                <div class="error-info">
                    <div><strong>Error:</strong> ${errorInfo.error.name}</div>
                    <div><strong>Message:</strong> ${errorInfo.error.message}</div>
                    <div><strong>Time:</strong> ${errorInfo.timestamp}</div>
                    <div><strong>Context:</strong> ${JSON.stringify(errorInfo.context, null, 2)}</div>
                    ${errorInfo.stackTrace ? `<div><strong>Stack:</strong><pre>${errorInfo.stackTrace}</pre></div>` : ''}
                </div>
            </details>
        `;
    }

    /**
     * Retry error recovery
     */
    async retry(errorId) {
        const errorInfo = this.errorHistory.find(e => e.errorId === errorId);
        if (errorInfo) {
            const recovered = await this.attemptRecovery(errorInfo);
            if (!recovered) {
                this.showRetryFailed();
            }
        }
    }

    /**
     * Report error to external service
     */
    reportError(errorId) {
        const errorInfo = this.errorHistory.find(e => e.errorId === errorId);
        if (errorInfo && window.electronAPI?.reportError) {
            window.electronAPI.reportError({
                ...errorInfo,
                userAgent: navigator.userAgent,
                timestamp: new Date().toISOString()
            });
            
            this.showReportSent();
        }
    }

    /**
     * Setup global error handlers
     */
    setupGlobalErrorHandlers() {
        // Handle unhandled JavaScript errors
        window.addEventListener('error', (event) => {
            this.handleError(event.error || new Error(event.message), {
                type: 'javascript',
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
            });
        });

        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.handleError(event.reason || new Error('Unhandled promise rejection'), {
                type: 'promise',
                promise: event.promise
            });
        });

        // Handle network errors
        window.addEventListener('offline', () => {
            this.handleError(new Error('Network connection lost'), {
                type: 'network',
                online: false
            });
        });
    }

    /**
     * Utility functions
     */
    isNetworkError(error) {
        return error.name === 'NetworkError' || 
               error.message.includes('fetch') ||
               error.message.includes('network') ||
               !navigator.onLine;
    }

    isDatabaseError(error) {
        return error.message.includes('database') ||
               error.message.includes('SQL') ||
               error.name === 'DatabaseError';
    }

    isUIError(error) {
        return error.message.includes('DOM') ||
               error.message.includes('element') ||
               error.name === 'DOMException';
    }

    isAPIError(error) {
        return error.status || 
               error.response ||
               error.message.includes('API') ||
               error.message.includes('HTTP');
    }

    isCriticalError(error) {
        return error.name === 'SecurityError' ||
               error.message.includes('permission') ||
               error.message.includes('CORS');
    }

    getErrorSeverity(error) {
        if (this.isCriticalError(error)) return 'critical';
        if (this.isNetworkError(error)) return 'warning';
        return 'error';
    }

    getErrorIcon(severity) {
        const icons = {
            critical: '🔴',
            error: '⚠️',
            warning: '⚡'
        };
        return icons[severity] || '❌';
    }

    getErrorTitle(errorInfo) {
        const { error, context } = errorInfo;
        
        if (this.isNetworkError(error)) return 'Connection Issue';
        if (this.isDatabaseError(error)) return 'Database Error';
        if (this.isUIError(error)) return 'Interface Error';
        if (this.isAPIError(error)) return 'Service Error';
        
        return 'Unexpected Error';
    }

    getErrorMessage(errorInfo) {
        const { error, context } = errorInfo;
        
        if (this.isNetworkError(error)) {
            return 'There seems to be a problem with your internet connection. Please check your connection and try again.';
        }
        
        if (this.isDatabaseError(error)) {
            return 'There was an issue accessing the database. This is usually temporary.';
        }
        
        if (this.isUIError(error)) {
            return 'Something went wrong with the interface. Try refreshing the page.';
        }
        
        if (this.isAPIError(error)) {
            return 'Unable to connect to the service. Please try again in a moment.';
        }
        
        return 'Something unexpected happened. Don\'t worry, we\'re working on it!';
    }

    generateComponentId() {
        return 'component_' + Math.random().toString(36).substr(2, 9);
    }

    generateErrorId() {
        return 'error_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    hideErrorUI() {
        const existing = document.querySelectorAll('.error-boundary-container');
        existing.forEach(el => el.remove());
    }
    
    cleanupOldErrorUI() {
        // Remove error UI elements older than 1 minute
        const errorContainers = document.querySelectorAll('.error-boundary-container');
        const now = Date.now();
        
        errorContainers.forEach(container => {
            const errorId = container.getAttribute('data-error-id');
            const errorInfo = this.errorHistory.find(e => e.errorId === errorId);
            
            if (!errorInfo || (now - new Date(errorInfo.timestamp).getTime() > 60000)) {
                container.remove();
            }
        });
    }

    logError(errorInfo) {
        console.group('🔴 Error Boundary');
        console.error('Error:', errorInfo.error);
        console.log('Context:', errorInfo.context);
        console.log('Timestamp:', errorInfo.timestamp);
        if (errorInfo.stackTrace) {
            console.log('Stack:', errorInfo.stackTrace);
        }
        console.groupEnd();
    }

    defaultErrorHandler(errorInfo) {
        // Default error handler - can be overridden
        console.error('Unhandled error:', errorInfo);
    }

    createErrorResult(error, context) {
        return {
            success: false,
            error: error.message,
            context,
            recoverable: this.options.enableRecovery
        };
    }

    // UI feedback methods
    showRecoverySuccess() {
        this.showToast('✅ Issue resolved!', 'success');
    }

    showRetryFailed() {
        this.showToast('❌ Retry failed. Please reload the page.', 'error');
    }

    showMaxRetriesExceeded() {
        this.showToast('⚠️ Maximum retry attempts reached.', 'warning');
    }

    showReportSent() {
        this.showToast('📧 Error report sent. Thank you!', 'success');
    }

    showOfflineMessage() {
        this.showToast('📱 You appear to be offline.', 'warning', 0);
    }

    hideOfflineMessage() {
        this.hideToast();
    }

    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `error-toast error-toast-${type}`;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        if (duration > 0) {
            setTimeout(() => {
                toast.remove();
            }, duration);
        }
    }

    hideToast() {
        const toasts = document.querySelectorAll('.error-toast');
        toasts.forEach(toast => toast.remove());
    }

    // Statistics and monitoring
    getErrorStats() {
        return {
            totalErrors: this.errorCount,
            retryAttempts: this.retryAttempts,
            errorHistory: this.errorHistory.length,
            boundComponents: this.boundComponents.size,
            lastError: this.errorHistory[this.errorHistory.length - 1]
        };
    }

    clearErrorHistory() {
        this.errorHistory = [];
        this.errorCount = 0;
        this.retryAttempts = 0;
    }
}

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErrorBoundary;
} else {
    window.ErrorBoundary = ErrorBoundary;
}

// CSS styles for error UI (inject into document)
if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = `
        .error-boundary-container {
            position: fixed;
            top: 20px;
            right: 20px;
            max-width: 400px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            border-left: 4px solid #f56565;
        }

        .error-boundary-container.error-warning {
            border-left-color: #ed8936;
        }

        .error-boundary-container.error-critical {
            border-left-color: #e53e3e;
            animation: pulse 2s infinite;
        }

        .error-boundary-content {
            padding: 16px;
        }

        .error-header {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
        }

        .error-icon {
            margin-right: 8px;
            font-size: 16px;
        }

        .error-title {
            flex: 1;
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: #2d3748;
        }

        .error-close {
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            padding: 0;
            color: #a0aec0;
        }

        .error-close:hover {
            color: #2d3748;
        }

        .error-message {
            color: #4a5568;
            margin-bottom: 16px;
            line-height: 1.4;
        }

        .error-actions {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }

        .error-actions button {
            padding: 8px 12px;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            background: white;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }

        .error-retry {
            background: #4299e1 !important;
            color: white !important;
            border-color: #4299e1 !important;
        }

        .error-actions button:hover {
            background: #f7fafc;
            border-color: #cbd5e0;
        }

        .error-retry:hover {
            background: #3182ce !important;
        }

        .error-details {
            border-top: 1px solid #e2e8f0;
            padding-top: 12px;
        }

        .error-details summary {
            cursor: pointer;
            font-size: 12px;
            color: #718096;
        }

        .error-info {
            margin-top: 8px;
            font-size: 11px;
            color: #4a5568;
            background: #f7fafc;
            padding: 8px;
            border-radius: 4px;
        }

        .error-info pre {
            margin: 4px 0 0 0;
            white-space: pre-wrap;
            font-size: 10px;
        }

        .error-toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 16px;
            border-radius: 4px;
            color: white;
            font-weight: 500;
            z-index: 10001;
            animation: slideIn 0.3s ease-out;
        }

        .error-toast-success { background: #48bb78; }
        .error-toast-error { background: #f56565; }
        .error-toast-warning { background: #ed8936; }
        .error-toast-info { background: #4299e1; }

        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
    `;
    
    document.head.appendChild(style);
}