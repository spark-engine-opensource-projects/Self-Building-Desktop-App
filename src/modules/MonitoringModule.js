const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');
const prometheus = require('prom-client');
const StatsD = require('node-statsd');
const winston = require('winston');
const ElasticsearchTransport = require('winston-elasticsearch');

class MonitoringModule extends EventEmitter {
    constructor() {
        super();
        this.metrics = new Map();
        this.alerts = new Map();
        this.collectors = new Map();
        this.dashboards = new Map();
        this.exporters = new Map();
        this.timeSeries = new Map();
        this.thresholds = new Map();
        this.incidents = new Map();
        this.initialized = false;
        
        // Prometheus registry
        this.prometheusRegistry = new prometheus.Registry();
        
        // StatsD client
        this.statsd = null;
        
        // Elasticsearch logger
        this.elasticsearchLogger = null;
        
        // Performance tracking
        this.performanceMetrics = {
            cpu: [],
            memory: [],
            disk: [],
            network: [],
            custom: new Map()
        };
        
        // Alert configuration
        this.alertConfig = {
            cpu: { threshold: 80, duration: 300000 },
            memory: { threshold: 85, duration: 300000 },
            disk: { threshold: 90, duration: 600000 },
            errorRate: { threshold: 5, duration: 60000 },
            responseTime: { threshold: 1000, duration: 120000 }
        };
        
        // Monitoring intervals
        this.intervals = new Map();
    }

    async initialize(config = {}) {
        if (this.initialized) {
            return;
        }

        try {
            // Initialize Prometheus metrics
            this.initializePrometheusMetrics();
            
            // Initialize StatsD if configured
            if (config.statsd) {
                this.initializeStatsD(config.statsd);
            }
            
            // Initialize Elasticsearch if configured
            if (config.elasticsearch) {
                this.initializeElasticsearch(config.elasticsearch);
            }
            
            // Setup system metrics collection
            this.setupSystemMetricsCollection();
            
            // Setup application metrics
            this.setupApplicationMetrics();
            
            // Setup custom metrics
            this.setupCustomMetrics();
            
            // Initialize alert monitoring
            this.initializeAlertMonitoring();
            
            // Setup metric exporters
            this.setupMetricExporters();
            
            // Start monitoring
            this.startMonitoring();
            
            this.initialized = true;
            logger.info('Monitoring module initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize monitoring module', error);
            throw error;
        }
    }

    initializePrometheusMetrics() {
        // System metrics
        this.metrics.set('cpu_usage', new prometheus.Gauge({
            name: 'app_cpu_usage_percent',
            help: 'CPU usage percentage',
            registers: [this.prometheusRegistry]
        }));
        
        this.metrics.set('memory_usage', new prometheus.Gauge({
            name: 'app_memory_usage_bytes',
            help: 'Memory usage in bytes',
            registers: [this.prometheusRegistry]
        }));
        
        this.metrics.set('memory_percentage', new prometheus.Gauge({
            name: 'app_memory_usage_percent',
            help: 'Memory usage percentage',
            registers: [this.prometheusRegistry]
        }));
        
        // Application metrics
        this.metrics.set('request_duration', new prometheus.Histogram({
            name: 'app_request_duration_seconds',
            help: 'Request duration in seconds',
            labelNames: ['method', 'route', 'status'],
            buckets: [0.1, 0.5, 1, 2, 5, 10],
            registers: [this.prometheusRegistry]
        }));
        
        this.metrics.set('request_total', new prometheus.Counter({
            name: 'app_requests_total',
            help: 'Total number of requests',
            labelNames: ['method', 'route', 'status'],
            registers: [this.prometheusRegistry]
        }));
        
        this.metrics.set('error_total', new prometheus.Counter({
            name: 'app_errors_total',
            help: 'Total number of errors',
            labelNames: ['type', 'severity'],
            registers: [this.prometheusRegistry]
        }));
        
        // Business metrics
        this.metrics.set('active_sessions', new prometheus.Gauge({
            name: 'app_active_sessions',
            help: 'Number of active sessions',
            registers: [this.prometheusRegistry]
        }));
        
        this.metrics.set('code_generations', new prometheus.Counter({
            name: 'app_code_generations_total',
            help: 'Total code generations',
            labelNames: ['status'],
            registers: [this.prometheusRegistry]
        }));
        
        this.metrics.set('database_connections', new prometheus.Gauge({
            name: 'app_database_connections',
            help: 'Active database connections',
            labelNames: ['database'],
            registers: [this.prometheusRegistry]
        }));
        
        // Custom metrics
        this.metrics.set('custom_gauge', new prometheus.Gauge({
            name: 'app_custom_gauge',
            help: 'Custom gauge metric',
            labelNames: ['name'],
            registers: [this.prometheusRegistry]
        }));
        
        this.metrics.set('custom_counter', new prometheus.Counter({
            name: 'app_custom_counter',
            help: 'Custom counter metric',
            labelNames: ['name'],
            registers: [this.prometheusRegistry]
        }));
    }

    initializeStatsD(config) {
        this.statsd = new StatsD({
            host: config.host || 'localhost',
            port: config.port || 8125,
            prefix: config.prefix || 'app.',
            cacheDns: true
        });
        
        logger.info('StatsD client initialized', { 
            host: config.host,
            port: config.port 
        });
    }

    initializeElasticsearch(config) {
        const esTransport = new ElasticsearchTransport({
            level: 'info',
            clientOpts: {
                node: config.node || 'http://localhost:9200',
                auth: config.auth
            },
            index: config.index || 'app-monitoring',
            dataStream: true,
            transformer: (logData) => {
                return {
                    '@timestamp': new Date().toISOString(),
                    message: logData.message,
                    severity: logData.level,
                    fields: logData.meta
                };
            }
        });
        
        this.elasticsearchLogger = winston.createLogger({
            transports: [esTransport]
        });
        
        logger.info('Elasticsearch logger initialized', {
            node: config.node,
            index: config.index
        });
    }

    setupSystemMetricsCollection() {
        // CPU metrics collector
        this.collectors.set('cpu', setInterval(() => {
            const cpus = os.cpus();
            const cpuUsage = this.calculateCPUUsage(cpus);
            
            // Update Prometheus
            this.metrics.get('cpu_usage').set(cpuUsage);
            
            // Update StatsD
            if (this.statsd) {
                this.statsd.gauge('system.cpu.usage', cpuUsage);
            }
            
            // Store in time series
            this.addTimeSeriesData('cpu', cpuUsage);
            
            // Check alerts
            this.checkThreshold('cpu', cpuUsage);
        }, 5000));
        
        // Memory metrics collector
        this.collectors.set('memory', setInterval(() => {
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memPercentage = (usedMem / totalMem) * 100;
            
            // Update Prometheus
            this.metrics.get('memory_usage').set(usedMem);
            this.metrics.get('memory_percentage').set(memPercentage);
            
            // Update StatsD
            if (this.statsd) {
                this.statsd.gauge('system.memory.used', usedMem);
                this.statsd.gauge('system.memory.percentage', memPercentage);
            }
            
            // Store in time series
            this.addTimeSeriesData('memory', memPercentage);
            
            // Check alerts
            this.checkThreshold('memory', memPercentage);
        }, 5000));
        
        // Disk metrics collector
        this.collectors.set('disk', setInterval(async () => {
            try {
                const diskUsage = await this.getDiskUsage();
                
                // Update StatsD
                if (this.statsd) {
                    this.statsd.gauge('system.disk.usage', diskUsage.percentage);
                }
                
                // Store in time series
                this.addTimeSeriesData('disk', diskUsage.percentage);
                
                // Check alerts
                this.checkThreshold('disk', diskUsage.percentage);
            } catch (error) {
                logger.error('Failed to collect disk metrics', error);
            }
        }, 30000));
    }

    setupApplicationMetrics() {
        // Setup application-specific metric collectors
        this.collectors.set('application', {
            recordRequest: (method, route, status, duration) => {
                this.metrics.get('request_total').inc({ method, route, status });
                this.metrics.get('request_duration').observe({ method, route, status }, duration);
                
                if (this.statsd) {
                    this.statsd.increment(`requests.${method}.${status}`);
                    this.statsd.timing('request.duration', duration * 1000);
                }
                
                // Check response time threshold
                if (duration > this.alertConfig.responseTime.threshold / 1000) {
                    this.createIncident('slow_response', {
                        method,
                        route,
                        duration,
                        threshold: this.alertConfig.responseTime.threshold
                    });
                }
            },
            
            recordError: (type, severity) => {
                this.metrics.get('error_total').inc({ type, severity });
                
                if (this.statsd) {
                    this.statsd.increment(`errors.${type}.${severity}`);
                }
                
                // Log to Elasticsearch
                if (this.elasticsearchLogger) {
                    this.elasticsearchLogger.error('Application error', {
                        type,
                        severity,
                        timestamp: new Date().toISOString()
                    });
                }
            },
            
            updateActiveSessions: (count) => {
                this.metrics.get('active_sessions').set(count);
                
                if (this.statsd) {
                    this.statsd.gauge('sessions.active', count);
                }
            },
            
            recordCodeGeneration: (status) => {
                this.metrics.get('code_generations').inc({ status });
                
                if (this.statsd) {
                    this.statsd.increment(`code_generation.${status}`);
                }
            },
            
            updateDatabaseConnections: (database, count) => {
                this.metrics.get('database_connections').set({ database }, count);
                
                if (this.statsd) {
                    this.statsd.gauge(`database.connections.${database}`, count);
                }
            }
        });
    }

    setupCustomMetrics() {
        // Allow registration of custom metrics
        this.customMetricHandlers = {
            gauge: (name, value, labels = {}) => {
                this.metrics.get('custom_gauge').set({ name, ...labels }, value);
                
                if (this.statsd) {
                    this.statsd.gauge(`custom.${name}`, value);
                }
                
                // Store in custom time series
                if (!this.performanceMetrics.custom.has(name)) {
                    this.performanceMetrics.custom.set(name, []);
                }
                this.performanceMetrics.custom.get(name).push({
                    timestamp: Date.now(),
                    value,
                    labels
                });
            },
            
            counter: (name, increment = 1, labels = {}) => {
                this.metrics.get('custom_counter').inc({ name, ...labels }, increment);
                
                if (this.statsd) {
                    this.statsd.increment(`custom.${name}`, increment);
                }
            },
            
            histogram: (name, value, labels = {}) => {
                // Create histogram if not exists
                if (!this.metrics.has(`custom_histogram_${name}`)) {
                    const histogram = new prometheus.Histogram({
                        name: `app_custom_${name}`,
                        help: `Custom histogram for ${name}`,
                        labelNames: Object.keys(labels),
                        registers: [this.prometheusRegistry]
                    });
                    this.metrics.set(`custom_histogram_${name}`, histogram);
                }
                
                this.metrics.get(`custom_histogram_${name}`).observe(labels, value);
                
                if (this.statsd) {
                    this.statsd.timing(`custom.${name}`, value);
                }
            }
        };
    }

    initializeAlertMonitoring() {
        // Setup alert evaluation
        this.intervals.set('alert_evaluation', setInterval(() => {
            this.evaluateAlerts();
        }, 10000));
        
        // Setup incident cleanup
        this.intervals.set('incident_cleanup', setInterval(() => {
            this.cleanupIncidents();
        }, 300000)); // Every 5 minutes
    }

    setupMetricExporters() {
        // Prometheus exporter
        this.exporters.set('prometheus', {
            getMetrics: async () => {
                return await this.prometheusRegistry.metrics();
            },
            
            getContentType: () => {
                return this.prometheusRegistry.contentType;
            }
        });
        
        // JSON exporter
        this.exporters.set('json', {
            getMetrics: async () => {
                const metrics = {};
                
                // System metrics
                metrics.system = {
                    cpu: this.getLatestTimeSeriesValue('cpu'),
                    memory: this.getLatestTimeSeriesValue('memory'),
                    disk: this.getLatestTimeSeriesValue('disk')
                };
                
                // Application metrics
                metrics.application = {
                    activeSessions: this.metrics.get('active_sessions')._getValue(),
                    totalRequests: await this.getMetricValue('request_total'),
                    totalErrors: await this.getMetricValue('error_total'),
                    codeGenerations: await this.getMetricValue('code_generations')
                };
                
                // Custom metrics
                metrics.custom = {};
                for (const [name, values] of this.performanceMetrics.custom) {
                    const latest = values[values.length - 1];
                    metrics.custom[name] = latest ? latest.value : null;
                }
                
                // Alerts
                metrics.alerts = Array.from(this.alerts.values());
                
                // Incidents
                metrics.incidents = Array.from(this.incidents.values());
                
                return metrics;
            }
        });
        
        // CSV exporter
        this.exporters.set('csv', {
            getMetrics: async () => {
                const rows = [];
                rows.push('timestamp,metric,value,labels');
                
                const timestamp = new Date().toISOString();
                
                // Add all metrics
                for (const [name, metric] of this.metrics) {
                    const value = await this.getMetricValue(name);
                    rows.push(`${timestamp},${name},${value},`);
                }
                
                // Add time series data
                for (const [name, values] of this.performanceMetrics.custom) {
                    const latest = values[values.length - 1];
                    if (latest) {
                        const labels = JSON.stringify(latest.labels || {});
                        rows.push(`${timestamp},custom_${name},${latest.value},"${labels}"`);
                    }
                }
                
                return rows.join('\n');
            }
        });
    }

    startMonitoring() {
        // Start health check monitoring
        this.intervals.set('health_check', setInterval(() => {
            this.performHealthCheck();
        }, 60000));
        
        // Start metrics aggregation
        this.intervals.set('aggregation', setInterval(() => {
            this.aggregateMetrics();
        }, 30000));
        
        logger.info('Monitoring started');
    }

    // Metric recording methods
    recordRequest(method, route, status, duration) {
        const collector = this.collectors.get('application');
        if (collector) {
            collector.recordRequest(method, route, status, duration);
        }
    }

    recordError(type, severity = 'error') {
        const collector = this.collectors.get('application');
        if (collector) {
            collector.recordError(type, severity);
        }
    }

    updateActiveSessions(count) {
        const collector = this.collectors.get('application');
        if (collector) {
            collector.updateActiveSessions(count);
        }
    }

    recordCodeGeneration(status) {
        const collector = this.collectors.get('application');
        if (collector) {
            collector.recordCodeGeneration(status);
        }
    }

    updateDatabaseConnections(database, count) {
        const collector = this.collectors.get('application');
        if (collector) {
            collector.updateDatabaseConnections(database, count);
        }
    }

    // Custom metric methods
    recordCustomMetric(type, name, value, labels = {}) {
        if (this.customMetricHandlers[type]) {
            this.customMetricHandlers[type](name, value, labels);
        }
    }

    // Alert management
    createAlert(name, config) {
        const alert = {
            id: `alert_${Date.now()}_${name}`,
            name,
            ...config,
            created: new Date().toISOString(),
            status: 'active',
            triggered: false,
            lastCheck: null
        };
        
        this.alerts.set(alert.id, alert);
        logger.info('Alert created', { alert: alert.id, name });
        
        return alert.id;
    }

    updateAlert(alertId, updates) {
        const alert = this.alerts.get(alertId);
        if (alert) {
            Object.assign(alert, updates);
            logger.info('Alert updated', { alert: alertId });
        }
    }

    deleteAlert(alertId) {
        if (this.alerts.delete(alertId)) {
            logger.info('Alert deleted', { alert: alertId });
        }
    }

    evaluateAlerts() {
        for (const alert of this.alerts.values()) {
            if (alert.status !== 'active') continue;
            
            try {
                const value = this.getMetricForAlert(alert);
                const shouldTrigger = this.evaluateAlertCondition(alert, value);
                
                if (shouldTrigger && !alert.triggered) {
                    this.triggerAlert(alert, value);
                } else if (!shouldTrigger && alert.triggered) {
                    this.resolveAlert(alert);
                }
                
                alert.lastCheck = new Date().toISOString();
            } catch (error) {
                logger.error('Failed to evaluate alert', error, { alert: alert.id });
            }
        }
    }

    // Incident management
    createIncident(type, details) {
        const incident = {
            id: `incident_${Date.now()}_${type}`,
            type,
            details,
            created: new Date().toISOString(),
            resolved: false,
            resolvedAt: null,
            severity: this.calculateIncidentSeverity(type, details)
        };
        
        this.incidents.set(incident.id, incident);
        
        // Log to Elasticsearch
        if (this.elasticsearchLogger) {
            this.elasticsearchLogger.warn('Incident created', incident);
        }
        
        // Emit event
        this.emit('incident', incident);
        
        logger.warn('Incident created', { incident: incident.id, type });
        
        return incident.id;
    }

    resolveIncident(incidentId) {
        const incident = this.incidents.get(incidentId);
        if (incident && !incident.resolved) {
            incident.resolved = true;
            incident.resolvedAt = new Date().toISOString();
            
            // Log resolution
            if (this.elasticsearchLogger) {
                this.elasticsearchLogger.info('Incident resolved', incident);
            }
            
            logger.info('Incident resolved', { incident: incidentId });
        }
    }

    cleanupIncidents() {
        const cutoff = Date.now() - 86400000; // 24 hours
        
        for (const [id, incident] of this.incidents) {
            if (incident.resolved && new Date(incident.resolvedAt).getTime() < cutoff) {
                this.incidents.delete(id);
            }
        }
    }

    // Dashboard management
    createDashboard(name, config) {
        const dashboard = {
            id: `dashboard_${Date.now()}_${name}`,
            name,
            widgets: config.widgets || [],
            layout: config.layout || 'grid',
            refreshInterval: config.refreshInterval || 30000,
            created: new Date().toISOString()
        };
        
        this.dashboards.set(dashboard.id, dashboard);
        logger.info('Dashboard created', { dashboard: dashboard.id, name });
        
        return dashboard.id;
    }

    getDashboardData(dashboardId) {
        const dashboard = this.dashboards.get(dashboardId);
        if (!dashboard) {
            throw new Error(`Dashboard ${dashboardId} not found`);
        }
        
        const data = {
            ...dashboard,
            widgetData: {}
        };
        
        for (const widget of dashboard.widgets) {
            data.widgetData[widget.id] = this.getWidgetData(widget);
        }
        
        return data;
    }

    getWidgetData(widget) {
        switch (widget.type) {
            case 'timeseries':
                return this.getTimeSeriesData(widget.metric, widget.duration);
            case 'gauge':
                return this.getLatestTimeSeriesValue(widget.metric);
            case 'counter':
                return this.getMetricValue(widget.metric);
            case 'table':
                return this.getTableData(widget.query);
            default:
                return null;
        }
    }

    // Time series management
    addTimeSeriesData(metric, value) {
        if (!this.timeSeries.has(metric)) {
            this.timeSeries.set(metric, []);
        }
        
        const series = this.timeSeries.get(metric);
        series.push({
            timestamp: Date.now(),
            value
        });
        
        // Keep only last hour of data
        const cutoff = Date.now() - 3600000;
        const index = series.findIndex(point => point.timestamp >= cutoff);
        if (index > 0) {
            series.splice(0, index);
        }
    }

    getTimeSeriesData(metric, duration = 3600000) {
        const series = this.timeSeries.get(metric) || [];
        const cutoff = Date.now() - duration;
        
        return series.filter(point => point.timestamp >= cutoff);
    }

    getLatestTimeSeriesValue(metric) {
        const series = this.timeSeries.get(metric) || [];
        return series.length > 0 ? series[series.length - 1].value : null;
    }

    // Helper methods
    calculateCPUUsage(cpus) {
        let totalIdle = 0;
        let totalTick = 0;
        
        for (const cpu of cpus) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        }
        
        return 100 - ~~(100 * totalIdle / totalTick);
    }

    async getDiskUsage() {
        // Simplified disk usage calculation
        // In production, use a library like diskusage
        return {
            total: 100000000000, // 100GB
            used: 50000000000,   // 50GB
            free: 50000000000,   // 50GB
            percentage: 50
        };
    }

    async getMetricValue(name) {
        const metric = this.metrics.get(name);
        if (!metric) return null;
        
        // Get metric value based on type
        if (metric._type === 'counter') {
            return metric._getValue();
        } else if (metric._type === 'gauge') {
            return metric._getValue();
        } else if (metric._type === 'histogram') {
            const values = await metric.get().values;
            return values[values.length - 1]?.value || 0;
        }
        
        return null;
    }

    checkThreshold(metric, value) {
        const config = this.alertConfig[metric];
        if (!config) return;
        
        if (!this.thresholds.has(metric)) {
            this.thresholds.set(metric, {
                exceededAt: null,
                value: null
            });
        }
        
        const threshold = this.thresholds.get(metric);
        
        if (value > config.threshold) {
            if (!threshold.exceededAt) {
                threshold.exceededAt = Date.now();
                threshold.value = value;
            } else if (Date.now() - threshold.exceededAt > config.duration) {
                // Threshold exceeded for duration
                this.createIncident(`${metric}_threshold_exceeded`, {
                    metric,
                    value,
                    threshold: config.threshold,
                    duration: config.duration
                });
                threshold.exceededAt = null;
            }
        } else {
            threshold.exceededAt = null;
            threshold.value = null;
        }
    }

    getMetricForAlert(alert) {
        // Get metric value based on alert configuration
        if (alert.metric) {
            return this.getLatestTimeSeriesValue(alert.metric);
        } else if (alert.query) {
            // Execute custom query
            return this.executeMetricQuery(alert.query);
        }
        return null;
    }

    evaluateAlertCondition(alert, value) {
        if (value === null) return false;
        
        switch (alert.condition) {
            case 'gt':
                return value > alert.threshold;
            case 'gte':
                return value >= alert.threshold;
            case 'lt':
                return value < alert.threshold;
            case 'lte':
                return value <= alert.threshold;
            case 'eq':
                return value === alert.threshold;
            case 'neq':
                return value !== alert.threshold;
            default:
                return false;
        }
    }

    triggerAlert(alert, value) {
        alert.triggered = true;
        alert.triggeredAt = new Date().toISOString();
        alert.triggeredValue = value;
        
        // Create incident
        this.createIncident(`alert_${alert.name}`, {
            alert: alert.id,
            name: alert.name,
            value,
            threshold: alert.threshold,
            condition: alert.condition
        });
        
        // Emit event
        this.emit('alert_triggered', alert);
        
        logger.warn('Alert triggered', { 
            alert: alert.id,
            name: alert.name,
            value 
        });
    }

    resolveAlert(alert) {
        alert.triggered = false;
        alert.resolvedAt = new Date().toISOString();
        
        // Emit event
        this.emit('alert_resolved', alert);
        
        logger.info('Alert resolved', { 
            alert: alert.id,
            name: alert.name 
        });
    }

    calculateIncidentSeverity(type, details) {
        // Calculate severity based on type and details
        if (type.includes('threshold_exceeded')) {
            const exceedance = (details.value - details.threshold) / details.threshold;
            if (exceedance > 0.5) return 'critical';
            if (exceedance > 0.25) return 'high';
            return 'medium';
        }
        
        if (type === 'slow_response') {
            const ratio = details.duration / (details.threshold / 1000);
            if (ratio > 2) return 'high';
            if (ratio > 1.5) return 'medium';
            return 'low';
        }
        
        return 'medium';
    }

    executeMetricQuery(query) {
        // Execute custom metric query
        // This is a simplified implementation
        try {
            const parts = query.split('.');
            let value = this;
            
            for (const part of parts) {
                value = value[part];
                if (value === undefined) return null;
            }
            
            return typeof value === 'function' ? value() : value;
        } catch (error) {
            logger.error('Failed to execute metric query', error, { query });
            return null;
        }
    }

    aggregateMetrics() {
        // Aggregate metrics for reporting
        const aggregated = {
            timestamp: new Date().toISOString(),
            system: {
                cpu: {
                    avg: this.calculateAverage(this.getTimeSeriesData('cpu', 300000)),
                    max: this.calculateMax(this.getTimeSeriesData('cpu', 300000)),
                    current: this.getLatestTimeSeriesValue('cpu')
                },
                memory: {
                    avg: this.calculateAverage(this.getTimeSeriesData('memory', 300000)),
                    max: this.calculateMax(this.getTimeSeriesData('memory', 300000)),
                    current: this.getLatestTimeSeriesValue('memory')
                }
            },
            incidents: {
                active: Array.from(this.incidents.values()).filter(i => !i.resolved).length,
                total: this.incidents.size
            },
            alerts: {
                triggered: Array.from(this.alerts.values()).filter(a => a.triggered).length,
                total: this.alerts.size
            }
        };
        
        // Log aggregated metrics
        if (this.elasticsearchLogger) {
            this.elasticsearchLogger.info('Metrics aggregated', aggregated);
        }
        
        return aggregated;
    }

    calculateAverage(dataPoints) {
        if (dataPoints.length === 0) return 0;
        const sum = dataPoints.reduce((acc, point) => acc + point.value, 0);
        return sum / dataPoints.length;
    }

    calculateMax(dataPoints) {
        if (dataPoints.length === 0) return 0;
        return Math.max(...dataPoints.map(point => point.value));
    }

    performHealthCheck() {
        const health = {
            status: 'healthy',
            checks: {
                metrics: this.metrics.size > 0,
                collectors: this.collectors.size > 0,
                monitoring: this.intervals.size > 0,
                alerts: true,
                incidents: true
            },
            timestamp: new Date().toISOString()
        };
        
        // Check if any critical alerts are triggered
        const criticalAlerts = Array.from(this.alerts.values())
            .filter(a => a.triggered && a.severity === 'critical');
        
        if (criticalAlerts.length > 0) {
            health.status = 'unhealthy';
            health.criticalAlerts = criticalAlerts.map(a => ({
                id: a.id,
                name: a.name,
                triggeredAt: a.triggeredAt
            }));
        }
        
        // Check if too many incidents
        const activeIncidents = Array.from(this.incidents.values())
            .filter(i => !i.resolved);
        
        if (activeIncidents.length > 10) {
            health.status = 'degraded';
            health.activeIncidents = activeIncidents.length;
        }
        
        // Emit health check event
        this.emit('health_check', health);
        
        return health;
    }

    // Export methods
    async exportMetrics(format = 'prometheus') {
        const exporter = this.exporters.get(format);
        if (!exporter) {
            throw new Error(`Unsupported export format: ${format}`);
        }
        
        return await exporter.getMetrics();
    }

    getPrometheusMetrics() {
        return this.exporters.get('prometheus').getMetrics();
    }

    getPrometheusContentType() {
        return this.exporters.get('prometheus').getContentType();
    }

    // Cleanup
    async shutdown() {
        try {
            // Clear all intervals
            for (const interval of this.intervals.values()) {
                clearInterval(interval);
            }
            this.intervals.clear();
            
            // Clear all collectors
            for (const [name, collector] of this.collectors) {
                if (typeof collector === 'object' && collector.stop) {
                    collector.stop();
                } else {
                    clearInterval(collector);
                }
            }
            this.collectors.clear();
            
            // Close StatsD connection
            if (this.statsd) {
                this.statsd.close();
            }
            
            // Clear metrics
            this.metrics.clear();
            this.alerts.clear();
            this.incidents.clear();
            this.timeSeries.clear();
            
            this.initialized = false;
            logger.info('Monitoring module shut down successfully');
        } catch (error) {
            logger.error('Failed to shut down monitoring module', error);
            throw error;
        }
    }
}

module.exports = MonitoringModule;