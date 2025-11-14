# API Documentation - Self-Building Desktop Application

## Table of Contents
1. [Overview](#overview)
2. [Core Modules](#core-modules)
3. [Utility Modules](#utility-modules)
4. [Security Modules](#security-modules)
5. [Feature Modules](#feature-modules)
6. [IPC Communication](#ipc-communication)
7. [Error Codes](#error-codes)
8. [Examples](#examples)

---

## Overview

The Self-Building Desktop Application provides a comprehensive API for AI-powered code generation, project management, and development automation. This documentation covers all public APIs, their usage, and best practices.

### Base Configuration
```javascript
{
  apiKey: 'your-anthropic-api-key',
  apiEndpoint: 'https://api.anthropic.com',
  dataPath: './data',
  logsPath: './logs',
  maxRetries: 3,
  timeout: 30000
}
```

---

## Core Modules

### `set-api-key`
Sets the Anthropic API key for code generation.

**Parameters:**
- `apiKey` (string, required): The Anthropic API key

**Returns:**
```javascript
{
  success: boolean,
  error?: string
}
```

**Example:**
```javascript
await window.electronAPI.setApiKey('sk-ant-...');
```

---

### `generate-code`
Generates code from a natural language prompt.

**Parameters:**
- `prompt` (string, required): Natural language description (max 10,000 chars)

**Returns:**
```javascript
{
  success: boolean,
  data?: {
    packages: string[],
    code: string,
    description: string
  },
  metadata?: {
    processingTime: number,
    retryCount: number,
    enhanced: boolean,
    fromCache?: boolean
  },
  error?: string
}
```

**Example:**
```javascript
const result = await window.electronAPI.generateCode('Create a todo list app');
```

---

### `execute-code`
Executes generated code in a sandboxed Node.js environment.

**Parameters:**
- `code` (string, required): JavaScript code to execute
- `packages` (string[], optional): NPM packages to install
- `sessionId` (string, required): Session identifier

**Returns:**
```javascript
{
  success: boolean,
  output?: string,
  errors?: string,
  exitCode?: number
}
```

**Example:**
```javascript
await window.electronAPI.executeCode({
  code: 'console.log("Hello World")',
  packages: ['lodash'],
  sessionId: 'session_123_abc'
});
```

---

### `execute-dom-code`
Executes DOM-based code in the renderer process.

**Parameters:**
- `code` (string, required): DOM manipulation code
- `sessionId` (string, required): Session identifier

**Returns:**
```javascript
{
  success: boolean,
  output?: string,
  logs?: Array<{type: string, message: string, timestamp: number}>
}
```

---

## Session Management

### `create-session`
Creates a new session for tracking code generation and execution.

**Parameters:**
- `sessionId` (string, required): Unique session identifier
- `prompt` (string, optional): Initial prompt for the session

**Returns:**
```javascript
{
  success: boolean,
  session?: {
    id: string,
    created: string,
    status: string,
    metadata: object
  }
}
```

---

### `get-session`
Retrieves session information.

**Parameters:**
- `sessionId` (string, required): Session identifier

**Returns:**
```javascript
{
  success: boolean,
  session?: SessionObject
}
```

---

### `get-session-history`
Gets recent session history.

**Parameters:**
- `limit` (number, optional): Maximum number of sessions (1-100, default: 20)

**Returns:**
```javascript
{
  success: boolean,
  history?: Array<SessionSummary>
}
```

---

### `get-session-stats`
Gets aggregated session statistics.

**Parameters:** None

**Returns:**
```javascript
{
  success: boolean,
  stats?: {
    totalSessions: number,
    totalExecutions: number,
    successfulExecutions: number,
    averageCodeLength: number,
    statusDistribution: object,
    recentActivity: number
  }
}
```

---

### `cleanup-session`
Cleans up a session and its temporary files.

**Parameters:**
- `sessionId` (string, required): Session identifier

**Returns:**
```javascript
{
  success: boolean,
  error?: string
}
```

---

### `export-sessions`
Exports all sessions for backup.

**Parameters:** None

**Returns:**
```javascript
{
  success: boolean,
  data?: {
    exported: string,
    version: string,
    sessions: Array<SessionObject>
  }
}
```

---

## Configuration

### `get-config`
Retrieves current application configuration.

**Parameters:** None

**Returns:**
```javascript
{
  success: boolean,
  config?: ConfigObject
}
```

---

### `update-config`
Updates application configuration.

**Parameters:**
- `config` (object, required): Configuration updates

**Returns:**
```javascript
{
  success: boolean,
  config?: ConfigObject,
  error?: string
}
```

**Example:**
```javascript
await window.electronAPI.updateConfig({
  execution: {
    maxConcurrentExecutions: 5,
    executionTimeout: 60000
  }
});
```

---

## Security

### `scan-code-security`
Scans code for security issues before execution.

**Parameters:**
- `code` (string, required): Code to scan

**Returns:**
```javascript
{
  success: boolean,
  scan?: {
    safe: boolean,
    issues: Array<{
      type: string,
      severity: string,
      description: string
    }>,
    riskLevel: string
  }
}
```

---

### `select-api-key-file`
Opens file dialog to select API key file.

**Parameters:** None

**Returns:**
```javascript
{
  success: boolean,
  apiKey?: string,
  error?: string
}
```

---

## Monitoring

### `get-system-health`
Gets current system health metrics.

**Parameters:** None

**Returns:**
```javascript
{
  success: boolean,
  health?: {
    cpu: { usage: number, status: string },
    memory: { total: number, used: number, free: number, usage: number, status: string },
    disk: { total: number, used: number, free: number, usage: number, status: string }
  },
  stats?: ExecutionStats
}
```

---

### `get-active-sessions`
Gets list of currently active sessions.

**Parameters:** None

**Returns:**
```javascript
{
  success: boolean,
  sessions?: Array<{
    id: string,
    startTime: number,
    packages: string[],
    codeLength: number,
    duration: number
  }>
}
```

---

### `check-for-updates`
Checks for application updates.

**Parameters:** None

**Returns:**
```javascript
{
  success: boolean,
  result?: UpdateInfo,
  error?: string
}
```

---

## Cache Management

### `get-cache-stats`
Gets cache performance statistics.

**Parameters:** None

**Returns:**
```javascript
{
  success: boolean,
  stats?: {
    size: number,
    maxSize: number,
    hitRate: string,
    hits: number,
    misses: number,
    evictions: number,
    totalRequests: number,
    config: object
  }
}
```

---

### `clear-cache`
Clears the code generation cache.

**Parameters:** None

**Returns:**
```javascript
{
  success: boolean,
  error?: string
}
```

---

### `update-cache-config`
Updates cache configuration.

**Parameters:**
- `config` (object, required): Cache configuration

**Returns:**
```javascript
{
  success: boolean,
  config?: CacheConfig,
  error?: string
}
```

---

## User Feedback

### `submit-feedback`
Submits user feedback for a session.

**Parameters:**
- `feedback` (object, required):
  - `sessionId` (string, required): Session identifier
  - `rating` (string, required): 'good' or 'bad'
  - `prompt` (string, optional): Original prompt
  - `timestamp` (number, optional): Timestamp

**Returns:**
```javascript
{
  success: boolean,
  error?: string
}
```

---

## Error Handling

All IPC endpoints follow a consistent error handling pattern:

1. **Success Response:**
```javascript
{
  success: true,
  // ... endpoint-specific data
}
```

2. **Error Response:**
```javascript
{
  success: false,
  error: "Error message",
  details?: ["Validation error 1", "Validation error 2"]
}
```

## Rate Limiting

Some endpoints have rate limiting to prevent abuse:

- `generate-code`: 10 requests per minute
- `execute-code`: 20 requests per minute
- `scan-code-security`: 30 requests per minute

When rate limit is exceeded:
```javascript
{
  success: false,
  error: "Rate limit exceeded. Please try again later."
}
```

## Security Considerations

1. **Input Validation**: All inputs are validated and sanitized
2. **Session IDs**: Must match pattern `session_\d+_[a-z0-9]+`
3. **Code Length**: Maximum 100,000 characters
4. **Prompt Length**: Maximum 10,000 characters
5. **Package Filtering**: Dangerous packages are blocked

## Usage Example

```javascript
// Complete workflow example
async function generateAndExecute() {
  // Set API key
  await window.electronAPI.setApiKey('your-api-key');
  
  // Create session
  const sessionId = window.electronAPI.generateSessionId();
  await window.electronAPI.createSession(sessionId, 'Create a calculator');
  
  // Generate code
  const generated = await window.electronAPI.generateCode('Create a calculator');
  
  if (generated.success) {
    // Scan for security issues
    const scan = await window.electronAPI.scanCodeSecurity(generated.data.code);
    
    if (scan.scan.safe) {
      // Execute code
      const result = await window.electronAPI.executeCode({
        code: generated.data.code,
        packages: generated.data.packages,
        sessionId: sessionId
      });
      
      console.log('Execution result:', result);
    }
  }
  
  // Cleanup
  await window.electronAPI.cleanupSession(sessionId);
}
```