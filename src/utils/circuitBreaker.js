const logger = require('./logger');

/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by temporarily blocking requests to failing services
 */
class CircuitBreaker {
    constructor(options = {}) {
        this.options = {
            failureThreshold: options.failureThreshold || 5,        // Failures before opening
            successThreshold: options.successThreshold || 2,        // Successes before closing
            timeout: options.timeout || 60000,                      // Timeout for requests (ms)
            resetTimeout: options.resetTimeout || 30000,           // Time before attempting reset (ms)
            monitoringPeriod: options.monitoringPeriod || 120000,  // Period for monitoring (ms)
            name: options.name || 'default'
        };

        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failures = 0;
        this.successes = 0;
        this.nextAttempt = Date.now();
        this.requests = [];
        this.lastFailureTime = null;
        this.lastSuccessTime = null;
        this.stateChangeCallbacks = [];
    }

    /**
     * Execute a function with circuit breaker protection
     */
    async execute(fn, fallback = null) {
        // Check if circuit is open
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                logger.warn('Circuit breaker is OPEN', {
                    name: this.options.name,
                    nextAttempt: new Date(this.nextAttempt).toISOString()
                });
                
                if (fallback) {
                    return await fallback();
                }
                
                throw new Error(`Circuit breaker is OPEN for ${this.options.name}`);
            }
            
            // Try to recover
            this.state = 'HALF_OPEN';
            logger.info('Circuit breaker attempting recovery', {
                name: this.options.name,
                state: 'HALF_OPEN'
            });
        }

        try {
            // Set timeout for the operation
            const result = await this.executeWithTimeout(fn);
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            
            // If we have a fallback, use it
            if (fallback) {
                logger.info('Using fallback due to circuit breaker failure', {
                    name: this.options.name,
                    error: error.message
                });
                return await fallback();
            }
            
            throw error;
        }
    }

    /**
     * Execute function with timeout
     */
    async executeWithTimeout(fn) {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Operation timeout after ${this.options.timeout}ms`));
            }, this.options.timeout);

            try {
                const result = await fn();
                clearTimeout(timer);
                resolve(result);
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    /**
     * Handle successful execution
     */
    onSuccess() {
        this.failures = 0;
        this.lastSuccessTime = Date.now();
        
        if (this.state === 'HALF_OPEN') {
            this.successes++;
            
            if (this.successes >= this.options.successThreshold) {
                this.close();
            }
        }
        
        this.recordRequest(true);
    }

    /**
     * Handle failed execution
     */
    onFailure() {
        this.failures++;
        this.successes = 0;
        this.lastFailureTime = Date.now();
        
        if (this.state === 'HALF_OPEN') {
            this.open();
        } else if (this.failures >= this.options.failureThreshold) {
            this.open();
        }
        
        this.recordRequest(false);
    }

    /**
     * Open the circuit breaker
     */
    open() {
        this.state = 'OPEN';
        this.nextAttempt = Date.now() + this.options.resetTimeout;
        
        logger.error('Circuit breaker OPENED', {
            name: this.options.name,
            failures: this.failures,
            nextAttempt: new Date(this.nextAttempt).toISOString()
        });
        
        this.notifyStateChange('OPEN');
    }

    /**
     * Close the circuit breaker
     */
    close() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        
        logger.info('Circuit breaker CLOSED', {
            name: this.options.name
        });
        
        this.notifyStateChange('CLOSED');
    }

    /**
     * Record request for monitoring
     */
    recordRequest(success) {
        const now = Date.now();
        this.requests.push({ timestamp: now, success });
        
        // Remove old requests outside monitoring period
        const cutoff = now - this.options.monitoringPeriod;
        this.requests = this.requests.filter(req => req.timestamp > cutoff);
    }

    /**
     * Get circuit breaker statistics
     */
    getStats() {
        const now = Date.now();
        const recentRequests = this.requests.filter(
            req => req.timestamp > now - this.options.monitoringPeriod
        );
        
        const totalRequests = recentRequests.length;
        const successfulRequests = recentRequests.filter(req => req.success).length;
        const failedRequests = totalRequests - successfulRequests;
        const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;
        
        return {
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            totalRequests,
            successfulRequests,
            failedRequests,
            successRate: successRate.toFixed(2) + '%',
            lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
            lastSuccessTime: this.lastSuccessTime ? new Date(this.lastSuccessTime).toISOString() : null,
            nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null
        };
    }

    /**
     * Register callback for state changes
     */
    onStateChange(callback) {
        this.stateChangeCallbacks.push(callback);
    }

    /**
     * Notify listeners of state change
     */
    notifyStateChange(newState) {
        this.stateChangeCallbacks.forEach(callback => {
            try {
                callback(newState, this.options.name);
            } catch (error) {
                logger.error('Circuit breaker callback error', error);
            }
        });
    }

    /**
     * Reset circuit breaker
     */
    reset() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.requests = [];
        this.lastFailureTime = null;
        this.lastSuccessTime = null;
        
        logger.info('Circuit breaker reset', { name: this.options.name });
    }

    /**
     * Check if circuit breaker is healthy
     */
    isHealthy() {
        return this.state === 'CLOSED';
    }

    /**
     * Get current state
     */
    getState() {
        return this.state;
    }
}

/**
 * Circuit Breaker Manager for managing multiple circuit breakers
 */
class CircuitBreakerManager {
    constructor() {
        this.breakers = new Map();
    }

    /**
     * Get or create a circuit breaker
     */
    getBreaker(name, options = {}) {
        if (!this.breakers.has(name)) {
            this.breakers.set(name, new CircuitBreaker({ ...options, name }));
        }
        return this.breakers.get(name);
    }

    /**
     * Execute with circuit breaker
     */
    async execute(name, fn, fallback = null, options = {}) {
        const breaker = this.getBreaker(name, options);
        return await breaker.execute(fn, fallback);
    }

    /**
     * Get all circuit breaker stats
     */
    getAllStats() {
        const stats = {};
        for (const [name, breaker] of this.breakers.entries()) {
            stats[name] = breaker.getStats();
        }
        return stats;
    }

    /**
     * Reset a specific circuit breaker
     */
    reset(name) {
        const breaker = this.breakers.get(name);
        if (breaker) {
            breaker.reset();
        }
    }

    /**
     * Reset all circuit breakers
     */
    resetAll() {
        for (const breaker of this.breakers.values()) {
            breaker.reset();
        }
    }

    /**
     * Check overall health
     */
    isHealthy() {
        for (const breaker of this.breakers.values()) {
            if (!breaker.isHealthy()) {
                return false;
            }
        }
        return true;
    }
}

// Export singleton instance
module.exports = new CircuitBreakerManager();