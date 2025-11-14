const { Application } = require('spectron');
const path = require('path');
const nock = require('nock');

describe('API Integration End-to-End Tests', () => {
    let app;
    let mockServer;

    beforeAll(async () => {
        // Setup mock API server
        mockServer = nock('https://api.anthropic.com')
            .persist()
            .defaultReplyHeaders({
                'Content-Type': 'application/json'
            });

        // Start application
        app = new Application({
            path: require('electron'),
            args: [path.join(__dirname, '..', '..', 'src', 'main.js')],
            env: {
                NODE_ENV: 'test',
                USE_MOCK_API: 'true'
            }
        });

        await app.start();
    }, 30000);

    afterAll(async () => {
        nock.cleanAll();
        
        if (app && app.isRunning()) {
            await app.stop();
        }
    });

    describe('Claude API Integration', () => {
        test('should successfully call Claude API for code generation', async () => {
            // Mock successful API response
            mockServer
                .post('/v1/complete')
                .reply(200, {
                    completion: 'function helloWorld() {\n  console.log("Hello, World!");\n}',
                    stop_reason: 'stop',
                    model: 'claude-2'
                });

            // Trigger code generation
            await app.client.setValue('#promptInput', 'Create a hello world function');
            await app.client.click('#generateBtn');

            // Wait for response
            await app.client.waitForExist('#outputContainer .code-output', 15000);
            
            const output = await app.client.getText('#outputContainer .code-output');
            expect(output).toContain('function helloWorld');
            expect(output).toContain('console.log');
        });

        test('should handle API rate limiting gracefully', async () => {
            // Mock rate limit response
            mockServer
                .post('/v1/complete')
                .reply(429, {
                    error: {
                        type: 'rate_limit_error',
                        message: 'Rate limit exceeded'
                    }
                }, {
                    'Retry-After': '5'
                });

            // Attempt generation
            await app.client.setValue('#promptInput', 'Generate code');
            await app.client.click('#generateBtn');

            // Should show rate limit message
            await app.client.waitForExist('.warning-message', 5000);
            const warning = await app.client.getText('.warning-message');
            expect(warning).toContain('rate limit');
            
            // Should show retry timer
            expect(await app.client.isExisting('#retryTimer')).toBe(true);
        });

        test('should handle API authentication errors', async () => {
            // Mock authentication error
            mockServer
                .post('/v1/complete')
                .reply(401, {
                    error: {
                        type: 'authentication_error',
                        message: 'Invalid API key'
                    }
                });

            // Attempt generation
            await app.client.setValue('#promptInput', 'Generate code');
            await app.client.click('#generateBtn');

            // Should show auth error
            await app.client.waitForExist('.error-message', 5000);
            const error = await app.client.getText('.error-message');
            expect(error).toContain('API key');

            // Should offer to open settings
            expect(await app.client.isExisting('#openSettingsBtn')).toBe(true);
        });

        test('should handle streaming responses', async () => {
            // Mock streaming response
            let responseCount = 0;
            mockServer
                .post('/v1/complete')
                .reply(function() {
                    responseCount++;
                    if (responseCount <= 3) {
                        return [200, {
                            completion: `Part ${responseCount} of code\n`,
                            stop_reason: null
                        }];
                    } else {
                        return [200, {
                            completion: 'Final part',
                            stop_reason: 'stop'
                        }];
                    }
                });

            // Trigger generation
            await app.client.setValue('#promptInput', 'Generate streaming code');
            await app.client.click('#generateBtn');

            // Should show progressive updates
            await app.client.waitForExist('#outputContainer .code-output', 5000);
            
            // Wait for all parts
            await app.client.waitUntil(async () => {
                const text = await app.client.getText('#outputContainer .code-output');
                return text.includes('Final part');
            }, 15000);

            const finalOutput = await app.client.getText('#outputContainer .code-output');
            expect(finalOutput).toContain('Part 1');
            expect(finalOutput).toContain('Part 2');
            expect(finalOutput).toContain('Part 3');
            expect(finalOutput).toContain('Final part');
        });

        test('should handle network timeouts', async () => {
            // Mock timeout (no response)
            mockServer
                .post('/v1/complete')
                .delayConnection(35000) // Delay longer than timeout
                .reply(200, {});

            // Attempt generation
            await app.client.setValue('#promptInput', 'Generate code');
            await app.client.click('#generateBtn');

            // Should show timeout error
            await app.client.waitForExist('.error-message', 35000);
            const error = await app.client.getText('.error-message');
            expect(error).toContain('timeout');

            // Should offer retry
            expect(await app.client.isExisting('#retryBtn')).toBe(true);
        });

        test('should validate API responses', async () => {
            // Mock malformed response
            mockServer
                .post('/v1/complete')
                .reply(200, {
                    // Missing required fields
                    invalid: 'response'
                });

            // Attempt generation
            await app.client.setValue('#promptInput', 'Generate code');
            await app.client.click('#generateBtn');

            // Should handle gracefully
            await app.client.waitForExist('.error-message', 10000);
            const error = await app.client.getText('.error-message');
            expect(error).toContain('Invalid response');
        });
    });

    describe('Multiple API Calls', () => {
        test('should handle concurrent API requests', async () => {
            // Mock multiple endpoints
            mockServer
                .post('/v1/complete')
                .times(3)
                .reply(200, (uri, requestBody) => ({
                    completion: `Response for: ${JSON.parse(requestBody).prompt}`,
                    stop_reason: 'stop'
                }));

            // Open multiple tabs
            await app.client.click('#newTabBtn');
            await app.client.click('#newTabBtn');
            
            // Make concurrent requests in different tabs
            const tabs = await app.client.elements('.tab-item');
            
            for (let i = 0; i < 3; i++) {
                await app.client.click(`.tab-item:nth-child(${i + 1})`);
                await app.client.setValue('#promptInput', `Prompt ${i + 1}`);
                await app.client.click('#generateBtn');
            }

            // Wait for all responses
            await app.client.waitUntil(async () => {
                const outputs = await app.client.elements('.code-output');
                return outputs.value.length >= 3;
            }, 20000);

            // Verify each tab has its response
            for (let i = 0; i < 3; i++) {
                await app.client.click(`.tab-item:nth-child(${i + 1})`);
                const output = await app.client.getText('#outputContainer .code-output');
                expect(output).toContain(`Prompt ${i + 1}`);
            }
        });

        test('should queue requests when rate limited', async () => {
            let requestCount = 0;
            
            // Mock rate limiting after first request
            mockServer
                .post('/v1/complete')
                .reply(() => {
                    requestCount++;
                    if (requestCount === 1) {
                        return [200, {
                            completion: 'First request success',
                            stop_reason: 'stop'
                        }];
                    } else if (requestCount === 2) {
                        return [429, {
                            error: { type: 'rate_limit_error' }
                        }, { 'Retry-After': '2' }];
                    } else {
                        return [200, {
                            completion: 'Queued request success',
                            stop_reason: 'stop'
                        }];
                    }
                });

            // Make first request
            await app.client.setValue('#promptInput', 'First prompt');
            await app.client.click('#generateBtn');
            await app.client.waitForExist('#outputContainer .code-output', 10000);

            // Make second request (should be rate limited then queued)
            await app.client.setValue('#promptInput', 'Second prompt');
            await app.client.click('#generateBtn');

            // Should show queue status
            await app.client.waitForExist('#requestQueue', 5000);
            const queueStatus = await app.client.getText('#requestQueue');
            expect(queueStatus).toContain('queued');

            // Wait for retry
            await app.client.waitUntil(async () => {
                const output = await app.client.getText('#outputContainer .code-output');
                return output.includes('Queued request success');
            }, 10000);
        });
    });

    describe('API Configuration', () => {
        test('should allow switching API endpoints', async () => {
            // Open settings
            await app.client.click('#settingsBtn');
            await app.client.waitForExist('#settingsDialog', 5000);

            // Change endpoint
            await app.client.setValue('#apiEndpoint', 'https://custom.api.com');
            await app.client.click('#saveSettingsBtn');

            // Mock custom endpoint
            nock('https://custom.api.com')
                .post('/v1/complete')
                .reply(200, {
                    completion: 'Custom endpoint response',
                    stop_reason: 'stop'
                });

            // Test with new endpoint
            await app.client.setValue('#promptInput', 'Test custom endpoint');
            await app.client.click('#generateBtn');

            await app.client.waitForExist('#outputContainer .code-output', 10000);
            const output = await app.client.getText('#outputContainer .code-output');
            expect(output).toContain('Custom endpoint response');
        });

        test('should support different API versions', async () => {
            // Open settings
            await app.client.click('#settingsBtn');
            await app.client.waitForExist('#settingsDialog', 5000);

            // Select different API version
            await app.client.selectByValue('#apiVersion', 'v2');
            await app.client.click('#saveSettingsBtn');

            // Mock v2 endpoint
            mockServer
                .post('/v2/messages')
                .reply(200, {
                    content: [{ text: 'V2 API response' }],
                    stop_reason: 'stop'
                });

            // Test with v2
            await app.client.setValue('#promptInput', 'Test v2 API');
            await app.client.click('#generateBtn');

            await app.client.waitForExist('#outputContainer .code-output', 10000);
            const output = await app.client.getText('#outputContainer .code-output');
            expect(output).toContain('V2 API response');
        });
    });

    describe('Error Recovery', () => {
        test('should implement exponential backoff on failures', async () => {
            let attemptCount = 0;
            const attemptTimes = [];

            mockServer
                .post('/v1/complete')
                .reply(() => {
                    attemptCount++;
                    attemptTimes.push(Date.now());
                    
                    if (attemptCount < 3) {
                        return [500, { error: 'Server error' }];
                    }
                    return [200, {
                        completion: 'Success after retries',
                        stop_reason: 'stop'
                    }];
                });

            // Trigger request
            await app.client.setValue('#promptInput', 'Test retry');
            await app.client.click('#generateBtn');

            // Wait for successful response
            await app.client.waitForExist('#outputContainer .code-output', 20000);
            
            // Verify exponential backoff
            expect(attemptTimes.length).toBe(3);
            if (attemptTimes.length >= 3) {
                const delay1 = attemptTimes[1] - attemptTimes[0];
                const delay2 = attemptTimes[2] - attemptTimes[1];
                
                // Second delay should be longer (exponential)
                expect(delay2).toBeGreaterThan(delay1);
            }
        });

        test('should cache successful responses', async () => {
            // Mock API response
            let callCount = 0;
            mockServer
                .post('/v1/complete')
                .reply(() => {
                    callCount++;
                    return [200, {
                        completion: `Response ${callCount}`,
                        stop_reason: 'stop'
                    }];
                });

            // Make first request
            const prompt = 'Cached prompt test';
            await app.client.setValue('#promptInput', prompt);
            await app.client.click('#generateBtn');
            await app.client.waitForExist('#outputContainer .code-output', 10000);

            const firstOutput = await app.client.getText('#outputContainer .code-output');
            expect(firstOutput).toContain('Response 1');

            // Clear output
            await app.client.click('#clearOutputBtn');

            // Make same request again
            await app.client.setValue('#promptInput', prompt);
            await app.client.click('#generateBtn');
            await app.client.waitForExist('#outputContainer .code-output', 5000);

            const secondOutput = await app.client.getText('#outputContainer .code-output');
            // Should get cached response (Response 1, not Response 2)
            expect(secondOutput).toContain('Response 1');
            expect(callCount).toBe(1); // API called only once
        });
    });

    describe('Request Validation', () => {
        test('should validate prompts before sending', async () => {
            // Test empty prompt
            await app.client.setValue('#promptInput', '');
            await app.client.click('#generateBtn');

            await app.client.waitForExist('.validation-error', 5000);
            let error = await app.client.getText('.validation-error');
            expect(error).toContain('prompt is required');

            // Test prompt too long
            const longPrompt = 'a'.repeat(10001); // Assuming 10k char limit
            await app.client.setValue('#promptInput', longPrompt);
            await app.client.click('#generateBtn');

            await app.client.waitForExist('.validation-error', 5000);
            error = await app.client.getText('.validation-error');
            expect(error).toContain('too long');

            // Test valid prompt
            await app.client.setValue('#promptInput', 'Valid prompt');
            await app.client.click('#generateBtn');
            
            // Should not show validation error
            const hasError = await app.client.isExisting('.validation-error');
            expect(hasError).toBe(false);
        });

        test('should sanitize prompts for security', async () => {
            // Mock API to echo the prompt
            mockServer
                .post('/v1/complete')
                .reply(200, (uri, requestBody) => {
                    const body = JSON.parse(requestBody);
                    return {
                        completion: `Received: ${body.prompt}`,
                        stop_reason: 'stop'
                    };
                });

            // Test XSS attempt in prompt
            const xssPrompt = '<script>alert("XSS")</script> Generate code';
            await app.client.setValue('#promptInput', xssPrompt);
            await app.client.click('#generateBtn');

            await app.client.waitForExist('#outputContainer .code-output', 10000);
            const output = await app.client.getText('#outputContainer .code-output');
            
            // Should have sanitized the script tags
            expect(output).not.toContain('<script');
            expect(output).toContain('Generate code');
        });
    });

    describe('Response Processing', () => {
        test('should format code responses correctly', async () => {
            mockServer
                .post('/v1/complete')
                .reply(200, {
                    completion: '```javascript\nfunction test() {\n  return "formatted";\n}\n```',
                    stop_reason: 'stop'
                });

            await app.client.setValue('#promptInput', 'Generate formatted code');
            await app.client.click('#generateBtn');

            await app.client.waitForExist('#outputContainer .code-output', 10000);
            
            // Check for syntax highlighting
            expect(await app.client.isExisting('.hljs')).toBe(true);
            
            // Check for line numbers
            expect(await app.client.isExisting('.line-numbers')).toBe(true);
            
            // Check for copy button
            expect(await app.client.isExisting('#copyCodeBtn')).toBe(true);
        });

        test('should handle multi-language responses', async () => {
            mockServer
                .post('/v1/complete')
                .reply(200, {
                    completion: '```python\ndef hello():\n    print("Python")\n```\n\n```javascript\nfunction hello() {\n    console.log("JavaScript");\n}\n```',
                    stop_reason: 'stop'
                });

            await app.client.setValue('#promptInput', 'Generate multi-language code');
            await app.client.click('#generateBtn');

            await app.client.waitForExist('#outputContainer .code-output', 10000);
            
            // Should have multiple code blocks
            const codeBlocks = await app.client.elements('.code-block');
            expect(codeBlocks.value.length).toBe(2);
            
            // Should show language labels
            expect(await app.client.isExisting('.language-python')).toBe(true);
            expect(await app.client.isExisting('.language-javascript')).toBe(true);
        });
    });
});