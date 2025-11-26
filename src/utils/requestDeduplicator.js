/**
 * Request Deduplication Utility
 * Prevents duplicate concurrent requests for the same resource/operation
 * @module utils/requestDeduplicator
 */

const crypto = require('crypto');
const logger = require('./logger');

class RequestDeduplicator {
    constructor(options = {}) {
        // Map of request hash -> Promise for pending requests
        this.pendingRequests = new Map();

        // Track request history for debugging
        this.requestHistory = [];
        this.maxHistorySize = options.maxHistorySize || 100;

        // Default TTL for stale request cleanup (10 minutes)
        this.staleTTL = options.staleTTL || 10 * 60 * 1000;

        // Stats
        this.stats = {
            deduplicated: 0,
            executed: 0,
            errors: 0
        };

        // Cleanup stale requests periodically
        this.cleanupInterval = setInterval(() => this.cleanup(), this.staleTTL);
    }

    /**
     * Generate a hash for the request to identify duplicates
     * @param {string} type - Request type identifier
     * @param {any} params - Request parameters
     * @returns {string} Request hash
     */
    generateHash(type, params) {
        const content = JSON.stringify({ type, params });
        return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    }

    /**
     * Execute a request with deduplication
     * If an identical request is already in progress, returns the existing promise
     * @param {string} type - Request type identifier
     * @param {any} params - Request parameters
     * @param {Function} executor - Async function to execute the request
     * @returns {Promise<any>} Result of the request
     */
    async dedupe(type, params, executor) {
        const hash = this.generateHash(type, params);

        // Check if request is already pending
        if (this.pendingRequests.has(hash)) {
            this.stats.deduplicated++;
            logger.debug('Request deduplicated', { type, hash });
            return this.pendingRequests.get(hash);
        }

        // Create new request promise
        const requestPromise = this._executeRequest(type, params, hash, executor);
        this.pendingRequests.set(hash, requestPromise);

        try {
            const result = await requestPromise;
            return result;
        } finally {
            // Clean up after request completes
            this.pendingRequests.delete(hash);
        }
    }

    /**
     * Execute request and track history
     * @private
     */
    async _executeRequest(type, params, hash, executor) {
        const startTime = Date.now();
        this.stats.executed++;

        try {
            const result = await executor();

            this._addToHistory({
                type,
                hash,
                startTime,
                duration: Date.now() - startTime,
                success: true
            });

            return result;
        } catch (error) {
            this.stats.errors++;

            this._addToHistory({
                type,
                hash,
                startTime,
                duration: Date.now() - startTime,
                success: false,
                error: error.message
            });

            throw error;
        }
    }

    /**
     * Add entry to history with size limit
     * @private
     */
    _addToHistory(entry) {
        this.requestHistory.push({
            ...entry,
            timestamp: Date.now()
        });

        // Trim history if needed
        if (this.requestHistory.length > this.maxHistorySize) {
            this.requestHistory.shift();
        }
    }

    /**
     * Check if a request with given parameters is pending
     * @param {string} type - Request type identifier
     * @param {any} params - Request parameters
     * @returns {boolean}
     */
    isPending(type, params) {
        const hash = this.generateHash(type, params);
        return this.pendingRequests.has(hash);
    }

    /**
     * Get number of pending requests
     * @returns {number}
     */
    getPendingCount() {
        return this.pendingRequests.size;
    }

    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            ...this.stats,
            pendingCount: this.pendingRequests.size,
            historySize: this.requestHistory.length,
            deduplicationRate: this.stats.executed > 0
                ? ((this.stats.deduplicated / (this.stats.executed + this.stats.deduplicated)) * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    /**
     * Get recent request history
     * @param {number} limit - Number of entries to return
     * @returns {Array}
     */
    getHistory(limit = 10) {
        return this.requestHistory.slice(-limit);
    }

    /**
     * Cleanup stale entries and reset state
     */
    cleanup() {
        // Clear any pending requests that might be stuck
        const now = Date.now();
        const staleThreshold = now - this.staleTTL;

        // Clean up old history entries
        this.requestHistory = this.requestHistory.filter(
            entry => entry.timestamp > staleThreshold
        );

        logger.debug('Request deduplicator cleanup complete', {
            pendingCount: this.pendingRequests.size,
            historySize: this.requestHistory.length
        });
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            deduplicated: 0,
            executed: 0,
            errors: 0
        };
    }

    /**
     * Destroy the deduplicator and cleanup resources
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.pendingRequests.clear();
        this.requestHistory = [];
    }
}

// Export singleton instance and class
const instance = new RequestDeduplicator();
module.exports = instance;
module.exports.RequestDeduplicator = RequestDeduplicator;
module.exports.getInstance = () => instance;
