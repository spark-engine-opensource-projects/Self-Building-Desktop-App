const logger = require('../utils/logger');
const configManager = require('../utils/configManager');
const cacheManager = require('../utils/advancedCache');
const systemMonitor = require('../utils/systemMonitor');
const codeEnhancer = require('../utils/codeEnhancer');
const jsonParser = require('../utils/jsonParser');
const errorRecovery = require('../utils/errorRecovery');
const securitySandbox = require('../utils/securitySandbox');

/**
 * Module responsible for AI code generation functionality
 */
class CodeGenerationModule {
    constructor(anthropic) {
        this.anthropic = anthropic;
    }

    async generateCode(prompt, retryCount = 0) {
        if (!this.anthropic) {
            logger.warn('Code generation attempted without API key');
            return { success: false, error: 'Anthropic API key not configured' };
        }

        const startTime = Date.now();
        logger.info('Starting code generation', { prompt_length: prompt.length, retryCount });

        // Check cache first (only for initial requests, not retries)
        if (retryCount === 0) {
            const cachedResult = cacheManager.get(prompt);
            if (cachedResult && cachedResult.code) {
                // Re-validate cached results against current security rules
                let cacheInvalid = false;
                let invalidReason = '';

                // Check for localStorage/sessionStorage
                if (cachedResult.code.includes('localStorage') || cachedResult.code.includes('sessionStorage')) {
                    cacheInvalid = true;
                    invalidReason = 'localStorage/sessionStorage detected';
                }

                // Check for fictional APIs (query, run, etc.)
                const validAPIs = ['createTable', 'insertData', 'queryData', 'updateData', 'deleteData', 'executeQuery', 'listTables'];
                const apiMatches = cachedResult.code.match(/window\.electronAPI\.(\w+)/g);
                if (apiMatches) {
                    const usedAPIs = apiMatches.map(m => m.replace('window.electronAPI.', ''));
                    const fictionalAPIs = usedAPIs.filter(api => !validAPIs.includes(api));
                    if (fictionalAPIs.length > 0) {
                        cacheInvalid = true;
                        invalidReason = `fictional APIs: ${fictionalAPIs.join(', ')}`;
                    }
                }

                if (cacheInvalid) {
                    logger.warn('Cached code invalid - invalidating cache entry', { reason: invalidReason });
                    cacheManager.delete(prompt);
                } else {
                    logger.info('Cache hit - returning cached result', {
                        promptLength: prompt.length,
                        cacheAge: Date.now() - cachedResult.metadata?.processingTime || 0
                    });

                    return {
                        ...cachedResult,
                        fromCache: true,
                        metadata: {
                            ...cachedResult.metadata,
                            cacheHit: true,
                            totalTime: Date.now() - startTime
                        }
                    };
                }
            }
        }

        // Check prompt length limit
        const securityConfig = configManager.get('security');
        if (prompt.length > securityConfig.maxPromptLength) {
            logger.logSecurityEvent('prompt_length_exceeded', { length: prompt.length, limit: securityConfig.maxPromptLength });
            return { success: false, error: 'Prompt exceeds maximum length limit' };
        }

        try {
            const resourceCheck = await systemMonitor.checkResourceLimits();
            if (!resourceCheck.safe) {
                logger.logSecurityEvent('resource_limit_exceeded', resourceCheck);
                return { success: false, error: 'System resources insufficient for code generation' };
            }

            const result = await this.attemptCodeGeneration(prompt, retryCount, startTime);
            
            // Cache successful results (only for initial requests)
            if (result.success && retryCount === 0) {
                cacheManager.set(prompt, result);
            }
            
            return result;

        } catch (error) {
            return await this.handleGenerationError(error, prompt, retryCount, startTime);
        }
    }

    async attemptCodeGeneration(prompt, retryCount, startTime) {
        try {
            const aiConfig = configManager.get('ai');
            const systemPrompt = this.getSystemPrompt();

            const response = await this.anthropic.messages.create({
                model: aiConfig.model,
                max_tokens: aiConfig.maxTokens,
                temperature: aiConfig.temperature,
                system: systemPrompt,
                messages: [
                    { role: "user", content: prompt }
                ]
            });

            const content = response.content[0].text;

            // Debug logging only in development mode
            if (process.env.NODE_ENV === 'development') {
                logger.debug('Claude response received', { contentLength: content.length });
            }

            logger.info('AI response received', {
                contentLength: content.length,
                contentPreview: content.substring(0, 500)
            });

            // Use enhanced JSON parser
            const parseResult = await jsonParser.parseAIResponse(content);
            if (!parseResult.success) {
                logger.error('JSON parsing failed', {
                    error: parseResult.error,
                    details: parseResult.details,
                    contentLength: content.length
                });
                return {
                    success: false,
                    error: `Failed to parse AI response: ${parseResult.error}`,
                    details: parseResult.details,
                    suggestions: jsonParser.generateSuggestions(content, parseResult.error)
                };
            }

            const result = parseResult.data;

            // CRITICAL: Validate against localStorage usage for data apps
            if (result.code.includes('localStorage') || result.code.includes('sessionStorage')) {
                logger.warn('Generated code uses localStorage instead of database', { prompt });
                return {
                    success: false,
                    error: 'Code validation failed: localStorage detected. Please use window.electronAPI database for data persistence.',
                    suggestions: [
                        'Use await window.electronAPI.createTable() to create a database table',
                        'Use await window.electronAPI.insertData() to save data',
                        'Use await window.electronAPI.queryData() to load data',
                        'NEVER use localStorage or sessionStorage for persistent data'
                    ]
                };
            }

            // Fix common quote conflicts in generated HTML strings
            // Pattern: single-quoted string with single-quoted HTML attributes like '<div style='...'>'
            // This causes "Unexpected identifier" syntax errors
            result.code = this.fixQuoteConflicts(result.code);

            // CRITICAL: Detect quote conflicts that couldn't be fixed and auto-retry
            // Pattern: single-quoted HTML with single-quoted attributes like: '<div style='...'>'
            // These cause "Unexpected identifier" syntax errors
            const quoteConflictPattern = /'<[^']*\s+\w+='[^']*'[^']*>'/;
            if (quoteConflictPattern.test(result.code)) {
                logger.warn('Generated code has quote conflicts - REJECTING and will retry', {
                    prompt: prompt.substring(0, 100),
                    retryCount
                });

                if (retryCount < 2) {
                    const modifiedPrompt = `CRITICAL FORMATTING REQUIREMENT: Use ONLY backticks (\`) for ALL HTML strings, and double quotes (") for ALL HTML attributes. NEVER use single quotes for HTML.

Example of CORRECT code:
element.innerHTML = \`<div class="container" style="padding: 20px;">Content</div>\`;

Example of WRONG code (DO NOT DO THIS):
element.innerHTML = '<div style='padding: 20px;'>Content</div>';

${prompt}`;
                    logger.info('Auto-retrying with quote formatting emphasis', { retryCount: retryCount + 1 });
                    return await this.generateCode(modifiedPrompt, retryCount + 1);
                }

                return {
                    success: false,
                    error: 'Generated code has quote formatting issues. Please try again.',
                    suggestions: [
                        'The system will automatically retry with better formatting',
                        'Try a simpler description'
                    ]
                };
            }

            // CRITICAL: Reject Custom Elements - they cause constructor errors that can't be reliably fixed
            // Auto-retry up to 2 times with stronger prompt emphasis
            // Use regex to handle whitespace variations (newlines, multiple spaces, etc.)
            const customElementPatterns = [
                /extends\s+HTMLElement/i,
                /customElements\s*\.\s*define/i,
                /class\s+\w+\s+extends\s+\w*Element/i,  // catches any *Element extension
                /attachShadow\s*\(/i,  // Shadow DOM is also problematic
                /this\.shadowRoot/i
            ];

            // DEBUG: Log what we're checking
            logger.info('Checking for Custom Elements in generated code', {
                codeLength: result.code.length,
                codeSnippet: result.code.substring(0, 500),
                hasExtends: result.code.includes('extends'),
                hasHTMLElement: result.code.includes('HTMLElement'),
                hasCustomElements: result.code.includes('customElements')
            });

            const hasCustomElement = customElementPatterns.some(pattern => pattern.test(result.code));

            if (hasCustomElement) {
                logger.warn('Generated code uses Custom Elements - REJECTING and will retry', {
                    prompt: prompt.substring(0, 100),
                    retryCount,
                    matchedPatterns: customElementPatterns.filter(p => p.test(result.code)).map(p => p.toString())
                });

                // If we haven't retried too many times, auto-retry with stronger emphasis
                if (retryCount < 2) {
                    const modifiedPrompt = `CRITICAL: DO NOT use Custom Elements (class extends HTMLElement). Use the simple IIFE pattern instead.\n\n${prompt}`;
                    logger.info('Auto-retrying without Custom Elements', { retryCount: retryCount + 1 });
                    return await this.generateCode(modifiedPrompt, retryCount + 1);
                }

                // If we've already retried, return error
                return {
                    success: false,
                    error: 'Generated code uses Custom Elements which cause errors. Please try a different description.',
                    suggestions: [
                        'Try using simpler language in your description',
                        'Avoid mentioning "components" or "elements"',
                        'The system will generate code using a simpler pattern'
                    ]
                };
            }

            // Validate that code uses real APIs, not fictional ones
            // CRITICAL: This validation MUST catch any made-up API methods
            const validAPIs = ['createTable', 'insertData', 'queryData', 'updateData', 'deleteData', 'executeQuery', 'listTables'];
            const electronAPIMatch = result.code.match(/window\.electronAPI\.(\w+)/g);

            logger.info('Validating electronAPI usage', {
                foundAPICalls: electronAPIMatch ? electronAPIMatch.length : 0,
                validAPIs
            });

            if (electronAPIMatch) {
                const usedAPIs = electronAPIMatch.map(m => m.replace('window.electronAPI.', ''));
                const uniqueAPIs = [...new Set(usedAPIs)]; // Remove duplicates
                const fictionalAPIs = uniqueAPIs.filter(api => !validAPIs.includes(api));

                logger.info('API validation results', {
                    usedAPIs: uniqueAPIs,
                    fictionalAPIs,
                    valid: fictionalAPIs.length === 0
                });

                if (fictionalAPIs.length > 0) {
                    logger.warn('Generated code uses fictional APIs - REJECTING', { fictionalAPIs, prompt });
                    return {
                        success: false,
                        error: `Code uses non-existent APIs: ${fictionalAPIs.join(', ')}. Only these APIs exist: ${validAPIs.join(', ')}`,
                        suggestions: [
                            'Use createTable() to create/ensure table exists',
                            'Use queryData() to load data, NOT custom methods like getExpenses() or readDatabase()',
                            'Use insertData() to save new records, NOT writeDatabase()',
                            'Use updateData(tableName, id, data) to update records',
                            'Use deleteData(tableName, id) to delete records'
                        ]
                    };
                }
            } else {
                // No electronAPI calls found - code might not be using the database at all
                // Check if code is storing data in-memory which won't persist
                if (result.code.includes('this.entries = []') || result.code.includes('this.items = []') ||
                    result.code.includes('this.data = []') || result.code.includes('this.todos = []')) {
                    logger.warn('Generated code stores data in-memory without database', { prompt });
                    return {
                        success: false,
                        error: 'Code stores data in-memory only. Data will be lost on reload. Use window.electronAPI database.',
                        suggestions: [
                            'Use await window.electronAPI.createTable() to create a database table',
                            'Use await window.electronAPI.insertData() to save data persistently',
                            'Use await window.electronAPI.queryData() to load saved data',
                            'Data MUST be stored in the database to persist across app restarts'
                        ]
                    };
                }
            }

            // CRITICAL: Validate that createTable is called for any table being used
            // This prevents "no such table" errors at runtime
            const tableValidation = this.validateCreateTableCalls(result.code);
            if (!tableValidation.valid) {
                logger.warn('Generated code missing createTable calls', {
                    tablesWithoutCreate: tableValidation.tablesWithoutCreate,
                    prompt
                });
                return {
                    success: false,
                    error: `Code references tables without calling createTable first: ${tableValidation.tablesWithoutCreate.join(', ')}`,
                    suggestions: [
                        'ALWAYS call createTable() at the start of your code, BEFORE any queries',
                        'createTable() is safe to call multiple times - it only creates if not exists',
                        'Example: await window.electronAPI.createTable("tableName", {columns: [...]})'
                    ]
                };
            }

            // Enhanced code validation and enhancement pipeline
            if (aiConfig.enableCodeValidation) {
                const securityScan = securitySandbox.scanCode(result.code);
                if (!securityScan.safe) {
                    logger.logSecurityEvent('unsafe_code_generated', {
                        prompt_length: prompt.length,
                        issues: securityScan.issues,
                        riskLevel: securityScan.riskLevel
                    });
                    return {
                        success: false,
                        error: `Generated code failed security validation: ${securityScan.issues.map(i => i.description).join(', ')}`,
                        securityIssues: securityScan.issues
                    };
                }
            }

            // Enhance code quality with post-processing (minimal to avoid syntax errors)
            const enhancementResult = await codeEnhancer.enhanceCode(result.code, {
                addErrorHandling: false, // Disabled - causes syntax errors with complex code
                addAccessibility: true,
                addInputValidation: false, // Disabled - causes syntax errors
                optimizePerformance: false, // Disabled - let AI handle this
                validateSyntax: true
            });

            if (!enhancementResult.success) {
                logger.warn('Code enhancement failed, using original code', {
                    issues: enhancementResult.issues,
                    message: enhancementResult.message
                });
            } else {
                result.code = enhancementResult.code;
                logger.info('Code enhancement successful', {
                    enhancements: enhancementResult.enhancements,
                    issuesFound: enhancementResult.issues.length
                });
            }
            
            // Log package usage for monitoring
            if (result.packages && result.packages.length > 0) {
                logger.info('Generated code requires packages', { packages: result.packages });
            }

            const duration = Date.now() - startTime;
            logger.logCodeGeneration(prompt, { success: true, data: result }, duration);

            return {
                success: true,
                data: result,
                metadata: {
                    processingTime: duration,
                    retryCount,
                    enhanced: true
                }
            };

        } catch (error) {
            throw error; // Re-throw to be handled by error recovery
        }
    }

    async handleGenerationError(error, originalPrompt, retryCount, startTime) {
        const duration = Date.now() - startTime;

        logger.error('Code generation failed', error, {
            prompt_length: originalPrompt.length,
            duration,
            retryCount,
            status: error.status,
            statusCode: error.statusCode,
            errorType: error.error?.type
        });

        // Handle API overload errors with exponential backoff
        if (error.status === 529 || error.statusCode === 529 ||
            error.error?.type === 'overloaded_error' ||
            error.message?.includes('Overloaded')) {

            if (retryCount < 3) {
                const waitTime = Math.pow(2, retryCount) * 2000; // 2s, 4s, 8s
                logger.info(`API overloaded, waiting ${waitTime}ms before retry ${retryCount + 1}/3`);

                await new Promise(resolve => setTimeout(resolve, waitTime));

                return await this.generateCode(originalPrompt, retryCount + 1);
            } else {
                return {
                    success: false,
                    error: 'The Anthropic API is currently overloaded. Please try again in a few moments.',
                    technical: error.message,
                    suggestions: [
                        'Wait 30-60 seconds before trying again',
                        'Try a simpler or shorter prompt',
                        'Check Anthropic status page for service issues'
                    ],
                    canRetry: true,
                    errorType: 'overloaded'
                };
            }
        }

        // Attempt error recovery
        const recoveryContext = {
            originalPrompt,
            retryCount,
            error: error.message,
            temperature: configManager.get('ai', 'temperature'),
            maxTokens: configManager.get('ai', 'maxTokens')
        };

        const recoveryResult = await errorRecovery.attemptRecovery(error, recoveryContext);

        if (recoveryResult.canRecover && retryCount < 3) {
            logger.info('Attempting error recovery', {
                strategy: recoveryResult.strategy,
                retryCount: retryCount + 1
            });

            // Update AI config if adjustments are suggested
            if (recoveryResult.adjustments) {
                const currentConfig = configManager.get('ai');
                const tempConfig = { ...currentConfig, ...recoveryResult.adjustments };
                // Temporarily update config for this retry
                configManager.update({ ai: tempConfig });
            }

            try {
                // Retry with recovered prompt
                const retryResult = await this.generateCode(recoveryResult.newPrompt, retryCount + 1);
                
                // Restore original config
                const originalConfig = configManager.get('ai');
                delete originalConfig.temperature;
                delete originalConfig.maxTokens;
                
                return retryResult;
            } catch (retryError) {
                // If retry fails, continue to return user-friendly error
                logger.error('Recovery attempt failed', retryError);
            }
        }

        // Generate user-friendly error message
        const friendlyError = errorRecovery.generateUserFriendlyError(error, recoveryContext);
        
        return {
            success: false,
            error: friendlyError.message,
            technical: friendlyError.technical,
            suggestions: friendlyError.suggestions,
            canRetry: friendlyError.canRetry,
            errorType: friendlyError.type,
            retryCount
        };
    }

    getSystemPrompt() {
        return `You are a code generator. Return ONLY valid JSON in this EXACT format:
{"packages": [], "code": "javascript code here", "description": "what this does"}

IMPORTANT: The "packages" array should almost always be empty [] - the app runs in Electron with no npm install capability.

=== #1 CRITICAL RULE: HTML STRING FORMATTING - VIOLATION = SYNTAX ERROR ===

NEVER use single quotes for HTML strings! This WILL cause "Unexpected identifier" errors:
BAD:  '<div style='color: red;'>text</div>'   // SYNTAX ERROR - WILL CRASH!
BAD:  '<button class='btn'>Click</button>'    // SYNTAX ERROR - WILL CRASH!

ALWAYS use backticks (\`) for HTML with double quotes (") for attributes:
GOOD: \`<div style="color: red;">text</div>\`   // CORRECT
GOOD: \`<button class="btn">Click</button>\`    // CORRECT

This applies to ALL innerHTML, insertAdjacentHTML, and any HTML string assignment.

=== CRITICAL DATABASE RULES - VIOLATION WILL CAUSE REJECTION ===

1. This app has a DATABASE SYSTEM built-in - USE IT!
2. You MUST ALWAYS use the database API for ANY persistent data.
3. NEVER EVER use localStorage, sessionStorage, cookies, or in-memory storage.
4. Code with localStorage/sessionStorage will be REJECTED automatically.
5. DO NOT invent fictional APIs like "getExpenses()", "saveExpenses()", "getTodos()", etc.
6. ONLY use the EXACT API methods listed below - nothing else exists!

=== THE ONLY DATABASE APIs THAT EXIST ===

These are the ONLY methods available. Do NOT make up other methods:

1. createTable - Creates a table (MUST call first, creates if not exists)
2. insertData - Insert a new row
3. queryData - Query rows with filters
4. updateData - Update a row by ID
5. deleteData - Delete a row by ID
6. executeQuery - Run raw SQL (for complex queries)

// CREATE TABLE - Call this FIRST in your code, EVERY TIME
await window.electronAPI.createTable('expenses', {
  columns: [
    {name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true},
    {name: 'amount', type: 'REAL', required: true},
    {name: 'category', type: 'TEXT', required: true},
    {name: 'description', type: 'TEXT'},
    {name: 'date', type: 'TEXT'}
  ]
});
// Supported types: TEXT, INTEGER, REAL (for decimals)
// Table automatically gets id, created_at, updated_at columns

// Insert data - returns {success: true, id: 1} or {success: false, error: '...'}
const insertResult = await window.electronAPI.insertData('tableName', {
  columnName: 'value',
  count: 123
});

// Query data - returns {success: true, data: [...]} or {success: false, error: '...'}
const result = await window.electronAPI.queryData('tableName', {
  where: {columnName: 'value'},     // optional - filter conditions
  orderBy: 'id DESC',               // optional - sort order
  limit: 10,                        // optional - max records
  offset: 0                         // optional - skip records (for pagination)
});
// result.data = [{id: 1, columnName: 'value', ...}, ...]

// Update data - pass the ID directly, not in an object
await window.electronAPI.updateData('tableName', recordId, {columnName: 'newValue'});
// Example: await window.electronAPI.updateData('todos', 5, {completed: 1});

// Delete data - pass the ID directly
await window.electronAPI.deleteData('tableName', recordId);
// Example: await window.electronAPI.deleteData('todos', 5);

=== MANDATORY ERROR HANDLING ===

ALWAYS wrap database operations in try-catch:

try {
  const result = await window.electronAPI.insertData('todos', data);
  if (!result.success) {
    alert('Failed to save: ' + result.error);
    return;
  }
  // Success - update UI
  loadData();
} catch (error) {
  console.error('Database error:', error);
  alert('An error occurred. Please try again.');
}

=== CODE STRUCTURE REQUIREMENTS ===

1. ALWAYS wrap entire code in async IIFE: (async () => { CODE HERE })()
2. Create table(s) FIRST before any UI code
3. Load data from database after table creation
4. Build UI that displays the data
5. Add event handlers that save to database
6. Include error handling for all database operations
7. PREFER the IIFE pattern over Custom Elements - it's simpler and more reliable

=== CRITICAL: UI CONFINEMENT - YOUR CODE RUNS IN A SANDBOX ===

Your code runs inside a CONFINED container called "execution-root".
- document.body points to #execution-root, NOT the real document body
- document.getElementById() only finds elements INSIDE execution-root
- document.querySelector() only searches INSIDE execution-root
- You CANNOT access or modify elements outside execution-root

ALWAYS get the root container first:
const root = document.getElementById('execution-root');
// or simply use document.body (which points to execution-root)

DO NOT try to access: document.head, window.location, or any app UI elements.
DO NOT use: document.write(), document.open(), or try to replace document.body
Your UI should be built INSIDE the root container using innerHTML or appendChild.

=== CRITICAL: STRING AND QUOTE RULES ===

ALWAYS use template literals (backticks) for ALL HTML strings to avoid quote conflicts:

CORRECT:
element.innerHTML = \`<div class="container" style="padding: 20px;">Content</div>\`;
element.innerHTML = \`<button class="btn" onclick="handleClick()">Click</button>\`;

WRONG (causes syntax errors):
element.innerHTML = '<div style='padding: 20px;'>Content</div>';  // BROKEN - quote conflict!
element.innerHTML = "<div class=\"btn\">Content</div>";  // Messy escaping

Rules:
1. Use backticks (\`) for ALL innerHTML, insertAdjacentHTML, and HTML template strings
2. Use double quotes (") for ALL HTML attributes inside the template
3. NEVER use single-quoted strings for HTML - they WILL break on style/class attributes
4. This applies to ALL HTML generation, not just innerHTML

=== #2 CRITICAL RULE: NO CUSTOM ELEMENTS - VIOLATION = AUTOMATIC REJECTION ===

NEVER use Custom Elements. Code using them will be AUTOMATICALLY REJECTED:
- NO "class X extends HTMLElement" - REJECTED!
- NO "customElements.define()" - REJECTED!
- NO "attachShadow()" - REJECTED!
- NO "this.shadowRoot" - REJECTED!

ALWAYS use the simple IIFE pattern - it's the ONLY pattern that works reliably.

REJECTED - Custom Elements (code will be thrown away):
class MyApp extends HTMLElement {
  constructor() {
    super();
    this.init();  // FAILS! Cannot call methods that modify DOM in constructor
  }
}

GOOD - Simple IIFE Pattern (ALWAYS USE THIS):
(async () => {
  const root = document.getElementById('execution-root');

  // Create table first
  await window.electronAPI.createTable('items', { columns: [...] });

  // Load data
  const result = await window.electronAPI.queryData('items');
  const items = result.data || [];

  // Build UI with innerHTML
  root.innerHTML = \`<div class="container">...</div>\`;

  // Add event listeners
  root.querySelector('#addBtn').addEventListener('click', async () => {
    // Handle click
  });

  // Render function
  function renderItems() {
    const list = root.querySelector('#itemList');
    list.innerHTML = items.map(item => \`<div>...</div>\`).join('');
  }

  renderItems();
})();

=== SECURITY REQUIREMENTS (XSS PREVENTION) ===

1. NEVER use innerHTML with user data - this causes XSS vulnerabilities
2. Use textContent for displaying user-generated text
3. Use createElement() and appendChild() for dynamic content
4. For static HTML structure, innerHTML is OK, but NEVER interpolate user data into it
5. Example of SAFE code:
   const span = document.createElement('span');
   span.textContent = userInput; // SAFE - escapes HTML
6. Example of UNSAFE code (DO NOT USE):
   element.innerHTML = \`<span>\${userInput}</span>\`; // DANGEROUS - XSS vulnerability

=== COMPLETE TODO APP EXAMPLE ===

(async () => {
  try {
    // IMPORTANT: Get the root container FIRST - this is your sandbox
    const root = document.getElementById('execution-root');
    if (!root) {
      console.error('execution-root not found');
      return;
    }

    // 1. Create table
    await window.electronAPI.createTable('todos', {
      columns: [
        {name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true},
        {name: 'task', type: 'TEXT', required: true},
        {name: 'completed', type: 'INTEGER', default: 0},
        {name: 'created_at', type: 'TEXT'}
      ]
    });

    // 2. Load existing data
    async function loadTodos() {
      try {
        const result = await window.electronAPI.queryData('todos', {orderBy: 'id DESC'});
        if (!result.success) {
          console.error('Failed to load todos:', result.error);
          return;
        }
        renderTodos(result.data || []);
      } catch (error) {
        console.error('Error loading todos:', error);
      }
    }

    // 3. Render UI - ALWAYS render inside root, never outside!
    function renderTodos(todos) {
      root.innerHTML = '';  // Clear root, not document.body!

      const app = document.createElement('div');
      app.innerHTML = \`
        <style>
          .todo-app { padding: 20px; font-family: Arial; }
          .todo-input { padding: 10px; width: 300px; }
          .todo-btn { padding: 10px 20px; background: #4CAF50; color: white; border: none; cursor: pointer; }
          .todo-item { padding: 10px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; }
          .completed { text-decoration: line-through; opacity: 0.6; }
        </style>
        <div class="todo-app">
          <h2>Todo List</h2>
          <input type="text" class="todo-input" placeholder="Enter new task..." />
          <button class="todo-btn">Add Task</button>
          <div class="todo-list"></div>
        </div>
      \`;

      const list = app.querySelector('.todo-list');
      todos.forEach(todo => {
        const item = document.createElement('div');
        item.className = 'todo-item' + (todo.completed ? ' completed' : '');

        // Use textContent for user data to prevent XSS
        const taskSpan = document.createElement('span');
        taskSpan.textContent = todo.task; // SAFE - escapes HTML

        const btnContainer = document.createElement('div');
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = 'Toggle';
        toggleBtn.onclick = () => toggleTodo(todo.id);
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = () => deleteTodo(todo.id);
        btnContainer.appendChild(toggleBtn);
        btnContainer.appendChild(deleteBtn);

        item.appendChild(taskSpan);
        item.appendChild(btnContainer);
        list.appendChild(item);
      });

      root.appendChild(app);  // Append to root, not container!

      // 4. Add event handlers
      app.querySelector('.todo-btn').onclick = async () => {
        const input = app.querySelector('.todo-input');
        const task = input.value.trim();
        if (!task) return;

        try {
          const result = await window.electronAPI.insertData('todos', {
            task: task,
            completed: 0,
            created_at: new Date().toISOString()
          });
          if (result.success) {
            input.value = '';
            loadTodos();
          } else {
            alert('Failed to add task: ' + result.error);
          }
        } catch (error) {
          alert('Error: ' + error.message);
        }
      };
    }

    // 5. Helper functions with error handling
    window.toggleTodo = async (id) => {
      try {
        const result = await window.electronAPI.queryData('todos', {where: {id: id}});
        if (result.success && result.data.length > 0) {
          const todo = result.data[0];
          // Note: updateData takes (tableName, id, data) - id is passed directly
          await window.electronAPI.updateData('todos', id, {completed: todo.completed ? 0 : 1});
          loadTodos();
        }
      } catch (error) {
        alert('Error toggling task: ' + error.message);
      }
    };

    window.deleteTodo = async (id) => {
      try {
        // Note: deleteData takes (tableName, id) - id is passed directly
        await window.electronAPI.deleteData('todos', id);
        loadTodos();
      } catch (error) {
        alert('Error deleting task: ' + error.message);
      }
    };

    // 6. Initial load
    await loadTodos();

  } catch (error) {
    console.error('Failed to initialize app:', error);
    alert('Failed to start app: ' + error.message);
  }
})();

=== PAGINATION PATTERN (for large data sets) ===

let currentPage = 0;
const pageSize = 10;

async function loadPage(page) {
  const result = await window.electronAPI.queryData('items', {
    orderBy: 'id DESC',
    limit: pageSize,
    offset: page * pageSize
  });
  if (result.success) {
    currentPage = page;
    renderItems(result.data);
  }
}

// Navigation: loadPage(currentPage + 1) for next, loadPage(currentPage - 1) for previous

=== QUERY OPERATORS ===

// Greater than, less than comparisons
{where: {price: {$gt: 100}}}     // price > 100
{where: {price: {$gte: 100}}}    // price >= 100
{where: {price: {$lt: 50}}}      // price < 50
{where: {price: {$lte: 50}}}     // price <= 50

// LIKE pattern matching
{where: {name: {$like: '%search%'}}}  // contains 'search'
{where: {name: {$like: 'A%'}}}        // starts with 'A'

// IN clause
{where: {status: {$in: ['active', 'pending']}}}

=== REMEMBER ===
- ALWAYS call createTable() FIRST - it creates the table if it doesn't exist
- ONLY use: createTable, insertData, queryData, updateData, deleteData, executeQuery
- DO NOT invent APIs like getExpenses(), saveTodos(), loadData(), etc - THEY DON'T EXIST
- localStorage/sessionStorage will be REJECTED
- Always include try-catch error handling
- Always check result.success before proceeding
- updateData and deleteData take ID directly: updateData('table', id, data)

=== CORRECT CODE STRUCTURE ===

(async () => {
  // 0. ALWAYS get the root container FIRST - this is your sandbox
  const root = document.getElementById('execution-root');

  // 1. ALWAYS create table first (safe to call multiple times)
  await window.electronAPI.createTable('mydata', { columns: [...] });

  // 2. Load existing data
  const result = await window.electronAPI.queryData('mydata');

  // 3. Build UI with the data - render INSIDE root only!
  root.innerHTML = \`<div>Your UI here</div>\`;

  // 4. Add event handlers that use insertData/updateData/deleteData
})();`;
    }

    /**
     * Validate that createTable is called for any table being queried/inserted/updated/deleted
     * This prevents "no such table" errors at runtime
     */
    validateCreateTableCalls(code) {
        const tablesCreated = new Set();
        const tablesUsed = new Set();

        // Find all createTable calls
        const createTableRegex = /createTable\s*\(\s*['"]([\w_]+)['"]/g;
        let match;
        while ((match = createTableRegex.exec(code)) !== null) {
            tablesCreated.add(match[1].toLowerCase());
        }

        // Find tables used in queryData, insertData, updateData, deleteData
        const dataOpsRegex = /(queryData|insertData|updateData|deleteData)\s*\(\s*['"]([\w_]+)['"]/g;
        while ((match = dataOpsRegex.exec(code)) !== null) {
            tablesUsed.add(match[2].toLowerCase());
        }

        // Find tables used in raw SQL via executeQuery
        // Patterns: FROM table, INTO table, UPDATE table, DELETE FROM table
        const sqlPatterns = [
            /FROM\s+['"]*(\w+)['"]*(?:\s|;|$)/gi,
            /INTO\s+['"]*(\w+)['"]*\s*[\(\s]/gi,
            /UPDATE\s+['"]*(\w+)['"]*\s+SET/gi,
            /DELETE\s+FROM\s+['"]*(\w+)['"]*(?:\s|;|$)/gi
        ];

        for (const pattern of sqlPatterns) {
            while ((match = pattern.exec(code)) !== null) {
                const tableName = match[1].toLowerCase();
                // Skip SQLite system tables
                if (!tableName.startsWith('sqlite_')) {
                    tablesUsed.add(tableName);
                }
            }
        }

        // Check if all used tables have createTable calls
        const tablesWithoutCreate = [];
        for (const table of tablesUsed) {
            if (!tablesCreated.has(table)) {
                tablesWithoutCreate.push(table);
            }
        }

        if (tablesWithoutCreate.length > 0) {
            logger.warn('Tables used without createTable', {
                tablesCreated: Array.from(tablesCreated),
                tablesUsed: Array.from(tablesUsed),
                tablesWithoutCreate
            });
        }

        return {
            valid: tablesWithoutCreate.length === 0,
            tablesCreated: Array.from(tablesCreated),
            tablesUsed: Array.from(tablesUsed),
            tablesWithoutCreate
        };
    }

    /**
     * Fix Custom Elements that call init/render/loadData from constructor
     * Moves these calls to connectedCallback to prevent "Failed to construct CustomElement" errors
     */
    fixCustomElementConstructor(code) {
        try {
            // Check if code has Custom Element
            if (!code.includes('extends HTMLElement')) {
                return code;
            }

            let fixedCode = code;

            // Find all Custom Element class definitions
            // Pattern: class ClassName extends HTMLElement { ... }
            const classPattern = /class\s+(\w+)\s+extends\s+HTMLElement\s*\{/g;
            let classMatch;

            while ((classMatch = classPattern.exec(code)) !== null) {
                const className = classMatch[1];
                const classStartIndex = classMatch.index;

                // Find the constructor within this class
                // Need to find balanced braces to get the full constructor body
                const afterClassStart = code.substring(classStartIndex);

                // Find constructor
                const constructorMatch = afterClassStart.match(/constructor\s*\(\s*\)\s*\{/);
                if (!constructorMatch) continue;

                const constructorStart = constructorMatch.index + constructorMatch[0].length;

                // Find the matching closing brace for constructor
                let braceCount = 1;
                let constructorEnd = constructorStart;
                for (let i = constructorStart; i < afterClassStart.length && braceCount > 0; i++) {
                    if (afterClassStart[i] === '{') braceCount++;
                    if (afterClassStart[i] === '}') braceCount--;
                    constructorEnd = i;
                }

                const constructorBody = afterClassStart.substring(constructorStart, constructorEnd);

                // Check for problematic code in constructor - anything that manipulates DOM
                // Look for: this.render(), this.init(), this.innerHTML =, this.appendChild, etc.
                const problematicPatterns = [
                    /this\.\w+\s*\(\s*\)/g,  // Any method call on this
                    /this\.innerHTML\s*=/g,
                    /this\.appendChild/g,
                    /this\.insertAdjacentHTML/g,
                    /this\.textContent\s*=/g,
                    /this\.innerText\s*=/g,
                ];

                // But allow: super(), this.property = value (simple assignment)
                const allowedPatterns = [
                    /super\s*\(\s*\)/,
                    /this\.\w+\s*=\s*(?!.*\()/,  // Simple property assignment without method call
                ];

                // Extract code after super()
                const superMatch = constructorBody.match(/super\s*\(\s*\)\s*;?/);
                if (!superMatch) continue;

                const afterSuper = constructorBody.substring(superMatch.index + superMatch[0].length).trim();

                if (!afterSuper) continue;  // Nothing after super(), no problem

                // Check if there's any DOM manipulation
                let hasDOMManipulation = false;
                for (const pattern of problematicPatterns) {
                    if (pattern.test(afterSuper)) {
                        hasDOMManipulation = true;
                        break;
                    }
                }

                if (!hasDOMManipulation) continue;

                logger.warn('Detected Custom Element with DOM operations in constructor', {
                    className,
                    afterSuper: afterSuper.substring(0, 100)
                });

                // Check if connectedCallback already exists
                const hasConnectedCallback = /connectedCallback\s*\(\s*\)\s*\{/.test(afterClassStart);

                // Remove everything after super() from constructor
                const originalConstructor = afterClassStart.substring(
                    constructorMatch.index,
                    constructorEnd + 1
                );

                const cleanedConstructor = originalConstructor.replace(
                    /(super\s*\(\s*\)\s*;?)[\s\S]*?\}/,
                    '$1\n  }'
                );

                // Prepare the code to move
                const codeToMove = afterSuper;

                if (hasConnectedCallback) {
                    // Append to existing connectedCallback
                    fixedCode = fixedCode.replace(
                        originalConstructor,
                        cleanedConstructor
                    );
                    // Add code at the beginning of connectedCallback
                    fixedCode = fixedCode.replace(
                        /(connectedCallback\s*\(\s*\)\s*\{)/,
                        `$1\n    // Moved from constructor\n    ${codeToMove}\n`
                    );
                } else {
                    // Create new connectedCallback
                    const connectedCallback = `\n  connectedCallback() {\n    ${codeToMove}\n  }\n`;

                    fixedCode = fixedCode.replace(
                        originalConstructor,
                        cleanedConstructor + connectedCallback
                    );
                }

                logger.info('Fixed Custom Element constructor - moved DOM operations to connectedCallback', {
                    className,
                    movedCode: codeToMove.substring(0, 50)
                });
            }

            return fixedCode;
        } catch (error) {
            logger.warn('Failed to fix Custom Element constructor', { error: error.message });
            return code;
        }
    }

    /**
     * Fix common quote conflicts in generated code
     * Converts single-quoted HTML strings to template literals when they contain
     * single-quoted HTML attributes (which cause syntax errors)
     *
     * The core problem: Claude generates code like:
     *   element.innerHTML = '<div style='color: red;'>text</div>';
     * This breaks because the inner ' ends the string early, making 'color' an identifier
     */
    fixQuoteConflicts(code) {
        try {
            let modified = false;
            let fixedCode = code;

            // STEP 0 (AGGRESSIVE PRE-FIX): Detect the broken pattern directly
            // When Claude generates: innerHTML = '<div style='color: red;'>text</div>';
            // This becomes broken tokens. We can detect this by looking for:
            // Pattern: ='<tag attr=' followed by value then '> then content then </tag>';
            // This is a SPECIFIC fix for the most common broken pattern

            // Fix pattern: = '<tag style='value'>content</tag>';
            // Becomes: = `<tag style="value">content</tag>`;
            fixedCode = fixedCode.replace(
                /=\s*'<(\w+)([^>]*?)\s+(style|class|id|type|name|value|placeholder|href|src|data-\w+)='([^']*)'([^>]*)>([\s\S]*?)<\/\1>';/g,
                (match, tag, preAttrs, attrName, attrValue, postAttrs, content) => {
                    modified = true;
                    return `=\`<${tag}${preAttrs} ${attrName}="${attrValue}"${postAttrs}>${content}</${tag}>\`;`;
                }
            );

            // Also fix self-closing tags: = '<input type='text'/>';
            fixedCode = fixedCode.replace(
                /=\s*'<(\w+)([^>]*?)\s+(style|class|id|type|name|value|placeholder|href|src|data-\w+)='([^']*)'([^/>]*)\/?>';/g,
                (match, tag, preAttrs, attrName, attrValue, postAttrs) => {
                    modified = true;
                    const selfClose = match.includes('/>') ? '/>' : '>';
                    return `=\`<${tag}${preAttrs} ${attrName}="${attrValue}"${postAttrs}${selfClose}\`;`;
                }
            );

            // Fix multiple attributes: = '<div style='x' class='y'>text</div>';
            // This is trickier - handle sequentially
            let iterations = 0;
            const maxIterations = 10;
            while (iterations < maxIterations) {
                const beforeFix = fixedCode;
                fixedCode = fixedCode.replace(
                    /=\s*'(<[^']*?)\s+(\w+[-\w]*)='([^']*)'/g,
                    (match, beforeAttr, attrName, attrValue) => {
                        modified = true;
                        return `= '${beforeAttr} ${attrName}="${attrValue}"`;
                    }
                );
                if (fixedCode === beforeFix) break;
                iterations++;
            }

            // Now convert remaining HTML single-quoted strings to template literals
            fixedCode = fixedCode.replace(
                /=\s*'(<[^']*>)'/g,
                (match, content) => {
                    if (content.includes('<') && content.includes('>')) {
                        modified = true;
                        return `=\`${content}\``;
                    }
                    return match;
                }
            );

            // Approach: Find HTML-like content that's malformed due to quote issues
            // When we see: ='<tag  then look for the matching </tag>';

            // Step 1: Convert all single-quoted HTML strings to template literals
            // Match patterns like: = '<...'  where < suggests HTML
            fixedCode = fixedCode.replace(
                /(innerHTML|outerHTML|insertAdjacentHTML\s*\([^,]+,)\s*'(<[^']*(?:'[^']*'[^']*)*>)'/g,
                (match, prefix, html) => {
                    // Convert inner single quotes in attributes to double quotes
                    let fixed = html.replace(/(\s)(\w+)='([^']*)'/g, '$1$2="$3"');
                    modified = true;
                    return `${prefix}\`${fixed}\``;
                }
            );

            // Step 2: Fix standalone HTML strings in other contexts
            // Match: '<tag attr='value'>content</tag>'
            // This is tricky because the parser breaks at the first internal '

            // Simpler approach: Find all single-quoted strings, check if they contain <
            // If so, convert to template literal and fix internal quotes

            // Use a state machine approach
            const chars = fixedCode.split('');
            const result = [];
            let i = 0;

            while (i < chars.length) {
                // Look for potential HTML string: = '< or : '< or , '<
                if (chars[i] === "'" &&
                    i + 1 < chars.length &&
                    chars[i + 1] === '<' &&
                    (i === 0 || /[\s=:,(\[]/.test(chars[i - 1]))) {

                    // Found start of HTML string, try to find its intended end
                    // The end should be after a closing tag followed by ';
                    const stringStart = i;
                    i++; // Move past opening quote

                    let content = '';
                    let depth = 0;  // Track HTML tag depth
                    let foundEnd = false;

                    while (i < chars.length && !foundEnd) {
                        // Track opening tags
                        if (chars[i] === '<' && i + 1 < chars.length && chars[i + 1] !== '/') {
                            depth++;
                        }
                        // Track closing tags
                        if (chars[i] === '<' && i + 1 < chars.length && chars[i + 1] === '/') {
                            depth--;
                        }

                        // Check for string end: >'; or >';  (closing tag then quote then semicolon)
                        if (chars[i] === '>' && depth <= 0) {
                            // Look ahead for '; pattern
                            if (i + 1 < chars.length && chars[i + 1] === "'") {
                                // Check if followed by ; or other statement-ending char
                                if (i + 2 < chars.length && /[;\s\)]/.test(chars[i + 2])) {
                                    content += chars[i]; // Include the >
                                    i++; // Move past >
                                    foundEnd = true;
                                    break;
                                }
                            }
                        }

                        // Handle attribute quotes - when we see attr='
                        if (chars[i] === "'" && i > 0 && chars[i - 1] === '=') {
                            // This is an attribute value start, find the end
                            i++; // Move past opening attr quote
                            let attrValue = '';
                            while (i < chars.length && chars[i] !== "'") {
                                attrValue += chars[i];
                                i++;
                            }
                            // Add as double-quoted attribute
                            content += '"' + attrValue + '"';
                            modified = true;
                            i++; // Move past closing attr quote
                            continue;
                        }

                        content += chars[i];
                        i++;
                    }

                    // Found HTML content, output as template literal
                    if (content.includes('<')) {
                        result.push('`' + content + '`');
                        modified = true;
                    } else {
                        result.push("'" + content + "'");
                    }

                    // Move past closing quote if found
                    if (foundEnd && chars[i] === "'") {
                        i++;
                    }
                } else {
                    result.push(chars[i]);
                    i++;
                }
            }

            fixedCode = result.join('');

            // Step 3: Final cleanup - fix any remaining attribute quotes in template literals
            fixedCode = fixedCode.replace(/`([^`]*)`/g, (match, content) => {
                if (content.includes('<')) {
                    // Fix any remaining single-quoted attributes
                    let fixed = content.replace(/(\s)(\w+[-\w]*)='([^']*)'/g, '$1$2="$3"');
                    if (fixed !== content) {
                        modified = true;
                        return '`' + fixed + '`';
                    }
                }
                return match;
            });

            // Step 4: Fix inline HTML in any remaining single-quoted strings
            fixedCode = fixedCode.replace(/'([^']*<[^']*>)'/g, (match, content) => {
                if (content.includes('<') && content.includes('>')) {
                    let fixed = content.replace(/(\s)(\w+[-\w]*)='([^']*)'/g, '$1$2="$3"');
                    modified = true;
                    return '`' + fixed + '`';
                }
                return match;
            });

            if (modified) {
                logger.info('Quote conflicts fixed in generated code');
            }

            return fixedCode;
        } catch (error) {
            logger.warn('Failed to fix quote conflicts', { error: error.message });
            return code; // Return original if fixing fails
        }
    }

    /**
     * Wrap customElements.define() calls with a guard to prevent re-registration errors
     * This handles the case where Claude generates Custom Elements despite being told not to
     */
    wrapCustomElementsWithGuard(code) {
        try {
            // Find all customElements.define() calls and extract the element names
            const definePattern = /customElements\.define\s*\(\s*['"]([^'"]+)['"]/g;
            const elementNames = [];
            let match;

            while ((match = definePattern.exec(code)) !== null) {
                elementNames.push(match[1]);
            }

            if (elementNames.length === 0) {
                return code;
            }

            logger.info('Wrapping Custom Elements with registration guard', { elementNames });

            // Replace each customElements.define() with a guarded version
            let guardedCode = code;
            elementNames.forEach(name => {
                // Create a regex that matches the full define call for this element
                const fullDefinePattern = new RegExp(
                    `customElements\\.define\\s*\\(\\s*['"]${name}['"]\\s*,\\s*(\\w+)\\s*\\)`,
                    'g'
                );

                guardedCode = guardedCode.replace(fullDefinePattern, (match, className) => {
                    return `(function() {
                        if (!customElements.get('${name}')) {
                            customElements.define('${name}', ${className});
                        } else {
                            console.log('Custom element ${name} already registered, skipping');
                            // Create instance of existing element instead
                            const existingElement = document.querySelector('${name}');
                            if (!existingElement) {
                                const root = document.getElementById('execution-root');
                                if (root) {
                                    root.innerHTML = '';
                                    root.appendChild(document.createElement('${name}'));
                                }
                            }
                        }
                    })()`;
                });
            });

            // Also add a cleanup at the start to clear the execution root
            const cleanupCode = `
// Auto-added: Clear execution root before rendering
(function() {
    const root = document.getElementById('execution-root');
    if (root) {
        root.innerHTML = '';
    }
})();
`;
            guardedCode = cleanupCode + guardedCode;

            return guardedCode;
        } catch (error) {
            logger.warn('Failed to wrap Custom Elements', { error: error.message });
            return code;
        }
    }
}

module.exports = CodeGenerationModule;