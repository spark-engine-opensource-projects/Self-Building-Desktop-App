/**
 * AppPanel - Self-contained iframe sandbox for individual apps
 * Handles code execution, database API proxying, and inter-app messaging
 */

class AppPanel {
    constructor(options = {}) {
        this.id = options.id || `app-panel-${Date.now()}`;
        this.appId = options.appId || this.id;
        this.appName = options.appName || 'Untitled App';
        this.description = options.description || '';
        this.code = options.code || '';
        this.status = 'idle'; // idle, loading, running, error, paused
        this.iframe = null;
        this.container = null;
        this.createdAt = Date.now();
        this.lastActivity = Date.now();

        // Event handlers
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onDataChange = options.onDataChange || (() => {});
        this.onMessage = options.onMessage || (() => {});
        this.onClose = options.onClose || (() => {});
        this.onError = options.onError || (() => {});

        // Message listener reference for cleanup
        this._messageListener = null;
    }

    /**
     * Create the panel DOM structure
     * @param {HTMLElement} parentElement - Container to append panel to
     * @returns {HTMLElement} - The panel container
     */
    render(parentElement) {
        this.container = document.createElement('div');
        this.container.className = 'app-panel';
        this.container.id = this.id;
        this.container.dataset.appId = this.appId;

        this.container.innerHTML = `
            <div class="app-panel-header">
                <div class="app-panel-title">
                    <span class="app-panel-status-indicator"></span>
                    <span class="app-panel-name">${this.escapeHtml(this.appName)}</span>
                </div>
                <div class="app-panel-controls">
                    <button class="app-panel-btn refresh-btn" title="Refresh">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M23 4v6h-6M1 20v-6h6"/>
                            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                        </svg>
                    </button>
                    <button class="app-panel-btn pause-btn" title="Pause">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="6" y="4" width="4" height="16"/>
                            <rect x="14" y="4" width="4" height="16"/>
                        </svg>
                    </button>
                    <button class="app-panel-btn maximize-btn" title="Maximize">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        </svg>
                    </button>
                    <button class="app-panel-btn close-btn" title="Close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="app-panel-content">
                <!-- iframe will be inserted here -->
            </div>
            <div class="app-panel-status-bar">
                <span class="app-panel-status-text">Ready</span>
                <span class="app-panel-activity-time"></span>
            </div>
        `;

        // Add event listeners to controls
        this.container.querySelector('.refresh-btn').addEventListener('click', () => this.refresh());
        this.container.querySelector('.pause-btn').addEventListener('click', () => this.togglePause());
        this.container.querySelector('.maximize-btn').addEventListener('click', () => this.toggleMaximize());
        this.container.querySelector('.close-btn').addEventListener('click', () => this.close());

        parentElement.appendChild(this.container);
        return this.container;
    }

    /**
     * Execute code in the panel's iframe
     * @param {string} code - JavaScript code to execute
     */
    async execute(code = this.code) {
        if (!this.container) {
            throw new Error('Panel not rendered. Call render() first.');
        }

        this.code = code;
        this.setStatus('loading');

        try {
            // Remove existing iframe if any
            if (this.iframe) {
                this.destroyIframe();
            }

            // Create new iframe
            this.iframe = document.createElement('iframe');
            this.iframe.className = 'app-panel-iframe';
            this.iframe.sandbox = 'allow-scripts allow-same-origin allow-forms';

            const contentContainer = this.container.querySelector('.app-panel-content');
            contentContainer.innerHTML = '';
            contentContainer.appendChild(this.iframe);

            // Set up message listener for database proxying
            this._messageListener = (event) => this.handleIframeMessage(event);
            window.addEventListener('message', this._messageListener);

            // Create the secure document with injected code and API proxy
            const secureHTML = this.createSecureDocument(code);
            this.iframe.srcdoc = secureHTML;

            // Wait for iframe to load
            await new Promise((resolve, reject) => {
                this.iframe.onload = () => {
                    this.setStatus('running');
                    this.lastActivity = Date.now();
                    resolve();
                };
                this.iframe.onerror = (error) => {
                    this.setStatus('error');
                    reject(error);
                };

                // Timeout after 30 seconds
                setTimeout(() => {
                    if (this.status === 'loading') {
                        this.setStatus('error');
                        reject(new Error('Iframe load timeout'));
                    }
                }, 30000);
            });

        } catch (error) {
            this.setStatus('error');
            this.onError(error);
            throw error;
        }
    }

    /**
     * Create secure HTML document for iframe execution
     * @param {string} code - Code to execute
     * @returns {string} - HTML document string
     */
    createSecureDocument(code) {
        const parentOrigin = window.location.origin;

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
    <title>${this.escapeHtml(this.appName)}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            margin: 0;
            padding: 16px;
            background: #f8fafc;
            min-height: 100vh;
        }
        #execution-root {
            background: white;
            border-radius: 8px;
            min-height: calc(100vh - 32px);
        }
        .error-display {
            background: #fee2e2;
            color: #dc2626;
            padding: 16px;
            border-radius: 8px;
            margin: 16px 0;
        }
    </style>
</head>
<body>
    <div id="execution-root"></div>

    <script>
        (function() {
            const targetOrigin = '${parentOrigin}';
            const appId = '${this.appId}';

            // Create a promise-based message ID tracker for async responses
            const pendingRequests = new Map();
            let messageId = 0;

            // Send request to parent and wait for response
            function sendRequest(type, data) {
                return new Promise((resolve, reject) => {
                    const id = ++messageId;
                    pendingRequests.set(id, { resolve, reject });

                    parent.postMessage({
                        type: 'db-request',
                        id,
                        appId,
                        method: type,
                        data
                    }, targetOrigin);

                    // Timeout after 30 seconds
                    setTimeout(() => {
                        if (pendingRequests.has(id)) {
                            pendingRequests.delete(id);
                            reject(new Error('Request timeout'));
                        }
                    }, 30000);
                });
            }

            // Listen for responses from parent
            window.addEventListener('message', (event) => {
                if (event.data.type === 'db-response' && event.data.id) {
                    const request = pendingRequests.get(event.data.id);
                    if (request) {
                        pendingRequests.delete(event.data.id);
                        if (event.data.error) {
                            request.reject(new Error(event.data.error));
                        } else {
                            request.resolve(event.data.result);
                        }
                    }
                }

                // Handle data change notifications
                if (event.data.type === 'data-changed') {
                    window.dispatchEvent(new CustomEvent('data-changed', {
                        detail: event.data.detail
                    }));
                }

                // Handle inter-app messages
                if (event.data.type === 'app-message') {
                    window.dispatchEvent(new CustomEvent('app-message', {
                        detail: event.data.detail
                    }));
                }
            });

            // Proxy the electronAPI to use message passing
            window.electronAPI = {
                createTable: (tableName, schema) => sendRequest('createTable', { tableName, schema }),
                insertData: (tableName, data) => sendRequest('insertData', { tableName, data }),
                queryData: (tableName, options) => sendRequest('queryData', { tableName, options }),
                updateData: (tableName, id, data) => sendRequest('updateData', { tableName, id, data }),
                deleteData: (tableName, id) => sendRequest('deleteData', { tableName, id }),
                executeQuery: (sql, params) => sendRequest('executeQuery', { sql, params }),
                listTables: () => sendRequest('listTables', {}),
                getAllSchemas: () => sendRequest('getAllSchemas', {}),
                getSchemaContext: () => sendRequest('getSchemaContext', {}),
                getRelatedTables: (tableName) => sendRequest('getRelatedTables', { tableName }),

                // Multi-app specific APIs
                registerApp: (appId, appName, description) => sendRequest('registerApp', { appId, appName, description }),
                getAppInfo: (appId) => sendRequest('getAppInfo', { appId }),
                listApps: () => sendRequest('listApps', {}),
                createTableWithOwner: (tableName, schema, appId, description) =>
                    sendRequest('createTableWithOwner', { tableName, schema, appId, description }),
                recordTableRelationship: (sourceTable, targetTable, relationshipType, description) =>
                    sendRequest('recordTableRelationship', { sourceTable, targetTable, relationshipType, description })
            };

            // Inter-app messaging
            window.appBus = {
                send: (targetAppId, message) => {
                    parent.postMessage({
                        type: 'app-bus-message',
                        appId,
                        targetAppId,
                        message
                    }, targetOrigin);
                },
                broadcast: (message) => {
                    parent.postMessage({
                        type: 'app-bus-broadcast',
                        appId,
                        message
                    }, targetOrigin);
                },
                onMessage: (callback) => {
                    window.addEventListener('app-message', (e) => callback(e.detail));
                }
            };

            // Console capture
            const originalConsole = { ...console };
            ['log', 'info', 'warn', 'error'].forEach(method => {
                console[method] = function(...args) {
                    parent.postMessage({
                        type: 'console',
                        appId,
                        method,
                        args: args.map(arg =>
                            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                        )
                    }, targetOrigin);
                    originalConsole[method].apply(console, args);
                };
            });

            // Error handling
            window.addEventListener('error', (event) => {
                parent.postMessage({
                    type: 'error',
                    appId,
                    error: {
                        message: event.message,
                        filename: event.filename,
                        lineno: event.lineno,
                        colno: event.colno
                    }
                }, targetOrigin);
            });

            window.addEventListener('unhandledrejection', (event) => {
                parent.postMessage({
                    type: 'error',
                    appId,
                    error: {
                        message: 'Unhandled Promise Rejection: ' + event.reason
                    }
                }, targetOrigin);
            });

            // Execute the app code
            try {
                ${code}

                parent.postMessage({
                    type: 'execution-complete',
                    appId,
                    success: true
                }, targetOrigin);
            } catch (error) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error-display';
                errorDiv.textContent = 'Error: ' + error.message;
                document.getElementById('execution-root').appendChild(errorDiv);

                parent.postMessage({
                    type: 'execution-error',
                    appId,
                    error: error.message
                }, targetOrigin);
            }
        })();
    </script>
</body>
</html>`;
    }

    /**
     * Handle messages from the iframe
     * @param {MessageEvent} event - Message event
     */
    async handleIframeMessage(event) {
        // Only accept messages from our iframe
        if (event.source !== this.iframe?.contentWindow) {
            return;
        }

        const { type, id, appId, method, data } = event.data;

        // Handle database requests
        if (type === 'db-request') {
            try {
                let result;
                switch (method) {
                    case 'createTable':
                        result = await window.electronAPI.createTable(data.tableName, data.schema);
                        break;
                    case 'insertData':
                        result = await window.electronAPI.insertData(data.tableName, data.data);
                        // Notify data change
                        this.onDataChange({ table: data.tableName, action: 'insert', appId: this.appId });
                        break;
                    case 'queryData':
                        result = await window.electronAPI.queryData(data.tableName, data.options);
                        break;
                    case 'updateData':
                        result = await window.electronAPI.updateData(data.tableName, data.id, data.data);
                        this.onDataChange({ table: data.tableName, action: 'update', id: data.id, appId: this.appId });
                        break;
                    case 'deleteData':
                        result = await window.electronAPI.deleteData(data.tableName, data.id);
                        this.onDataChange({ table: data.tableName, action: 'delete', id: data.id, appId: this.appId });
                        break;
                    case 'executeQuery':
                        result = await window.electronAPI.executeQuery(data.sql, data.params);
                        break;
                    case 'listTables':
                        result = await window.electronAPI.listTables();
                        break;
                    case 'getAllSchemas':
                        result = await window.electronAPI.getAllSchemas();
                        break;
                    case 'getSchemaContext':
                        result = await window.electronAPI.getSchemaContext();
                        break;
                    case 'getRelatedTables':
                        result = await window.electronAPI.getRelatedTables(data.tableName);
                        break;
                    case 'registerApp':
                        result = await window.electronAPI.registerApp(data.appId, data.appName, data.description);
                        break;
                    case 'getAppInfo':
                        result = await window.electronAPI.getAppInfo(data.appId);
                        break;
                    case 'listApps':
                        result = await window.electronAPI.listApps();
                        break;
                    case 'createTableWithOwner':
                        result = await window.electronAPI.createTableWithOwner(
                            data.tableName, data.schema, data.appId, data.description
                        );
                        break;
                    case 'recordTableRelationship':
                        result = await window.electronAPI.recordTableRelationship(
                            data.sourceTable, data.targetTable, data.relationshipType, data.description
                        );
                        break;
                    default:
                        throw new Error(`Unknown method: ${method}`);
                }

                this.iframe.contentWindow.postMessage({
                    type: 'db-response',
                    id,
                    result
                }, '*');

            } catch (error) {
                this.iframe.contentWindow.postMessage({
                    type: 'db-response',
                    id,
                    error: error.message
                }, '*');
            }
        }

        // Handle console messages
        if (type === 'console') {
            console.log(`[${this.appName}]`, ...event.data.args);
            this.lastActivity = Date.now();
        }

        // Handle errors
        if (type === 'error') {
            console.error(`[${this.appName}] Error:`, event.data.error);
            this.onError(event.data.error);
        }

        // Handle execution complete
        if (type === 'execution-complete') {
            this.setStatus('running');
            this.updateStatusText('Running');
        }

        // Handle execution error
        if (type === 'execution-error') {
            this.setStatus('error');
            this.updateStatusText('Error: ' + event.data.error);
        }

        // Handle inter-app messages
        if (type === 'app-bus-message' || type === 'app-bus-broadcast') {
            this.onMessage({
                type,
                sourceAppId: event.data.appId,
                targetAppId: event.data.targetAppId,
                message: event.data.message
            });
        }
    }

    /**
     * Send a message to this panel's iframe
     * @param {Object} message - Message to send
     */
    sendMessage(message) {
        if (this.iframe?.contentWindow) {
            this.iframe.contentWindow.postMessage({
                type: 'app-message',
                detail: message
            }, '*');
        }
    }

    /**
     * Notify this panel of a data change
     * @param {Object} change - Change information
     */
    notifyDataChange(change) {
        if (this.iframe?.contentWindow) {
            this.iframe.contentWindow.postMessage({
                type: 'data-changed',
                detail: change
            }, '*');
        }
    }

    /**
     * Refresh the panel by re-executing the code
     */
    async refresh() {
        if (this.code) {
            await this.execute(this.code);
        }
    }

    /**
     * Toggle pause state
     */
    togglePause() {
        if (this.status === 'paused') {
            this.setStatus('running');
            this.container.classList.remove('paused');
        } else if (this.status === 'running') {
            this.setStatus('paused');
            this.container.classList.add('paused');
        }
    }

    /**
     * Toggle maximize state
     */
    toggleMaximize() {
        this.container.classList.toggle('maximized');
    }

    /**
     * Close the panel
     */
    close() {
        this.destroyIframe();
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.onClose(this);
    }

    /**
     * Destroy the iframe and cleanup
     */
    destroyIframe() {
        if (this._messageListener) {
            window.removeEventListener('message', this._messageListener);
            this._messageListener = null;
        }

        if (this.iframe && this.iframe.parentNode) {
            this.iframe.parentNode.removeChild(this.iframe);
        }
        this.iframe = null;
    }

    /**
     * Set panel status
     * @param {string} status - New status
     */
    setStatus(status) {
        this.status = status;

        if (this.container) {
            const indicator = this.container.querySelector('.app-panel-status-indicator');
            if (indicator) {
                indicator.className = 'app-panel-status-indicator ' + status;
            }
        }

        this.onStatusChange(status, this);
    }

    /**
     * Update status bar text
     * @param {string} text - Status text
     */
    updateStatusText(text) {
        if (this.container) {
            const statusText = this.container.querySelector('.app-panel-status-text');
            if (statusText) {
                statusText.textContent = text;
            }
        }
    }

    /**
     * Escape HTML special characters
     * @param {string} text - Text to escape
     * @returns {string} - Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get panel state for serialization
     * @returns {Object} - Panel state
     */
    getState() {
        return {
            id: this.id,
            appId: this.appId,
            appName: this.appName,
            description: this.description,
            code: this.code,
            status: this.status,
            createdAt: this.createdAt,
            lastActivity: this.lastActivity
        };
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AppPanel;
} else if (typeof window !== 'undefined') {
    window.AppPanel = AppPanel;
}
