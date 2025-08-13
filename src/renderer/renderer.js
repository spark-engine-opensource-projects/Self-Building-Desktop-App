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
            console.log('Secure DOM executor initialized');
        } else {
            console.warn('SecureDOMExecutor not available, falling back to basic execution');
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
            progressDiv.innerHTML = `
                <div class="progress-content">
                    <div class="progress-spinner"></div>
                    <span class="progress-message">${message}</span>
                </div>
            `;
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
        metadataDiv.innerHTML = `
            <div class="metadata-item">
                <strong>Processing Time:</strong> ${metadata.processingTime}ms
            </div>
            ${metadata.retryCount > 0 ? `<div class="metadata-item">
                <strong>Retry Count:</strong> ${metadata.retryCount}
            </div>` : ''}
            ${metadata.enhanced ? `<div class="metadata-item">
                <strong>Enhanced:</strong> ✅ Code quality improvements applied
            </div>` : ''}
        `;
        
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
            console.warn('Failed to submit feedback:', error);
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
                console.warn('Failed to cleanup old session:', error);
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
            console.error('Secure DOM execution failed:', error);
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
                console.warn('Failed to save theme preference:', error);
            });
        }
        
        console.log(`Theme switched to: ${theme}`);
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