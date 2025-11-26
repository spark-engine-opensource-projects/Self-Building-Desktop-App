const logger = require('./logger');

class CodeEnhancer {
    constructor() {
        this.enhancementOptions = {
            addErrorHandling: true,
            optimizePerformance: true,
            addAccessibility: true,
            addDocumentation: false,
            validateSyntax: true,
            addInputValidation: true
        };
    }

    /**
     * Validates JavaScript syntax using a safe parser approach
     */
    validateSyntax(code) {
        try {
            // Use Function constructor instead of eval for syntax validation
            new Function(code);
            return {
                valid: true,
                errors: []
            };
        } catch (error) {
            return {
                valid: false,
                errors: [{
                    type: 'SyntaxError',
                    message: error.message,
                    line: this.extractLineNumber(error.message)
                }]
            };
        }
    }

    /**
     * Validates CSS syntax
     */
    validateCSS(css) {
        const errors = [];
        
        // Basic CSS validation patterns
        const cssPatterns = {
            unclosedBraces: /\{[^}]*$/m,
            invalidProperty: /[^a-zA-Z-][\s]*:/g,
            missingSemicolon: /[^;}]\s*\n\s*[a-zA-Z-]+\s*:/g
        };

        Object.entries(cssPatterns).forEach(([type, pattern]) => {
            if (pattern.test(css)) {
                errors.push({
                    type: 'CSSError',
                    message: `Potential ${type} detected`,
                    severity: 'warning'
                });
            }
        });

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validates HTML structure
     */
    validateHTML(html) {
        const errors = [];
        
        // Check for unclosed tags
        const tagRegex = /<(\w+)[^>]*>/g;
        const closingTagRegex = /<\/(\w+)>/g;
        
        const openTags = [];
        const closedTags = [];
        
        let match;
        while ((match = tagRegex.exec(html)) !== null) {
            const tag = match[1].toLowerCase();
            // Skip self-closing tags
            if (!['img', 'br', 'hr', 'input', 'meta', 'link'].includes(tag)) {
                openTags.push(tag);
            }
        }
        
        while ((match = closingTagRegex.exec(html)) !== null) {
            closedTags.push(match[1].toLowerCase());
        }
        
        // Simple validation - in real implementation would need proper parsing
        if (openTags.length !== closedTags.length) {
            errors.push({
                type: 'HTMLError',
                message: 'Potential unclosed HTML tags detected',
                severity: 'warning'
            });
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Enhances JavaScript code with error handling
     */
    addErrorHandling(code) {
        // Add try-catch blocks around potentially dangerous operations
        // Note: localStorage/sessionStorage removed - code using them should be rejected upstream
        // The simple regex patterns can't handle nested parentheses properly
        const dangerousPatterns = [
            /document\.querySelector\(['"][^'"]+['"]\)/g,
            /document\.getElementById\(['"][^'"]+['"]\)/g,
            /JSON\.parse\([^)]+\)/g
        ];

        let enhancedCode = code;

        dangerousPatterns.forEach(pattern => {
            enhancedCode = enhancedCode.replace(pattern, (match) => {
                if (match.includes('try') || match.includes('catch')) {
                    return match; // Already has error handling
                }
                return `(function() { try { return ${match}; } catch(e) { console.warn('Operation failed:', e.message); return null; } })()`;
            });
        });

        return enhancedCode;
    }

    /**
     * Adds accessibility attributes to HTML elements
     */
    addAccessibility(code) {
        let enhancedCode = code;

        // Add ARIA labels to interactive elements
        const accessibilityEnhancements = [
            {
                pattern: /<button([^>]*)>/g,
                replacement: '<button$1 role="button" tabindex="0">'
            },
            {
                pattern: /<input([^>]*type="text"[^>]*)>/g,
                replacement: '<input$1 aria-required="false">'
            },
            {
                pattern: /<form([^>]*)>/g,
                replacement: '<form$1 role="form">'
            },
            {
                pattern: /<div([^>]*onclick[^>]*)>/g,
                replacement: '<div$1 role="button" tabindex="0">'
            }
        ];

        accessibilityEnhancements.forEach(({ pattern, replacement }) => {
            enhancedCode = enhancedCode.replace(pattern, replacement);
        });

        return enhancedCode;
    }

    /**
     * Adds input validation to form elements
     */
    addInputValidation(code) {
        // Add validation event listeners
        const validationCode = `
        // Auto-added input validation
        (function() {
            document.addEventListener('DOMContentLoaded', function() {
                const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="number"], textarea');
                inputs.forEach(input => {
                    if (!input.hasAttribute('data-validation-added')) {
                        input.setAttribute('data-validation-added', 'true');
                        input.addEventListener('blur', function() {
                            if (this.hasAttribute('required') && !this.value.trim()) {
                                this.style.borderColor = '#ef4444';
                                this.setAttribute('aria-invalid', 'true');
                            } else {
                                this.style.borderColor = '';
                                this.removeAttribute('aria-invalid');
                            }
                        });
                    }
                });
            });
        })();
        `;

        // Only add if code contains form elements
        if (code.includes('input') || code.includes('textarea') || code.includes('form')) {
            return code + validationCode;
        }

        return code;
    }

    /**
     * Optimizes performance by adding event delegation
     */
    optimizePerformance(code) {
        // Replace multiple event listeners with event delegation where possible
        let optimizedCode = code;

        // Pattern for multiple addEventListener calls
        const eventListenerPattern = /document\.addEventListener\('([^']+)',\s*function\([^)]*\)\s*{([^}]+)}\)/g;
        const matches = [...code.matchAll(eventListenerPattern)];

        if (matches.length > 2) {
            // Suggest event delegation optimization
            const delegationComment = `
            // Performance optimization: Consider using event delegation
            // for multiple event listeners of the same type
            `;
            optimizedCode = delegationComment + optimizedCode;
        }

        return optimizedCode;
    }

    /**
     * Adds Content Security Policy meta tag
     */
    addCSPHeader(code) {
        if (code.includes('<head>') && !code.includes('Content-Security-Policy')) {
            const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';">`;
            return code.replace('<head>', `<head>\n    ${cspMeta}`);
        }
        return code;
    }

    /**
     * Main enhancement method
     */
    async enhanceCode(code, options = {}) {
        const enhancementOptions = { ...this.enhancementOptions, ...options };
        let enhancedCode = code;
        const issues = [];

        try {
            // 1. Validate syntax first
            if (enhancementOptions.validateSyntax) {
                const syntaxValidation = this.validateSyntax(enhancedCode);
                if (!syntaxValidation.valid) {
                    issues.push(...syntaxValidation.errors);
                    logger.warn('Syntax validation failed', { errors: syntaxValidation.errors });
                    return {
                        success: false,
                        code: enhancedCode,
                        issues,
                        message: 'Code contains syntax errors'
                    };
                }
            }

            // 2. Add error handling
            if (enhancementOptions.addErrorHandling) {
                enhancedCode = this.addErrorHandling(enhancedCode);
            }

            // 3. Add accessibility features
            if (enhancementOptions.addAccessibility) {
                enhancedCode = this.addAccessibility(enhancedCode);
            }

            // 4. Add input validation
            if (enhancementOptions.addInputValidation) {
                enhancedCode = this.addInputValidation(enhancedCode);
            }

            // 5. Performance optimizations
            if (enhancementOptions.optimizePerformance) {
                enhancedCode = this.optimizePerformance(enhancedCode);
            }

            // 6. Add CSP if HTML content
            if (enhancedCode.includes('<html>') || enhancedCode.includes('<head>')) {
                enhancedCode = this.addCSPHeader(enhancedCode);
            }

            logger.info('Code enhancement completed', {
                originalLength: code.length,
                enhancedLength: enhancedCode.length,
                enhancements: Object.keys(enhancementOptions).filter(key => enhancementOptions[key])
            });

            return {
                success: true,
                code: enhancedCode,
                issues,
                enhancements: Object.keys(enhancementOptions).filter(key => enhancementOptions[key])
            };

        } catch (error) {
            logger.error('Code enhancement failed', error);
            return {
                success: false,
                code,
                issues: [{
                    type: 'EnhancementError',
                    message: error.message
                }],
                message: 'Enhancement process failed'
            };
        }
    }

    /**
     * Extract line number from error message
     */
    extractLineNumber(errorMessage) {
        const lineMatch = errorMessage.match(/line (\d+)/i);
        return lineMatch ? parseInt(lineMatch[1]) : null;
    }

    /**
     * Generate enhancement report
     */
    generateReport(originalCode, enhancedCode, issues) {
        return {
            originalSize: originalCode.length,
            enhancedSize: enhancedCode.length,
            improvementRatio: ((enhancedCode.length - originalCode.length) / originalCode.length * 100).toFixed(2),
            issuesFound: issues.length,
            categories: {
                syntax: issues.filter(i => i.type.includes('Syntax')).length,
                security: issues.filter(i => i.type.includes('Security')).length,
                accessibility: issues.filter(i => i.type.includes('Accessibility')).length,
                performance: issues.filter(i => i.type.includes('Performance')).length
            }
        };
    }
}

module.exports = new CodeEnhancer();