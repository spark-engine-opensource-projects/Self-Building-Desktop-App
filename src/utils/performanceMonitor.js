const logger = require('./logger');
const { performance, PerformanceObserver } = require('perf_hooks');

/**
 * Performance Monitoring and Metrics Collection
 * Tracks application performance and resource usage
 */
class PerformanceMonitor {
    constructor() {
        this.metrics = {
            requests: new Map(),
            operations: new Map(),
            memory: [],
            cpu: [],
            eventLoop: []
        };
        
        this.observers = [];
        this.isMonitoring = false;
        this.startTime = Date.now();
        
        // Configuration
        this.config = {
            maxMetricHistory: 1000,
            collectInterval: 5000, // 5 seconds
            memoryThreshold: 500 * 1024 * 1024, // 500MB
            cpuThreshold: 80, // 80%
            eventLoopThreshold: 100 // 100ms
        };
    }

    /**
     * Start performance monitoring
     */
    start() {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        this.startTime = Date.now();

        // Setup performance observers
        this.setupObservers();
        
        // Start periodic collection
        this.startPeriodicCollection();
        
        logger.info('Performance monitoring started');
    }

    /**
     * Stop performance monitoring
     */
    stop() {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        
        // Stop observers
        this.observers.forEach(observer => {
            try {
                observer.disconnect();
            } catch (error) {
                logger.warn('Failed to disconnect performance observer', error);
            }
        });
        this.observers = [];

        // Clear intervals
        if (this.collectionInterval) {
            clearInterval(this.collectionInterval);
            this.collectionInterval = null;
        }

        logger.info('Performance monitoring stopped');
    }

    /**
     * Setup performance observers
     */
    setupObservers() {
        // Clear any existing observers first
        this.cleanupObservers();
        
        try {
            // HTTP request observer
            const httpObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    this.recordHttpMetric(entry);
                });
            });
            httpObserver.observe({ entryTypes: ['http'] });
            this.observers.push(httpObserver);

            // Measure observer
            const measureObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    this.recordMeasureMetric(entry);
                });
            });
            measureObserver.observe({ entryTypes: ['measure'] });
            this.observers.push(measureObserver);

        } catch (error) {
            logger.warn('Failed to setup performance observers', error);
        }
    }
    
    /**
     * Cleanup observers
     */
    cleanupObservers() {
        this.observers.forEach(observer => {
            try {
                observer.disconnect();
            } catch (error) {
                // Silently ignore cleanup errors
            }
        });
        this.observers = [];
    }

    /**
     * Start periodic metric collection
     */
    startPeriodicCollection() {
        this.collectionInterval = setInterval(() => {
            this.collectSystemMetrics();
        }, this.config.collectInterval);
    }

    /**
     * Collect system metrics
     */
    collectSystemMetrics() {
        try {
            // Memory metrics
            const memoryUsage = process.memoryUsage();
            this.recordMemoryMetric(memoryUsage);

            // CPU metrics
            const cpuUsage = process.cpuUsage();
            this.recordCpuMetric(cpuUsage);

            // Event loop lag
            this.measureEventLoopLag();

        } catch (error) {
            logger.error('Failed to collect system metrics', error);
        }
    }

    /**
     * Record HTTP request metric
     */
    recordHttpMetric(entry) {
        const metric = {
            name: entry.name,
            duration: entry.duration,
            timestamp: entry.startTime + performance.timeOrigin,
            type: 'http'
        };

        this.addMetric('requests', entry.name, metric);
    }

    /**
     * Record custom measure metric
     */
    recordMeasureMetric(entry) {
        const metric = {
            name: entry.name,
            duration: entry.duration,
            timestamp: entry.startTime + performance.timeOrigin,
            type: 'measure'
        };

        this.addMetric('operations', entry.name, metric);
    }

    /**
     * Record memory metric
     */
    recordMemoryMetric(memoryUsage) {
        const metric = {
            timestamp: Date.now(),
            rss: memoryUsage.rss,
            heapTotal: memoryUsage.heapTotal,
            heapUsed: memoryUsage.heapUsed,
            external: memoryUsage.external,
            arrayBuffers: memoryUsage.arrayBuffers || 0
        };

        this.addToTimeSeries('memory', metric);

        // Check memory threshold
        if (memoryUsage.heapUsed > this.config.memoryThreshold) {
            logger.warn('Memory usage high', {
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
                threshold: Math.round(this.config.memoryThreshold / 1024 / 1024) + 'MB'
            });
        }
    }

    /**
     * Record CPU metric
     */
    recordCpuMetric(cpuUsage) {
        const metric = {
            timestamp: Date.now(),
            user: cpuUsage.user,
            system: cpuUsage.system
        };

        this.addToTimeSeries('cpu', metric);
    }

    /**
     * Measure event loop lag
     */
    measureEventLoopLag() {
        const start = performance.now();
        setImmediate(() => {
            const lag = performance.now() - start;
            
            const metric = {
                timestamp: Date.now(),
                lag: lag
            };

            this.addToTimeSeries('eventLoop', metric);

            if (lag > this.config.eventLoopThreshold) {
                logger.warn('Event loop lag detected', {
                    lag: Math.round(lag) + 'ms',
                    threshold: this.config.eventLoopThreshold + 'ms'
                });
            }
        });
    }

    /**
     * Add metric to collection
     */
    addMetric(collection, key, metric) {
        if (!this.metrics[collection].has(key)) {
            this.metrics[collection].set(key, []);
        }

        const metrics = this.metrics[collection].get(key);
        metrics.push(metric);

        // Limit history
        if (metrics.length > this.config.maxMetricHistory) {
            metrics.shift();
        }
        
        // Limit total number of keys in collection
        if (this.metrics[collection].size > 100) {
            // Remove oldest entries
            const keysToRemove = Array.from(this.metrics[collection].keys()).slice(0, 10);
            keysToRemove.forEach(k => this.metrics[collection].delete(k));
        }
    }

    /**
     * Add metric to time series
     */
    addToTimeSeries(series, metric) {
        this.metrics[series].push(metric);

        // Limit history
        if (this.metrics[series].length > this.config.maxMetricHistory) {
            this.metrics[series].shift();
        }
    }

    /**
     * Start measuring an operation
     */
    startMeasure(name) {
        performance.mark(`${name}-start`);
        return name;
    }

    /**
     * End measuring an operation
     */
    endMeasure(name) {
        try {
            performance.mark(`${name}-end`);
            performance.measure(name, `${name}-start`, `${name}-end`);
            
            // Clean up marks
            performance.clearMarks(`${name}-start`);
            performance.clearMarks(`${name}-end`);
            
        } catch (error) {
            logger.warn('Failed to end performance measure', error, { name });
        }
    }

    /**
     * Measure async operation
     */
    async measureAsync(name, operation) {
        const measureName = this.startMeasure(name);
        
        try {
            const result = await operation();
            this.endMeasure(measureName);
            return result;
        } catch (error) {
            this.endMeasure(measureName);
            throw error;
        }
    }

    /**
     * Get performance statistics
     */
    getStats() {
        const now = Date.now();
        const uptime = now - this.startTime;

        return {
            uptime,
            monitoring: this.isMonitoring,
            memory: this.getMemoryStats(),
            cpu: this.getCpuStats(),
            eventLoop: this.getEventLoopStats(),
            requests: this.getRequestStats(),
            operations: this.getOperationStats()
        };
    }

    /**
     * Get memory statistics
     */
    getMemoryStats() {
        if (this.metrics.memory.length === 0) {
            return null;
        }

        const recent = this.metrics.memory.slice(-10);
        const current = recent[recent.length - 1];
        
        const avgHeapUsed = recent.reduce((sum, m) => sum + m.heapUsed, 0) / recent.length;
        const maxHeapUsed = Math.max(...recent.map(m => m.heapUsed));

        return {
            current: {
                rss: Math.round(current.rss / 1024 / 1024),
                heapTotal: Math.round(current.heapTotal / 1024 / 1024),
                heapUsed: Math.round(current.heapUsed / 1024 / 1024),
                external: Math.round(current.external / 1024 / 1024)
            },
            average: {
                heapUsed: Math.round(avgHeapUsed / 1024 / 1024)
            },
            max: {
                heapUsed: Math.round(maxHeapUsed / 1024 / 1024)
            },
            samples: this.metrics.memory.length
        };
    }

    /**
     * Get CPU statistics
     */
    getCpuStats() {
        if (this.metrics.cpu.length < 2) {
            return null;
        }

        const recent = this.metrics.cpu.slice(-2);
        const [prev, current] = recent;

        const userDiff = current.user - prev.user;
        const systemDiff = current.system - prev.system;
        const timeDiff = current.timestamp - prev.timestamp;

        // Convert to percentage (rough approximation)
        const userPercent = (userDiff / (timeDiff * 1000)) * 100;
        const systemPercent = (systemDiff / (timeDiff * 1000)) * 100;

        return {
            user: Math.round(userPercent * 100) / 100,
            system: Math.round(systemPercent * 100) / 100,
            total: Math.round((userPercent + systemPercent) * 100) / 100,
            samples: this.metrics.cpu.length
        };
    }

    /**
     * Get event loop statistics
     */
    getEventLoopStats() {
        if (this.metrics.eventLoop.length === 0) {
            return null;
        }

        const recent = this.metrics.eventLoop.slice(-10);
        const lags = recent.map(m => m.lag);
        
        const avgLag = lags.reduce((sum, lag) => sum + lag, 0) / lags.length;
        const maxLag = Math.max(...lags);
        const p95Lag = this.percentile(lags, 95);

        return {
            average: Math.round(avgLag * 100) / 100,
            max: Math.round(maxLag * 100) / 100,
            p95: Math.round(p95Lag * 100) / 100,
            samples: this.metrics.eventLoop.length
        };
    }

    /**
     * Get request statistics
     */
    getRequestStats() {
        const stats = {};
        
        for (const [name, requests] of this.metrics.requests) {
            const durations = requests.map(r => r.duration);
            
            stats[name] = {
                count: requests.length,
                avgDuration: Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length),
                maxDuration: Math.round(Math.max(...durations)),
                p95Duration: Math.round(this.percentile(durations, 95))
            };
        }

        return stats;
    }

    /**
     * Get operation statistics
     */
    getOperationStats() {
        const stats = {};
        
        for (const [name, operations] of this.metrics.operations) {
            const durations = operations.map(o => o.duration);
            
            stats[name] = {
                count: operations.length,
                avgDuration: Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length),
                maxDuration: Math.round(Math.max(...durations)),
                p95Duration: Math.round(this.percentile(durations, 95))
            };
        }

        return stats;
    }

    /**
     * Calculate percentile
     */
    percentile(values, p) {
        if (values.length === 0) return 0;
        
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    /**
     * Clear all metrics
     */
    clearMetrics() {
        this.metrics = {
            requests: new Map(),
            operations: new Map(),
            memory: [],
            cpu: [],
            eventLoop: []
        };
        
        logger.info('Performance metrics cleared');
    }

    /**
     * Configure monitoring
     */
    configure(config) {
        this.config = { ...this.config, ...config };
        logger.info('Performance monitor configured', { config: this.config });
    }

    /**
     * Get health status
     */
    getHealthStatus() {
        const stats = this.getStats();
        const issues = [];

        // Check memory
        if (stats.memory && stats.memory.current.heapUsed > this.config.memoryThreshold / 1024 / 1024) {
            issues.push('high_memory_usage');
        }

        // Check event loop
        if (stats.eventLoop && stats.eventLoop.p95 > this.config.eventLoopThreshold) {
            issues.push('high_event_loop_lag');
        }

        return {
            healthy: issues.length === 0,
            issues,
            uptime: stats.uptime,
            monitoring: this.isMonitoring
        };
    }
}

// Export singleton instance
module.exports = new PerformanceMonitor();