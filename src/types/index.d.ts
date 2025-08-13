// Type definitions for Dynamic App Builder

export interface ElectronAPI {
  // Core functionality
  setApiKey(apiKey: string): Promise<APIResponse<void>>;
  generateCode(prompt: string): Promise<CodeGenerationResponse>;
  executeCode(params: CodeExecutionParams): Promise<ExecutionResponse>;
  executeDOMCode(params: DOMExecutionParams): Promise<ExecutionResponse>;
  cleanupSession(sessionId: string): Promise<APIResponse<void>>;
  selectApiKeyFile(): Promise<APIResponse<{ apiKey: string }>>;
  
  // Session management
  createSession(sessionId: string, prompt?: string): Promise<APIResponse<SessionObject>>;
  getSession(sessionId: string): Promise<APIResponse<SessionObject>>;
  getSessionHistory(limit?: number): Promise<APIResponse<SessionSummary[]>>;
  getSessionStats(): Promise<APIResponse<SessionStats>>;
  exportSessions(): Promise<APIResponse<SessionExport>>;
  
  // Configuration
  getConfig(): Promise<APIResponse<ConfigObject>>;
  updateConfig(config: Partial<ConfigObject>): Promise<APIResponse<ConfigObject>>;
  
  // Security
  scanCodeSecurity(code: string): Promise<APIResponse<SecurityScanResult>>;
  
  // Monitoring
  getSystemHealth(): Promise<APIResponse<SystemHealth>>;
  getActiveSessions(): Promise<APIResponse<ActiveSession[]>>;
  
  // Cache management
  getCacheStats(): Promise<APIResponse<CacheStats>>;
  clearCache(): Promise<APIResponse<void>>;
  updateCacheConfig(config: CacheConfig): Promise<APIResponse<CacheConfig>>;
  
  // Updates and feedback
  checkForUpdates(): Promise<APIResponse<UpdateInfo>>;
  submitFeedback(feedback: UserFeedback): Promise<APIResponse<void>>;
  
  // Utility
  generateSessionId(): string;
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string[];
}

export interface CodeGenerationResponse extends APIResponse<CodeGenerationData> {
  metadata?: {
    processingTime: number;
    retryCount: number;
    enhanced: boolean;
    fromCache?: boolean;
    cacheHit?: boolean;
    totalTime?: number;
  };
}

export interface CodeGenerationData {
  packages: string[];
  code: string;
  description: string;
}

export interface CodeExecutionParams {
  code: string;
  packages?: string[];
  sessionId: string;
}

export interface DOMExecutionParams {
  code: string;
  sessionId: string;
}

export interface ExecutionResponse extends APIResponse<void> {
  output?: string;
  errors?: string;
  exitCode?: number;
  logs?: LogEntry[];
  executionTime?: number;
}

export interface LogEntry {
  type: 'log' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface SessionObject {
  id: string;
  created: string;
  lastModified: string;
  prompt: string;
  generatedCode?: string;
  packages: string[];
  executionHistory: ExecutionHistoryEntry[];
  config: Record<string, any>;
  status: 'created' | 'code_generated' | 'executing' | 'executed_success' | 'executed_failed';
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  totalExecutions: number;
  successfulExecutions: number;
  lastExecution?: string;
  codeLength: number;
}

export interface ExecutionHistoryEntry {
  timestamp: string;
  success: boolean;
  output?: string;
  errors?: string;
  duration: number;
}

export interface SessionSummary {
  id: string;
  created: string;
  lastModified: string;
  prompt: string;
  status: string;
  metadata: SessionMetadata;
}

export interface SessionStats {
  totalSessions: number;
  totalExecutions: number;
  successfulExecutions: number;
  averageCodeLength: number;
  statusDistribution: Record<string, number>;
  recentActivity: number;
}

export interface SessionExport {
  exported: string;
  version: string;
  sessions: SessionObject[];
}

export interface ConfigObject {
  execution: ExecutionConfig;
  security: SecurityConfig;
  monitoring: MonitoringConfig;
  ai: AIConfig;
  ui: UIConfig;
}

export interface ExecutionConfig {
  maxConcurrentExecutions: number;
  executionTimeout: number;
  maxMemoryMB: number;
  maxOutputSize: number;
  maxDiskSpaceMB: number;
}

export interface SecurityConfig {
  enableResourceMonitoring: boolean;
  logAllExecutions: boolean;
  blockSuspiciousPackages: boolean;
  maxPromptLength: number;
  requireApiKeyFile: boolean;
}

export interface MonitoringConfig {
  healthCheckInterval: number;
  maxLogFileSize: number;
  maxLogFiles: number;
  enableMetrics: boolean;
}

export interface AIConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  enableCodeValidation: boolean;
}

export interface UIConfig {
  enableDevTools: boolean;
  autoSavePrompts: boolean;
  maxHistoryItems: number;
  darkMode?: boolean;
}

export interface SecurityScanResult {
  safe: boolean;
  issues: SecurityIssue[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface SecurityIssue {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  pattern?: string;
  line?: number;
}

export interface SystemHealth {
  cpu: {
    usage: number;
    status: 'healthy' | 'warning' | 'critical';
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usage: number;
    status: 'healthy' | 'warning' | 'critical';
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usage: number;
    status: 'healthy' | 'warning' | 'critical';
  };
}

export interface ActiveSession {
  id: string;
  startTime: number;
  packages: string[];
  codeLength: number;
  duration: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hitRate: string;
  hits: number;
  misses: number;
  evictions: number;
  totalRequests: number;
  config: CacheConfig;
}

export interface CacheConfig {
  enabled: boolean;
  ttl: number;
  maxSimilarity: number;
  maxPromptLength: number;
  maxCacheSize?: number;
}

export interface UpdateInfo {
  version?: string;
  releaseDate?: string;
  downloadURL?: string;
  releaseNotes?: string;
}

export interface UserFeedback {
  sessionId: string;
  rating: 'good' | 'bad';
  prompt?: string;
  timestamp?: number;
  comment?: string;
}

export interface CircuitBreakerStats {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  successes: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: string;
  lastFailureTime?: string;
  lastSuccessTime?: string;
  nextAttempt?: string;
}

export interface PerformanceMetrics {
  requestDuration: number;
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  timestamp: number;
  operation: string;
}

// Global declarations
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    app: any; // DynamicAppRenderer instance
  }
}

export {};