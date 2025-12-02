/**
 * AppManager - Multi-panel lifecycle management
 * Handles creation, layout, and coordination of multiple AppPanels
 */

class AppManager {
    constructor(options = {}) {
        this.panels = new Map();
        this.container = null;
        this.layout = options.layout || 'grid'; // grid, stack, tabs
        this.maxPanels = options.maxPanels || 6;
        this.activeTabId = null;

        // Event handlers
        this.onPanelCreated = options.onPanelCreated || (() => {});
        this.onPanelClosed = options.onPanelClosed || (() => {});
        this.onLayoutChange = options.onLayoutChange || (() => {});
        this.onDataChange = options.onDataChange || (() => {});

        // Message bus and broadcaster (set externally)
        this.messageBus = null;
        this.dataChangeBroadcaster = null;

        // Load state from localStorage
        this.loadState();
    }

    /**
     * Initialize the AppManager with a container element
     * @param {HTMLElement} containerElement - Container for app panels
     */
    initialize(containerElement) {
        this.container = containerElement;
        this.container.className = `app-panels-container layout-${this.layout}`;

        // Create tabs bar for tab layout
        this.tabsBar = document.createElement('div');
        this.tabsBar.className = 'app-tabs-bar';
        this.tabsBar.style.display = this.layout === 'tabs' ? 'flex' : 'none';
        this.container.parentNode.insertBefore(this.tabsBar, this.container);

        // Restore panels from saved state
        this.restorePanels();
    }

    /**
     * Create a new app panel
     * @param {Object} options - Panel options
     * @returns {AppPanel} - The created panel
     */
    createPanel(options = {}) {
        if (this.panels.size >= this.maxPanels) {
            throw new Error(`Maximum number of panels (${this.maxPanels}) reached`);
        }

        const panel = new AppPanel({
            ...options,
            onStatusChange: (status, panel) => this.handlePanelStatusChange(status, panel),
            onDataChange: (change) => this.handleDataChange(change),
            onMessage: (msg) => this.handlePanelMessage(msg),
            onClose: (panel) => this.handlePanelClose(panel),
            onError: (error) => this.handlePanelError(error, panel)
        });

        this.panels.set(panel.id, panel);
        panel.render(this.container);

        // Add tab if in tabs layout
        if (this.layout === 'tabs') {
            this.addTab(panel);
            this.setActiveTab(panel.id);
        }

        this.updateLayout();
        this.saveState();
        this.onPanelCreated(panel);

        return panel;
    }

    /**
     * Add tab for a panel
     * @param {AppPanel} panel - Panel to add tab for
     */
    addTab(panel) {
        const tab = document.createElement('div');
        tab.className = 'app-tab';
        tab.dataset.panelId = panel.id;
        tab.innerHTML = `
            <span class="app-tab-name">${this.escapeHtml(panel.appName)}</span>
            <button class="app-tab-close" title="Close">&times;</button>
        `;

        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('app-tab-close')) {
                this.setActiveTab(panel.id);
            }
        });

        tab.querySelector('.app-tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closePanel(panel.id);
        });

        this.tabsBar.appendChild(tab);
    }

    /**
     * Set active tab
     * @param {string} panelId - Panel ID to activate
     */
    setActiveTab(panelId) {
        this.activeTabId = panelId;

        // Update tab styles
        this.tabsBar.querySelectorAll('.app-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.panelId === panelId);
        });

        // Show/hide panels
        this.panels.forEach((panel, id) => {
            if (panel.container) {
                panel.container.style.display = id === panelId ? 'flex' : 'none';
            }
        });
    }

    /**
     * Get panel by ID
     * @param {string} panelId - Panel ID
     * @returns {AppPanel|undefined}
     */
    getPanel(panelId) {
        return this.panels.get(panelId);
    }

    /**
     * Get all panels
     * @returns {AppPanel[]}
     */
    getAllPanels() {
        return Array.from(this.panels.values());
    }

    /**
     * Close a panel
     * @param {string} panelId - Panel ID to close
     */
    closePanel(panelId) {
        const panel = this.panels.get(panelId);
        if (panel) {
            panel.close();
        }
    }

    /**
     * Handle panel close
     * @param {AppPanel} panel - Closed panel
     */
    handlePanelClose(panel) {
        this.panels.delete(panel.id);

        // Remove tab if exists
        const tab = this.tabsBar.querySelector(`[data-panel-id="${panel.id}"]`);
        if (tab) {
            tab.remove();
        }

        // If this was the active tab, activate another
        if (this.activeTabId === panel.id && this.panels.size > 0) {
            const nextPanel = this.panels.values().next().value;
            if (nextPanel) {
                this.setActiveTab(nextPanel.id);
            }
        }

        this.updateLayout();
        this.saveState();
        this.onPanelClosed(panel);
    }

    /**
     * Handle panel status change
     * @param {string} status - New status
     * @param {AppPanel} panel - Panel that changed
     */
    handlePanelStatusChange(status, panel) {
        // Update tab indicator if in tabs layout
        if (this.layout === 'tabs') {
            const tab = this.tabsBar.querySelector(`[data-panel-id="${panel.id}"]`);
            if (tab) {
                tab.className = `app-tab ${status}${panel.id === this.activeTabId ? ' active' : ''}`;
            }
        }
    }

    /**
     * Handle data change from a panel
     * @param {Object} change - Change information
     */
    handleDataChange(change) {
        // Broadcast to other panels via DataChangeBroadcaster
        if (this.dataChangeBroadcaster) {
            this.dataChangeBroadcaster.broadcast(change);
        }

        // Notify all other panels
        this.panels.forEach((panel, id) => {
            if (id !== change.appId) {
                panel.notifyDataChange(change);
            }
        });

        this.onDataChange(change);
    }

    /**
     * Handle message from a panel
     * @param {Object} msg - Message data
     */
    handlePanelMessage(msg) {
        if (msg.type === 'app-bus-message' && msg.targetAppId) {
            // Direct message to specific app
            const targetPanel = Array.from(this.panels.values())
                .find(p => p.appId === msg.targetAppId);
            if (targetPanel) {
                targetPanel.sendMessage({
                    sourceAppId: msg.sourceAppId,
                    message: msg.message
                });
            }
        } else if (msg.type === 'app-bus-broadcast') {
            // Broadcast to all apps
            this.panels.forEach(panel => {
                if (panel.appId !== msg.sourceAppId) {
                    panel.sendMessage({
                        sourceAppId: msg.sourceAppId,
                        message: msg.message
                    });
                }
            });
        }

        // Also route through message bus if available
        if (this.messageBus) {
            this.messageBus.emit('app-message', msg);
        }
    }

    /**
     * Handle panel error
     * @param {Error} error - Error object
     * @param {AppPanel} panel - Panel that errored
     */
    handlePanelError(error, panel) {
        console.error(`[AppManager] Panel ${panel.appName} error:`, error);
    }

    /**
     * Set layout mode
     * @param {string} layout - Layout mode (grid, stack, tabs)
     */
    setLayout(layout) {
        this.layout = layout;
        this.container.className = `app-panels-container layout-${layout}`;

        // Show/hide tabs bar
        this.tabsBar.style.display = layout === 'tabs' ? 'flex' : 'none';

        // Update panel visibility for tabs
        if (layout === 'tabs') {
            if (!this.activeTabId && this.panels.size > 0) {
                this.activeTabId = this.panels.keys().next().value;
            }
            this.panels.forEach((panel, id) => {
                if (panel.container) {
                    panel.container.style.display = id === this.activeTabId ? 'flex' : 'none';
                }
            });
        } else {
            // Show all panels for grid/stack
            this.panels.forEach(panel => {
                if (panel.container) {
                    panel.container.style.display = 'flex';
                }
            });
        }

        this.updateLayout();
        this.saveState();
        this.onLayoutChange(layout);
    }

    /**
     * Update layout calculations
     */
    updateLayout() {
        const panelCount = this.panels.size;

        if (this.layout === 'grid') {
            // Calculate grid columns based on panel count
            let columns = Math.ceil(Math.sqrt(panelCount));
            columns = Math.min(columns, 3); // Max 3 columns
            this.container.style.setProperty('--grid-columns', columns);
        }
    }

    /**
     * Save state to localStorage
     */
    saveState() {
        try {
            const state = {
                layout: this.layout,
                activeTabId: this.activeTabId,
                panels: Array.from(this.panels.values()).map(panel => panel.getState())
            };
            localStorage.setItem('appManager_state', JSON.stringify(state));
        } catch (error) {
            console.warn('Failed to save AppManager state:', error);
        }
    }

    /**
     * Load state from localStorage
     */
    loadState() {
        try {
            const stateJson = localStorage.getItem('appManager_state');
            if (stateJson) {
                const state = JSON.parse(stateJson);
                this.layout = state.layout || 'grid';
                this.activeTabId = state.activeTabId;
                this._savedPanels = state.panels || [];
            }
        } catch (error) {
            console.warn('Failed to load AppManager state:', error);
        }
    }

    /**
     * Restore panels from saved state
     */
    restorePanels() {
        if (this._savedPanels && this._savedPanels.length > 0) {
            for (const panelState of this._savedPanels) {
                try {
                    const panel = this.createPanel({
                        id: panelState.id,
                        appId: panelState.appId,
                        appName: panelState.appName,
                        description: panelState.description,
                        code: panelState.code
                    });

                    // Execute the code to restore the app
                    if (panelState.code) {
                        panel.execute(panelState.code).catch(err => {
                            console.warn(`Failed to restore panel ${panelState.appName}:`, err);
                        });
                    }
                } catch (error) {
                    console.warn(`Failed to restore panel ${panelState.id}:`, error);
                }
            }

            // Restore active tab
            if (this.activeTabId && this.panels.has(this.activeTabId)) {
                this.setActiveTab(this.activeTabId);
            }
        }
    }

    /**
     * Clear all panels
     */
    clearAllPanels() {
        const panelIds = Array.from(this.panels.keys());
        panelIds.forEach(id => this.closePanel(id));
    }

    /**
     * Find panels by app ID
     * @param {string} appId - App ID to find
     * @returns {AppPanel[]}
     */
    findPanelsByAppId(appId) {
        return Array.from(this.panels.values()).filter(p => p.appId === appId);
    }

    /**
     * Refresh all panels
     */
    async refreshAllPanels() {
        const promises = Array.from(this.panels.values()).map(panel => panel.refresh());
        await Promise.allSettled(promises);
    }

    /**
     * Get manager statistics
     * @returns {Object}
     */
    getStats() {
        const panels = Array.from(this.panels.values());
        return {
            totalPanels: panels.length,
            runningPanels: panels.filter(p => p.status === 'running').length,
            errorPanels: panels.filter(p => p.status === 'error').length,
            layout: this.layout
        };
    }

    /**
     * Escape HTML special characters
     * @param {string} text - Text to escape
     * @returns {string}
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.clearAllPanels();
        if (this.tabsBar && this.tabsBar.parentNode) {
            this.tabsBar.parentNode.removeChild(this.tabsBar);
        }
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AppManager;
} else if (typeof window !== 'undefined') {
    window.AppManager = AppManager;
}
