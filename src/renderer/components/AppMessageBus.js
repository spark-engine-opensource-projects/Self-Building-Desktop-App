/**
 * AppMessageBus - Pub/sub messaging system for inter-app communication
 * Enables decoupled communication between multiple running apps
 */

class AppMessageBus {
    constructor() {
        this.listeners = new Map();
        this.messageHistory = [];
        this.maxHistorySize = 100;
        this.debug = false;
    }

    /**
     * Subscribe to a channel
     * @param {string} channel - Channel name
     * @param {Function} callback - Callback function
     * @returns {Function} - Unsubscribe function
     */
    subscribe(channel, callback) {
        if (!this.listeners.has(channel)) {
            this.listeners.set(channel, new Set());
        }

        this.listeners.get(channel).add(callback);

        if (this.debug) {
            console.log(`[AppMessageBus] Subscribed to channel: ${channel}`);
        }

        // Return unsubscribe function
        return () => {
            this.unsubscribe(channel, callback);
        };
    }

    /**
     * Unsubscribe from a channel
     * @param {string} channel - Channel name
     * @param {Function} callback - Callback function to remove
     */
    unsubscribe(channel, callback) {
        const channelListeners = this.listeners.get(channel);
        if (channelListeners) {
            channelListeners.delete(callback);

            // Clean up empty channels
            if (channelListeners.size === 0) {
                this.listeners.delete(channel);
            }
        }
    }

    /**
     * Publish message to a channel
     * @param {string} channel - Channel name
     * @param {*} data - Message data
     * @param {Object} options - Options (sourceAppId, etc.)
     */
    publish(channel, data, options = {}) {
        const message = {
            channel,
            data,
            timestamp: Date.now(),
            sourceAppId: options.sourceAppId || null,
            id: this.generateMessageId()
        };

        // Store in history
        this.addToHistory(message);

        // Notify listeners
        const channelListeners = this.listeners.get(channel);
        if (channelListeners) {
            channelListeners.forEach(callback => {
                try {
                    callback(message);
                } catch (error) {
                    console.error(`[AppMessageBus] Error in listener for channel ${channel}:`, error);
                }
            });
        }

        // Also notify wildcard listeners
        const wildcardListeners = this.listeners.get('*');
        if (wildcardListeners) {
            wildcardListeners.forEach(callback => {
                try {
                    callback(message);
                } catch (error) {
                    console.error('[AppMessageBus] Error in wildcard listener:', error);
                }
            });
        }

        if (this.debug) {
            console.log(`[AppMessageBus] Published to ${channel}:`, data);
        }
    }

    /**
     * Emit an event (alias for publish)
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        this.publish(event, data);
    }

    /**
     * Listen for an event (alias for subscribe)
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     * @returns {Function} - Unsubscribe function
     */
    on(event, callback) {
        return this.subscribe(event, callback);
    }

    /**
     * Listen for an event once
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    once(event, callback) {
        const unsubscribe = this.subscribe(event, (message) => {
            unsubscribe();
            callback(message);
        });
    }

    /**
     * Request/response pattern - send request and wait for response
     * @param {string} channel - Channel name
     * @param {*} data - Request data
     * @param {number} timeout - Timeout in ms (default 5000)
     * @returns {Promise<*>} - Response data
     */
    request(channel, data, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const requestId = this.generateMessageId();
            const responseChannel = `${channel}:response:${requestId}`;

            // Set up response listener
            const timer = setTimeout(() => {
                this.unsubscribe(responseChannel, responseHandler);
                reject(new Error(`Request timeout for channel: ${channel}`));
            }, timeout);

            const responseHandler = (message) => {
                clearTimeout(timer);
                this.unsubscribe(responseChannel, responseHandler);
                resolve(message.data);
            };

            this.subscribe(responseChannel, responseHandler);

            // Send request
            this.publish(channel, {
                ...data,
                __requestId: requestId,
                __responseChannel: responseChannel
            });
        });
    }

    /**
     * Reply to a request
     * @param {Object} requestMessage - Original request message
     * @param {*} responseData - Response data
     */
    reply(requestMessage, responseData) {
        if (requestMessage.data?.__responseChannel) {
            this.publish(requestMessage.data.__responseChannel, responseData);
        }
    }

    /**
     * Create a channel group for related operations
     * @param {string} prefix - Channel prefix
     * @returns {Object} - Channel group helper
     */
    createGroup(prefix) {
        return {
            subscribe: (channel, callback) => this.subscribe(`${prefix}:${channel}`, callback),
            publish: (channel, data, options) => this.publish(`${prefix}:${channel}`, data, options),
            emit: (event, data) => this.emit(`${prefix}:${event}`, data),
            on: (event, callback) => this.on(`${prefix}:${event}`, callback)
        };
    }

    /**
     * Add message to history
     * @param {Object} message - Message to store
     */
    addToHistory(message) {
        this.messageHistory.push(message);

        // Trim history if needed
        if (this.messageHistory.length > this.maxHistorySize) {
            this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Get message history for a channel
     * @param {string} channel - Channel name (optional, all if not provided)
     * @param {number} limit - Maximum messages to return
     * @returns {Object[]}
     */
    getHistory(channel = null, limit = 50) {
        let history = this.messageHistory;

        if (channel) {
            history = history.filter(m => m.channel === channel);
        }

        return history.slice(-limit);
    }

    /**
     * Clear message history
     * @param {string} channel - Channel name (optional, all if not provided)
     */
    clearHistory(channel = null) {
        if (channel) {
            this.messageHistory = this.messageHistory.filter(m => m.channel !== channel);
        } else {
            this.messageHistory = [];
        }
    }

    /**
     * Generate unique message ID
     * @returns {string}
     */
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get all active channels
     * @returns {string[]}
     */
    getChannels() {
        return Array.from(this.listeners.keys());
    }

    /**
     * Get listener count for a channel
     * @param {string} channel - Channel name
     * @returns {number}
     */
    getListenerCount(channel) {
        return this.listeners.get(channel)?.size || 0;
    }

    /**
     * Check if channel has listeners
     * @param {string} channel - Channel name
     * @returns {boolean}
     */
    hasListeners(channel) {
        return this.getListenerCount(channel) > 0;
    }

    /**
     * Enable debug logging
     * @param {boolean} enabled
     */
    setDebug(enabled) {
        this.debug = enabled;
    }

    /**
     * Clear all listeners and history
     */
    reset() {
        this.listeners.clear();
        this.messageHistory = [];
    }

    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        let totalListeners = 0;
        this.listeners.forEach(set => {
            totalListeners += set.size;
        });

        return {
            channels: this.listeners.size,
            totalListeners,
            historySize: this.messageHistory.length
        };
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AppMessageBus;
} else if (typeof window !== 'undefined') {
    window.AppMessageBus = AppMessageBus;
}
