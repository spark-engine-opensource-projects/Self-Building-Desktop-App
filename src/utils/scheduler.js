const logger = require('./logger');
const sessionManager = require('./sessionManager');
const cacheManager = require('./cacheManager');

/**
 * Task Scheduler for automatic cleanup and maintenance
 * Handles periodic tasks like session cleanup, cache maintenance, etc.
 */
class Scheduler {
    constructor() {
        this.tasks = new Map();
        this.isRunning = false;
        this.intervals = new Map();
    }

    /**
     * Start the scheduler
     */
    start() {
        if (this.isRunning) {
            logger.warn('Scheduler is already running');
            return;
        }

        this.isRunning = true;
        this.setupDefaultTasks();
        this.startAllTasks();
        
        logger.info('Scheduler started');
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        this.stopAllTasks();
        
        logger.info('Scheduler stopped');
    }

    /**
     * Setup default maintenance tasks
     */
    setupDefaultTasks() {
        // Session cleanup - every hour
        this.addTask('session-cleanup', {
            interval: 60 * 60 * 1000, // 1 hour
            task: async () => {
                try {
                    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
                    const deletedCount = await sessionManager.cleanupOldSessions(maxAge);
                    
                    if (deletedCount > 0) {
                        logger.info('Session cleanup completed', { deletedCount });
                    }
                    
                    return { success: true, deletedSessions: deletedCount };
                } catch (error) {
                    logger.error('Session cleanup failed', error);
                    return { success: false, error: error.message };
                }
            },
            enabled: true,
            description: 'Clean up old sessions older than 7 days'
        });

        // Cache cleanup - every 30 minutes
        this.addTask('cache-cleanup', {
            interval: 30 * 60 * 1000, // 30 minutes
            task: async () => {
                try {
                    const expiredCount = cacheManager.clearExpired();
                    
                    if (expiredCount > 0) {
                        logger.info('Cache cleanup completed', { expiredCount });
                    }
                    
                    return { success: true, expiredItems: expiredCount };
                } catch (error) {
                    logger.error('Cache cleanup failed', error);
                    return { success: false, error: error.message };
                }
            },
            enabled: true,
            description: 'Remove expired cache entries'
        });

        // Log rotation check - every 6 hours
        this.addTask('log-rotation', {
            interval: 6 * 60 * 60 * 1000, // 6 hours
            task: async () => {
                try {
                    const fs = require('fs').promises;
                    const path = require('path');
                    const { app } = require('electron');
                    
                    const logDir = app ? app.getPath('logs') : path.join(__dirname, '..', '..', 'logs');
                    const maxLogSize = 10 * 1024 * 1024; // 10MB
                    const maxLogFiles = 5;
                    
                    let rotatedFiles = 0;
                    
                    try {
                        const files = await fs.readdir(logDir);
                        
                        for (const file of files) {
                            if (file.endsWith('.log')) {
                                const filePath = path.join(logDir, file);
                                const stats = await fs.stat(filePath);
                                
                                if (stats.size > maxLogSize) {
                                    // Rotate log file
                                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                    const rotatedPath = path.join(logDir, `${file}.${timestamp}`);
                                    
                                    await fs.rename(filePath, rotatedPath);
                                    rotatedFiles++;
                                    
                                    logger.info('Log file rotated', { 
                                        original: file, 
                                        rotated: path.basename(rotatedPath),
                                        size: Math.round(stats.size / 1024 / 1024) + 'MB'
                                    });
                                }
                            }
                        }
                        
                        // Clean up old rotated logs
                        const rotatedLogs = files.filter(f => f.includes('.log.'));
                        if (rotatedLogs.length > maxLogFiles) {
                            const sortedLogs = rotatedLogs.sort();
                            const toDelete = sortedLogs.slice(0, rotatedLogs.length - maxLogFiles);
                            
                            for (const logFile of toDelete) {
                                await fs.unlink(path.join(logDir, logFile));
                                logger.info('Old log file deleted', { file: logFile });
                            }
                        }
                        
                    } catch (error) {
                        if (error.code !== 'ENOENT') {
                            throw error;
                        }
                    }
                    
                    return { success: true, rotatedFiles };
                } catch (error) {
                    logger.error('Log rotation failed', error);
                    return { success: false, error: error.message };
                }
            },
            enabled: true,
            description: 'Rotate large log files and clean up old logs'
        });

        // Memory usage check - every 5 minutes
        this.addTask('memory-check', {
            interval: 5 * 60 * 1000, // 5 minutes
            task: async () => {
                try {
                    const memoryUsage = process.memoryUsage();
                    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
                    const rssMB = Math.round(memoryUsage.rss / 1024 / 1024);
                    
                    // Log if memory usage is high
                    const memoryThreshold = 500; // 500MB
                    if (heapUsedMB > memoryThreshold) {
                        logger.warn('High memory usage detected', {
                            heapUsed: heapUsedMB + 'MB',
                            rss: rssMB + 'MB',
                            threshold: memoryThreshold + 'MB'
                        });
                    }
                    
                    // Force garbage collection if available
                    if (global.gc) {
                        global.gc();
                    }
                    
                    return { 
                        success: true, 
                        heapUsedMB, 
                        rssMB,
                        gcForced: !!global.gc
                    };
                } catch (error) {
                    logger.error('Memory check failed', error);
                    return { success: false, error: error.message };
                }
            },
            enabled: true,
            description: 'Monitor memory usage and force GC if needed'
        });

        // Health check - every 2 minutes
        this.addTask('health-check', {
            interval: 2 * 60 * 1000, // 2 minutes
            task: async () => {
                try {
                    const systemMonitor = require('./systemMonitor');
                    const health = await systemMonitor.getSystemHealth();
                    
                    if (health) {
                        const warnings = [];
                        
                        if (health.memory.status === 'warning') {
                            warnings.push(`High memory usage: ${health.memory.usage}%`);
                        }
                        
                        if (health.cpu.status === 'warning') {
                            warnings.push(`High CPU usage: ${health.cpu.usage}%`);
                        }
                        
                        if (health.disk.status === 'warning') {
                            warnings.push(`High disk usage: ${health.disk.usage}%`);
                        }
                        
                        if (warnings.length > 0) {
                            logger.warn('System health warnings', { warnings });
                        }
                    }
                    
                    return { success: true, health, warnings: warnings.length };
                } catch (error) {
                    logger.error('Health check failed', error);
                    return { success: false, error: error.message };
                }
            },
            enabled: true,
            description: 'Check system health metrics'
        });
    }

    /**
     * Add a scheduled task
     */
    addTask(name, config) {
        const task = {
            name,
            interval: config.interval,
            task: config.task,
            enabled: config.enabled !== false,
            description: config.description || '',
            lastRun: null,
            nextRun: null,
            runCount: 0,
            errorCount: 0,
            lastError: null,
            averageDuration: 0
        };
        
        this.tasks.set(name, task);
        
        if (this.isRunning && task.enabled) {
            this.startTask(name);
        }
        
        logger.info('Task added to scheduler', { name, interval: config.interval });
    }

    /**
     * Remove a scheduled task
     */
    removeTask(name) {
        this.stopTask(name);
        const removed = this.tasks.delete(name);
        
        if (removed) {
            logger.info('Task removed from scheduler', { name });
        }
        
        return removed;
    }

    /**
     * Enable/disable a task
     */
    setTaskEnabled(name, enabled) {
        const task = this.tasks.get(name);
        if (!task) {
            throw new Error(`Task ${name} not found`);
        }
        
        task.enabled = enabled;
        
        if (this.isRunning) {
            if (enabled) {
                this.startTask(name);
            } else {
                this.stopTask(name);
            }
        }
        
        logger.info('Task status changed', { name, enabled });
    }

    /**
     * Start a specific task
     */
    startTask(name) {
        const task = this.tasks.get(name);
        if (!task || !task.enabled) {
            return;
        }

        // Stop existing interval if any
        this.stopTask(name);

        const intervalId = setInterval(async () => {
            await this.runTask(name);
        }, task.interval);

        this.intervals.set(name, intervalId);
        task.nextRun = new Date(Date.now() + task.interval);
        
        logger.debug('Task started', { name, nextRun: task.nextRun });
    }

    /**
     * Stop a specific task
     */
    stopTask(name) {
        const intervalId = this.intervals.get(name);
        if (intervalId) {
            clearInterval(intervalId);
            this.intervals.delete(name);
            
            const task = this.tasks.get(name);
            if (task) {
                task.nextRun = null;
            }
            
            logger.debug('Task stopped', { name });
        }
    }

    /**
     * Start all enabled tasks
     */
    startAllTasks() {
        for (const [name, task] of this.tasks) {
            if (task.enabled) {
                this.startTask(name);
            }
        }
    }

    /**
     * Stop all tasks
     */
    stopAllTasks() {
        for (const name of this.tasks.keys()) {
            this.stopTask(name);
        }
    }

    /**
     * Run a task immediately
     */
    async runTask(name) {
        const task = this.tasks.get(name);
        if (!task) {
            throw new Error(`Task ${name} not found`);
        }

        const startTime = Date.now();
        task.lastRun = new Date(startTime);
        task.nextRun = new Date(startTime + task.interval);

        try {
            logger.debug('Running scheduled task', { name });
            
            const result = await task.task();
            const duration = Date.now() - startTime;
            
            // Update statistics
            task.runCount++;
            task.averageDuration = Math.round(
                (task.averageDuration * (task.runCount - 1) + duration) / task.runCount
            );
            
            logger.debug('Scheduled task completed', { 
                name, 
                duration, 
                result: result?.success ? 'success' : 'failed'
            });
            
            return result;
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            task.errorCount++;
            task.lastError = {
                message: error.message,
                timestamp: new Date().toISOString()
            };
            
            logger.error('Scheduled task failed', error, { name, duration });
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Get task status
     */
    getTaskStatus(name) {
        const task = this.tasks.get(name);
        if (!task) {
            return null;
        }

        return {
            name: task.name,
            enabled: task.enabled,
            description: task.description,
            interval: task.interval,
            lastRun: task.lastRun,
            nextRun: task.nextRun,
            runCount: task.runCount,
            errorCount: task.errorCount,
            lastError: task.lastError,
            averageDuration: task.averageDuration,
            successRate: task.runCount > 0 
                ? Math.round(((task.runCount - task.errorCount) / task.runCount) * 100) 
                : 0
        };
    }

    /**
     * Get all tasks status
     */
    getAllTasksStatus() {
        const status = {};
        
        for (const name of this.tasks.keys()) {
            status[name] = this.getTaskStatus(name);
        }
        
        return {
            running: this.isRunning,
            totalTasks: this.tasks.size,
            enabledTasks: Array.from(this.tasks.values()).filter(t => t.enabled).length,
            tasks: status
        };
    }

    /**
     * Run all enabled tasks once (for testing/manual trigger)
     */
    async runAllTasks() {
        const results = {};
        
        for (const [name, task] of this.tasks) {
            if (task.enabled) {
                try {
                    results[name] = await this.runTask(name);
                } catch (error) {
                    results[name] = { success: false, error: error.message };
                }
            }
        }
        
        return results;
    }
}

// Export singleton instance
module.exports = new Scheduler();