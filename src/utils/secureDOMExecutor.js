// Browser-safe logger (logger is only available in Node.js context)
const logger = typeof window !== 'undefined' && window.devLog ? window.devLog : console;

class SecureDOMExecutor {
    constructor() {
        this.activeIframes = new Map();
        this.executionId = 0;

        // Dangerous code patterns to block
        this.dangerousPatterns = [
            { pattern: /eval\s*\(/i, description: 'eval() is not allowed' },
            { pattern: /Function\s*\(\s*['"]/i, description: 'Function constructor with string is not allowed' },
            { pattern: /document\.write\s*\(/i, description: 'document.write() is not allowed' },
            { pattern: /document\.cookie/i, description: 'Accessing cookies is not allowed' },
            { pattern: /window\.location\s*=/i, description: 'Modifying window.location is not allowed' },
            { pattern: /\.innerHTML\s*=\s*[^'"`;\n]+\s*\+\s*['"][^'"]*</i, description: 'Dynamic innerHTML with string concatenation of HTML is risky' },
            { pattern: /importScripts\s*\(/i, description: 'importScripts() is not allowed' },
            { pattern: /Worker\s*\(/i, description: 'Web Workers are not allowed' },
            { pattern: /SharedArrayBuffer/i, description: 'SharedArrayBuffer is not allowed' }
        ];

        // Start periodic cleanup to prevent memory leaks
        this.startPeriodicCleanup();
    }

    /**
     * Scan code for dangerous patterns before execution
     * @param {string} code - Code to scan
     * @returns {Object} - { safe: boolean, issues: string[] }
     */
    scanCodeForDangers(code) {
        const issues = [];

        for (const { pattern, description } of this.dangerousPatterns) {
            if (pattern.test(code)) {
                issues.push(description);
            }
        }

        // Check code size limit (100KB)
        if (code.length > 100000) {
            issues.push('Code exceeds maximum allowed size (100KB)');
        }

        return {
            safe: issues.length === 0,
            issues
        };
    }

    /**
     * Start periodic cleanup of old iframes
     */
    startPeriodicCleanup() {
        // Clean up old iframes every 5 minutes
        setInterval(() => {
            this.cleanupOldIframes(300000); // 5 minutes
        }, 300000);
        
        // Also cleanup when we have too many iframes
        setInterval(() => {
            if (this.activeIframes.size > 10) {
                const oldestFrames = Array.from(this.activeIframes.entries())
                    .sort((a, b) => a[1].createdAt - b[1].createdAt)
                    .slice(0, 5); // Remove 5 oldest
                
                oldestFrames.forEach(([sessionId]) => {
                    this.cleanupIframe(sessionId);
                });
                
                if (typeof logger !== 'undefined') {
                    logger.info('Cleaned up excess iframes', { 
                        removed: oldestFrames.length, 
                        remaining: this.activeIframes.size 
                    });
                }
            }
        }, 60000); // Check every minute
    }

    /**
     * Create a secure iframe for code execution
     */
    createSecureIframe(sessionId) {
        const iframe = document.createElement('iframe');
        const iframeId = `secure-frame-${++this.executionId}`;
        
        // Configure iframe security
        iframe.id = iframeId;
        iframe.style.cssText = `
            position: absolute;
            top: -9999px;
            left: -9999px;
            width: 1px;
            height: 1px;
            border: none;
            visibility: hidden;
        `;
        
        // Set sandbox attributes for security
        iframe.sandbox = 'allow-scripts allow-same-origin';
        
        // Store reference
        this.activeIframes.set(sessionId, {
            iframe,
            iframeId,
            createdAt: Date.now()
        });

        return { iframe, iframeId };
    }

    /**
     * Execute code in secure iframe with CSP
     */
    async executeInSecureFrame(code, sessionId, options = {}) {
        const { timeout = 30000, allowNetworking = false } = options;

        // Security scan before execution
        const securityScan = this.scanCodeForDangers(code);
        if (!securityScan.safe) {
            logger.warn('Security scan failed for code execution', {
                sessionId,
                issues: securityScan.issues
            });
            return {
                success: false,
                error: `Security check failed: ${securityScan.issues.join('; ')}`,
                logs: []
            };
        }

        return new Promise((resolve, reject) => {
            try {
                const { iframe, iframeId } = this.createSecureIframe(sessionId);

                // Create secure HTML document
                const secureHTML = this.createSecureDocument(code, allowNetworking);
                
                // Set up message handling
                const messageHandler = (event) => {
                    if (event.source === iframe.contentWindow) {
                        window.removeEventListener('message', messageHandler);
                        
                        if (event.data.type === 'execution-result') {
                            this.cleanupIframe(sessionId);
                            resolve({
                                success: true,
                                output: event.data.result,
                                logs: event.data.logs || []
                            });
                        } else if (event.data.type === 'execution-error') {
                            this.cleanupIframe(sessionId);
                            resolve({
                                success: false,
                                error: event.data.error,
                                logs: event.data.logs || []
                            });
                        }
                    }
                };

                window.addEventListener('message', messageHandler);

                // Set timeout
                const timeoutId = setTimeout(() => {
                    window.removeEventListener('message', messageHandler);
                    this.cleanupIframe(sessionId);
                    reject(new Error('Code execution timeout'));
                }, timeout);

                // Load secure document
                iframe.onload = () => {
                    clearTimeout(timeoutId);
                };

                iframe.onerror = () => {
                    clearTimeout(timeoutId);
                    window.removeEventListener('message', messageHandler);
                    this.cleanupIframe(sessionId);
                    reject(new Error('Iframe loading failed'));
                };

                // Append to DOM and load content
                document.body.appendChild(iframe);
                iframe.srcdoc = secureHTML;

            } catch (error) {
                logger.error('Secure frame execution setup failed', error);
                reject(error);
            }
        });
    }

    /**
     * Create secure HTML document with CSP and error handling
     */
    createSecureDocument(code, allowNetworking) {
        const cspPolicy = allowNetworking ?
            "default-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline';" :
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';";

        // Get the parent origin for secure postMessage
        // In Electron, this is typically 'file://' or a custom protocol
        const parentOrigin = typeof window !== 'undefined' ? window.location.origin : '*';
        // Escape for embedding in the HTML document
        const safeParentOrigin = parentOrigin.replace(/'/g, "\\'");

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${cspPolicy}">
    <title>Secure Execution Environment</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f8fafc;
        }
        .execution-container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .error-display {
            background: #fee;
            color: #c53030;
            padding: 16px;
            border-left: 4px solid #fc8181;
            margin: 16px 0;
            border-radius: 4px;
        }
        .success-display {
            background: #f0fff4;
            color: #38a169;
            padding: 16px;
            border-left: 4px solid #68d391;
            margin: 16px 0;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div id="execution-root" class="execution-container">
        <!-- Generated content will appear here -->
    </div>

    <script>
        (function() {
            // Target origin for postMessage (set by parent)
            const targetOrigin = '${safeParentOrigin}';
            const logs = [];
            const originalConsole = { ...console };
            
            // Override console methods to capture output
            ['log', 'info', 'warn', 'error'].forEach(method => {
                console[method] = function(...args) {
                    logs.push({
                        type: method,
                        message: args.map(arg => 
                            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                        ).join(' '),
                        timestamp: Date.now()
                    });
                    originalConsole[method].apply(console, args);
                };
            });

            // Global error handler
            window.addEventListener('error', function(event) {
                const errorInfo = {
                    message: event.message,
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                    stack: event.error ? event.error.stack : null
                };

                parent.postMessage({
                    type: 'execution-error',
                    error: errorInfo.message,
                    details: errorInfo,
                    logs: logs
                }, targetOrigin);
            });

            // Unhandled promise rejection handler
            window.addEventListener('unhandledrejection', function(event) {
                parent.postMessage({
                    type: 'execution-error',
                    error: 'Unhandled Promise Rejection: ' + event.reason,
                    logs: logs
                }, targetOrigin);
            });

            // Execute user code with error handling
            try {
                // Sandbox environment setup
                const document = window.document;
                const localStorage = window.localStorage;
                const sessionStorage = window.sessionStorage;

                // Execute the user code
                ${code}

                // If execution completes without error, report success
                setTimeout(() => {
                    parent.postMessage({
                        type: 'execution-result',
                        result: 'Code executed successfully',
                        logs: logs,
                        htmlContent: document.body.innerHTML
                    }, targetOrigin);
                }, 100);

            } catch (error) {
                parent.postMessage({
                    type: 'execution-error',
                    error: error.message,
                    stack: error.stack,
                    logs: logs
                }, targetOrigin);
            }
        })();
    </script>
</body>
</html>`;
    }

    /**
     * Execute code directly in current context (for simple DOM operations)
     */
    async executeInCurrentContext(code, sessionId, targetElement = null) {
        // Security scan before execution
        const securityScan = this.scanCodeForDangers(code);
        if (!securityScan.safe) {
            logger.warn('Security scan failed for direct code execution', {
                sessionId,
                issues: securityScan.issues
            });
            return {
                success: false,
                error: `Security check failed: ${securityScan.issues.join('; ')}`,
                logs: []
            };
        }

        const startTime = Date.now();
        const logs = [];

        // Create isolated scope
        const executionScope = {
            // Provide safe DOM access
            document: document,
            window: window,
            console: {
                log: (...args) => logs.push({ type: 'log', message: args.join(' '), timestamp: Date.now() }),
                info: (...args) => logs.push({ type: 'info', message: args.join(' '), timestamp: Date.now() }),
                warn: (...args) => logs.push({ type: 'warn', message: args.join(' '), timestamp: Date.now() }),
                error: (...args) => logs.push({ type: 'error', message: args.join(' '), timestamp: Date.now() })
            },
            // Utility functions
            createElement: (tag) => document.createElement(tag),
            getElementById: (id) => document.getElementById(id),
            querySelector: (selector) => document.querySelector(selector),
            querySelectorAll: (selector) => document.querySelectorAll(selector)
        };

        try {
            // Create function with isolated scope
            const executionFunction = new Function(
                'document', 'window', 'console', 'createElement', 'getElementById', 'querySelector', 'querySelectorAll',
                code
            );

            // Execute with scope
            const result = executionFunction.call(
                null,
                executionScope.document,
                executionScope.window,
                executionScope.console,
                executionScope.createElement,
                executionScope.getElementById,
                executionScope.querySelector,
                executionScope.querySelectorAll
            );

            const duration = Date.now() - startTime;
            
            logger.info('Direct DOM execution successful', {
                sessionId,
                duration,
                logsCount: logs.length
            });

            return {
                success: true,
                output: 'Code executed in current context',
                result,
                logs,
                executionTime: duration
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            
            logger.error('Direct DOM execution failed', error, {
                sessionId,
                duration,
                codeLength: code.length
            });

            return {
                success: false,
                error: error.message,
                stack: error.stack,
                logs,
                executionTime: duration
            };
        }
    }

    /**
     * Clean up iframe after execution
     */
    cleanupIframe(sessionId) {
        const frameInfo = this.activeIframes.get(sessionId);
        if (frameInfo) {
            try {
                if (frameInfo.iframe.parentNode) {
                    frameInfo.iframe.parentNode.removeChild(frameInfo.iframe);
                }
            } catch (error) {
                logger.warn('Iframe cleanup warning', error);
            }
            this.activeIframes.delete(sessionId);
        }
    }

    /**
     * Clean up all active iframes
     */
    cleanupAllIframes() {
        for (const sessionId of this.activeIframes.keys()) {
            this.cleanupIframe(sessionId);
        }
    }

    /**
     * Get execution statistics
     */
    getStats() {
        return {
            activeIframes: this.activeIframes.size,
            totalExecutions: this.executionId,
            oldestFrame: this.activeIframes.size > 0 ? 
                Math.min(...Array.from(this.activeIframes.values()).map(f => f.createdAt)) : 
                null
        };
    }

    /**
     * Cleanup old iframes (called periodically)
     */
    cleanupOldIframes(maxAge = 300000) { // 5 minutes
        const now = Date.now();
        for (const [sessionId, frameInfo] of this.activeIframes.entries()) {
            if (now - frameInfo.createdAt > maxAge) {
                logger.info('Cleaning up old iframe', { sessionId, age: now - frameInfo.createdAt });
                this.cleanupIframe(sessionId);
            }
        }
    }
}

// For browser environment compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SecureDOMExecutor;
} else if (typeof window !== 'undefined') {
    window.SecureDOMExecutor = SecureDOMExecutor;
}