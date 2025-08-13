const si = require('systeminformation');
const logger = require('./logger');

class SystemMonitor {
    constructor() {
        this.executionStats = {
            totalExecutions: 0,
            failedExecutions: 0,
            averageExecutionTime: 0,
            memoryUsage: [],
            cpuUsage: []
        };
        this.resourceLimits = {
            maxMemoryMB: 512,
            maxCpuPercent: 98,
            maxExecutionTimeMs: 30000,
            maxDiskSpaceMB: 100
        };
    }

    async getSystemHealth() {
        try {
            const [cpu, memory, disk] = await Promise.all([
                si.currentLoad(),
                si.mem(),
                si.fsSize()
            ]);

            const health = {
                cpu: {
                    usage: cpu.currentLoad,
                    status: cpu.currentLoad < 80 ? 'healthy' : 'warning'
                },
                memory: {
                    total: Math.round(memory.total / 1024 / 1024),
                    used: Math.round(memory.used / 1024 / 1024),
                    free: Math.round(memory.free / 1024 / 1024),
                    usage: Math.round((memory.used / memory.total) * 100),
                    status: (memory.used / memory.total) < 0.8 ? 'healthy' : 'warning'
                },
                disk: {
                    total: Math.round(disk[0]?.size / 1024 / 1024 / 1024 || 0),
                    used: Math.round(disk[0]?.used / 1024 / 1024 / 1024 || 0),
                    free: Math.round((disk[0]?.size - disk[0]?.used) / 1024 / 1024 / 1024 || 0),
                    usage: Math.round((disk[0]?.used / disk[0]?.size) * 100 || 0),
                    status: ((disk[0]?.used / disk[0]?.size) || 0) < 0.9 ? 'healthy' : 'warning'
                }
            };

            return health;
        } catch (error) {
            logger.error('Failed to get system health', error);
            return null;
        }
    }

    checkResourceLimits(processId = null) {
        return new Promise(async (resolve) => {
            try {
                const health = await this.getSystemHealth();
                
                const violations = [];
                
                if (health.memory.usage > 98) {
                    violations.push('memory_critical');
                }
                
                if (health.cpu.usage > this.resourceLimits.maxCpuPercent) {
                    violations.push('cpu_high');
                }
                
                if (health.disk.usage > 98) {
                    violations.push('disk_critical');
                }

                if (violations.length > 0) {
                    logger.logSecurityEvent('resource_limit_violation', {
                        violations,
                        health
                    });
                }

                resolve({
                    safe: violations.length === 0,
                    violations,
                    health
                });
            } catch (error) {
                logger.error('Resource limit check failed', error);
                resolve({ safe: false, violations: ['check_failed'], health: null });
            }
        });
    }

    recordExecution(duration, success, memoryUsed = 0) {
        this.executionStats.totalExecutions++;
        if (!success) {
            this.executionStats.failedExecutions++;
        }

        const oldAvg = this.executionStats.averageExecutionTime;
        const count = this.executionStats.totalExecutions;
        this.executionStats.averageExecutionTime = ((oldAvg * (count - 1)) + duration) / count;

        this.executionStats.memoryUsage.push(memoryUsed);
        if (this.executionStats.memoryUsage.length > 100) {
            this.executionStats.memoryUsage.shift();
        }

        logger.info('Execution recorded', {
            action: 'execution_stats',
            stats: this.executionStats
        });
    }

    getExecutionStats() {
        return {
            ...this.executionStats,
            successRate: this.executionStats.totalExecutions > 0 
                ? ((this.executionStats.totalExecutions - this.executionStats.failedExecutions) / this.executionStats.totalExecutions * 100).toFixed(2)
                : 0
        };
    }

    setResourceLimits(limits) {
        this.resourceLimits = { ...this.resourceLimits, ...limits };
        logger.info('Resource limits updated', { limits: this.resourceLimits });
    }

    async startMonitoring(intervalMs = 10000) {
        setInterval(async () => {
            const health = await this.getSystemHealth();
            if (health) {
                logger.debug('System health check', { health });
            }
        }, intervalMs);
    }
}

module.exports = new SystemMonitor();