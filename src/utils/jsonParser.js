const logger = require('./logger');

class EnhancedJSONParser {
    constructor() {
        this.schema = {
            type: 'object',
            required: ['packages', 'code', 'description'],
            properties: {
                packages: {
                    type: 'array',
                    items: { type: 'string' }
                },
                code: {
                    type: 'string',
                    minLength: 1
                },
                description: {
                    type: 'string',
                    minLength: 1
                }
            }
        };
    }

    /**
     * Extract JSON from AI response with multiple fallback strategies
     */
    extractJSON(content) {
        const strategies = [
            // Strategy 1: Standard JSON code block
            () => {
                const match = content.match(/```json\s*([\s\S]*?)```/i);
                return match ? match[1].trim() : null;
            },
            
            // Strategy 2: Generic code block
            () => {
                const match = content.match(/```\s*([\s\S]*?)```/);
                if (match) {
                    const candidate = match[1].trim();
                    // Check if it looks like JSON (starts with { or [)
                    if (candidate.startsWith('{') || candidate.startsWith('[')) {
                        return candidate;
                    }
                }
                return null;
            },
            
            // Strategy 3: Balanced brace extraction
            () => {
                return this.extractBalancedJSON(content);
            },
            
            // Strategy 4: Line-by-line JSON detection
            () => {
                const lines = content.split('\n');
                let jsonStart = -1;
                let jsonEnd = -1;
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('{') && jsonStart === -1) {
                        jsonStart = i;
                    }
                    if (line.endsWith('}') && jsonStart !== -1) {
                        jsonEnd = i;
                        break;
                    }
                }
                
                if (jsonStart !== -1 && jsonEnd !== -1) {
                    return lines.slice(jsonStart, jsonEnd + 1).join('\n');
                }
                return null;
            }
        ];

        for (let i = 0; i < strategies.length; i++) {
            try {
                const result = strategies[i]();
                if (result) {
                    logger.debug(`JSON extraction successful with strategy ${i + 1}`);
                    return result;
                }
            } catch (error) {
                logger.debug(`JSON extraction strategy ${i + 1} failed:`, error.message);
            }
        }

        return null;
    }

    /**
     * Extract JSON using balanced brace counting
     */
    extractBalancedJSON(content) {
        const start = content.indexOf('{');
        if (start === -1) return null;

        let braceCount = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < content.length; i++) {
            const char = content[i];
            
            if (escaped) {
                escaped = false;
                continue;
            }
            
            if (char === '\\') {
                escaped = true;
                continue;
            }
            
            if (char === '"' && !escaped) {
                inString = !inString;
                continue;
            }
            
            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        return content.substring(start, i + 1);
                    }
                }
            }
        }

        return null;
    }

    /**
     * Validate JSON against schema
     */
    validateSchema(data) {
        const errors = [];

        // Check required fields
        for (const field of this.schema.required) {
            if (!(field in data)) {
                errors.push({
                    field,
                    message: `Required field '${field}' is missing`
                });
            }
        }

        // Validate field types and constraints
        if (data.packages !== undefined) {
            if (!Array.isArray(data.packages)) {
                errors.push({
                    field: 'packages',
                    message: 'packages must be an array'
                });
            } else {
                data.packages.forEach((pkg, index) => {
                    if (typeof pkg !== 'string') {
                        errors.push({
                            field: `packages[${index}]`,
                            message: 'Package names must be strings'
                        });
                    }
                });
            }
        }

        if (data.code !== undefined) {
            if (typeof data.code !== 'string') {
                errors.push({
                    field: 'code',
                    message: 'code must be a string'
                });
            } else if (data.code.trim().length === 0) {
                errors.push({
                    field: 'code',
                    message: 'code cannot be empty'
                });
            }
        }

        if (data.description !== undefined) {
            if (typeof data.description !== 'string') {
                errors.push({
                    field: 'description',
                    message: 'description must be a string'
                });
            } else if (data.description.trim().length === 0) {
                errors.push({
                    field: 'description',
                    message: 'description cannot be empty'
                });
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Attempt to fix common JSON issues
     */
    repairJSON(jsonString) {
        let repaired = jsonString;

        // Common repairs
        const repairs = [
            // Fix trailing commas
            () => repaired.replace(/,(\s*[}\]])/g, '$1'),
            
            // Fix missing quotes around keys
            () => repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":'),
            
            // Fix single quotes to double quotes
            () => repaired.replace(/'/g, '"'),
            
            // Fix unescaped quotes in strings
            () => {
                // This is a simplified version - in practice would need more sophisticated parsing
                return repaired.replace(/(?<!\\)"/g, '\\"');
            }
        ];

        for (const repair of repairs) {
            try {
                const candidate = repair();
                JSON.parse(candidate);
                repaired = candidate;
                logger.debug('JSON repair successful');
                break;
            } catch (error) {
                // Repair didn't work, continue with next
            }
        }

        return repaired;
    }

    /**
     * Parse AI response with comprehensive error handling
     */
    async parseAIResponse(content, options = {}) {
        const startTime = Date.now();
        
        try {
            // Step 1: Extract JSON from response
            const jsonString = this.extractJSON(content);
            if (!jsonString) {
                return {
                    success: false,
                    error: 'No JSON found in response',
                    details: {
                        contentLength: content.length,
                        contentPreview: content.substring(0, 200) + '...'
                    }
                };
            }

            // Step 2: Attempt to parse JSON
            let parsedData;
            try {
                parsedData = JSON.parse(jsonString);
            } catch (parseError) {
                // Step 3: Attempt to repair and re-parse
                logger.debug('Initial JSON parse failed, attempting repair');
                const repairedJSON = this.repairJSON(jsonString);
                
                try {
                    parsedData = JSON.parse(repairedJSON);
                    logger.info('JSON repair successful');
                } catch (repairError) {
                    return {
                        success: false,
                        error: 'Invalid JSON format',
                        details: {
                            parseError: parseError.message,
                            repairError: repairError.message,
                            jsonPreview: jsonString.substring(0, 200) + '...'
                        }
                    };
                }
            }

            // Step 4: Validate against schema
            const validation = this.validateSchema(parsedData);
            if (!validation.valid) {
                return {
                    success: false,
                    error: 'JSON schema validation failed',
                    details: {
                        validationErrors: validation.errors,
                        data: parsedData
                    }
                };
            }

            // Step 5: Sanitize and normalize data
            const sanitizedData = this.sanitizeData(parsedData);

            const processingTime = Date.now() - startTime;
            logger.info('JSON parsing successful', {
                processingTime,
                dataSize: JSON.stringify(sanitizedData).length
            });

            return {
                success: true,
                data: sanitizedData,
                metadata: {
                    processingTime,
                    originalLength: content.length,
                    jsonLength: jsonString.length
                }
            };

        } catch (error) {
            logger.error('JSON parsing failed with unexpected error', error);
            return {
                success: false,
                error: 'Unexpected parsing error',
                details: {
                    errorMessage: error.message,
                    stack: error.stack
                }
            };
        }
    }

    /**
     * Sanitize and normalize parsed data
     */
    sanitizeData(data) {
        return {
            packages: Array.isArray(data.packages) ? 
                data.packages.filter(pkg => typeof pkg === 'string' && pkg.trim().length > 0) : 
                [],
            code: typeof data.code === 'string' ? data.code.trim() : '',
            description: typeof data.description === 'string' ? data.description.trim() : 'No description provided'
        };
    }

    /**
     * Generate parsing suggestions based on failure patterns
     */
    generateSuggestions(content, error) {
        const suggestions = [];

        if (error.includes('No JSON found')) {
            suggestions.push('Ensure the response contains JSON wrapped in ```json code blocks');
            suggestions.push('Check if the response format matches the expected structure');
        }

        if (error.includes('Invalid JSON format')) {
            suggestions.push('Verify JSON syntax (brackets, commas, quotes)');
            suggestions.push('Check for unescaped characters in strings');
        }

        if (error.includes('schema validation failed')) {
            suggestions.push('Ensure all required fields (packages, code, description) are present');
            suggestions.push('Verify data types match expected schema');
        }

        return suggestions;
    }

    /**
     * Get detailed error information for debugging
     */
    getDetailedError(content, error) {
        return {
            error: error.message || error,
            contentAnalysis: {
                length: content.length,
                hasCodeBlocks: /```/.test(content),
                hasJSON: /\{[\s\S]*\}/.test(content),
                preview: content.substring(0, 300) + '...'
            },
            suggestions: this.generateSuggestions(content, error.message || error),
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = new EnhancedJSONParser();