// Use global logger and performance utils (loaded via script tags)
// Note: window.rendererLogger is available from rendererLogger.js
// window.UIPerformanceMonitor is available from performanceUtils.js

class DynamicAppRenderer {
    constructor() {
        this.currentSession = null;
        this.currentCode = null;
        this.currentPackages = [];
        this.isApiConfigured = false;
        this.secureDOMExecutor = null;
        this.theme = 'light';

        // Multi-app runtime components
        this.appManager = null;
        this.messageBus = null;
        this.dataChangeBroadcaster = null;
        this.multiAppMode = false;

        // Performance optimization
        if (window.UIPerformanceMonitor) {
            this.performanceMonitor = window.UIPerformanceMonitor;
            this.performanceMonitor.start();
        }

        this.initializeElements();
        this.setupEventListeners();
        this.updateUI();
        this.initializeSecureExecution();
        this.initializeTheme();
        this.initializeMultiAppRuntime();
    }

    initializeSecureExecution() {
        // Load the secure DOM executor
        if (typeof SecureDOMExecutor !== 'undefined') {
            this.secureDOMExecutor = new SecureDOMExecutor();
            window.rendererLogger.debug('Secure DOM executor initialized');
        } else {
            window.rendererLogger.warn('SecureDOMExecutor not available, falling back to basic execution');
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
        this.dataPagination = document.getElementById('dataPagination');

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

        // Multi-app runtime elements
        this.multiAppRuntime = document.getElementById('multiAppRuntime');
        this.appPanelsContainer = document.getElementById('appPanelsContainer');
        this.appTabsBar = document.getElementById('appTabsBar');
        this.clearAllAppsBtn = document.getElementById('clearAllAppsBtn');
        this.runningAppsCount = document.getElementById('runningAppsCount');
        this.sharedDbName = document.getElementById('sharedDbName');
    }

    setupEventListeners() {
        this.setApiKeyBtn.addEventListener('click', () => this.handleSetApiKey());
        this.loadApiKeyBtn.addEventListener('click', () => this.handleLoadApiKey());
        this.generateBtn.addEventListener('click', () => this.handleGenerateCode());
        this.executeBtn.addEventListener('click', () => this.handleExecuteCode());
        this.clearBtn.addEventListener('click', () => this.handleClear());
        this.newSessionBtn.addEventListener('click', () => this.handleNewSession());
        this.themeToggle.addEventListener('click', () => this.toggleTheme());

        // Template buttons
        document.querySelectorAll('.template-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.loadTemplate(e.target.dataset.template));
        });

        // Enter key support for API key input
        this.apiKeyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSetApiKey();
            }
        });

        // Ctrl+Enter support for prompt input
        this.promptInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.handleGenerateCode();
            }
        });
        
        // Database event listeners
        this.toggleDatabaseBtn.addEventListener('click', () => this.toggleDatabaseSection());
        this.performanceDashboardBtn.addEventListener('click', () => this.openPerformanceDashboard());

        // DB Context Sidebar listeners
        const toggleDbContextBtn = document.getElementById('toggleDbContext');
        const closeSidebarBtn = document.getElementById('closeSidebar');
        const refreshDbContextBtn = document.getElementById('refreshDbContext');

        if (toggleDbContextBtn) {
            toggleDbContextBtn.addEventListener('click', () => this.toggleDbContextSidebar());
        }
        if (closeSidebarBtn) {
            closeSidebarBtn.addEventListener('click', () => this.closeDbContextSidebar());
        }
        if (refreshDbContextBtn) {
            refreshDbContextBtn.addEventListener('click', () => this.refreshDbContext());
        }
        this.showDbManagerBtn.addEventListener('click', () => this.showDatabaseManager());
        this.showSchemaGeneratorBtn.addEventListener('click', () => this.showSchemaGenerator());

        // Visual Schema Designer
        const showVisualDesignerBtn = document.getElementById('showVisualDesignerBtn');
        const addColumnBtn = document.getElementById('addColumnBtn');
        const generateSchemaCodeBtn = document.getElementById('generateSchemaCodeBtn');
        const createTableFromDesignBtn = document.getElementById('createTableFromDesignBtn');
        const clearDesignerBtn = document.getElementById('clearDesignerBtn');

        if (showVisualDesignerBtn) {
            showVisualDesignerBtn.addEventListener('click', () => this.showVisualDesigner());
        }
        if (addColumnBtn) {
            addColumnBtn.addEventListener('click', () => this.addColumnRow());
        }
        if (generateSchemaCodeBtn) {
            generateSchemaCodeBtn.addEventListener('click', () => this.generateSchemaCode());
        }
        if (createTableFromDesignBtn) {
            createTableFromDesignBtn.addEventListener('click', () => this.createTableFromDesign());
        }
        if (clearDesignerBtn) {
            clearDesignerBtn.addEventListener('click', () => this.clearDesigner());
        }

        // Database Manager with debouncing
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

        // Multi-app runtime event listeners
        if (this.clearAllAppsBtn) {
            this.clearAllAppsBtn.addEventListener('click', () => this.clearAllApps());
        }

        // Layout control buttons
        document.querySelectorAll('.layout-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const layout = e.currentTarget.dataset.layout;
                this.setMultiAppLayout(layout);
            });
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

        // Build error display safely using DOM methods to prevent XSS
        const errorHeader = document.createElement('div');
        errorHeader.className = 'error-header';

        const headerTitle = document.createElement('h3');
        headerTitle.textContent = '❌ Generation Failed';
        errorHeader.appendChild(headerTitle);

        const errorType = document.createElement('span');
        errorType.className = 'error-type';
        errorType.textContent = result.errorType || 'Unknown';
        errorHeader.appendChild(errorType);

        errorDiv.appendChild(errorHeader);

        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.textContent = result.error || 'An unknown error occurred';
        errorDiv.appendChild(errorMessage);

        // Add suggestions if present
        if (result.suggestions && result.suggestions.length > 0) {
            const suggestionsDiv = document.createElement('div');
            suggestionsDiv.className = 'error-suggestions';

            const suggestionsTitle = document.createElement('h4');
            suggestionsTitle.textContent = '💡 Suggestions:';
            suggestionsDiv.appendChild(suggestionsTitle);

            const suggestionsList = document.createElement('ul');
            result.suggestions.forEach(suggestion => {
                const li = document.createElement('li');
                li.textContent = suggestion;
                suggestionsList.appendChild(li);
            });
            suggestionsDiv.appendChild(suggestionsList);
            errorDiv.appendChild(suggestionsDiv);
        }

        // Add retry button if applicable
        if (result.canRetry) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'error-actions';

            const retryBtn = document.createElement('button');
            retryBtn.className = 'btn btn-secondary';
            retryBtn.textContent = '🔄 Try Again';
            retryBtn.addEventListener('click', () => this.retryGeneration());
            actionsDiv.appendChild(retryBtn);

            errorDiv.appendChild(actionsDiv);
        }

        // Add technical details if present
        if (result.technical) {
            const technicalDetails = document.createElement('details');
            technicalDetails.className = 'error-technical';

            const summary = document.createElement('summary');
            summary.textContent = 'Technical Details';
            technicalDetails.appendChild(summary);

            const pre = document.createElement('pre');
            pre.textContent = result.technical;
            technicalDetails.appendChild(pre);

            errorDiv.appendChild(technicalDetails);
        }

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

        // Create buttons using DOM methods instead of innerHTML to avoid XSS risks
        const improveBtn = document.createElement('button');
        improveBtn.className = 'btn btn-outline';
        improveBtn.title = 'Request improvements';
        improveBtn.textContent = '🔧 Improve';
        improveBtn.addEventListener('click', () => this.improveFeedback());
        feedbackDiv.appendChild(improveBtn);

        const goodBtn = document.createElement('button');
        goodBtn.className = 'btn btn-outline';
        goodBtn.title = 'Good result';
        goodBtn.textContent = '👍';
        goodBtn.addEventListener('click', () => this.rateFeedback('good'));
        feedbackDiv.appendChild(goodBtn);

        const badBtn = document.createElement('button');
        badBtn.className = 'btn btn-outline';
        badBtn.title = 'Poor result';
        badBtn.textContent = '👎';
        badBtn.addEventListener('click', () => this.rateFeedback('bad'));
        feedbackDiv.appendChild(badBtn);

        codeActions.appendChild(feedbackDiv);
    }

    async improveFeedback() {
        // Create a custom modal dialog since prompt() is not supported in Electron
        const modal = document.createElement('div');
        modal.className = 'improvement-modal';
        modal.innerHTML = `
            <div class="improvement-dialog">
                <h3>🔧 Improve Code</h3>
                <p>What would you like to improve about this code?</p>
                <textarea id="improvement-input" rows="4" placeholder="Describe the improvements you want..."></textarea>
                <div class="improvement-actions">
                    <button class="btn btn-secondary" id="cancel-improvement">Cancel</button>
                    <button class="btn btn-primary" id="submit-improvement">Improve</button>
                </div>
            </div>
        `;

        // Add modal styles if not already present
        if (!document.getElementById('improvement-modal-styles')) {
            const styles = document.createElement('style');
            styles.id = 'improvement-modal-styles';
            styles.textContent = `
                .improvement-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                }
                .improvement-dialog {
                    background: var(--card-bg, #fff);
                    padding: 24px;
                    border-radius: 12px;
                    max-width: 500px;
                    width: 90%;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                }
                .improvement-dialog h3 {
                    margin: 0 0 12px 0;
                    color: var(--text-primary, #333);
                }
                .improvement-dialog p {
                    margin: 0 0 16px 0;
                    color: var(--text-secondary, #666);
                }
                .improvement-dialog textarea {
                    width: 100%;
                    padding: 12px;
                    border: 1px solid var(--border-color, #ddd);
                    border-radius: 8px;
                    resize: vertical;
                    font-family: inherit;
                    font-size: 14px;
                    background: var(--input-bg, #fff);
                    color: var(--text-primary, #333);
                }
                .improvement-dialog textarea:focus {
                    outline: none;
                    border-color: var(--accent-color, #4f46e5);
                }
                .improvement-actions {
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                    margin-top: 16px;
                }
            `;
            document.head.appendChild(styles);
        }

        document.body.appendChild(modal);

        const input = modal.querySelector('#improvement-input');
        input.focus();

        return new Promise((resolve) => {
            const cleanup = () => {
                modal.remove();
            };

            modal.querySelector('#cancel-improvement').addEventListener('click', () => {
                cleanup();
                resolve();
            });

            modal.querySelector('#submit-improvement').addEventListener('click', async () => {
                const improvement = input.value.trim();
                cleanup();
                if (improvement) {
                    const improvedPrompt = `${this.promptInput.value}\n\nIMPROVEMENT REQUEST: ${improvement}`;
                    this.promptInput.value = improvedPrompt;
                    await this.handleGenerateCode();
                }
                resolve();
            });

            // Allow pressing Enter to submit (Shift+Enter for newline)
            input.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    modal.querySelector('#submit-improvement').click();
                }
                if (e.key === 'Escape') {
                    cleanup();
                    resolve();
                }
            });

            // Click outside to close
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    cleanup();
                    resolve();
                }
            });
        });
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
            window.rendererLogger.warn('Failed to submit feedback:', error);
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

        // Debounce protection - prevent double execution
        if (this._isExecuting) {
            console.log('Execution already in progress, ignoring duplicate click');
            return;
        }
        this._isExecuting = true;

        this.executeBtn.disabled = true;
        this.executeBtn.innerHTML = '⏳ Executing...';
        this.executionResults.style.display = 'none';

        try {
            // Check if this is DOM code (contains document/DOM methods)
            const isDOMCode = /document\.|window\.|addEventListener|createElement|getElementById|querySelector/i.test(this.currentCode);

            // For DOM code, launch in multi-app mode if AppManager is available
            if (isDOMCode && this.appManager) {
                const appName = this.codeDescription?.textContent || 'Generated App';
                const panel = await this.executeInMultiAppMode(
                    this.currentCode,
                    appName,
                    this.promptInput.value.substring(0, 100)
                );

                if (panel) {
                    this.executionOutput.textContent = `App "${appName}" launched in multi-app panel`;
                    this.errorSection.style.display = 'none';
                    this.executionResults.style.display = 'block';
                    // Scroll to multi-app section
                    this.multiAppRuntime?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                    // Fallback to standard execution if panel creation failed
                    await this.executeStandardDOMCode();
                }
            } else if (isDOMCode) {
                // Execute DOM code in execution-root (fallback mode)
                await this.executeStandardDOMCode();
            } else {
                // Execute Node.js code in sandbox
                const result = await window.electronAPI.executeCode({
                    packages: this.currentPackages,
                    code: this.currentCode,
                    sessionId: this.currentSession
                });

                if (result.success) {
                    this.executionOutput.textContent = result.output || 'No output generated';

                    if (result.errors) {
                        this.executionErrors.textContent = result.errors;
                        this.errorSection.style.display = 'block';
                    } else {
                        this.errorSection.style.display = 'none';
                    }

                    this.executionResults.style.display = 'block';
                    this.showNotification('Code executed successfully!', 'success');
                } else {
                    this.showNotification(`Execution failed: ${result.error}`, 'error');
                    this.executionOutput.textContent = 'Execution failed';
                    this.executionErrors.textContent = result.error;
                    this.errorSection.style.display = 'block';
                    this.executionResults.style.display = 'block';
                }
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
        } finally {
            this._isExecuting = false;  // Reset debounce lock
            this.executeBtn.disabled = false;
            this.executeBtn.innerHTML = '▶️ Execute';
        }
    }

    /**
     * Execute DOM code in the standard execution-root container
     */
    async executeStandardDOMCode() {
        const result = await this.executeSecureDOMCode(this.currentCode);

        if (result.success) {
            this.executionOutput.textContent = result.output || 'DOM code executed in browser';

            if (result.errors) {
                this.executionErrors.textContent = result.errors;
                this.errorSection.style.display = 'block';
            } else {
                this.errorSection.style.display = 'none';
            }

            this.executionResults.style.display = 'block';
            this.showNotification('Code executed successfully!', 'success');
        } else {
            this.showNotification(`Execution failed: ${result.error}`, 'error');
            this.executionOutput.textContent = 'Execution failed';
            this.executionErrors.textContent = result.error;
            this.errorSection.style.display = 'block';
            this.executionResults.style.display = 'block';
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
                window.rendererLogger.warn('Failed to cleanup old session:', error);
            }
        }

        // Create new session
        this.currentSession = await window.electronAPI.generateSessionId();
        this.sessionId.textContent = this.currentSession;
        this.handleClear();
        this.showNotification('New session started', 'info');
    }

    /**
     * Load a pre-defined template into the prompt input
     */
    loadTemplate(templateType) {
        // Templates are simplified - the system prompt handles database requirements automatically
        const templates = {
            'todo': 'Create a todo list app with:\n- Add tasks\n- Mark complete/incomplete\n- Delete tasks\n- Show task count\n- Modern clean design',

            'notes': 'Build a note-taking app with:\n- Create notes (title + content)\n- Edit and delete notes\n- Search notes\n- Modern card layout',

            'contacts': 'Create a contacts app with:\n- Add contacts (name, email, phone)\n- Edit and delete contacts\n- Search by name\n- Clean table or card layout',

            'expenses': 'Build an expense tracker with:\n- Add expenses (amount, category, date)\n- Show totals by category\n- Edit and delete\n- Professional design',

            'inventory': 'Create an inventory system with:\n- Add items (name, quantity, price)\n- Update stock levels\n- Show total value\n- Low stock alerts',

            'diary': 'Build a journal app with:\n- Write entries (title, content, mood)\n- View by date\n- Edit and delete\n- Calming design'
        };

        if (templates[templateType]) {
            this.promptInput.value = templates[templateType];
            this.showNotification(`Loaded ${templateType} template!`, 'success');
            // Scroll to the prompt
            this.promptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.promptInput.focus();
        }
    }

    /**
     * Toggle the database context sidebar
     */
    toggleDbContextSidebar() {
        const sidebar = document.getElementById('dbContextSidebar');
        if (sidebar) {
            sidebar.classList.toggle('open');
            if (sidebar.classList.contains('open')) {
                this.refreshDbContext();
            }
        }
    }

    /**
     * Close the database context sidebar
     */
    closeDbContextSidebar() {
        const sidebar = document.getElementById('dbContextSidebar');
        if (sidebar) {
            sidebar.classList.remove('open');
        }
    }

    /**
     * Refresh the database context information
     */
    async refreshDbContext() {
        try {
            const currentDbName = document.getElementById('currentDbName');
            const tablesPreviewList = document.getElementById('tablesPreviewList');

            if (!this.currentSession) {
                currentDbName.textContent = 'No active session';
                tablesPreviewList.innerHTML = '<p class="no-data">Start a session to see database tables</p>';
                return;
            }

            // Set current database name (use session ID as DB name)
            currentDbName.textContent = this.currentSession;

            // Fetch tables for current session/database
            const result = await window.electronAPI.dbListTables(this.currentSession);

            if (result.success && result.tables && result.tables.length > 0) {
                tablesPreviewList.innerHTML = '';

                for (const tableName of result.tables) {
                    // Skip internal tables
                    if (tableName === '_init_table') continue;

                    // Get table schema
                    let columns = [];
                    try {
                        const schemaResult = await window.electronAPI.dbGetTableSchema(this.currentSession, tableName);
                        if (schemaResult.success && schemaResult.columns) {
                            columns = schemaResult.columns;
                        }
                    } catch (e) {
                        console.warn('Could not fetch schema for', tableName);
                    }

                    // Build table item using DOM methods to prevent XSS
                    const tableItem = document.createElement('div');
                    tableItem.className = 'table-preview-item';

                    const tableNameEl = document.createElement('strong');
                    tableNameEl.textContent = tableName;
                    tableItem.appendChild(tableNameEl);

                    const columnsDiv = document.createElement('div');
                    columnsDiv.className = 'table-columns';
                    if (columns.length > 0) {
                        columnsDiv.textContent = columns.map(col => `${col.name} (${col.type})`).join(', ');
                    } else {
                        columnsDiv.textContent = 'No schema info';
                    }
                    tableItem.appendChild(columnsDiv);

                    // Click to insert table reference into prompt
                    tableItem.addEventListener('click', () => {
                        this.insertTableReference(tableName);
                    });

                    tablesPreviewList.appendChild(tableItem);
                }

                this.showNotification(`Found ${result.tables.length - 1} tables`, 'success');
            } else {
                const noDataP = document.createElement('p');
                noDataP.className = 'no-data';
                noDataP.textContent = 'No tables yet. Create one in your code!';
                tablesPreviewList.innerHTML = '';
                tablesPreviewList.appendChild(noDataP);
            }
        } catch (error) {
            console.error('Error refreshing DB context:', error);
            const errorP = document.createElement('p');
            errorP.className = 'no-data';
            errorP.textContent = 'Error loading tables';
            const tablesListEl = document.getElementById('tablesPreviewList');
            tablesListEl.innerHTML = '';
            tablesListEl.appendChild(errorP);
        }
    }

    /**
     * Insert a table reference into the prompt
     */
    insertTableReference(tableName) {
        const currentValue = this.promptInput.value;
        const addition = `\n\nUse the existing "${tableName}" table in the database.`;

        this.promptInput.value = currentValue + addition;
        this.closeDbContextSidebar();
        this.showNotification(`Added reference to ${tableName}`, 'info');
        this.promptInput.focus();
    }

    async executeSecureDOMCode(code) {
        try {
            // First, notify main process for logging
            await window.electronAPI.executeDOMCode({
                code: code,
                sessionId: this.currentSession
            });

            // Clear execution-root before new execution to prevent UI pollution
            const executionRoot = document.getElementById('execution-root');
            if (executionRoot) {
                executionRoot.innerHTML = '';
            }

            // Wrap code to confine it to execution-root
            const confinedCode = this.wrapCodeForConfinement(code);

            // Use secure DOM executor if available
            if (this.secureDOMExecutor) {
                return await this.secureDOMExecutor.executeInCurrentContext(
                    confinedCode,
                    this.currentSession,
                    executionRoot
                );
            } else {
                // Fallback to function-based execution (safer than eval)
                return await this.executeFunctionBased(confinedCode);
            }
        } catch (error) {
            window.rendererLogger.error('Secure DOM execution failed:', error);
            return {
                success: false,
                error: error.message,
                logs: []
            };
        }
    }

    /**
     * Check if code contains Custom Element patterns
     */
    isCustomElementCode(code) {
        return /extends\s+HTMLElement/i.test(code) ||
               /customElements\.define/i.test(code);
    }

    /**
     * Wrap generated code to confine it to execution-root container
     * This prevents generated code from modifying the rest of the UI
     */
    wrapCodeForConfinement(code) {
        // Check if this is Custom Element code - needs special handling
        const isCustomElement = this.isCustomElementCode(code);

        if (isCustomElement) {
            // Use lighter confinement for Custom Elements to avoid breaking their rendering
            return this.wrapCustomElementCode(code);
        }

        // Standard confinement for regular DOM code
        return this.wrapStandardCode(code);
    }

    /**
     * Lighter confinement wrapper for Custom Element code
     * Custom Elements need more direct DOM access for proper rendering
     */
    wrapCustomElementCode(code) {
        return `
// === CUSTOM ELEMENT CONFINEMENT WRAPPER ===
(function() {
    const __executionRoot = document.getElementById('execution-root');
    if (!__executionRoot) {
        console.error('execution-root not found');
        return;
    }

    // Clear execution-root for fresh render
    __executionRoot.innerHTML = '';

    // Save original customElements.define once to prevent stacking wrappers
    if (!customElements.__originalDefine) {
        customElements.__originalDefine = customElements.define.bind(customElements);
    }
    const __originalDefine = customElements.__originalDefine;

    // Track elements defined during this execution
    const __definedInThisRun = [];

    // Unified customElements.define wrapper - handles both tracking and re-registration
    customElements.define = function(name, constructor, options) {
        if (customElements.get(name)) {
            console.log('Custom element "' + name + '" already registered, creating new instance');
            __definedInThisRun.push(name);
            // Create and append a new instance
            const newInstance = document.createElement(name);
            __executionRoot.appendChild(newInstance);
            return;
        }
        __definedInThisRun.push(name);
        return __originalDefine(name, constructor, options);
    };

    // Create a minimal proxy that redirects body to execution-root
    // but allows most document operations to work normally for Custom Elements
    const __docProxy = new Proxy(document, {
        get: function(target, prop) {
            // Redirect body to execution-root
            if (prop === 'body') {
                return __executionRoot;
            }
            // Handle DOMContentLoaded immediately
            if (prop === 'addEventListener') {
                return function(event, handler, options) {
                    if (event === 'DOMContentLoaded') {
                        setTimeout(handler, 0);
                    } else {
                        target.addEventListener(event, handler, options);
                    }
                };
            }
            // Block dangerous methods
            if (prop === 'write' || prop === 'writeln') {
                return function() { console.warn('document.' + prop + ' is blocked'); };
            }
            // Pass through everything else for Custom Element compatibility
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });

    // Execute user code with minimal confinement
    (function(document) {
        try {
            ${code}

            // After code execution, if no element was appended, auto-append defined custom elements
            if (__executionRoot.children.length === 0 && __definedInThisRun.length > 0) {
                console.log('Auto-appending custom elements:', __definedInThisRun);
                __definedInThisRun.forEach(function(name) {
                    if (!__executionRoot.querySelector(name)) {
                        const element = document.createElement(name);
                        __executionRoot.appendChild(element);
                    }
                });
            }
        } catch (error) {
            console.error('Custom element code error:', error);
            __executionRoot.innerHTML = '<div style="color: #ef4444; padding: 16px; background: #fef2f2; border-radius: 8px;"><strong>Error:</strong> ' + error.message + '</div>';
        }
    })(__docProxy);
})();
`;
    }

    /**
     * Standard confinement wrapper for regular DOM code
     */
    wrapStandardCode(code) {
        return `
// === CONFINEMENT WRAPPER - DO NOT MODIFY ===
(function() {
    // Get the execution root container
    const __executionRoot = document.getElementById('execution-root');
    if (!__executionRoot) {
        console.error('execution-root not found');
        return;
    }

    // Clear for fresh execution
    __executionRoot.innerHTML = '';

    // === CUSTOM ELEMENT PROTECTION ===
    // Save original customElements.define once to prevent stacking wrappers
    if (!customElements.__originalDefine) {
        customElements.__originalDefine = customElements.define.bind(customElements);
    }
    const __originalDefine = customElements.__originalDefine;

    // Override customElements.define to handle re-registration gracefully
    customElements.define = function(name, constructor, options) {
        if (customElements.get(name)) {
            console.log('Custom element "' + name + '" already registered, skipping re-registration');
            // Clear execution-root and add a new instance of the existing element
            __executionRoot.innerHTML = '';
            const existingElement = document.createElement(name);
            __executionRoot.appendChild(existingElement);
            return;
        }
        return __originalDefine(name, constructor, options);
    };

    // Create a proxy for document that confines most operations
    const confinedDocument = new Proxy(document, {
        get: function(target, prop) {
            // Confine these methods to execution-root
            if (prop === 'getElementById') {
                return function(id) {
                    if (id === 'execution-root') return __executionRoot;
                    // First check execution-root, then fall back to real document for system IDs
                    const inRoot = __executionRoot.querySelector('#' + CSS.escape(id));
                    if (inRoot) return inRoot;
                    return null; // Block access to outside elements
                };
            }
            if (prop === 'querySelector') {
                return function(selector) {
                    if (selector === '#execution-root' || selector === 'body') return __executionRoot;
                    return __executionRoot.querySelector(selector);
                };
            }
            if (prop === 'querySelectorAll') {
                return function(selector) {
                    return __executionRoot.querySelectorAll(selector);
                };
            }
            if (prop === 'body') {
                return __executionRoot;
            }
            // Allow createElement and other safe methods
            if (prop === 'createElement' || prop === 'createTextNode' || prop === 'createDocumentFragment') {
                return target[prop].bind(target);
            }
            // Pass through addEventListener for DOMContentLoaded etc
            if (prop === 'addEventListener') {
                return function(event, handler, options) {
                    if (event === 'DOMContentLoaded') {
                        // Execute immediately since DOM is already loaded
                        setTimeout(handler, 0);
                    } else {
                        __executionRoot.addEventListener(event, handler, options);
                    }
                };
            }
            // Block dangerous methods
            if (prop === 'write' || prop === 'writeln' || prop === 'open' || prop === 'close') {
                return function() { console.warn('document.' + prop + ' is blocked'); };
            }
            // Return other properties as-is
            return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
        }
    });

    // Execute the user code with confined document
    // Note: Don't pass 'root' as parameter to avoid shadowing user's 'const root' declarations
    (function(document) {
        // === USER CODE STARTS HERE ===
${code}
        // === USER CODE ENDS HERE ===
    })(confinedDocument);
})();
`;
    }

    /**
     * Check code for dangerous patterns before execution
     * Returns null if safe, or error message if dangerous
     */
    scanCodeForDangers(code) {
        const dangerousPatterns = [
            { pattern: /eval\s*\(/i, description: 'eval() is not allowed' },
            { pattern: /Function\s*\(/i, description: 'Function constructor is not allowed' },
            { pattern: /\.innerHTML\s*=\s*[^'"`;\n]+\s*\+\s*['"][^'"]*</i, description: 'Dynamic innerHTML with string concatenation of HTML is risky' },
            { pattern: /document\.write\s*\(/i, description: 'document.write() is not allowed' },
            { pattern: /window\.location\s*=/i, description: 'Modifying window.location is not allowed' },
            { pattern: /document\.cookie/i, description: 'Accessing cookies is not allowed' },
            { pattern: /localStorage\./i, description: 'localStorage access is not allowed in fallback mode' },
            { pattern: /sessionStorage\./i, description: 'sessionStorage access is not allowed in fallback mode' },
            { pattern: /fetch\s*\(/i, description: 'Network requests are not allowed in fallback mode' },
            { pattern: /XMLHttpRequest/i, description: 'Network requests are not allowed in fallback mode' },
            { pattern: /import\s*\(/i, description: 'Dynamic imports are not allowed' },
            { pattern: /require\s*\(/i, description: 'require() is not allowed' }
        ];

        for (const { pattern, description } of dangerousPatterns) {
            if (pattern.test(code)) {
                return description;
            }
        }

        // Check code size limit
        if (code.length > 100000) {
            return 'Code exceeds maximum allowed size (100KB)';
        }

        return null;
    }

    async executeFunctionBased(code) {
        const logs = [];
        const startTime = Date.now();

        // Security: Warn that this is fallback execution mode
        window.rendererLogger.warn('Using fallback execution mode (new Function). SecureDOMExecutor preferred.');

        // Security scan before execution
        const securityIssue = this.scanCodeForDangers(code);
        if (securityIssue) {
            return {
                success: false,
                error: `Security check failed: ${securityIssue}`,
                logs: [],
                executionTime: 0
            };
        }

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
            // Note: This is a fallback when SecureDOMExecutor is unavailable
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

        const visualDesigner = document.getElementById('visualSchemaDesigner');
        if (visualDesigner) visualDesigner.style.display = 'none';

        this.showDbManagerBtn.classList.remove('active');
        this.showSchemaGeneratorBtn.classList.remove('active');
        const showVisualDesignerBtn = document.getElementById('showVisualDesignerBtn');
        if (showVisualDesignerBtn) showVisualDesignerBtn.classList.remove('active');
    }

    /**
     * Show visual schema designer subsection
     */
    showVisualDesigner() {
        this.databaseManager.style.display = 'none';
        this.schemaGenerator.style.display = 'none';
        this.queryBuilder.style.display = 'none';

        const visualDesigner = document.getElementById('visualSchemaDesigner');
        if (visualDesigner) visualDesigner.style.display = 'block';

        this.showDbManagerBtn.classList.remove('active');
        this.showSchemaGeneratorBtn.classList.remove('active');
        const showVisualDesignerBtn = document.getElementById('showVisualDesignerBtn');
        if (showVisualDesignerBtn) showVisualDesignerBtn.classList.add('active');

        // Initialize with one column row if empty
        const columnsContainer = document.getElementById('columnsContainer');
        if (columnsContainer && columnsContainer.children.length === 0) {
            this.addColumnRow();
        }
    }

    /**
     * Add a column row to the visual designer
     */
    addColumnRow() {
        const columnsContainer = document.getElementById('columnsContainer');
        if (!columnsContainer) return;

        const columnRow = document.createElement('div');
        columnRow.className = 'column-row';
        columnRow.innerHTML = `
            <input type="text" placeholder="Column name" class="column-name">
            <select class="column-type">
                <option value="TEXT">TEXT</option>
                <option value="INTEGER">INTEGER</option>
                <option value="REAL">REAL</option>
                <option value="BLOB">BLOB</option>
            </select>
            <label>
                <input type="checkbox" class="column-required"> Required
            </label>
            <button class="remove-column-btn" onclick="this.parentElement.remove(); window.app.updateSchemaPreview();">×</button>
        `;

        // Add input listeners to update preview
        const inputs = columnRow.querySelectorAll('input, select');
        inputs.forEach(input => {
            input.addEventListener('input', () => this.updateSchemaPreview());
            input.addEventListener('change', () => this.updateSchemaPreview());
        });

        columnsContainer.appendChild(columnRow);
        this.updateSchemaPreview();
    }

    /**
     * Update the schema preview
     */
    updateSchemaPreview() {
        const tableName = document.getElementById('designerTableName')?.value || 'table_name';
        const columnsContainer = document.getElementById('columnsContainer');
        const schemaPreview = document.getElementById('schemaPreview');

        if (!columnsContainer || !schemaPreview) return;

        const columns = [];
        const columnRows = columnsContainer.querySelectorAll('.column-row');

        columnRows.forEach(row => {
            const name = row.querySelector('.column-name').value;
            const type = row.querySelector('.column-type').value;
            const required = row.querySelector('.column-required').checked;

            if (name) {
                columns.push({ name, type, required });
            }
        });

        if (columns.length === 0) {
            schemaPreview.innerHTML = '<p class="no-data">Add columns to see preview</p>';
            return;
        }

        // Generate preview code
        const code = `await window.electronAPI.createTable('${tableName}', {
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
${columns.map(col => `    { name: '${col.name}', type: '${col.type}'${col.required ? ', required: true' : ''} }`).join(',\n')}
  ]
});`;

        schemaPreview.textContent = code;
    }

    /**
     * Generate schema code and copy to prompt
     */
    generateSchemaCode() {
        const tableName = document.getElementById('designerTableName')?.value;
        if (!tableName) {
            this.showNotification('Please enter a table name', 'error');
            return;
        }

        this.updateSchemaPreview();
        const code = document.getElementById('schemaPreview')?.textContent;

        if (code && !code.includes('Add columns')) {
            this.promptInput.value = `Create an app that uses this database table:\n\n${code}\n\nBuild a complete UI to manage this data with add, edit, delete, and view functionality.`;
            this.showNotification('Schema code added to prompt!', 'success');
            this.promptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    /**
     * Create table directly from visual designer
     */
    async createTableFromDesign() {
        const tableName = document.getElementById('designerTableName')?.value;
        if (!tableName) {
            this.showNotification('Please enter a table name', 'error');
            return;
        }

        if (!this.currentSession) {
            this.showNotification('Please start a session first', 'error');
            return;
        }

        const columnsContainer = document.getElementById('columnsContainer');
        const columnRows = columnsContainer.querySelectorAll('.column-row');

        if (columnRows.length === 0) {
            this.showNotification('Please add at least one column', 'error');
            return;
        }

        const columns = [
            { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true }
        ];

        columnRows.forEach(row => {
            const name = row.querySelector('.column-name').value;
            const type = row.querySelector('.column-type').value;
            const required = row.querySelector('.column-required').checked;

            if (name) {
                columns.push({ name, type, required });
            }
        });

        try {
            const result = await window.electronAPI.dbCreateTable(this.currentSession, tableName, { columns });

            if (result.success) {
                this.showNotification(`Table "${tableName}" created successfully!`, 'success');
                this.clearDesigner();
                this.refreshDbContext();
            } else {
                this.showNotification(`Failed to create table: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Clear the visual designer
     */
    clearDesigner() {
        document.getElementById('designerTableName').value = '';
        document.getElementById('columnsContainer').innerHTML = '';
        document.getElementById('schemaPreview').innerHTML = '<p class="no-data">Add columns to see preview</p>';
        this.addColumnRow();
    }

    /**
     * Generate UI for an existing table
     */
    async generateUIForTable(tableName) {
        try {
            if (!this.currentDatabase) {
                this.showNotification('No database selected', 'error');
                return;
            }

            // Get table schema
            const schemaResult = await window.electronAPI.dbGetTableSchema(this.currentDatabase, tableName);

            if (!schemaResult.success || !schemaResult.columns) {
                this.showNotification('Failed to load table schema', 'error');
                return;
            }

            const columns = schemaResult.columns;

            // Get sample data to understand the table better
            let sampleData = [];
            try {
                const dataResult = await window.electronAPI.dbQueryData(this.currentDatabase, tableName, { limit: 3 });
                if (dataResult.success && dataResult.data) {
                    sampleData = dataResult.data;
                }
            } catch (e) {
                console.warn('Could not fetch sample data');
            }

            // Build detailed prompt
            let prompt = `Create a complete, production-ready UI application for managing the "${tableName}" database table.\n\n`;

            prompt += `TABLE SCHEMA:\n`;
            prompt += `Table: ${tableName}\n`;
            prompt += `Columns:\n`;
            columns.forEach(col => {
                prompt += `  - ${col.name} (${col.type})${col.primaryKey ? ' [PRIMARY KEY]' : ''}${col.required ? ' [REQUIRED]' : ''}\n`;
            });

            if (sampleData.length > 0) {
                prompt += `\nSAMPLE DATA (${sampleData.length} records):\n`;
                prompt += JSON.stringify(sampleData, null, 2) + '\n';
            }

            prompt += `\nREQUIREMENTS:\n`;
            prompt += `1. Create a complete CRUD interface (Create, Read, Update, Delete)\n`;
            prompt += `2. Display all records from the "${tableName}" table in a beautiful, modern layout\n`;
            prompt += `3. Add a form to create new records with all fields\n`;
            prompt += `4. Enable editing of existing records (click to edit)\n`;
            prompt += `5. Add delete functionality with confirmation\n`;
            prompt += `6. Include search/filter capability\n`;
            prompt += `7. Show total record count\n`;
            prompt += `8. Add proper validation for all fields\n`;
            prompt += `9. Use the existing "${tableName}" table (DO NOT create a new table)\n`;
            prompt += `10. Include error handling and user feedback\n`;
            prompt += `11. Make it responsive and visually appealing with modern CSS\n`;
            prompt += `12. Add loading states for async operations\n\n`;

            prompt += `IMPORTANT:\n`;
            prompt += `- Use await window.electronAPI.queryData('${tableName}', ...) to load existing data\n`;
            prompt += `- Use await window.electronAPI.insertData('${tableName}', {...}) to create records\n`;
            prompt += `- Use await window.electronAPI.updateData('${tableName}', {id: X}, {...}) to update\n`;
            prompt += `- Use await window.electronAPI.deleteData('${tableName}', {id: X}) to delete\n`;
            prompt += `- Handle all database operations with proper try-catch and result.success checking\n\n`;

            prompt += `Make it beautiful, functional, and user-friendly!`;

            // Set the prompt
            this.promptInput.value = prompt;

            // Scroll to the prompt
            this.codeGeneration.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this.promptInput.focus();

            // Show notification
            this.showNotification(`Generated UI prompt for "${tableName}". Click Generate Code!`, 'success');

            // Optional: Auto-trigger code generation
            // Uncomment the next line to automatically generate code
            // await this.handleGenerateCode();

        } catch (error) {
            console.error('Error generating UI for table:', error);
            this.showNotification(`Error: ${error.message}`, 'error');
        }
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
                    const noDataP = document.createElement('p');
                    noDataP.className = 'no-data';
                    noDataP.textContent = 'No tables in this database';
                    this.tablesList.appendChild(noDataP);
                } else {
                    result.tables.forEach(tableName => {
                        if (tableName !== '_init_table') { // Hide init table
                            // Build table item using DOM methods to prevent XSS
                            const tableItem = document.createElement('div');
                            tableItem.className = 'table-item';

                            const tableNameSpan = document.createElement('span');
                            tableNameSpan.className = 'table-name';
                            tableNameSpan.textContent = tableName;
                            tableItem.appendChild(tableNameSpan);

                            const actionsDiv = document.createElement('div');
                            actionsDiv.className = 'table-actions';

                            // View Data button
                            const viewBtn = document.createElement('button');
                            viewBtn.className = 'btn btn-sm';
                            viewBtn.textContent = 'View Data';
                            viewBtn.addEventListener('click', () => this.selectTable(tableName));
                            actionsDiv.appendChild(viewBtn);

                            // Schema button
                            const schemaBtn = document.createElement('button');
                            schemaBtn.className = 'btn btn-sm btn-outline';
                            schemaBtn.textContent = 'Schema';
                            schemaBtn.addEventListener('click', () => this.showTableSchema(tableName));
                            actionsDiv.appendChild(schemaBtn);

                            // Generate UI button
                            const generateBtn = document.createElement('button');
                            generateBtn.className = 'btn btn-sm btn-success';
                            generateBtn.textContent = '🎨 Generate UI';
                            generateBtn.addEventListener('click', () => this.generateUIForTable(tableName));
                            actionsDiv.appendChild(generateBtn);

                            // Delete table button
                            const deleteBtn = document.createElement('button');
                            deleteBtn.className = 'btn btn-sm btn-danger';
                            deleteBtn.textContent = '🗑️ Delete';
                            deleteBtn.addEventListener('click', () => this.deleteTable(tableName));
                            actionsDiv.appendChild(deleteBtn);

                            tableItem.appendChild(actionsDiv);
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
     * Delete a table from the database
     */
    async deleteTable(tableName) {
        // Show confirmation dialog
        const confirmed = await this.showConfirmDialog(
            `Delete Table "${tableName}"?`,
            `This will permanently delete the table "${tableName}" and all its data. This action cannot be undone.`
        );

        if (!confirmed) {
            return;
        }

        try {
            const result = await window.electronAPI.dropTable(tableName);

            if (result.success) {
                this.showNotification(`Table "${tableName}" deleted successfully`, 'success');

                // Hide data panel if current table was deleted
                if (this.currentTable === tableName) {
                    this.hideDataPanel();
                    this.currentTable = null;
                }

                // Refresh tables list
                await this.loadTables();
            } else {
                this.showNotification(`Failed to delete table: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Error deleting table: ${error.message}`, 'error');
        }
    }

    /**
     * Show a confirmation dialog
     */
    async showConfirmDialog(title, message) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'confirm-modal';
            modal.innerHTML = `
                <div class="confirm-dialog">
                    <h3>${this.escapeHtml(title)}</h3>
                    <p>${this.escapeHtml(message)}</p>
                    <div class="confirm-actions">
                        <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
                        <button class="btn btn-danger" id="confirm-delete">Delete</button>
                    </div>
                </div>
            `;

            // Add modal styles if not already present
            if (!document.getElementById('confirm-modal-styles')) {
                const styles = document.createElement('style');
                styles.id = 'confirm-modal-styles';
                styles.textContent = `
                    .confirm-modal {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: rgba(0, 0, 0, 0.5);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 10000;
                    }
                    .confirm-dialog {
                        background: var(--card-bg, #fff);
                        padding: 24px;
                        border-radius: 12px;
                        max-width: 400px;
                        width: 90%;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                    }
                    .confirm-dialog h3 {
                        margin: 0 0 12px 0;
                        color: var(--text-primary, #333);
                    }
                    .confirm-dialog p {
                        margin: 0 0 20px 0;
                        color: var(--text-secondary, #666);
                        line-height: 1.5;
                    }
                    .confirm-actions {
                        display: flex;
                        gap: 12px;
                        justify-content: flex-end;
                    }
                `;
                document.head.appendChild(styles);
            }

            document.body.appendChild(modal);

            const cleanup = () => {
                modal.remove();
            };

            modal.querySelector('#confirm-cancel').addEventListener('click', () => {
                cleanup();
                resolve(false);
            });

            modal.querySelector('#confirm-delete').addEventListener('click', () => {
                cleanup();
                resolve(true);
            });

            // Click outside to cancel
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    cleanup();
                    resolve(false);
                }
            });

            // Escape key to cancel
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    cleanup();
                    document.removeEventListener('keydown', handleEscape);
                    resolve(false);
                }
            };
            document.addEventListener('keydown', handleEscape);
        });
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
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Render data table safely using DOM methods to prevent XSS
     */
    renderDataTable(data) {
        // Clear existing content
        this.dataTable.innerHTML = '';

        if (!data || data.length === 0) {
            const noData = document.createElement('p');
            noData.className = 'no-data';
            noData.textContent = 'No data in this table';
            this.dataTable.appendChild(noData);
            return;
        }

        const columns = Object.keys(data[0]);

        // Create table element
        const table = document.createElement('table');
        table.className = 'data-table';

        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            headerRow.appendChild(th);
        });
        const actionsHeader = document.createElement('th');
        actionsHeader.textContent = 'Actions';
        headerRow.appendChild(actionsHeader);
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');
        data.forEach(row => {
            const tr = document.createElement('tr');

            columns.forEach(col => {
                const td = document.createElement('td');
                let value = row[col];

                if (typeof value === 'object' && value !== null) {
                    value = JSON.stringify(value);
                } else if (value === null) {
                    const em = document.createElement('em');
                    em.textContent = 'null';
                    td.appendChild(em);
                    tr.appendChild(td);
                    return;
                }

                td.textContent = String(value);
                tr.appendChild(td);
            });

            // Actions cell
            const actionsTd = document.createElement('td');
            actionsTd.className = 'actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-sm';
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => this.editRecord(row.id));
            actionsTd.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-sm btn-danger';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => this.deleteRecord(row.id));
            actionsTd.appendChild(deleteBtn);

            tr.appendChild(actionsTd);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        this.dataTable.appendChild(table);
    }

    /**
     * Render pagination safely using DOM methods
     */
    renderPagination(totalCount, currentPage, pageSize) {
        // Check if dataPagination element exists
        if (!this.dataPagination) {
            return;
        }

        const totalPages = Math.ceil(totalCount / pageSize);

        // Clear existing content
        this.dataPagination.innerHTML = '';

        if (totalPages <= 1) {
            return;
        }

        // Create pagination info
        const paginationInfo = document.createElement('div');
        paginationInfo.className = 'pagination-info';
        paginationInfo.textContent = `Showing page ${currentPage} of ${totalPages} (${totalCount} total records)`;
        this.dataPagination.appendChild(paginationInfo);

        // Create pagination controls
        const paginationControls = document.createElement('div');
        paginationControls.className = 'pagination-controls';

        if (currentPage > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'btn btn-sm';
            prevBtn.textContent = 'Previous';
            prevBtn.addEventListener('click', () => this.loadTableData(currentPage - 1));
            paginationControls.appendChild(prevBtn);
        }

        if (currentPage < totalPages) {
            const nextBtn = document.createElement('button');
            nextBtn.className = 'btn btn-sm';
            nextBtn.textContent = 'Next';
            nextBtn.addEventListener('click', () => this.loadTableData(currentPage + 1));
            paginationControls.appendChild(nextBtn);
        }

        this.dataPagination.appendChild(paginationControls);
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
     * Initialize multi-app runtime components
     */
    initializeMultiAppRuntime() {
        try {
            // Initialize message bus
            if (typeof AppMessageBus !== 'undefined') {
                this.messageBus = new AppMessageBus();
                window.rendererLogger.debug('AppMessageBus initialized');
            }

            // Initialize data change broadcaster
            if (typeof DataChangeBroadcaster !== 'undefined') {
                this.dataChangeBroadcaster = new DataChangeBroadcaster(this.messageBus);
                window.rendererLogger.debug('DataChangeBroadcaster initialized');
            }

            // Initialize app manager
            if (typeof AppManager !== 'undefined' && this.appPanelsContainer) {
                this.appManager = new AppManager({
                    layout: 'grid',
                    maxPanels: 6,
                    onPanelCreated: (panel) => this.handlePanelCreated(panel),
                    onPanelClosed: (panel) => this.handlePanelClosed(panel),
                    onLayoutChange: (layout) => this.handleLayoutChange(layout),
                    onDataChange: (change) => this.handleAppDataChange(change)
                });

                // Set message bus and broadcaster
                this.appManager.messageBus = this.messageBus;
                this.appManager.dataChangeBroadcaster = this.dataChangeBroadcaster;

                // Initialize with container
                this.appManager.initialize(this.appPanelsContainer);

                window.rendererLogger.debug('AppManager initialized');
            }

            // Check if there are restored panels
            if (this.appManager && this.appManager.panels.size > 0) {
                this.showMultiAppRuntime();
            }

        } catch (error) {
            window.rendererLogger.error('Failed to initialize multi-app runtime:', error);
        }
    }

    /**
     * Handle panel created event
     */
    handlePanelCreated(panel) {
        this.updateMultiAppStats();
        window.rendererLogger.debug(`Panel created: ${panel.appName}`);
    }

    /**
     * Handle panel closed event
     */
    handlePanelClosed(panel) {
        this.updateMultiAppStats();

        // Hide runtime section if no panels remain
        if (this.appManager && this.appManager.panels.size === 0) {
            this.hideMultiAppRuntime();
        }

        window.rendererLogger.debug(`Panel closed: ${panel.appName}`);
    }

    /**
     * Handle layout change event
     */
    handleLayoutChange(layout) {
        // Update layout button states
        document.querySelectorAll('.layout-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.layout === layout);
        });

        // Update tabs bar visibility
        if (this.appTabsBar) {
            this.appTabsBar.style.display = layout === 'tabs' ? 'flex' : 'none';
        }

        window.rendererLogger.debug(`Layout changed to: ${layout}`);
    }

    /**
     * Handle app data change event
     */
    handleAppDataChange(change) {
        window.rendererLogger.debug('App data change:', change);

        // Broadcast to data change broadcaster for real-time sync
        if (this.dataChangeBroadcaster) {
            this.dataChangeBroadcaster.broadcast(change);
        }
    }

    /**
     * Show multi-app runtime section
     */
    showMultiAppRuntime() {
        if (this.multiAppRuntime) {
            this.multiAppRuntime.style.display = 'block';
            this.multiAppMode = true;
        }
    }

    /**
     * Hide multi-app runtime section
     */
    hideMultiAppRuntime() {
        if (this.multiAppRuntime) {
            this.multiAppRuntime.style.display = 'none';
            this.multiAppMode = false;
        }
    }

    /**
     * Update multi-app statistics display
     */
    updateMultiAppStats() {
        if (this.runningAppsCount && this.appManager) {
            this.runningAppsCount.textContent = this.appManager.panels.size;
        }
    }

    /**
     * Set multi-app layout mode
     */
    setMultiAppLayout(layout) {
        if (this.appManager) {
            this.appManager.setLayout(layout);
        }
    }

    /**
     * Clear all running apps
     */
    clearAllApps() {
        if (this.appManager) {
            this.appManager.clearAllPanels();
            this.hideMultiAppRuntime();
            this.showNotification('All apps closed', 'info');
        }
    }

    /**
     * Create a new app panel from generated code
     */
    async createAppPanel(appName, description, code) {
        if (!this.appManager) {
            window.rendererLogger.warn('AppManager not initialized');
            return null;
        }

        try {
            // Generate unique app ID
            const appId = `app_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Create panel
            const panel = this.appManager.createPanel({
                appId,
                appName: appName || 'Generated App',
                description: description || 'AI-generated application'
            });

            // Show multi-app runtime
            this.showMultiAppRuntime();

            // Execute code in panel
            await panel.execute(code);

            // Register app in database
            try {
                await window.electronAPI.registerApp(appId, appName, description);
            } catch (regError) {
                window.rendererLogger.warn('Failed to register app:', regError);
            }

            return panel;
        } catch (error) {
            window.rendererLogger.error('Failed to create app panel:', error);
            this.showNotification(`Failed to create app: ${error.message}`, 'error');
            return null;
        }
    }

    /**
     * Execute code in multi-app mode (creates a new panel)
     */
    async executeInMultiAppMode(code, appName, description) {
        const panel = await this.createAppPanel(appName, description, code);
        if (panel) {
            this.showNotification(`App "${appName}" launched!`, 'success');
        }
        return panel;
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
                window.rendererLogger.warn('Failed to save theme preference:', error);
            });
        }
        
        window.rendererLogger.debug(`Theme switched to: ${theme}`);
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