const logger = require('../utils/logger');
const configManager = require('../utils/configManager');
const cacheManager = require('../utils/cacheManager');
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
            if (cachedResult) {
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
            logger.debug('AI response received', { contentLength: content.length });
            
            // Use enhanced JSON parser
            const parseResult = await jsonParser.parseAIResponse(content);
            if (!parseResult.success) {
                logger.error('JSON parsing failed', parseResult);
                return {
                    success: false,
                    error: `Failed to parse AI response: ${parseResult.error}`,
                    details: parseResult.details,
                    suggestions: jsonParser.generateSuggestions(content, parseResult.error)
                };
            }

            const result = parseResult.data;
            
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

            // Enhance code quality with post-processing
            const enhancementResult = await codeEnhancer.enhanceCode(result.code, {
                addErrorHandling: true,
                addAccessibility: true,
                addInputValidation: true,
                optimizePerformance: true,
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
            retryCount
        });

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
        return `You are an advanced UI component generation assistant. Generate complete, production-ready, interactive web components for desktop applications.

Respond with a JSON object in this EXACT format:
{
  "packages": [],
  "code": "your complete JavaScript code here",
  "description": "Brief description of the component functionality"
}

CRITICAL REQUIREMENTS:

🏗️ ARCHITECTURE:
- Generate complete, self-contained UI components
- Use modern JavaScript (ES6+) with proper DOM manipulation
- Create responsive, accessible, and visually appealing interfaces
- Include comprehensive error handling and input validation
- Implement proper event delegation and cleanup

🎨 STYLING:
- Use inline styles or inject CSS via <style> elements
- Follow modern design principles (clean, minimal, intuitive)
- Ensure mobile-responsive design (use flexbox/grid)
- Include hover states, transitions, and micro-interactions
- Use consistent color scheme and typography

🔒 SECURITY & VALIDATION:
- Sanitize all user inputs
- Validate data types and ranges
- Include proper error messages and user feedback
- Handle edge cases gracefully
- Prevent XSS and injection vulnerabilities

♿ ACCESSIBILITY:
- Include ARIA labels and roles
- Ensure keyboard navigation support
- Use semantic HTML elements
- Provide screen reader compatibility
- Include focus indicators

🚀 PERFORMANCE:
- Optimize DOM operations
- Use event delegation
- Implement debouncing for inputs
- Minimize reflows and repaints
- Include loading states for async operations

CODE STRUCTURE:
- Start with container creation
- Define styles first, then HTML structure
- Add event handlers and functionality
- Include initialization and cleanup
- End with DOM insertion

NO COMMENTS in code - make it self-explanatory through good naming and structure.`;
    }
}

module.exports = CodeGenerationModule;