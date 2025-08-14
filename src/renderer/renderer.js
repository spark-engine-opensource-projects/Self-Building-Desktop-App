// Import conditional logger for development
const rendererLogger = require('../utils/rendererLogger');

class DynamicAppRenderer {
    constructor() {
        this.currentSession = null;
        this.currentCode = null;
        this.currentPackages = [];
        this.isApiConfigured = false;
        this.secureDOMExecutor = null;
        this.theme = 'light';
        
        this.initializeElements();
        this.setupEventListeners();
        this.updateUI();
        this.initializeSecureExecution();
        this.initializeTheme();
    }

    initializeSecureExecution() {
        // Load the secure DOM executor
        if (typeof SecureDOMExecutor !== 'undefined') {
            this.secureDOMExecutor = new SecureDOMExecutor();
            rendererLogger.debug('Secure DOM executor initialized');
        } else {
            rendererLogger.warn('SecureDOMExecutor not available, falling back to basic execution');
        }
    }

    initializeElements() {
        // API Configuration
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.setApiKeyBtn = document.getElementById('setApiKeyBtn');
        this.loadApiKeyBtn = document.getElementById('loadApiKeyBtn');
        this.apiStatus = document.getElementById('apiStatus');
        this.apiConfig = document.getElementById('apiConfig');
        
        // Code Generation
        this.codeGeneration = document.getElementById('codeGeneration');
        this.promptInput = document.getElementById('promptInput');
        this.generateBtn = document.getElementById('generateBtn');
        this.generateSpinner = this.generateBtn.querySelector('.spinner');
        this.generateText = this.generateBtn.querySelector('.btn-text');
        
        // Code Display
        this.codeDisplay = document.getElementById('codeDisplay');
        this.codeDescription = document.getElementById('codeDescription');
        this.codePackages = document.getElementById('codePackages');
        this.generatedCode = document.getElementById('generatedCode');
        this.executeBtn = document.getElementById('executeBtn');
        this.clearBtn = document.getElementById('clearBtn');
        
        // Execution Results
        this.executionResults = document.getElementById('executionResults');
        this.executionOutput = document.getElementById('executionOutput');
        this.executionErrors = document.getElementById('executionErrors');
        this.errorSection = document.getElementById('errorSection');
        
        // Session
        this.sessionId = document.getElementById('sessionId');
        this.newSessionBtn = document.getElementById('newSessionBtn');
        
        // Theme toggle
        this.themeToggle = document.getElementById('themeToggle');
        this.sunIcon = document.getElementById('sunIcon');
        this.moonIcon = document.getElementById('moonIcon');
        
        // Database elements
        this.toggleDatabaseBtn = document.getElementById('toggleDatabaseBtn');
        this.databaseSection = document.getElementById('databaseSection');
        
        // Performance dashboard
        this.performanceDashboardBtn = document.getElementById('performanceDashboardBtn');
        this.showDbManagerBtn = document.getElementById('showDbManagerBtn');
        this.showSchemaGeneratorBtn = document.getElementById('showSchemaGeneratorBtn');
        
        // Database Manager
        this.databaseManager = document.getElementById('databaseManager');
        this.databaseSelect = document.getElementById('databaseSelect');
        this.newDatabaseName = document.getElementById('newDatabaseName');
        this.createDatabaseBtn = document.getElementById('createDatabaseBtn');
        this.refreshDatabasesBtn = document.getElementById('refreshDatabasesBtn');
        this.tablesList = document.getElementById('tablesList');
        this.createTableBtn = document.getElementById('createTableBtn');
        this.exportDatabaseBtn = document.getElementById('exportDatabaseBtn');
        this.dataPanel = document.getElementById('dataPanel');
        this.currentTableName = document.getElementById('currentTableName');
        this.addRecordBtn = document.getElementById('addRecordBtn');
        this.refreshDataBtn = document.getElementById('refreshDataBtn');
        this.queryBuilderBtn = document.getElementById('queryBuilderBtn');
        this.dataTable = document.getElementById('dataTable');
        
        // Schema Generator
        this.schemaGenerator = document.getElementById('schemaGenerator');
        this.schemaDescription = document.getElementById('schemaDescription');
        this.generateSchemaBtn = document.getElementById('generateSchemaBtn');
        this.generateScriptBtn = document.getElementById('generateScriptBtn');
        this.schemaOutput = document.getElementById('schemaOutput');
        this.implementSchemaBtn = document.getElementById('implementSchemaBtn');
        this.suggestImprovementsBtn = document.getElementById('suggestImprovementsBtn');
        
        // Query Builder
        this.queryBuilder = document.getElementById('queryBuilder');
        this.closeQueryBuilderBtn = document.getElementById('closeQueryBuilderBtn');
        this.queryType = document.getElementById('queryType');
        this.addConditionBtn = document.getElementById('addConditionBtn');
        this.executeQueryBtn = document.getElementById('executeQueryBtn');
        this.generatedSQL = document.getElementById('generatedSQL');
        
        // Data Form Modal
        this.dataFormModal = document.getElementById('dataFormModal');
        this.dataForm = document.getElementById('dataForm');
        this.closeFormBtn = document.getElementById('closeFormBtn');
        this.cancelFormBtn = document.getElementById('cancelFormBtn');
        
        // Database state
        this.currentDatabase = null;
        this.currentTable = null;
        this.currentSchema = null;
        this.generatedSchema = null;
    }

    setupEventListeners() {
        this.setApiKeyBtn.addEventListener('click', () => this.handleSetApiKey());
        this.loadApiKeyBtn.addEventListener('click', () => this.handleLoadApiKey());
        this.generateBtn.addEventListener('click', () => this.handleGenerateCode());
        this.executeBtn.addEventListener('click', () => this.handleExecuteCode());
        this.clearBtn.addEventListener('click', () => this.handleClear());
        this.newSessionBtn.addEventListener('click', () => this.handleNewSession());
        this.themeToggle.addEventListener('click', () => this.toggleTheme());
        
        // Enter key support
        this.apiKeyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSetApiKey();
            }
        });
        
        this.promptInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.handleGenerateCode();
            }
        });
        
        // Database event listeners
        this.toggleDatabaseBtn.addEventListener('click', () => this.toggleDatabaseSection());
        this.performanceDashboardBtn.addEventListener('click', () => this.openPerformanceDashboard());
        this.showDbManagerBtn.addEventListener('click', () => this.showDatabaseManager());
        this.showSchemaGeneratorBtn.addEventListener('click', () => this.showSchemaGenerator());
        
        // Database Manager
        this.databaseSelect.addEventListener('change', () => this.handleDatabaseChange());
        this.createDatabaseBtn.addEventListener('click', () => this.handleCreateDatabase());
        this.refreshDatabasesBtn.addEventListener('click', () => this.loadDatabases());
        this.createTableBtn.addEventListener('click', () => this.showCreateTableDialog());
        this.exportDatabaseBtn.addEventListener('click', () => this.handleExportDatabase());
        this.addRecordBtn.addEventListener('click', () => this.showAddRecordForm());
        this.refreshDataBtn.addEventListener('click', () => this.loadTableData());
        this.queryBuilderBtn.addEventListener('click', () => this.showQueryBuilder());
        
        // Schema Generator
        this.generateSchemaBtn.addEventListener('click', () => this.handleGenerateSchema());
        this.generateScriptBtn.addEventListener('click', () => this.handleGenerateScript());
        this.implementSchemaBtn.addEventListener('click', () => this.handleImplementSchema());
        this.suggestImprovementsBtn.addEventListener('click', () => this.handleSuggestImprovements());
        
        // Query Builder
        this.closeQueryBuilderBtn.addEventListener('click', () => this.hideQueryBuilder());
        this.addConditionBtn.addEventListener('click', () => this.addQueryCondition());
        this.executeQueryBtn.addEventListener('click', () => this.executeCustomQuery());
        
        // Modal handlers
        this.closeFormBtn.addEventListener('click', () => this.hideDataForm());
        this.cancelFormBtn.addEventListener('click', () => this.hideDataForm());
        this.dataForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        
        // Tab switching for schema output
        document.addEventListener('click', (e) => {
            if (e.target.matches('.tab-btn')) {
                this.switchSchemaTab(e.target.dataset.tab);
            }
        });
    }

    updateUI() {
        // Show/hide sections based on state
        if (this.isApiConfigured) {
            this.codeGeneration.style.display = 'block';
            this.apiStatus.textContent = 'Connected';
            this.apiStatus.classList.add('connected');
        } else {
            this.codeGeneration.style.display = 'none';
            this.codeDisplay.style.display = 'none';
            this.executionResults.style.display = 'none';
            this.apiStatus.textContent = 'Not Configured';
            this.apiStatus.classList.remove('connected');
        }
    }

    async openPerformanceDashboard() {
        try {
            const result = await window.electronAPI.openPerformanceDashboard();
            if (!result.success) {
                this.showNotification('Failed to open performance dashboard: ' + result.error, 'error');
            }
        } catch (error) {
            this.showNotification('Failed to open performance dashboard', 'error');
            console.error('Performance dashboard error:', error);
        }
    }

    async handleSetApiKey() {
        const apiKey = this.apiKeyInput.value.trim();
        if (!apiKey) {
            this.showNotification('Please enter an API key', 'error');
            return;
        }

        this.setApiKeyBtn.disabled = true;
        this.setApiKeyBtn.textContent = 'Setting...';

        try {
            const result = await window.electronAPI.setApiKey(apiKey);
            if (result.success) {
                this.isApiConfigured = true;
                this.apiKeyInput.value = '';
                this.updateUI();
                this.handleNewSession();
                this.showNotification('API key configured successfully!', 'success');
            } else {
                this.showNotification(`Failed to configure API key: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
        } finally {
            this.setApiKeyBtn.disabled = false;
            this.setApiKeyBtn.textContent = 'Set API Key';
        }
    }

    async handleLoadApiKey() {
        try {
            const result = await window.electronAPI.selectApiKeyFile();
            if (result.success) {
                this.apiKeyInput.value = result.apiKey;
                this.showNotification('API key loaded from file', 'success');
            } else {
                this.showNotification(`Failed to load API key: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
        }
    }

    async handleGenerateCode() {
        const prompt = this.promptInput.value.trim();
        if (!prompt) {
            this.showNotification('Please enter a prompt', 'error');
            return;
        }

        this.setGenerateButtonLoading(true);
        this.codeDisplay.style.display = 'none';
        this.executionResults.style.display = 'none';

        // Show progressive feedback
        this.showProgressiveFeedback('Analyzing your request...');

        try {
            const result = await window.electronAPI.generateCode(prompt);
            
            if (result.success) {
                const { packages, code, description } = result.data;
                
                this.currentCode = code;
                this.currentPackages = packages;
                
                this.codeDescription.textContent = description || 'No description provided';
                this.codePackages.textContent = packages.length > 0 ? packages.join(', ') : 'None';
                this.generatedCode.textContent = code;
                
                // Show metadata if available
                if (result.metadata) {
                    this.showGenerationMetadata(result.metadata);
                }
                
                this.codeDisplay.style.display = 'block';
                this.hideProgressiveFeedback();
                this.showNotification('Code generated successfully!', 'success');
                
                // Add feedback options
                this.addFeedbackOptions();
                
            } else {
                this.hideProgressiveFeedback();
                this.showEnhancedError(result);
            }
        } catch (error) {
            this.hideProgressiveFeedback();
            this.showNotification(`Error: ${error.message}`, 'error');
        } finally {
            this.setGenerateButtonLoading(false);
        }
    }

    showProgressiveFeedback(message) {
        // Create or update progress indicator
        let progressDiv = document.getElementById('generation-progress');
        if (!progressDiv) {
            progressDiv = document.createElement('div');
            progressDiv.id = 'generation-progress';
            progressDiv.className = 'generation-progress';
            const progressContent = document.createElement('div');
            progressContent.className = 'progress-content';
            
            const spinner = document.createElement('div');
            spinner.className = 'progress-spinner';
            
            const messageSpan = document.createElement('span');
            messageSpan.className = 'progress-message';
            messageSpan.textContent = message;
            
            progressContent.appendChild(spinner);
            progressContent.appendChild(messageSpan);
            progressDiv.appendChild(progressContent);
            document.querySelector('.container').appendChild(progressDiv);
        } else {
            progressDiv.querySelector('.progress-message').textContent = message;
        }
        progressDiv.style.display = 'block';
    }

    hideProgressiveFeedback() {
        const progressDiv = document.getElementById('generation-progress');
        if (progressDiv) {
            progressDiv.style.display = 'none';
        }
    }

    showGenerationMetadata(metadata) {
        const metadataDiv = document.createElement('div');
        metadataDiv.className = 'generation-metadata';
        const processingTimeDiv = document.createElement('div');
        processingTimeDiv.className = 'metadata-item';
        const timeStrong = document.createElement('strong');
        timeStrong.textContent = 'Processing Time: ';
        processingTimeDiv.appendChild(timeStrong);
        processingTimeDiv.appendChild(document.createTextNode(`${metadata.processingTime}ms`));
        metadataDiv.appendChild(processingTimeDiv);
        
        if (metadata.retryCount > 0) {
            const retryDiv = document.createElement('div');
            retryDiv.className = 'metadata-item';
            const retryStrong = document.createElement('strong');
            retryStrong.textContent = 'Retry Count: ';
            retryDiv.appendChild(retryStrong);
            retryDiv.appendChild(document.createTextNode(metadata.retryCount));
            metadataDiv.appendChild(retryDiv);
        }
        
        if (metadata.enhanced) {
            const enhancedDiv = document.createElement('div');
            enhancedDiv.className = 'metadata-item';
            const enhancedStrong = document.createElement('strong');
            enhancedStrong.textContent = 'Enhanced: ';
            enhancedDiv.appendChild(enhancedStrong);
            enhancedDiv.appendChild(document.createTextNode('✅ Code quality improvements applied'));
            metadataDiv.appendChild(enhancedDiv);
        }
        
        const codeInfo = document.querySelector('.code-info');
        codeInfo.appendChild(metadataDiv);
    }

    showEnhancedError(result) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'enhanced-error';
        errorDiv.innerHTML = `
            <div class="error-header">
                <h3>❌ Generation Failed</h3>
                <span class="error-type">${result.errorType || 'Unknown'}</span>
            </div>
            <div class="error-message">${result.error}</div>
            ${result.suggestions && result.suggestions.length > 0 ? `
                <div class="error-suggestions">
                    <h4>💡 Suggestions:</h4>
                    <ul>
                        ${result.suggestions.map(s => `<li>${s}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            ${result.canRetry ? `
                <div class="error-actions">
                    <button onclick="app.retryGeneration()" class="btn btn-secondary">🔄 Try Again</button>
                </div>
            ` : ''}
            ${result.technical ? `
                <details class="error-technical">
                    <summary>Technical Details</summary>
                    <pre>${result.technical}</pre>
                </details>
            ` : ''}
        `;
        
        document.querySelector('.container').appendChild(errorDiv);
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 10000);
    }

    addFeedbackOptions() {
        // Add feedback buttons to code display
        const codeActions = document.querySelector('.code-actions');
        
        // Remove existing feedback buttons
        const existingFeedback = codeActions.querySelector('.feedback-buttons');
        if (existingFeedback) {
            existingFeedback.remove();
        }
        
        const feedbackDiv = document.createElement('div');
        feedbackDiv.className = 'feedback-buttons';
        feedbackDiv.innerHTML = `
            <button onclick="app.improveFeedback()" class="btn btn-outline" title="Request improvements">
                🔧 Improve
            </button>
            <button onclick="app.rateFeedback('good')" class="btn btn-outline" title="Good result">
                👍
            </button>
            <button onclick="app.rateFeedback('bad')" class="btn btn-outline" title="Poor result">
                👎
            </button>
        `;
        codeActions.appendChild(feedbackDiv);
    }

    async improveFeedback() {
        const improvement = prompt('What would you like to improve about this code?');
        if (improvement) {
            const improvedPrompt = `${this.promptInput.value}\n\nIMPROVEMENT REQUEST: ${improvement}`;
            this.promptInput.value = improvedPrompt;
            await this.handleGenerateCode();
        }
    }

    async rateFeedback(rating) {
        try {
            // Send feedback to main process for logging
            await window.electronAPI.submitFeedback({
                sessionId: this.currentSession,
                prompt: this.promptInput.value,
                rating,
                timestamp: Date.now()
            });
            
            this.showNotification(`Thank you for your feedback! (${rating === 'good' ? '👍' : '👎'})`, 'info');
        } catch (error) {
            rendererLogger.warn('Failed to submit feedback:', error);
        }
    }

    async retryGeneration() {
        // Remove error display
        const errorDiv = document.querySelector('.enhanced-error');
        if (errorDiv) {
            errorDiv.remove();
        }
        
        // Retry generation
        await this.handleGenerateCode();
    }

    async handleExecuteCode() {
        if (!this.currentCode) {
            this.showNotification('No code to execute', 'error');
            return;
        }

        this.executeBtn.disabled = true;
        this.executeBtn.innerHTML = '⏳ Executing...';
        this.executionResults.style.display = 'none';

        try {
            // Check if this is DOM code (contains document/DOM methods)
            const isDOMCode = /document\.|window\.|addEventListener|createElement|getElementById|querySelector/i.test(this.currentCode);
            
            let result;
            if (isDOMCode) {
                // Execute DOM code securely
                result = await this.executeSecureDOMCode(this.currentCode);
            } else {
                // Execute Node.js code in sandbox
                result = await window.electronAPI.executeCode({
                    packages: this.currentPackages,
                    code: this.currentCode,
                    sessionId: this.currentSession
                });
            }

            if (result.success) {
                this.executionOutput.textContent = result.output || (isDOMCode ? 'DOM code executed in browser' : 'No output generated');
                
                if (result.errors) {
                    this.executionErrors.textContent = result.errors;
                    this.errorSection.style.display = 'block';
                } else {
                    this.errorSection.style.display = 'none';
                }
                
                this.executionResults.style.display = 'block';
                if (!isDOMCode) {
                    this.showNotification('Code executed successfully!', 'success');
                }
            } else {
                this.showNotification(`Execution failed: ${result.error}`, 'error');
                this.executionOutput.textContent = 'Execution failed';
                this.executionErrors.textContent = result.error;
                this.errorSection.style.display = 'block';
                this.executionResults.style.display = 'block';
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
        } finally {
            this.executeBtn.disabled = false;
            this.executeBtn.innerHTML = '▶️ Execute';
        }
    }

    handleClear() {
        this.promptInput.value = '';
        this.currentCode = null;
        this.currentPackages = [];
        this.codeDisplay.style.display = 'none';
        this.executionResults.style.display = 'none';
        this.showNotification('Cleared successfully', 'info');
    }

    async handleNewSession() {
        // Cleanup old session
        if (this.currentSession) {
            try {
                await window.electronAPI.cleanupSession(this.currentSession);
            } catch (error) {
                rendererLogger.warn('Failed to cleanup old session:', error);
            }
        }

        // Create new session
        this.currentSession = window.electronAPI.generateSessionId();
        this.sessionId.textContent = this.currentSession;
        this.handleClear();
        this.showNotification('New session started', 'info');
    }

    async executeSecureDOMCode(code) {
        try {
            // First, notify main process for logging
            await window.electronAPI.executeDOMCode({
                code: code,
                sessionId: this.currentSession
            });

            // Use secure DOM executor if available
            if (this.secureDOMExecutor) {
                return await this.secureDOMExecutor.executeInCurrentContext(
                    code, 
                    this.currentSession,
                    document.getElementById('execution-root')
                );
            } else {
                // Fallback to function-based execution (safer than eval)
                return await this.executeFunctionBased(code);
            }
        } catch (error) {
            rendererLogger.error('Secure DOM execution failed:', error);
            return {
                success: false,
                error: error.message,
                logs: []
            };
        }
    }

    async executeFunctionBased(code) {
        const logs = [];
        const startTime = Date.now();

        try {
            // Create safe execution environment
            const safeConsole = {
                log: (...args) => {
                    logs.push({ type: 'log', message: args.join(' '), timestamp: Date.now() });
                    console.log(...args);
                },
                info: (...args) => {
                    logs.push({ type: 'info', message: args.join(' '), timestamp: Date.now() });
                    console.info(...args);
                },
                warn: (...args) => {
                    logs.push({ type: 'warn', message: args.join(' '), timestamp: Date.now() });
                    console.warn(...args);
                },
                error: (...args) => {
                    logs.push({ type: 'error', message: args.join(' '), timestamp: Date.now() });
                    console.error(...args);
                }
            };

            // Create execution function with restricted scope
            const executionFunction = new Function(
                'document',
                'window',
                'console',
                'createElement',
                'getElementById',
                'querySelector',
                'querySelectorAll',
                `
                'use strict';
                try {
                    ${code}
                    return { success: true, result: 'Execution completed' };
                } catch (error) {
                    return { success: false, error: error.message, stack: error.stack };
                }
                `
            );

            // Execute with limited scope
            const executionResult = executionFunction.call(
                null,
                document,
                window,
                safeConsole,
                (tag) => document.createElement(tag),
                (id) => document.getElementById(id),
                (selector) => document.querySelector(selector),
                (selector) => document.querySelectorAll(selector)
            );

            const duration = Date.now() - startTime;

            if (executionResult.success) {
                this.showNotification('DOM code executed successfully!', 'success');
                return {
                    success: true,
                    output: 'Code executed successfully in current context',
                    result: executionResult.result,
                    logs,
                    executionTime: duration
                };
            } else {
                return {
                    success: false,
                    error: executionResult.error,
                    stack: executionResult.stack,
                    logs,
                    executionTime: duration
                };
            }

        } catch (error) {
            const duration = Date.now() - startTime;
            return {
                success: false,
                error: error.message,
                stack: error.stack,
                logs,
                executionTime: duration
            };
        }
    }

    setGenerateButtonLoading(loading) {
        if (loading) {
            this.generateBtn.disabled = true;
            this.generateText.textContent = 'Generating...';
            this.generateSpinner.style.display = 'block';
        } else {
            this.generateBtn.disabled = false;
            this.generateText.textContent = 'Generate Code';
            this.generateSpinner.style.display = 'none';
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add to DOM
        document.body.appendChild(notification);
        
        // Trigger animation
        setTimeout(() => notification.classList.add('show'), 100);
        
        // Remove after delay
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new DynamicAppRenderer();
});

// Add notification styles dynamically
const notificationStyles = `
.notification {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 1000;
    transform: translateX(100%);
    transition: transform 0.3s ease;
    max-width: 400px;
    word-wrap: break-word;
}

.notification.show {
    transform: translateX(0);
}

.notification-success {
    background: #10b981;
}

.notification-error {
    background: #ef4444;
}

.notification-info {
    background: #3b82f6;
}

.notification-warning {
    background: #f59e0b;
}

/* Progressive feedback styles */
.generation-progress {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 20px;
    border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 1001;
    min-width: 300px;
    text-align: center;
}

.progress-content {
    display: flex;
    align-items: center;
    gap: 15px;
}

.progress-spinner {
    width: 24px;
    height: 24px;
    border: 3px solid #e2e8f0;
    border-top: 3px solid #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.progress-message {
    font-weight: 500;
    color: #374151;
}

/* Enhanced error styles */
.enhanced-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    padding: 20px;
    margin: 20px 0;
    color: #991b1b;
}

.error-header {
    display: flex;
    justify-content: between;
    align-items: center;
    margin-bottom: 15px;
}

.error-header h3 {
    margin: 0;
    color: #dc2626;
}

.error-type {
    background: #dc2626;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    text-transform: uppercase;
}

.error-message {
    font-weight: 500;
    margin-bottom: 15px;
}

.error-suggestions {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 6px;
    padding: 15px;
    margin: 15px 0;
}

.error-suggestions h4 {
    margin: 0 0 10px 0;
    color: #0369a1;
}

.error-suggestions ul {
    margin: 0;
    padding-left: 20px;
}

.error-suggestions li {
    margin-bottom: 5px;
    color: #0f172a;
}

.error-actions {
    margin-top: 15px;
}

.error-technical {
    margin-top: 15px;
    font-size: 14px;
}

.error-technical summary {
    cursor: pointer;
    color: #6b7280;
}

.error-technical pre {
    background: #f9fafb;
    padding: 10px;
    border-radius: 4px;
    font-size: 12px;
    overflow-x: auto;
}

/* Generation metadata styles */
.generation-metadata {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 6px;
    padding: 15px;
    margin: 10px 0;
}

.metadata-item {
    margin-bottom: 8px;
    font-size: 14px;
    color: #0f172a;
}

.metadata-item:last-child {
    margin-bottom: 0;
}

/* Feedback buttons */
.feedback-buttons {
    display: flex;
    gap: 8px;
    margin-left: 10px;
}

.feedback-buttons .btn {
    padding: 6px 12px;
    font-size: 14px;
    min-width: auto;
}
`;

    // ================================
    // DATABASE FUNCTIONALITY
    // ================================

    /**
     * Toggle database section visibility
     */
    toggleDatabaseSection() {
        const isVisible = this.databaseSection.style.display !== 'none';
        this.databaseSection.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            this.loadDatabases();
            this.showDatabaseManager();
        }
    }

    /**
     * Show database manager subsection
     */
    showDatabaseManager() {
        this.databaseManager.style.display = 'block';
        this.schemaGenerator.style.display = 'none';
        this.queryBuilder.style.display = 'none';
        
        this.showDbManagerBtn.classList.add('active');
        this.showSchemaGeneratorBtn.classList.remove('active');
    }

    /**
     * Show schema generator subsection
     */
    showSchemaGenerator() {
        this.databaseManager.style.display = 'none';
        this.schemaGenerator.style.display = 'block';
        this.queryBuilder.style.display = 'none';
        
        this.showDbManagerBtn.classList.remove('active');
        this.showSchemaGeneratorBtn.classList.add('active');
    }

    /**
     * Load available databases
     */
    async loadDatabases() {
        try {
            const result = await window.electronAPI.dbListDatabases();
            
            if (result.success) {
                this.databaseSelect.innerHTML = '<option value="">Select database...</option>';
                
                result.databases.forEach(dbName => {
                    const option = document.createElement('option');
                    option.value = dbName;
                    option.textContent = dbName;
                    this.databaseSelect.appendChild(option);
                });
                
                this.showNotification(`Found ${result.databases.length} databases`, 'info');
            } else {
                this.showNotification(`Failed to load databases: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error loading databases: ${error.message}`, 'error');
        }
    }

    /**
     * Handle database selection change
     */
    async handleDatabaseChange() {
        this.currentDatabase = this.databaseSelect.value;
        
        if (this.currentDatabase) {
            this.createTableBtn.disabled = false;
            this.exportDatabaseBtn.disabled = false;
            await this.loadTables();
        } else {
            this.createTableBtn.disabled = true;
            this.exportDatabaseBtn.disabled = true;
            this.tablesList.innerHTML = '<p class="no-data">Select a database to view tables</p>';
            this.hideDataPanel();
        }
    }

    /**
     * Create new database
     */
    async handleCreateDatabase() {
        const dbName = this.newDatabaseName.value.trim();
        
        if (!dbName) {
            this.showNotification('Please enter a database name', 'error');
            return;
        }

        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(dbName)) {
            this.showNotification('Database name must start with letter and contain only letters, numbers, and underscores', 'error');
            return;
        }

        try {
            // Create database by creating a simple table (SQLite creates DB on first table creation)
            const result = await window.electronAPI.dbCreateTable(dbName, '_init_table', {
                columns: {
                    temp_column: { type: 'string', required: false }
                }
            });
            
            if (result.success) {
                this.showNotification(`Database "${dbName}" created successfully`, 'success');
                this.newDatabaseName.value = '';
                await this.loadDatabases();
                
                // Select the new database
                this.databaseSelect.value = dbName;
                await this.handleDatabaseChange();
            } else {
                this.showNotification(`Failed to create database: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error creating database: ${error.message}`, 'error');
        }
    }

    /**
     * Load tables for current database
     */
    async loadTables() {
        try {
            const result = await window.electronAPI.dbListTables(this.currentDatabase);
            
            if (result.success) {
                this.tablesList.innerHTML = '';
                
                if (result.tables.length === 0) {
                    this.tablesList.innerHTML = '<p class="no-data">No tables in this database</p>';
                } else {
                    result.tables.forEach(tableName => {
                        if (tableName !== '_init_table') { // Hide init table
                            const tableItem = document.createElement('div');
                            tableItem.className = 'table-item';
                            tableItem.innerHTML = `
                                <span class="table-name">${tableName}</span>
                                <div class="table-actions">
                                    <button onclick="app.selectTable('${tableName}')" class="btn btn-sm">View Data</button>
                                    <button onclick="app.showTableSchema('${tableName}')" class="btn btn-sm btn-outline">Schema</button>
                                </div>
                            `;
                            this.tablesList.appendChild(tableItem);
                        }
                    });
                }
            } else {
                this.showNotification(`Failed to load tables: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error loading tables: ${error.message}`, 'error');
        }
    }

    /**
     * Select and display table data
     */
    async selectTable(tableName) {
        this.currentTable = tableName;
        this.currentTableName.textContent = `${tableName} Data`;
        
        this.showDataPanel();
        await this.loadTableData();
    }

    /**
     * Show data panel
     */
    showDataPanel() {
        this.dataPanel.style.display = 'block';
        this.addRecordBtn.disabled = false;
        this.refreshDataBtn.disabled = false;
        this.queryBuilderBtn.disabled = false;
    }

    /**
     * Hide data panel
     */
    hideDataPanel() {
        this.dataPanel.style.display = 'none';
        this.addRecordBtn.disabled = true;
        this.refreshDataBtn.disabled = true;
        this.queryBuilderBtn.disabled = true;
    }

    /**
     * Load table data
     */
    async loadTableData(page = 1, pageSize = 10) {
        try {
            const offset = (page - 1) * pageSize;
            const result = await window.electronAPI.dbQueryData(this.currentDatabase, this.currentTable, {
                limit: pageSize,
                offset: offset
            });
            
            if (result.success) {
                this.renderDataTable(result.data);
                this.renderPagination(result.count, page, pageSize);
            } else {
                this.showNotification(`Failed to load data: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error loading data: ${error.message}`, 'error');
        }
    }

    /**
     * Render data table
     */
    renderDataTable(data) {
        if (!data || data.length === 0) {
            this.dataTable.innerHTML = '<p class="no-data">No data in this table</p>';
            return;
        }

        const columns = Object.keys(data[0]);
        
        let tableHTML = '<table class="data-table">';
        
        // Header
        tableHTML += '<thead><tr>';
        columns.forEach(col => {
            tableHTML += `<th>${col}</th>`;
        });
        tableHTML += '<th>Actions</th></tr></thead>';
        
        // Body
        tableHTML += '<tbody>';
        data.forEach(row => {
            tableHTML += '<tr>';
            columns.forEach(col => {
                let value = row[col];
                if (typeof value === 'object' && value !== null) {
                    value = JSON.stringify(value);
                } else if (value === null) {
                    value = '<em>null</em>';
                }
                tableHTML += `<td>${value}</td>`;
            });
            tableHTML += `
                <td class="actions">
                    <button onclick="app.editRecord(${row.id})" class="btn btn-sm">Edit</button>
                    <button onclick="app.deleteRecord(${row.id})" class="btn btn-sm btn-danger">Delete</button>
                </td>
            `;
            tableHTML += '</tr>';
        });
        tableHTML += '</tbody></table>';
        
        this.dataTable.innerHTML = tableHTML;
    }

    /**
     * Render pagination
     */
    renderPagination(totalCount, currentPage, pageSize) {
        const totalPages = Math.ceil(totalCount / pageSize);
        
        if (totalPages <= 1) {
            this.dataPagination.innerHTML = '';
            return;
        }
        
        let paginationHTML = '<div class="pagination-info">';
        paginationHTML += `Showing page ${currentPage} of ${totalPages} (${totalCount} total records)`;
        paginationHTML += '</div><div class="pagination-controls">';
        
        if (currentPage > 1) {
            paginationHTML += `<button onclick="app.loadTableData(${currentPage - 1})" class="btn btn-sm">Previous</button>`;
        }
        
        if (currentPage < totalPages) {
            paginationHTML += `<button onclick="app.loadTableData(${currentPage + 1})" class="btn btn-sm">Next</button>`;
        }
        
        paginationHTML += '</div>';
        this.dataPagination.innerHTML = paginationHTML;
    }

    // Schema Generation Methods
    async handleGenerateSchema() {
        const description = this.schemaDescription.value.trim();
        
        if (!description) {
            this.showNotification('Please enter a description of your database needs', 'error');
            return;
        }

        this.setSchemaButtonLoading(true);

        try {
            const result = await window.electronAPI.dbGenerateSchema(description);
            
            if (result.success) {
                this.generatedSchema = result.schema;
                this.displaySchemaOutput(result.schema, result.raw_response);
                this.showNotification('Schema generated successfully!', 'success');
            } else {
                this.showNotification(`Schema generation failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error generating schema: ${error.message}`, 'error');
        } finally {
            this.setSchemaButtonLoading(false);
        }
    }

    displaySchemaOutput(schema) {
        this.schemaOutput.style.display = 'block';
        document.getElementById('schemaJson').textContent = JSON.stringify(schema, null, 2);
        this.switchSchemaTab('json');
    }

    switchSchemaTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        document.getElementById(tabName === 'visual' ? 'visualSchema' : 
                              tabName === 'json' ? 'jsonSchema' : 'sqlScript').classList.add('active');
    }

    setSchemaButtonLoading(loading) {
        const btn = this.generateSchemaBtn;
        const text = btn.querySelector('.btn-text');
        const spinner = btn.querySelector('.spinner');
        
        if (loading) {
            btn.disabled = true;
            text.textContent = 'Generating...';
            spinner.style.display = 'block';
        } else {
            btn.disabled = false;
            text.textContent = 'Generate Schema';
            spinner.style.display = 'none';
        }
    }

    /**
     * Initialize theme system
     */
    initializeTheme() {
        // Load saved theme preference
        const savedTheme = localStorage.getItem('theme') || 'light';
        this.setTheme(savedTheme);
    }

    /**
     * Toggle between light and dark theme
     */
    toggleTheme() {
        const newTheme = this.theme === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
    }

    /**
     * Set the application theme
     */
    setTheme(theme) {
        this.theme = theme;
        
        // Update document attribute
        document.documentElement.setAttribute('data-theme', theme);
        
        // Update toggle button icons
        if (theme === 'dark') {
            this.sunIcon.style.display = 'none';
            this.moonIcon.style.display = 'block';
            this.themeToggle.title = 'Switch to light mode';
        } else {
            this.sunIcon.style.display = 'block';
            this.moonIcon.style.display = 'none';
            this.themeToggle.title = 'Switch to dark mode';
        }
        
        // Save preference
        localStorage.setItem('theme', theme);
        
        // Update config if available
        if (window.electronAPI) {
            window.electronAPI.updateConfig({
                ui: { darkMode: theme === 'dark' }
            }).catch(error => {
                rendererLogger.warn('Failed to save theme preference:', error);
            });
        }
        
        rendererLogger.debug(`Theme switched to: ${theme}`);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new DynamicAppRenderer();
});

// Add notification styles dynamically
const notificationStyles = `
.notification {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 1000;
    transform: translateX(100%);
    transition: transform 0.3s ease;
    max-width: 400px;
    word-wrap: break-word;
}

.notification.show {
    transform: translateX(0);
}

.notification-success {
    background: #10b981;
}

.notification-error {
    background: #ef4444;
}

.notification-info {
    background: #3b82f6;
}

.notification-warning {
    background: #f59e0b;
}

/* Progressive feedback styles */
.generation-progress {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 20px;
    border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 1001;
    min-width: 300px;
    text-align: center;
}

.progress-content {
    display: flex;
    align-items: center;
    gap: 15px;
}

.progress-spinner {
    width: 24px;
    height: 24px;
    border: 3px solid #e2e8f0;
    border-top: 3px solid #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.progress-message {
    font-weight: 500;
    color: #374151;
}

/* Enhanced error styles */
.enhanced-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    padding: 20px;
    margin: 20px 0;
    color: #991b1b;
}

.error-header {
    display: flex;
    justify-content: between;
    align-items: center;
    margin-bottom: 15px;
}

.error-header h3 {
    margin: 0;
    color: #dc2626;
}

.error-type {
    background: #dc2626;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    text-transform: uppercase;
}

.error-message {
    font-weight: 500;
    margin-bottom: 15px;
}

.error-suggestions {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 6px;
    padding: 15px;
    margin: 15px 0;
}

.error-suggestions h4 {
    margin: 0 0 10px 0;
    color: #0369a1;
}

.error-suggestions ul {
    margin: 0;
    padding-left: 20px;
}

.error-suggestions li {
    margin-bottom: 5px;
    color: #0f172a;
}

.error-actions {
    margin-top: 15px;
}

.error-technical {
    margin-top: 15px;
    font-size: 14px;
}

.error-technical summary {
    cursor: pointer;
    color: #6b7280;
}

.error-technical pre {
    background: #f9fafb;
    padding: 10px;
    border-radius: 4px;
    font-size: 12px;
    overflow-x: auto;
}

/* Generation metadata styles */
.generation-metadata {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 6px;
    padding: 15px;
    margin: 10px 0;
}

.metadata-item {
    margin-bottom: 8px;
    font-size: 14px;
    color: #0f172a;
}

.metadata-item:last-child {
    margin-bottom: 0;
}

/* Feedback buttons */
.feedback-buttons {
    display: flex;
    gap: 8px;
    margin-left: 10px;
}

.feedback-buttons .btn {
    padding: 6px 12px;
    font-size: 14px;
    min-width: auto;
}
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = notificationStyles;
document.head.appendChild(styleSheet);