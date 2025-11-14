const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { createWriteStream, createReadStream } = require('fs');
const readline = require('readline');
const zlib = require('zlib');

/**
 * AuditModule - Comprehensive audit logging and compliance system
 * Implements secure logging, compliance tracking, and forensic analysis
 */
class AuditModule extends EventEmitter {
    constructor() {
        super();
        this.logs = [];
        this.currentLogFile = null;
        this.logStream = null;
        this.config = {};
        this.logIndex = new Map();
        this.complianceRules = new Map();
        this.alerts = new Map();
        this.retentionPolicies = new Map();
        this.logStats = {
            totalLogs: 0,
            byLevel: {},
            byCategory: {},
            byUser: {}
        };
    }

    /**
     * Initialize audit module
     */
    async initialize(config = {}) {
        try {
            this.config = {
                logPath: config.logPath || path.join(process.cwd(), 'logs', 'audit'),
                maxLogSize: config.maxLogSize || 10 * 1024 * 1024, // 10MB
                maxLogAge: config.maxLogAge || 90 * 24 * 60 * 60 * 1000, // 90 days
                compressionEnabled: config.compressionEnabled !== false,
                encryptionEnabled: config.encryptionEnabled !== false,
                realTimeAlerts: config.realTimeAlerts !== false,
                complianceMode: config.complianceMode || 'standard', // standard, hipaa, gdpr, pci
                logLevel: config.logLevel || 'info',
                includeSystemInfo: config.includeSystemInfo !== false,
                tamperDetection: config.tamperDetection !== false,
                ...config
            };

            // Create log directory
            await fs.mkdir(this.config.logPath, { recursive: true });

            // Initialize log file
            await this.initializeLogFile();

            // Setup compliance rules
            this.setupComplianceRules();

            // Setup retention policies
            this.setupRetentionPolicies();

            // Start log rotation
            this.startLogRotation();

            // Start retention enforcement
            this.startRetentionEnforcement();

            console.log('Audit module initialized');
            this.emit('initialized');

            // Log initialization
            await this.log('SYSTEM', 'audit_module_initialized', {
                config: this.sanitizeConfig(this.config)
            });

            return { success: true };
        } catch (error) {
            console.error('Failed to initialize audit module:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup compliance rules based on mode
     */
    setupComplianceRules() {
        switch (this.config.complianceMode) {
            case 'hipaa':
                this.setupHIPAACompliance();
                break;
            case 'gdpr':
                this.setupGDPRCompliance();
                break;
            case 'pci':
                this.setupPCICompliance();
                break;
            default:
                this.setupStandardCompliance();
        }
    }

    /**
     * Setup HIPAA compliance rules
     */
    setupHIPAACompliance() {
        this.complianceRules.set('hipaa', {
            requiredFields: ['userId', 'patientId', 'action', 'timestamp'],
            encryptionRequired: true,
            minimumRetention: 6 * 365 * 24 * 60 * 60 * 1000, // 6 years
            accessControl: true,
            integrityCheck: true,
            mandatoryEvents: [
                'patient_record_access',
                'patient_record_modification',
                'patient_record_deletion',
                'user_authentication',
                'authorization_change'
            ]
        });
    }

    /**
     * Setup GDPR compliance rules
     */
    setupGDPRCompliance() {
        this.complianceRules.set('gdpr', {
            requiredFields: ['userId', 'purpose', 'legalBasis', 'timestamp'],
            encryptionRequired: true,
            anonymizationRequired: true,
            rightToErasure: true,
            dataPortability: true,
            mandatoryEvents: [
                'consent_given',
                'consent_withdrawn',
                'data_access_request',
                'data_deletion_request',
                'data_breach'
            ]
        });
    }

    /**
     * Setup PCI compliance rules
     */
    setupPCICompliance() {
        this.complianceRules.set('pci', {
            requiredFields: ['userId', 'action', 'resource', 'timestamp'],
            encryptionRequired: true,
            maskSensitiveData: true,
            minimumRetention: 1 * 365 * 24 * 60 * 60 * 1000, // 1 year
            mandatoryEvents: [
                'card_data_access',
                'payment_processing',
                'authentication_attempt',
                'privilege_escalation',
                'system_configuration_change'
            ]
        });
    }

    /**
     * Setup standard compliance rules
     */
    setupStandardCompliance() {
        this.complianceRules.set('standard', {
            requiredFields: ['timestamp', 'level', 'message'],
            encryptionRequired: false,
            minimumRetention: 30 * 24 * 60 * 60 * 1000, // 30 days
            mandatoryEvents: [
                'user_login',
                'user_logout',
                'data_modification',
                'security_event',
                'system_error'
            ]
        });
    }

    /**
     * Setup retention policies
     */
    setupRetentionPolicies() {
        // Security logs - longer retention
        this.retentionPolicies.set('security', {
            retention: 365 * 24 * 60 * 60 * 1000, // 1 year
            compression: true,
            archive: true
        });

        // Access logs
        this.retentionPolicies.set('access', {
            retention: 90 * 24 * 60 * 60 * 1000, // 90 days
            compression: true,
            archive: false
        });

        // Error logs
        this.retentionPolicies.set('error', {
            retention: 180 * 24 * 60 * 60 * 1000, // 180 days
            compression: true,
            archive: true
        });

        // Debug logs - shorter retention
        this.retentionPolicies.set('debug', {
            retention: 7 * 24 * 60 * 60 * 1000, // 7 days
            compression: false,
            archive: false
        });
    }

    /**
     * Initialize log file
     */
    async initializeLogFile() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.currentLogFile = path.join(this.config.logPath, `audit_${timestamp}.log`);
        
        // Create write stream
        this.logStream = createWriteStream(this.currentLogFile, { flags: 'a' });
        
        // Write header
        const header = {
            version: '1.0',
            created: new Date().toISOString(),
            compliance: this.config.complianceMode,
            encrypted: this.config.encryptionEnabled,
            host: require('os').hostname(),
            pid: process.pid
        };
        
        await this.writeToLog(header);
    }

    /**
     * Log an audit event
     */
    async log(category, event, data = {}, options = {}) {
        try {
            const logEntry = {
                id: this.generateLogId(),
                timestamp: new Date().toISOString(),
                category,
                event,
                level: options.level || 'info',
                userId: options.userId || 'system',
                sessionId: options.sessionId,
                ipAddress: options.ipAddress,
                userAgent: options.userAgent,
                data: this.sanitizeData(data),
                metadata: {}
            };

            // Add system information if configured
            if (this.config.includeSystemInfo) {
                logEntry.metadata.system = {
                    hostname: require('os').hostname(),
                    platform: process.platform,
                    pid: process.pid,
                    memory: process.memoryUsage(),
                    uptime: process.uptime()
                };
            }

            // Add integrity hash
            if (this.config.tamperDetection) {
                logEntry.hash = this.generateLogHash(logEntry);
                logEntry.previousHash = this.lastLogHash;
                this.lastLogHash = logEntry.hash;
            }

            // Check compliance requirements
            const complianceCheck = this.checkCompliance(logEntry);
            if (!complianceCheck.valid) {
                console.warn('Log entry does not meet compliance requirements:', complianceCheck.errors);
            }

            // Store in memory buffer
            this.logs.push(logEntry);
            if (this.logs.length > 1000) {
                this.logs.shift(); // Keep only last 1000 in memory
            }

            // Write to file
            await this.writeToLog(logEntry);

            // Update statistics
            this.updateStatistics(logEntry);

            // Index log entry
            this.indexLog(logEntry);

            // Check for alerts
            await this.checkAlerts(logEntry);

            // Emit event
            this.emit('log-written', logEntry);

            return { success: true, logId: logEntry.id };
        } catch (error) {
            console.error('Failed to write audit log:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Log security event
     */
    async logSecurity(event, data, options = {}) {
        return this.log('security', event, data, { ...options, level: 'warning' });
    }

    /**
     * Log access event
     */
    async logAccess(resource, action, data, options = {}) {
        return this.log('access', `${action}_${resource}`, data, options);
    }

    /**
     * Log data change
     */
    async logDataChange(entity, action, before, after, options = {}) {
        return this.log('data', `${entity}_${action}`, {
            before: this.sanitizeData(before),
            after: this.sanitizeData(after),
            changes: this.calculateChanges(before, after)
        }, options);
    }

    /**
     * Log error
     */
    async logError(error, context = {}, options = {}) {
        return this.log('error', 'error_occurred', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            context
        }, { ...options, level: 'error' });
    }

    /**
     * Log compliance event
     */
    async logCompliance(event, data, options = {}) {
        return this.log('compliance', event, data, { ...options, level: 'info' });
    }

    /**
     * Write to log file
     */
    async writeToLog(entry) {
        return new Promise((resolve, reject) => {
            let data = JSON.stringify(entry) + '\n';
            
            // Encrypt if enabled
            if (this.config.encryptionEnabled) {
                data = this.encryptLogEntry(data);
            }
            
            this.logStream.write(data, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    /**
     * Encrypt log entry
     */
    encryptLogEntry(data) {
        // Simple encryption for demonstration
        // In production, use the EncryptionModule
        const cipher = crypto.createCipher('aes-256-cbc', this.getEncryptionKey());
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted + '\n';
    }

    /**
     * Decrypt log entry
     */
    decryptLogEntry(encrypted) {
        const decipher = crypto.createDecipher('aes-256-cbc', this.getEncryptionKey());
        let decrypted = decipher.update(encrypted.trim(), 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    /**
     * Get encryption key
     */
    getEncryptionKey() {
        // In production, use secure key management
        return this.config.encryptionKey || 'default-encryption-key';
    }

    /**
     * Generate log hash for integrity
     */
    generateLogHash(entry) {
        const content = JSON.stringify({
            timestamp: entry.timestamp,
            category: entry.category,
            event: entry.event,
            data: entry.data
        });
        
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Verify log integrity
     */
    async verifyLogIntegrity(logFile) {
        try {
            const entries = await this.readLogFile(logFile);
            let previousHash = null;
            let valid = true;
            const errors = [];
            
            for (const entry of entries) {
                if (entry.hash) {
                    // Verify hash
                    const expectedHash = this.generateLogHash(entry);
                    if (entry.hash !== expectedHash) {
                        valid = false;
                        errors.push(`Hash mismatch for log ${entry.id}`);
                    }
                    
                    // Verify chain
                    if (previousHash && entry.previousHash !== previousHash) {
                        valid = false;
                        errors.push(`Chain broken at log ${entry.id}`);
                    }
                    
                    previousHash = entry.hash;
                }
            }
            
            return { valid, errors };
        } catch (error) {
            console.error('Failed to verify log integrity:', error);
            return { valid: false, errors: [error.message] };
        }
    }

    /**
     * Read log file
     */
    async readLogFile(logFile) {
        return new Promise((resolve, reject) => {
            const entries = [];
            const stream = createReadStream(logFile);
            const rl = readline.createInterface({ input: stream });
            
            rl.on('line', (line) => {
                try {
                    let data = line;
                    
                    // Decrypt if needed
                    if (this.config.encryptionEnabled) {
                        data = this.decryptLogEntry(data);
                    }
                    
                    const entry = JSON.parse(data);
                    entries.push(entry);
                } catch (error) {
                    // Skip malformed entries
                    console.warn('Skipping malformed log entry');
                }
            });
            
            rl.on('close', () => resolve(entries));
            rl.on('error', reject);
        });
    }

    /**
     * Search logs
     */
    async searchLogs(criteria) {
        try {
            const results = [];
            const logFiles = await this.getLogFiles();
            
            for (const logFile of logFiles) {
                const entries = await this.readLogFile(logFile);
                
                for (const entry of entries) {
                    if (this.matchesCriteria(entry, criteria)) {
                        results.push(entry);
                    }
                }
            }
            
            // Sort by timestamp
            results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            return {
                success: true,
                results,
                count: results.length
            };
        } catch (error) {
            console.error('Failed to search logs:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if log entry matches search criteria
     */
    matchesCriteria(entry, criteria) {
        if (criteria.startDate && new Date(entry.timestamp) < new Date(criteria.startDate)) {
            return false;
        }
        
        if (criteria.endDate && new Date(entry.timestamp) > new Date(criteria.endDate)) {
            return false;
        }
        
        if (criteria.category && entry.category !== criteria.category) {
            return false;
        }
        
        if (criteria.event && !entry.event.includes(criteria.event)) {
            return false;
        }
        
        if (criteria.userId && entry.userId !== criteria.userId) {
            return false;
        }
        
        if (criteria.level && entry.level !== criteria.level) {
            return false;
        }
        
        if (criteria.text) {
            const entryText = JSON.stringify(entry).toLowerCase();
            if (!entryText.includes(criteria.text.toLowerCase())) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Get log files
     */
    async getLogFiles() {
        const files = await fs.readdir(this.config.logPath);
        return files
            .filter(file => file.startsWith('audit_') && file.endsWith('.log'))
            .map(file => path.join(this.config.logPath, file))
            .sort();
    }

    /**
     * Generate report
     */
    async generateReport(type, options = {}) {
        try {
            let report;
            
            switch (type) {
                case 'compliance':
                    report = await this.generateComplianceReport(options);
                    break;
                case 'security':
                    report = await this.generateSecurityReport(options);
                    break;
                case 'access':
                    report = await this.generateAccessReport(options);
                    break;
                case 'summary':
                    report = await this.generateSummaryReport(options);
                    break;
                default:
                    throw new Error(`Unknown report type: ${type}`);
            }
            
            // Save report
            const reportPath = path.join(
                this.config.logPath,
                'reports',
                `${type}_${Date.now()}.json`
            );
            
            await fs.mkdir(path.dirname(reportPath), { recursive: true });
            await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
            
            return {
                success: true,
                report,
                path: reportPath
            };
        } catch (error) {
            console.error('Failed to generate report:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate compliance report
     */
    async generateComplianceReport(options) {
        const logs = await this.searchLogs({
            category: 'compliance',
            startDate: options.startDate,
            endDate: options.endDate
        });
        
        const violations = [];
        const summary = {
            totalEvents: logs.results.length,
            byEvent: {},
            violations: 0
        };
        
        for (const log of logs.results) {
            summary.byEvent[log.event] = (summary.byEvent[log.event] || 0) + 1;
            
            const compliance = this.checkCompliance(log);
            if (!compliance.valid) {
                violations.push({
                    logId: log.id,
                    timestamp: log.timestamp,
                    errors: compliance.errors
                });
                summary.violations++;
            }
        }
        
        return {
            type: 'compliance',
            generated: new Date().toISOString(),
            period: {
                start: options.startDate,
                end: options.endDate
            },
            complianceMode: this.config.complianceMode,
            summary,
            violations
        };
    }

    /**
     * Generate security report
     */
    async generateSecurityReport(options) {
        const logs = await this.searchLogs({
            category: 'security',
            startDate: options.startDate,
            endDate: options.endDate
        });
        
        const threats = [];
        const summary = {
            totalEvents: logs.results.length,
            byLevel: {},
            threats: 0,
            topUsers: {},
            topEvents: {}
        };
        
        for (const log of logs.results) {
            summary.byLevel[log.level] = (summary.byLevel[log.level] || 0) + 1;
            summary.topUsers[log.userId] = (summary.topUsers[log.userId] || 0) + 1;
            summary.topEvents[log.event] = (summary.topEvents[log.event] || 0) + 1;
            
            // Detect potential threats
            if (log.level === 'error' || log.level === 'critical') {
                threats.push({
                    logId: log.id,
                    timestamp: log.timestamp,
                    event: log.event,
                    userId: log.userId,
                    details: log.data
                });
                summary.threats++;
            }
        }
        
        // Sort top items
        summary.topUsers = Object.entries(summary.topUsers)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        
        summary.topEvents = Object.entries(summary.topEvents)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        
        return {
            type: 'security',
            generated: new Date().toISOString(),
            period: {
                start: options.startDate,
                end: options.endDate
            },
            summary,
            threats
        };
    }

    /**
     * Generate access report
     */
    async generateAccessReport(options) {
        const logs = await this.searchLogs({
            category: 'access',
            startDate: options.startDate,
            endDate: options.endDate
        });
        
        const accessPatterns = {};
        const summary = {
            totalAccess: logs.results.length,
            uniqueUsers: new Set(),
            topResources: {},
            byHour: Array(24).fill(0),
            byDay: Array(7).fill(0)
        };
        
        for (const log of logs.results) {
            summary.uniqueUsers.add(log.userId);
            
            // Parse resource from event
            const resource = log.event.split('_').slice(1).join('_');
            summary.topResources[resource] = (summary.topResources[resource] || 0) + 1;
            
            // Time analysis
            const date = new Date(log.timestamp);
            summary.byHour[date.getHours()]++;
            summary.byDay[date.getDay()]++;
            
            // User access patterns
            if (!accessPatterns[log.userId]) {
                accessPatterns[log.userId] = {
                    totalAccess: 0,
                    resources: {},
                    firstAccess: log.timestamp,
                    lastAccess: log.timestamp
                };
            }
            
            accessPatterns[log.userId].totalAccess++;
            accessPatterns[log.userId].resources[resource] = 
                (accessPatterns[log.userId].resources[resource] || 0) + 1;
            accessPatterns[log.userId].lastAccess = log.timestamp;
        }
        
        summary.uniqueUsers = summary.uniqueUsers.size;
        summary.topResources = Object.entries(summary.topResources)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        
        return {
            type: 'access',
            generated: new Date().toISOString(),
            period: {
                start: options.startDate,
                end: options.endDate
            },
            summary,
            accessPatterns
        };
    }

    /**
     * Generate summary report
     */
    async generateSummaryReport(options) {
        const allLogs = await this.searchLogs({
            startDate: options.startDate,
            endDate: options.endDate
        });
        
        const summary = {
            totalLogs: allLogs.results.length,
            byCategory: {},
            byLevel: {},
            byUser: {},
            timeline: {},
            alerts: this.alerts.size,
            diskUsage: await this.calculateDiskUsage()
        };
        
        for (const log of allLogs.results) {
            summary.byCategory[log.category] = (summary.byCategory[log.category] || 0) + 1;
            summary.byLevel[log.level] = (summary.byLevel[log.level] || 0) + 1;
            summary.byUser[log.userId] = (summary.byUser[log.userId] || 0) + 1;
            
            // Group by day for timeline
            const day = new Date(log.timestamp).toISOString().split('T')[0];
            summary.timeline[day] = (summary.timeline[day] || 0) + 1;
        }
        
        return {
            type: 'summary',
            generated: new Date().toISOString(),
            period: {
                start: options.startDate,
                end: options.endDate
            },
            summary
        };
    }

    /**
     * Setup alert rule
     */
    setupAlert(name, condition, action) {
        this.alerts.set(name, {
            condition,
            action,
            triggered: 0,
            lastTriggered: null
        });
    }

    /**
     * Check alerts for log entry
     */
    async checkAlerts(logEntry) {
        for (const [name, alert] of this.alerts) {
            if (alert.condition(logEntry)) {
                alert.triggered++;
                alert.lastTriggered = Date.now();
                
                // Execute action
                if (alert.action) {
                    await alert.action(logEntry, alert);
                }
                
                this.emit('alert-triggered', {
                    name,
                    logEntry,
                    alert
                });
            }
        }
    }

    /**
     * Start log rotation
     */
    startLogRotation() {
        setInterval(async () => {
            const stats = await fs.stat(this.currentLogFile).catch(() => null);
            
            if (stats && stats.size > this.config.maxLogSize) {
                await this.rotateLog();
            }
        }, 60000); // Check every minute
    }

    /**
     * Rotate log file
     */
    async rotateLog() {
        try {
            // Close current stream
            this.logStream.end();
            
            // Compress if enabled
            if (this.config.compressionEnabled) {
                await this.compressLog(this.currentLogFile);
            }
            
            // Create new log file
            await this.initializeLogFile();
            
            this.emit('log-rotated', {
                oldFile: this.currentLogFile,
                newFile: this.currentLogFile
            });
        } catch (error) {
            console.error('Failed to rotate log:', error);
        }
    }

    /**
     * Compress log file
     */
    async compressLog(logFile) {
        return new Promise((resolve, reject) => {
            const input = createReadStream(logFile);
            const output = createWriteStream(`${logFile}.gz`);
            const gzip = zlib.createGzip();
            
            input
                .pipe(gzip)
                .pipe(output)
                .on('finish', async () => {
                    // Delete original file
                    await fs.unlink(logFile);
                    resolve();
                })
                .on('error', reject);
        });
    }

    /**
     * Start retention enforcement
     */
    startRetentionEnforcement() {
        setInterval(async () => {
            await this.enforceRetention();
        }, 24 * 60 * 60 * 1000); // Daily
    }

    /**
     * Enforce retention policies
     */
    async enforceRetention() {
        try {
            const files = await this.getLogFiles();
            const now = Date.now();
            
            for (const file of files) {
                const stats = await fs.stat(file);
                const age = now - stats.mtime.getTime();
                
                if (age > this.config.maxLogAge) {
                    await fs.unlink(file);
                    
                    this.emit('log-deleted', {
                        file,
                        age,
                        reason: 'retention'
                    });
                }
            }
        } catch (error) {
            console.error('Failed to enforce retention:', error);
        }
    }

    /**
     * Export logs
     */
    async exportLogs(format, criteria = {}) {
        try {
            const logs = await this.searchLogs(criteria);
            let exportData;
            
            switch (format) {
                case 'json':
                    exportData = JSON.stringify(logs.results, null, 2);
                    break;
                
                case 'csv':
                    exportData = this.convertToCSV(logs.results);
                    break;
                
                case 'syslog':
                    exportData = this.convertToSyslog(logs.results);
                    break;
                
                default:
                    throw new Error(`Unknown export format: ${format}`);
            }
            
            const exportPath = path.join(
                this.config.logPath,
                'exports',
                `audit_export_${Date.now()}.${format}`
            );
            
            await fs.mkdir(path.dirname(exportPath), { recursive: true });
            await fs.writeFile(exportPath, exportData);
            
            // Log the export
            await this.logCompliance('logs_exported', {
                format,
                criteria,
                count: logs.results.length,
                path: exportPath
            });
            
            return {
                success: true,
                path: exportPath,
                count: logs.results.length
            };
        } catch (error) {
            console.error('Failed to export logs:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Convert logs to CSV
     */
    convertToCSV(logs) {
        if (logs.length === 0) return '';
        
        const headers = Object.keys(logs[0]);
        const rows = [headers.join(',')];
        
        for (const log of logs) {
            const values = headers.map(header => {
                const value = log[header];
                if (typeof value === 'object') {
                    return JSON.stringify(value).replace(/"/g, '""');
                }
                return `"${value}"`;
            });
            rows.push(values.join(','));
        }
        
        return rows.join('\n');
    }

    /**
     * Convert logs to syslog format
     */
    convertToSyslog(logs) {
        const facility = 16; // Local0
        const severityMap = {
            debug: 7,
            info: 6,
            warning: 4,
            error: 3,
            critical: 2
        };
        
        return logs.map(log => {
            const severity = severityMap[log.level] || 6;
            const priority = facility * 8 + severity;
            const timestamp = new Date(log.timestamp).toISOString();
            const hostname = require('os').hostname();
            const message = `${log.category} ${log.event} ${JSON.stringify(log.data)}`;
            
            return `<${priority}>${timestamp} ${hostname} ${log.userId}: ${message}`;
        }).join('\n');
    }

    /**
     * Calculate disk usage
     */
    async calculateDiskUsage() {
        try {
            const files = await fs.readdir(this.config.logPath);
            let totalSize = 0;
            
            for (const file of files) {
                const filePath = path.join(this.config.logPath, file);
                const stats = await fs.stat(filePath);
                if (stats.isFile()) {
                    totalSize += stats.size;
                }
            }
            
            return totalSize;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Check compliance
     */
    checkCompliance(logEntry) {
        const rules = this.complianceRules.get(this.config.complianceMode);
        if (!rules) return { valid: true };
        
        const errors = [];
        
        // Check required fields
        for (const field of rules.requiredFields || []) {
            if (!logEntry[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        }
        
        // Check mandatory events
        if (rules.mandatoryEvents && !rules.mandatoryEvents.includes(logEntry.event)) {
            // This is just a warning, not an error
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Sanitize sensitive data
     */
    sanitizeData(data) {
        if (!data) return data;
        
        const sensitivePatterns = [
            { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: 'XXXX-XXXX-XXXX-XXXX' }, // Credit card
            { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: 'XXX-XX-XXXX' }, // SSN
            { pattern: /password[\s]*[:=][\s]*["']?[^"',\s]+/gi, replacement: 'password=***' }, // Passwords
            { pattern: /api[_-]?key[\s]*[:=][\s]*["']?[^"',\s]+/gi, replacement: 'api_key=***' }, // API keys
            { pattern: /token[\s]*[:=][\s]*["']?[^"',\s]+/gi, replacement: 'token=***' } // Tokens
        ];
        
        let sanitized = JSON.stringify(data);
        
        for (const { pattern, replacement } of sensitivePatterns) {
            sanitized = sanitized.replace(pattern, replacement);
        }
        
        try {
            return JSON.parse(sanitized);
        } catch {
            return data;
        }
    }

    /**
     * Sanitize configuration for logging
     */
    sanitizeConfig(config) {
        const sanitized = { ...config };
        delete sanitized.encryptionKey;
        return sanitized;
    }

    /**
     * Calculate changes between objects
     */
    calculateChanges(before, after) {
        const changes = [];
        
        if (!before || !after) return changes;
        
        const allKeys = new Set([
            ...Object.keys(before),
            ...Object.keys(after)
        ]);
        
        for (const key of allKeys) {
            if (before[key] !== after[key]) {
                changes.push({
                    field: key,
                    before: before[key],
                    after: after[key]
                });
            }
        }
        
        return changes;
    }

    /**
     * Index log entry
     */
    indexLog(entry) {
        // Index by various fields for fast lookup
        const indexes = ['userId', 'sessionId', 'event', 'category'];
        
        for (const field of indexes) {
            if (entry[field]) {
                if (!this.logIndex.has(field)) {
                    this.logIndex.set(field, new Map());
                }
                
                const fieldIndex = this.logIndex.get(field);
                if (!fieldIndex.has(entry[field])) {
                    fieldIndex.set(entry[field], []);
                }
                
                fieldIndex.get(entry[field]).push(entry.id);
            }
        }
    }

    /**
     * Update statistics
     */
    updateStatistics(entry) {
        this.logStats.totalLogs++;
        this.logStats.byLevel[entry.level] = (this.logStats.byLevel[entry.level] || 0) + 1;
        this.logStats.byCategory[entry.category] = (this.logStats.byCategory[entry.category] || 0) + 1;
        this.logStats.byUser[entry.userId] = (this.logStats.byUser[entry.userId] || 0) + 1;
    }

    /**
     * Generate log ID
     */
    generateLogId() {
        return `log_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Get audit statistics
     */
    getStatistics() {
        return {
            ...this.logStats,
            currentLogFile: this.currentLogFile,
            alerts: this.alerts.size,
            complianceMode: this.config.complianceMode,
            encryptionEnabled: this.config.encryptionEnabled,
            retentionPolicies: Array.from(this.retentionPolicies.keys())
        };
    }

    /**
     * Cleanup audit module
     */
    async cleanup() {
        try {
            // Close log stream
            if (this.logStream) {
                this.logStream.end();
            }
            
            // Clear data
            this.logs = [];
            this.logIndex.clear();
            this.alerts.clear();
            
            console.log('Audit module cleaned up');
            return { success: true };
        } catch (error) {
            console.error('Failed to cleanup audit module:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = AuditModule;