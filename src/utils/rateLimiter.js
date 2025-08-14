/**
 * Rate Limiter for API calls and resource protection
 * Implements token bucket and sliding window algorithms
 */
class RateLimiter {
    constructor(options = {}) {
        this.options = {
            windowMs: options.windowMs || 60000, // 1 minute
            maxRequests: options.maxRequests || 100,
            algorithm: options.algorithm || 'sliding_window', // 'token_bucket', 'sliding_window', 'fixed_window'
            keyGenerator: options.keyGenerator || this.defaultKeyGenerator,
            onLimitReached: options.onLimitReached || this.defaultLimitHandler,
            skipSuccessfulRequests: options.skipSuccessfulRequests || false,
            skipFailedRequests: options.skipFailedRequests || false,
            ...options
        };
        
        this.requests = new Map(); // Store request history per key
        this.buckets = new Map(); // For token bucket algorithm
        
        // Start cleanup timer
        setInterval(() => {
            this.cleanup();
        }, this.options.windowMs);
    }

    /**
     * Check if request should be allowed
     */
    async checkLimit(key = null, options = {}) {
        const requestKey = key || this.options.keyGenerator();
        const now = Date.now();
        
        switch (this.options.algorithm) {
            case 'token_bucket':
                return this.tokenBucket(requestKey, now, options);
            case 'sliding_window':
                return this.slidingWindow(requestKey, now, options);
            case 'fixed_window':
                return this.fixedWindow(requestKey, now, options);
            default:
                return this.slidingWindow(requestKey, now, options);
        }
    }

    /**
     * Token bucket algorithm
     */
    tokenBucket(key, now, options = {}) {
        const capacity = options.maxRequests || this.options.maxRequests;
        const refillRate = options.refillRate || capacity / (this.options.windowMs / 1000); // tokens per second
        
        if (!this.buckets.has(key)) {
            this.buckets.set(key, {
                tokens: capacity,
                lastRefill: now,
                requests: 0,
                firstRequest: now
            });
        }

        const bucket = this.buckets.get(key);
        
        // Refill tokens based on time elapsed
        const timePassed = (now - bucket.lastRefill) / 1000; // seconds
        const tokensToAdd = Math.floor(timePassed * refillRate);
        
        if (tokensToAdd > 0) {
            bucket.tokens = Math.min(capacity, bucket.tokens + tokensToAdd);
            bucket.lastRefill = now;
        }

        // Check if request can be served
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            bucket.requests += 1;
            
            return {
                allowed: true,
                remaining: bucket.tokens,
                resetTime: null,
                retryAfter: null
            };
        }

        // Calculate retry after
        const tokensNeeded = 1 - bucket.tokens;
        const retryAfter = Math.ceil(tokensNeeded / refillRate * 1000); // ms

        this.options.onLimitReached(key, bucket);

        return {
            allowed: false,
            remaining: 0,
            resetTime: now + retryAfter,
            retryAfter: retryAfter
        };
    }

    /**
     * Sliding window algorithm
     */
    slidingWindow(key, now, options = {}) {
        const windowMs = options.windowMs || this.options.windowMs;
        const maxRequests = options.maxRequests || this.options.maxRequests;
        
        if (!this.requests.has(key)) {
            this.requests.set(key, []);
        }

        const requests = this.requests.get(key);
        
        // Remove old requests outside the window
        const windowStart = now - windowMs;
        while (requests.length > 0 && requests[0].timestamp < windowStart) {
            requests.shift();
        }

        // Check if we're within the limit
        if (requests.length < maxRequests) {
            requests.push({
                timestamp: now,
                id: this.generateRequestId()
            });

            return {
                allowed: true,
                remaining: maxRequests - requests.length,
                resetTime: requests.length > 0 ? requests[0].timestamp + windowMs : null,
                retryAfter: null
            };
        }

        // Calculate when the oldest request will expire
        const oldestRequest = requests[0];
        const retryAfter = oldestRequest.timestamp + windowMs - now;

        this.options.onLimitReached(key, { requests: requests.length, maxRequests });

        return {
            allowed: false,
            remaining: 0,
            resetTime: oldestRequest.timestamp + windowMs,
            retryAfter: Math.max(0, retryAfter)
        };
    }

    /**
     * Fixed window algorithm
     */
    fixedWindow(key, now, options = {}) {
        const windowMs = options.windowMs || this.options.windowMs;
        const maxRequests = options.maxRequests || this.options.maxRequests;
        
        const windowStart = Math.floor(now / windowMs) * windowMs;
        const windowKey = `${key}:${windowStart}`;
        
        if (!this.requests.has(windowKey)) {
            this.requests.set(windowKey, {
                count: 0,
                windowStart: windowStart
            });
        }

        const window = this.requests.get(windowKey);
        
        if (window.count < maxRequests) {
            window.count += 1;
            
            return {
                allowed: true,
                remaining: maxRequests - window.count,
                resetTime: windowStart + windowMs,
                retryAfter: null
            };
        }

        const retryAfter = windowStart + windowMs - now;

        this.options.onLimitReached(key, window);

        return {
            allowed: false,
            remaining: 0,
            resetTime: windowStart + windowMs,
            retryAfter: Math.max(0, retryAfter)
        };
    }

    /**
     * Middleware function for wrapping API calls
     */
    middleware(options = {}) {
        return async (req, next) => {
            const key = options.keyGenerator ? 
                options.keyGenerator(req) : 
                this.options.keyGenerator(req);
            
            const result = await this.checkLimit(key, options);
            
            if (!result.allowed) {
                throw new Error(`Rate limit exceeded. Retry after ${result.retryAfter}ms`);
            }

            // Add rate limit info to request
            req.rateLimit = result;
            
            try {
                const response = await next();
                
                // Track successful requests if needed
                if (!this.options.skipSuccessfulRequests) {
                    this.trackRequest(key, true, response);
                }
                
                return response;
            } catch (error) {
                // Track failed requests if needed
                if (!this.options.skipFailedRequests) {
                    this.trackRequest(key, false, error);
                }
                
                throw error;
            }
        };
    }

    /**
     * Track request for analytics
     */
    trackRequest(key, success, data) {
        // Implementation for tracking requests
        // Could be used for analytics or adaptive rate limiting
    }

    /**
     * Get current status for a key
     */
    getStatus(key) {
        const now = Date.now();
        
        switch (this.options.algorithm) {
            case 'token_bucket':
                const bucket = this.buckets.get(key);
                if (!bucket) return { requests: 0, remaining: this.options.maxRequests };
                
                return {
                    requests: bucket.requests,
                    remaining: bucket.tokens,
                    resetTime: null,
                    algorithm: 'token_bucket'
                };
                
            case 'sliding_window':
                const requests = this.requests.get(key) || [];
                const windowStart = now - this.options.windowMs;
                const activeRequests = requests.filter(r => r.timestamp >= windowStart);
                
                return {
                    requests: activeRequests.length,
                    remaining: this.options.maxRequests - activeRequests.length,
                    resetTime: activeRequests.length > 0 ? activeRequests[0].timestamp + this.options.windowMs : null,
                    algorithm: 'sliding_window'
                };
                
            case 'fixed_window':
                const windowStart2 = Math.floor(now / this.options.windowMs) * this.options.windowMs;
                const windowKey = `${key}:${windowStart2}`;
                const window = this.requests.get(windowKey);
                
                return {
                    requests: window ? window.count : 0,
                    remaining: this.options.maxRequests - (window ? window.count : 0),
                    resetTime: windowStart2 + this.options.windowMs,
                    algorithm: 'fixed_window'
                };
                
            default:
                return { requests: 0, remaining: this.options.maxRequests };
        }
    }

    /**
     * Reset rate limit for a specific key
     */
    reset(key) {
        this.requests.delete(key);
        this.buckets.delete(key);
        
        // Clean up all related keys for fixed window
        if (this.options.algorithm === 'fixed_window') {
            for (const [k] of this.requests) {
                if (k.startsWith(`${key}:`)) {
                    this.requests.delete(k);
                }
            }
        }
    }

    /**
     * Reset all rate limits
     */
    resetAll() {
        this.requests.clear();
        this.buckets.clear();
    }

    /**
     * Get statistics for all keys
     */
    getStats() {
        const stats = {
            totalKeys: 0,
            totalRequests: 0,
            activeWindows: 0,
            algorithm: this.options.algorithm
        };

        switch (this.options.algorithm) {
            case 'token_bucket':
                stats.totalKeys = this.buckets.size;
                for (const [key, bucket] of this.buckets) {
                    stats.totalRequests += bucket.requests;
                }
                break;
                
            case 'sliding_window':
                stats.totalKeys = this.requests.size;
                for (const [key, requests] of this.requests) {
                    stats.totalRequests += requests.length;
                    if (requests.length > 0) stats.activeWindows++;
                }
                break;
                
            case 'fixed_window':
                stats.activeWindows = this.requests.size;
                for (const [key, window] of this.requests) {
                    stats.totalRequests += window.count;
                }
                break;
        }

        return stats;
    }

    /**
     * Cleanup expired entries
     */
    cleanup() {
        const now = Date.now();
        const windowMs = this.options.windowMs;

        switch (this.options.algorithm) {
            case 'token_bucket':
                // Remove inactive buckets
                for (const [key, bucket] of this.buckets) {
                    if (now - bucket.lastRefill > windowMs * 2) {
                        this.buckets.delete(key);
                    }
                }
                break;
                
            case 'sliding_window':
                // Clean up old requests
                for (const [key, requests] of this.requests) {
                    const windowStart = now - windowMs;
                    const activeRequests = requests.filter(r => r.timestamp >= windowStart);
                    
                    if (activeRequests.length === 0) {
                        this.requests.delete(key);
                    } else if (activeRequests.length < requests.length) {
                        this.requests.set(key, activeRequests);
                    }
                }
                break;
                
            case 'fixed_window':
                // Remove expired windows
                for (const [key, window] of this.requests) {
                    if (now >= window.windowStart + windowMs) {
                        this.requests.delete(key);
                    }
                }
                break;
        }
    }

    /**
     * Default key generator
     */
    defaultKeyGenerator(req) {
        if (req && req.ip) return req.ip;
        if (req && req.userId) return `user:${req.userId}`;
        return 'default';
    }

    /**
     * Default limit reached handler
     */
    defaultLimitHandler(key, info) {
        console.warn(`Rate limit reached for key: ${key}`, info);
    }

    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Create a rate-limited version of a function
     */
    limit(fn, options = {}) {
        const limiter = this;
        
        return async function rateLimitedFunction(...args) {
            const key = options.keyGenerator ? 
                options.keyGenerator(...args) : 
                limiter.options.keyGenerator({ args });
            
            const result = await limiter.checkLimit(key, options);
            
            if (!result.allowed) {
                const error = new Error(`Rate limit exceeded. Try again in ${result.retryAfter}ms`);
                error.retryAfter = result.retryAfter;
                error.resetTime = result.resetTime;
                error.remaining = result.remaining;
                throw error;
            }

            return fn.apply(this, args);
        };
    }
}

// Predefined rate limiter configurations
const RateLimitConfigs = {
    // Conservative limits for external APIs
    API_CALLS: {
        windowMs: 60000, // 1 minute
        maxRequests: 60, // 1 per second
        algorithm: 'sliding_window'
    },
    
    // Generous limits for UI interactions
    USER_ACTIONS: {
        windowMs: 60000, // 1 minute  
        maxRequests: 300, // 5 per second
        algorithm: 'sliding_window'
    },
    
    // Strict limits for expensive operations
    HEAVY_OPERATIONS: {
        windowMs: 300000, // 5 minutes
        maxRequests: 10, // 2 per minute
        algorithm: 'token_bucket',
        refillRate: 2 / 60 // 2 tokens per minute
    },
    
    // For database operations
    DATABASE_QUERIES: {
        windowMs: 60000, // 1 minute
        maxRequests: 100,
        algorithm: 'sliding_window'
    }
};

module.exports = { RateLimiter, RateLimitConfigs };