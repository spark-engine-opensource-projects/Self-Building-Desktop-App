const systemMonitor = require('../utils/systemMonitor');
const logger = require('../utils/logger');

/**
 * Performance monitoring dashboard module
 */
class PerformanceDashboard {
    constructor() {
        this.metrics = {
            system: {
                cpu: 0,
                memory: 0,
                disk: 0,
                network: 0
            },
            application: {
                codeGenerations: 0,
                codeExecutions: 0,
                averageResponseTime: 0,
                cacheHitRate: 0,
                errorRate: 0
            },
            database: {
                activeConnections: 0,
                queryCount: 0,
                averageQueryTime: 0,
                connectionPoolEfficiency: 0
            },
            sessions: {
                activeSessions: 0,
                totalSessions: 0,
                averageSessionDuration: 0
            }
        };
        
        this.historicalData = {
            system: [],
            application: [],
            database: [],
            sessions: []
        };
        
        this.alerts = [];
        this.thresholds = {
            cpu: 80,
            memory: 85,
            errorRate: 5,
            responseTime: 5000
        };
        
        this.startDataCollection();
    }

    /**
     * Start collecting performance data
     */
    startDataCollection() {
        // Collect metrics every 30 seconds
        this.metricsInterval = setInterval(() => {
            this.collectMetrics();
        }, 30000);
        
        // Update historical data every 5 minutes
        this.historyInterval = setInterval(() => {
            this.updateHistoricalData();
        }, 300000);
        
        logger.info('Performance dashboard data collection started');
    }

    /**
     * Collect current performance metrics
     */
    async collectMetrics() {
        try {
            // System metrics
            const systemHealth = await systemMonitor.getSystemHealth();
            this.metrics.system = {
                cpu: systemHealth.cpu?.usage || 0,
                memory: systemHealth.memory?.usagePercent || 0,
                disk: systemHealth.disk?.usagePercent || 0,
                network: systemHealth.network?.bytesPerSecond || 0
            };

            // Application metrics
            const executionStats = systemMonitor.getExecutionStats();
            this.metrics.application = {
                codeGenerations: executionStats.totalExecutions || 0,
                codeExecutions: executionStats.successfulExecutions || 0,
                averageResponseTime: executionStats.averageExecutionTime || 0,
                cacheHitRate: this.calculateCacheHitRate(),
                errorRate: this.calculateErrorRate()
            };

            // Check for alerts
            this.checkThresholds();
            
        } catch (error) {
            logger.error('Failed to collect performance metrics', error);
        }
    }

    /**
     * Calculate cache hit rate
     */
    calculateCacheHitRate() {
        try {
            const cacheManager = require('../utils/cacheManager');
            const stats = cacheManager.getStats();
            const total = stats.hits + stats.misses;
            return total > 0 ? (stats.hits / total * 100) : 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Calculate error rate
     */
    calculateErrorRate() {
        try {
            const executionStats = systemMonitor.getExecutionStats();
            const total = executionStats.totalExecutions || 0;
            const failed = (executionStats.totalExecutions || 0) - (executionStats.successfulExecutions || 0);
            return total > 0 ? (failed / total * 100) : 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Update historical data for charts
     */
    updateHistoricalData() {
        const timestamp = Date.now();
        
        // Add current metrics to history
        this.historicalData.system.push({
            timestamp,
            ...this.metrics.system
        });
        
        this.historicalData.application.push({
            timestamp,
            ...this.metrics.application
        });
        
        // Keep only last 24 hours of data (288 points for 5-minute intervals)
        const maxPoints = 288;
        for (const category of Object.keys(this.historicalData)) {
            if (this.historicalData[category].length > maxPoints) {
                this.historicalData[category] = this.historicalData[category].slice(-maxPoints);
            }
        }
    }

    /**
     * Check performance thresholds and generate alerts
     */
    checkThresholds() {
        const now = Date.now();
        
        // CPU threshold
        if (this.metrics.system.cpu > this.thresholds.cpu) {
            this.addAlert('warning', 'High CPU Usage', 
                `CPU usage is ${this.metrics.system.cpu.toFixed(1)}% (threshold: ${this.thresholds.cpu}%)`);
        }
        
        // Memory threshold
        if (this.metrics.system.memory > this.thresholds.memory) {
            this.addAlert('warning', 'High Memory Usage', 
                `Memory usage is ${this.metrics.system.memory.toFixed(1)}% (threshold: ${this.thresholds.memory}%)`);
        }
        
        // Error rate threshold
        if (this.metrics.application.errorRate > this.thresholds.errorRate) {
            this.addAlert('error', 'High Error Rate', 
                `Error rate is ${this.metrics.application.errorRate.toFixed(1)}% (threshold: ${this.thresholds.errorRate}%)`);
        }
        
        // Response time threshold
        if (this.metrics.application.averageResponseTime > this.thresholds.responseTime) {
            this.addAlert('warning', 'Slow Response Time', 
                `Average response time is ${this.metrics.application.averageResponseTime}ms (threshold: ${this.thresholds.responseTime}ms)`);
        }
    }

    /**
     * Add alert to the dashboard
     */
    addAlert(severity, title, message) {
        const alert = {
            id: Date.now() + Math.random(),
            severity,
            title,
            message,
            timestamp: new Date().toISOString(),
            acknowledged: false
        };
        
        this.alerts.unshift(alert);
        
        // Keep only last 50 alerts
        if (this.alerts.length > 50) {
            this.alerts = this.alerts.slice(0, 50);
        }
        
        logger.warn('Performance alert generated', alert);
    }

    /**
     * Get dashboard data for rendering
     */
    getDashboardData() {
        return {
            metrics: this.metrics,
            historicalData: this.historicalData,
            alerts: this.alerts.slice(0, 10), // Last 10 alerts
            summary: this.generateSummary(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Generate performance summary
     */
    generateSummary() {
        const activeAlerts = this.alerts.filter(a => !a.acknowledged).length;
        
        return {
            status: this.getOverallStatus(),
            activeAlerts,
            systemHealth: this.getSystemHealthScore(),
            recommendations: this.generateRecommendations()
        };
    }

    /**
     * Get overall system status
     */
    getOverallStatus() {
        const criticalIssues = this.alerts.filter(a => 
            !a.acknowledged && a.severity === 'error'
        ).length;
        
        const warnings = this.alerts.filter(a => 
            !a.acknowledged && a.severity === 'warning'
        ).length;
        
        if (criticalIssues > 0) return 'critical';
        if (warnings > 0) return 'warning';
        return 'healthy';
    }

    /**
     * Calculate system health score (0-100)
     */
    getSystemHealthScore() {
        let score = 100;
        
        // Deduct points for high resource usage
        if (this.metrics.system.cpu > 70) score -= 20;
        if (this.metrics.system.memory > 80) score -= 20;
        if (this.metrics.application.errorRate > 2) score -= 30;
        if (this.metrics.application.averageResponseTime > 3000) score -= 15;
        
        return Math.max(0, score);
    }

    /**
     * Generate performance recommendations
     */
    generateRecommendations() {
        const recommendations = [];
        
        if (this.metrics.system.cpu > 70) {
            recommendations.push({
                type: 'performance',
                priority: 'high',
                title: 'High CPU Usage',
                suggestion: 'Consider optimizing code generation algorithms or reducing concurrent operations'
            });
        }
        
        if (this.metrics.system.memory > 80) {
            recommendations.push({
                type: 'memory',
                priority: 'high',
                title: 'Memory Usage',
                suggestion: 'Clear caches, reduce session data retention, or increase available memory'
            });
        }
        
        if (this.metrics.application.cacheHitRate < 50) {
            recommendations.push({
                type: 'cache',
                priority: 'medium',
                title: 'Low Cache Hit Rate',
                suggestion: 'Review cache configuration or increase cache size for better performance'
            });
        }
        
        if (this.metrics.application.errorRate > 2) {
            recommendations.push({
                type: 'reliability',
                priority: 'critical',
                title: 'High Error Rate',
                suggestion: 'Investigate recent error logs and fix underlying issues'
            });
        }
        
        return recommendations;
    }

    /**
     * Acknowledge alert
     */
    acknowledgeAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.acknowledged = true;
            alert.acknowledgedAt = new Date().toISOString();
            logger.info('Alert acknowledged', { alertId, title: alert.title });
        }
    }

    /**
     * Export performance data
     */
    exportData(format = 'json') {
        const data = {
            exportTime: new Date().toISOString(),
            metrics: this.metrics,
            historicalData: this.historicalData,
            alerts: this.alerts
        };
        
        if (format === 'csv') {
            return this.convertToCSV(data);
        }
        
        return JSON.stringify(data, null, 2);
    }

    /**
     * Convert data to CSV format
     */
    convertToCSV(data) {
        const lines = ['Timestamp,CPU,Memory,Disk,ResponseTime,ErrorRate,CacheHitRate'];
        
        data.historicalData.system.forEach((point, index) => {
            const appPoint = data.historicalData.application[index] || {};
            lines.push([
                new Date(point.timestamp).toISOString(),
                point.cpu,
                point.memory,
                point.disk,
                appPoint.averageResponseTime || 0,
                appPoint.errorRate || 0,
                appPoint.cacheHitRate || 0
            ].join(','));
        });
        
        return lines.join('\n');
    }

    /**
     * Cleanup dashboard resources
     */
    cleanup() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }
        if (this.historyInterval) {
            clearInterval(this.historyInterval);
        }
        
        logger.info('Performance dashboard cleanup completed');
    }
}

module.exports = PerformanceDashboard;