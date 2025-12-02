/**
 * DataChangeBroadcaster - Broadcasts database changes to subscribed apps
 * Enables real-time synchronization between multiple apps sharing the same database
 */

class DataChangeBroadcaster {
    constructor(messageBus = null) {
        this.messageBus = messageBus;
        this.subscribers = new Map(); // table -> Set of callbacks
        this.globalSubscribers = new Set();
        this.changeQueue = [];
        this.isProcessing = false;
        this.batchDelay = 50; // ms to wait before broadcasting to batch rapid changes
        this.batchTimer = null;
        this.debug = false;
    }

    /**
     * Set the message bus for cross-app communication
     * @param {AppMessageBus} messageBus
     */
    setMessageBus(messageBus) {
        this.messageBus = messageBus;
    }

    /**
     * Subscribe to changes for a specific table
     * @param {string} tableName - Table to watch
     * @param {Function} callback - Callback function(change)
     * @returns {Function} - Unsubscribe function
     */
    subscribeToTable(tableName, callback) {
        if (!this.subscribers.has(tableName)) {
            this.subscribers.set(tableName, new Set());
        }

        this.subscribers.get(tableName).add(callback);

        if (this.debug) {
            console.log(`[DataChangeBroadcaster] Subscribed to table: ${tableName}`);
        }

        return () => {
            this.unsubscribeFromTable(tableName, callback);
        };
    }

    /**
     * Unsubscribe from table changes
     * @param {string} tableName - Table name
     * @param {Function} callback - Callback to remove
     */
    unsubscribeFromTable(tableName, callback) {
        const tableSubscribers = this.subscribers.get(tableName);
        if (tableSubscribers) {
            tableSubscribers.delete(callback);

            if (tableSubscribers.size === 0) {
                this.subscribers.delete(tableName);
            }
        }
    }

    /**
     * Subscribe to all data changes
     * @param {Function} callback - Callback function(change)
     * @returns {Function} - Unsubscribe function
     */
    subscribeToAll(callback) {
        this.globalSubscribers.add(callback);

        return () => {
            this.globalSubscribers.delete(callback);
        };
    }

    /**
     * Broadcast a data change
     * @param {Object} change - Change information
     *   - table: string (table name)
     *   - action: string ('insert', 'update', 'delete')
     *   - id: number (optional, record ID)
     *   - data: object (optional, changed data)
     *   - appId: string (source app ID)
     */
    broadcast(change) {
        const enrichedChange = {
            ...change,
            timestamp: Date.now(),
            id: change.id || null,
            changeId: this.generateChangeId()
        };

        // Add to queue for batching
        this.changeQueue.push(enrichedChange);

        // Process after batch delay
        if (!this.batchTimer) {
            this.batchTimer = setTimeout(() => {
                this.processQueue();
            }, this.batchDelay);
        }
    }

    /**
     * Process the change queue
     */
    processQueue() {
        if (this.isProcessing || this.changeQueue.length === 0) {
            return;
        }

        this.isProcessing = true;
        this.batchTimer = null;

        // Get all changes from queue
        const changes = [...this.changeQueue];
        this.changeQueue = [];

        // Deduplicate changes for the same record
        const deduplicatedChanges = this.deduplicateChanges(changes);

        // Notify subscribers
        for (const change of deduplicatedChanges) {
            this.notifySubscribers(change);
        }

        this.isProcessing = false;

        // Process any new changes that came in while we were processing
        if (this.changeQueue.length > 0) {
            this.batchTimer = setTimeout(() => {
                this.processQueue();
            }, this.batchDelay);
        }
    }

    /**
     * Deduplicate changes for the same record
     * Keeps only the most recent change for each table+id combination
     * @param {Object[]} changes - Array of changes
     * @returns {Object[]} - Deduplicated changes
     */
    deduplicateChanges(changes) {
        const changeMap = new Map();

        for (const change of changes) {
            const key = `${change.table}:${change.id || 'no-id'}:${change.action}`;

            // Keep the most recent change for each key
            if (!changeMap.has(key) || change.timestamp > changeMap.get(key).timestamp) {
                changeMap.set(key, change);
            }
        }

        return Array.from(changeMap.values());
    }

    /**
     * Notify all relevant subscribers of a change
     * @param {Object} change - Change information
     */
    notifySubscribers(change) {
        if (this.debug) {
            console.log(`[DataChangeBroadcaster] Broadcasting change:`, change);
        }

        // Notify table-specific subscribers
        const tableSubscribers = this.subscribers.get(change.table);
        if (tableSubscribers) {
            tableSubscribers.forEach(callback => {
                try {
                    callback(change);
                } catch (error) {
                    console.error(`[DataChangeBroadcaster] Error in table subscriber:`, error);
                }
            });
        }

        // Notify global subscribers
        this.globalSubscribers.forEach(callback => {
            try {
                callback(change);
            } catch (error) {
                console.error(`[DataChangeBroadcaster] Error in global subscriber:`, error);
            }
        });

        // Publish to message bus if available
        if (this.messageBus) {
            this.messageBus.publish('data-change', change, {
                sourceAppId: change.appId
            });

            // Also publish to table-specific channel
            this.messageBus.publish(`data-change:${change.table}`, change, {
                sourceAppId: change.appId
            });
        }
    }

    /**
     * Broadcast immediate (skip batching)
     * Use for critical changes that need immediate propagation
     * @param {Object} change - Change information
     */
    broadcastImmediate(change) {
        const enrichedChange = {
            ...change,
            timestamp: Date.now(),
            id: change.id || null,
            changeId: this.generateChangeId()
        };

        this.notifySubscribers(enrichedChange);
    }

    /**
     * Generate unique change ID
     * @returns {string}
     */
    generateChangeId() {
        return `chg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get tables with active subscribers
     * @returns {string[]}
     */
    getWatchedTables() {
        return Array.from(this.subscribers.keys());
    }

    /**
     * Check if a table has subscribers
     * @param {string} tableName - Table name
     * @returns {boolean}
     */
    hasSubscribersForTable(tableName) {
        return this.subscribers.has(tableName) && this.subscribers.get(tableName).size > 0;
    }

    /**
     * Get subscriber count
     * @param {string} tableName - Optional table name
     * @returns {number}
     */
    getSubscriberCount(tableName = null) {
        if (tableName) {
            return this.subscribers.get(tableName)?.size || 0;
        }

        let total = this.globalSubscribers.size;
        this.subscribers.forEach(set => {
            total += set.size;
        });
        return total;
    }

    /**
     * Set batch delay
     * @param {number} ms - Delay in milliseconds
     */
    setBatchDelay(ms) {
        this.batchDelay = Math.max(0, ms);
    }

    /**
     * Enable debug logging
     * @param {boolean} enabled
     */
    setDebug(enabled) {
        this.debug = enabled;
    }

    /**
     * Flush pending changes immediately
     */
    flush() {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        this.processQueue();
    }

    /**
     * Clear all subscribers
     */
    clearSubscribers() {
        this.subscribers.clear();
        this.globalSubscribers.clear();
    }

    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        let tableSubscribers = 0;
        this.subscribers.forEach(set => {
            tableSubscribers += set.size;
        });

        return {
            watchedTables: this.subscribers.size,
            tableSubscribers,
            globalSubscribers: this.globalSubscribers.size,
            pendingChanges: this.changeQueue.length,
            batchDelay: this.batchDelay
        };
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }
        this.clearSubscribers();
        this.changeQueue = [];
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataChangeBroadcaster;
} else if (typeof window !== 'undefined') {
    window.DataChangeBroadcaster = DataChangeBroadcaster;
}
