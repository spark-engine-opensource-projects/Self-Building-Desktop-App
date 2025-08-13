const logger = require('./logger');
const circuitBreaker = require('./circuitBreaker');

/**
 * Request/Response Interceptor for API calls
 * Provides centralized error handling, logging, and monitoring
 */
class RequestInterceptor {
    constructor() {
        this.interceptors = {
            request: [],
            response: [],
            error: []
        };
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            lastRequestTime: null
        };
    }

    /**
     * Add request interceptor
     */
    addRequestInterceptor(interceptor) {
        if (typeof interceptor !== 'function') {
            throw new Error('Request interceptor must be a function');
        }
        this.interceptors.request.push(interceptor);
        return this.interceptors.request.length - 1;
    }

    /**
     * Add response interceptor
     */
    addResponseInterceptor(interceptor) {
        if (typeof interceptor !== 'function') {
            throw new Error('Response interceptor must be a function');
        }
        this.interceptors.response.push(interceptor);
        return this.interceptors.response.length - 1;
    }

    /**
     * Add error interceptor
     */
    addErrorInterceptor(interceptor) {
        if (typeof interceptor !== 'function') {
            throw new Error('Error interceptor must be a function');
        }
        this.interceptors.error.push(interceptor);
        return this.interceptors.error.length - 1;
    }

    /**
     * Remove interceptor by index
     */
    removeInterceptor(type, index) {
        if (this.interceptors[type] && this.interceptors[type][index]) {
            this.interceptors[type].splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Execute request interceptors
     */
    async executeRequestInterceptors(request) {
        let modifiedRequest = { ...request };

        for (const interceptor of this.interceptors.request) {
            try {
                const result = await interceptor(modifiedRequest);
                if (result) {
                    modifiedRequest = { ...modifiedRequest, ...result };
                }
            } catch (error) {
                logger.error('Request interceptor error', error, {
                    interceptor: interceptor.name || 'anonymous'
                });
            }
        }

        return modifiedRequest;
    }

    /**
     * Execute response interceptors
     */
    async executeResponseInterceptors(response, request) {
        let modifiedResponse = { ...response };

        for (const interceptor of this.interceptors.response) {
            try {
                const result = await interceptor(modifiedResponse, request);
                if (result) {
                    modifiedResponse = { ...modifiedResponse, ...result };
                }
            } catch (error) {
                logger.error('Response interceptor error', error, {
                    interceptor: interceptor.name || 'anonymous'
                });
            }
        }

        return modifiedResponse;
    }

    /**
     * Execute error interceptors
     */
    async executeErrorInterceptors(error, request) {
        let modifiedError = error;

        for (const interceptor of this.interceptors.error) {
            try {
                const result = await interceptor(modifiedError, request);
                if (result) {
                    modifiedError = result;
                }
            } catch (interceptorError) {
                logger.error('Error interceptor error', interceptorError, {
                    interceptor: interceptor.name || 'anonymous',
                    originalError: error.message
                });
            }
        }

        return modifiedError;
    }

    /**
     * Intercept and process request
     */
    async intercept(requestFn, options = {}) {
        const {
            service = 'default',
            timeout = 30000,
            retries = 0,
            metadata = {}
        } = options;

        const startTime = Date.now();
        const correlationId = logger.setCorrelationId();

        // Initial request data
        let request = {
            service,
            timeout,
            retries,
            metadata,
            correlationId,
            timestamp: startTime
        };

        try {
            // Execute request interceptors
            request = await this.executeRequestInterceptors(request);

            logger.info('Request initiated', {
                service: request.service,
                correlationId,
                metadata: request.metadata
            });

            // Execute the actual request with circuit breaker
            const response = await circuitBreaker.execute(
                service,
                async () => {
                    return await this.executeWithTimeout(requestFn, request.timeout);
                },
                options.fallback
            );

            const duration = Date.now() - startTime;
            this.updateMetrics(true, duration);

            // Execute response interceptors
            const finalResponse = await this.executeResponseInterceptors(response, request);

            logger.info('Request completed successfully', {
                service: request.service,
                correlationId,
                duration,
                responseSize: JSON.stringify(finalResponse).length
            });

            return finalResponse;

        } catch (error) {
            const duration = Date.now() - startTime;
            this.updateMetrics(false, duration);

            // Execute error interceptors
            const finalError = await this.executeErrorInterceptors(error, request);

            logger.error('Request failed', finalError, {
                service: request.service,
                correlationId,
                duration,
                metadata: request.metadata
            });

            throw finalError;
        }
    }

    /**
     * Execute function with timeout
     */
    async executeWithTimeout(fn, timeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Request timeout after ${timeout}ms`));
            }, timeout);

            Promise.resolve(fn())
                .then(result => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    /**
     * Update request metrics
     */
    updateMetrics(success, duration) {
        this.metrics.totalRequests++;
        this.metrics.lastRequestTime = new Date().toISOString();

        if (success) {
            this.metrics.successfulRequests++;
        } else {
            this.metrics.failedRequests++;
        }

        // Update average response time
        const totalDuration = this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + duration;
        this.metrics.averageResponseTime = Math.round(totalDuration / this.metrics.totalRequests);
    }

    /**
     * Get request metrics
     */
    getMetrics() {
        const successRate = this.metrics.totalRequests > 0 
            ? (this.metrics.successfulRequests / this.metrics.totalRequests) * 100 
            : 0;

        return {
            ...this.metrics,
            successRate: parseFloat(successRate.toFixed(2))
        };
    }

    /**
     * Clear metrics
     */
    clearMetrics() {
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            lastRequestTime: null
        };
    }

    /**
     * Create a pre-configured interceptor for a specific service
     */
    createServiceInterceptor(serviceName, defaultOptions = {}) {
        return async (requestFn, options = {}) => {
            const mergedOptions = {
                service: serviceName,
                ...defaultOptions,
                ...options
            };
            return await this.intercept(requestFn, mergedOptions);
        };
    }

    /**
     * Setup default interceptors
     */
    setupDefaultInterceptors() {
        // Request logging interceptor
        this.addRequestInterceptor(async (request) => {
            logger.debug('Outgoing request', {
                service: request.service,
                correlationId: request.correlationId,
                timestamp: request.timestamp
            });
            return request;
        });

        // Response logging interceptor
        this.addResponseInterceptor(async (response, request) => {
            logger.debug('Incoming response', {
                service: request.service,
                correlationId: request.correlationId,
                success: response.success !== false
            });
            return response;
        });

        // Error enhancement interceptor
        this.addErrorInterceptor(async (error, request) => {
            // Add context to errors
            const enhancedError = new Error(error.message);
            enhancedError.service = request.service;
            enhancedError.correlationId = request.correlationId;
            enhancedError.timestamp = request.timestamp;
            enhancedError.originalError = error;
            
            // Add stack trace if missing
            if (!enhancedError.stack) {
                enhancedError.stack = error.stack || new Error().stack;
            }

            return enhancedError;
        });
    }

    /**
     * Add retry interceptor
     */
    addRetryInterceptor(maxRetries = 3, backoffMs = 1000) {
        this.addErrorInterceptor(async (error, request) => {
            if (request.retries > 0 && this.shouldRetry(error)) {
                logger.info('Retrying request', {
                    service: request.service,
                    correlationId: request.correlationId,
                    attempt: maxRetries - request.retries + 2,
                    maxRetries: maxRetries + 1
                });

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, backoffMs));

                // Decrement retries and throw to trigger retry
                request.retries--;
                throw error;
            }

            return error;
        });
    }

    /**
     * Determine if error should trigger retry
     */
    shouldRetry(error) {
        const retryableErrors = [
            'ECONNRESET',
            'ENOTFOUND',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'timeout'
        ];

        const errorString = error.message?.toLowerCase() || '';
        return retryableErrors.some(pattern => errorString.includes(pattern));
    }
}

// Export singleton instance with default interceptors
const requestInterceptor = new RequestInterceptor();
requestInterceptor.setupDefaultInterceptors();

module.exports = requestInterceptor;