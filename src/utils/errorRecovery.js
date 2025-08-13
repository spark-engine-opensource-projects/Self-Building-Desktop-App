const logger = require('./logger');
const configManager = require('./configManager');

class ErrorRecoveryManager {
    constructor() {
        this.generationStrategies = [
            {
                name: 'standard',
                model: 'claude-3-5-sonnet-20241022',
                temperature: 0.7,
                maxTokens: 2000
            },
            {
                name: 'conservative',
                model: 'claude-3-5-sonnet-20241022',
                temperature: 0.3,
                maxTokens: 2000
            },
            {
                name: 'extended',
                model: 'claude-3-5-sonnet-20241022',
                temperature: 0.5,
                maxTokens: 4000
            }
        ];
        
        this.retryConfig = {
            maxRetries: 3,
            backoffMultiplier: 2,
            initialDelay: 1000
        };

        this.errorPatterns = {
            parsing: /JSON|parse|syntax|invalid/i,
            timeout: /timeout|timed out/i,
            rateLimit: /rate limit|quota|429/i,
            network: /network|connection|fetch|ENOTFOUND/i,
            validation: /validation|schema|required/i,
            security: /security|unsafe|blocked/i
        };

        this.recoveryActions = new Map();
        this.setupRecoveryActions();
    }

    setupRecoveryActions() {
        // JSON Parsing errors
        this.recoveryActions.set('parsing', {
            retryable: true,
            strategy: 'refine_prompt',
            action: async (context) => {
                const refinedPrompt = this.refinePromptForBetterJSON(context.originalPrompt);
                return {
                    newPrompt: refinedPrompt,
                    adjustments: {
                        temperature: Math.max(0.1, context.temperature - 0.2),
                        maxTokens: Math.min(4000, context.maxTokens + 1000)
                    }
                };
            }
        });

        // Timeout errors
        this.recoveryActions.set('timeout', {
            retryable: true,
            strategy: 'reduce_complexity',
            action: async (context) => {
                const simplifiedPrompt = this.simplifyPrompt(context.originalPrompt);
                return {
                    newPrompt: simplifiedPrompt,
                    adjustments: {
                        temperature: 0.3,
                        maxTokens: Math.max(1000, context.maxTokens - 500)
                    }
                };
            }
        });

        // Rate limit errors
        this.recoveryActions.set('rateLimit', {
            retryable: true,
            strategy: 'exponential_backoff',
            action: async (context) => {
                const delay = this.calculateBackoffDelay(context.retryCount);
                await this.sleep(delay);
                return {
                    newPrompt: context.originalPrompt,
                    adjustments: {}
                };
            }
        });

        // Network errors
        this.recoveryActions.set('network', {
            retryable: true,
            strategy: 'retry_with_backoff',
            action: async (context) => {
                const delay = this.calculateBackoffDelay(context.retryCount);
                await this.sleep(delay);
                return {
                    newPrompt: context.originalPrompt,
                    adjustments: {}
                };
            }
        });

        // Validation errors
        this.recoveryActions.set('validation', {
            retryable: true,
            strategy: 'add_validation_guidance',
            action: async (context) => {
                const guidedPrompt = this.addValidationGuidance(context.originalPrompt);
                return {
                    newPrompt: guidedPrompt,
                    adjustments: {
                        temperature: 0.2
                    }
                };
            }
        });

        // Security errors
        this.recoveryActions.set('security', {
            retryable: true,
            strategy: 'add_security_constraints',
            action: async (context) => {
                const constrainedPrompt = this.addSecurityConstraints(context.originalPrompt);
                return {
                    newPrompt: constrainedPrompt,
                    adjustments: {
                        temperature: 0.1
                    }
                };
            }
        });
    }

    /**
     * Attempt to recover from generation failure
     */
    async attemptRecovery(error, context) {
        const errorType = this.classifyError(error);
        const recovery = this.recoveryActions.get(errorType);
        
        if (!recovery || !recovery.retryable) {
            return {
                canRecover: false,
                reason: `No recovery strategy for error type: ${errorType}`
            };
        }

        if (context.retryCount >= this.retryConfig.maxRetries) {
            return {
                canRecover: false,
                reason: 'Maximum retry attempts exceeded'
            };
        }

        try {
            const recoveryResult = await recovery.action(context);
            
            logger.info('Error recovery attempted', {
                errorType,
                strategy: recovery.strategy,
                retryCount: context.retryCount,
                adjustments: recoveryResult.adjustments
            });

            return {
                canRecover: true,
                strategy: recovery.strategy,
                newPrompt: recoveryResult.newPrompt,
                adjustments: recoveryResult.adjustments
            };

        } catch (recoveryError) {
            logger.error('Recovery action failed', recoveryError);
            return {
                canRecover: false,
                reason: `Recovery action failed: ${recoveryError.message}`
            };
        }
    }

    /**
     * Classify error type based on error message
     */
    classifyError(error) {
        const errorMessage = typeof error === 'string' ? error : error.message || '';
        
        for (const [type, pattern] of Object.entries(this.errorPatterns)) {
            if (pattern.test(errorMessage)) {
                return type;
            }
        }
        
        return 'unknown';
    }

    /**
     * Refine prompt for better JSON output
     */
    refinePromptForBetterJSON(originalPrompt) {
        const jsonGuidance = `

IMPORTANT: Your response MUST contain ONLY a valid JSON object wrapped in \`\`\`json code blocks.

Example format:
\`\`\`json
{
  "packages": ["package1", "package2"],
  "code": "your complete JavaScript code here",
  "description": "Clear description of what the code does"
}
\`\`\`

Ensure:
- Valid JSON syntax (proper quotes, commas, brackets)
- All strings properly escaped
- No trailing commas
- Complete code in the "code" field
`;

        return originalPrompt + jsonGuidance;
    }

    /**
     * Simplify prompt to reduce complexity
     */
    simplifyPrompt(originalPrompt) {
        const simplificationNote = `

Please create a simpler, more basic version focusing on core functionality only. 
Avoid complex features, animations, or advanced styling.
Keep the implementation straightforward and minimal.
`;

        return originalPrompt + simplificationNote;
    }

    /**
     * Add validation guidance to prompt
     */
    addValidationGuidance(originalPrompt) {
        const validationGuidance = `

VALIDATION REQUIREMENTS:
- Include proper input validation for all form fields
- Handle empty/null values gracefully
- Validate data types and ranges
- Provide clear error messages to users
- Test edge cases and boundary conditions
`;

        return originalPrompt + validationGuidance;
    }

    /**
     * Add security constraints to prompt
     */
    addSecurityConstraints(originalPrompt) {
        const securityGuidance = `

SECURITY REQUIREMENTS:
- NO use of eval(), Function constructor, or similar dynamic execution
- NO file system access or external network requests
- Sanitize all user inputs
- Use safe DOM manipulation methods only
- Avoid innerHTML with user data - use textContent or createElement
- NO access to window.location, localStorage without validation
`;

        return originalPrompt + securityGuidance;
    }

    /**
     * Calculate exponential backoff delay
     */
    calculateBackoffDelay(retryCount) {
        return this.retryConfig.initialDelay * Math.pow(this.retryConfig.backoffMultiplier, retryCount);
    }

    /**
     * Sleep utility function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Generate user-friendly error message with suggestions
     */
    generateUserFriendlyError(error, context) {
        const errorType = this.classifyError(error);
        const suggestions = this.generateSuggestions(errorType, context);
        
        const friendlyMessages = {
            parsing: 'The AI response could not be properly formatted. This usually happens when the request is too complex.',
            timeout: 'The request took too long to complete. Try simplifying your request.',
            rateLimit: 'Too many requests have been made. Please wait a moment before trying again.',
            network: 'Network connection issue. Please check your internet connection and try again.',
            validation: 'The generated code did not meet validation requirements. Try being more specific in your request.',
            security: 'The generated code was blocked for security reasons. Try requesting simpler functionality.',
            unknown: 'An unexpected error occurred. Please try again with a different approach.'
        };

        return {
            type: errorType,
            message: friendlyMessages[errorType] || friendlyMessages.unknown,
            suggestions,
            canRetry: this.recoveryActions.has(errorType),
            technical: typeof error === 'string' ? error : error.message
        };
    }

    /**
     * Generate contextual suggestions for error recovery
     */
    generateSuggestions(errorType, context) {
        const suggestionMap = {
            parsing: [
                'Try breaking down your request into smaller, simpler components',
                'Be more specific about the exact functionality you need',
                'Avoid requesting too many features in a single prompt'
            ],
            timeout: [
                'Simplify your request to focus on core functionality',
                'Break complex features into multiple smaller requests',
                'Try requesting a basic version first, then add features incrementally'
            ],
            rateLimit: [
                'Wait a few minutes before making another request',
                'Consider upgrading your API plan if this happens frequently'
            ],
            network: [
                'Check your internet connection',
                'Try again in a few moments',
                'Verify your API key is still valid'
            ],
            validation: [
                'Be more specific about data types and validation rules',
                'Include examples of expected input/output formats',
                'Specify error handling requirements clearly'
            ],
            security: [
                'Avoid requesting features that access files or external resources',
                'Focus on safe DOM manipulation and user interface components',
                'Request simpler functionality that doesn\'t require elevated permissions'
            ]
        };

        return suggestionMap[errorType] || [
            'Try rephrasing your request',
            'Break down complex requirements into simpler parts',
            'Check the application logs for more technical details'
        ];
    }

    /**
     * Get recovery statistics
     */
    getRecoveryStats() {
        return {
            availableStrategies: this.generationStrategies.length,
            retryConfig: this.retryConfig,
            supportedErrorTypes: Array.from(this.recoveryActions.keys()),
            errorPatterns: Object.keys(this.errorPatterns)
        };
    }

    /**
     * Update recovery configuration
     */
    updateRecoveryConfig(newConfig) {
        this.retryConfig = { ...this.retryConfig, ...newConfig };
        logger.info('Recovery configuration updated', { config: this.retryConfig });
    }
}

module.exports = new ErrorRecoveryManager();