const ipcSecurity = require('../../src/utils/ipcSecurityMiddleware');
const RateLimiter = require('../../src/utils/rateLimiter');

describe('IPC Security Middleware', () => {
    let mockAuditModule;
    let mockRateLimiter;

    beforeEach(() => {
        mockAuditModule = {
            logSecurityEvent: jest.fn().mockResolvedValue(undefined),
            logEvent: jest.fn().mockResolvedValue(undefined)
        };

        mockRateLimiter = {
            checkLimit: jest.fn().mockResolvedValue(true)
        };

        ipcSecurity.initialize(mockAuditModule);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Sender Verification', () => {
        test('should reject unauthorized sender', async () => {
            const mockEvent = {
                sender: { id: 999, processId: 1234 }
            };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => ({ success: true })
            );

            const result = await handler(mockEvent);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Unauthorized');
            expect(mockAuditModule.logSecurityEvent).toHaveBeenCalledWith(
                'unauthorized_ipc_access',
                expect.objectContaining({ handler: 'test-handler' })
            );
        });

        test('should accept registered sender', async () => {
            const senderId = 123;
            ipcSecurity.registerSender(senderId);

            const mockEvent = {
                sender: { id: senderId }
            };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => ({ success: true, data: 'test' })
            );

            const result = await handler(mockEvent);

            expect(result.success).toBe(true);
            expect(result.data).toBe('test');
        });

        test('should unregister sender', () => {
            const senderId = 456;
            ipcSecurity.registerSender(senderId);
            ipcSecurity.unregisterSender(senderId);

            const mockEvent = {
                sender: { id: senderId }
            };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => ({ success: true })
            );

            return handler(mockEvent).then(result => {
                expect(result.success).toBe(false);
                expect(result.error).toContain('Unauthorized');
            });
        });
    });

    describe('Input Validation', () => {
        beforeEach(() => {
            ipcSecurity.registerSender(1);
        });

        test('should validate required string parameter', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {
                    name: { type: 'string', required: true }
                },
                async (event, params) => ({ success: true, name: params.name })
            );

            // Missing required parameter
            const result1 = await handler(mockEvent, {});
            expect(result1.success).toBe(false);
            expect(result1.error).toContain('required parameter');

            // Valid parameter
            const result2 = await handler(mockEvent, { name: 'test' });
            expect(result2.success).toBe(true);
            expect(result2.name).toBe('test');
        });

        test('should validate string length', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {
                    name: { type: 'string', maxLength: 10, minLength: 2 }
                },
                async (event, params) => ({ success: true })
            );

            // Too short
            const result1 = await handler(mockEvent, { name: 'a' });
            expect(result1.success).toBe(false);

            // Too long
            const result2 = await handler(mockEvent, { name: 'a'.repeat(11) });
            expect(result2.success).toBe(false);

            // Valid
            const result3 = await handler(mockEvent, { name: 'valid' });
            expect(result3.success).toBe(true);
        });

        test('should validate number ranges', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {
                    age: { type: 'number', min: 0, max: 150 }
                },
                async (event, params) => ({ success: true })
            );

            const result1 = await handler(mockEvent, { age: -1 });
            expect(result1.success).toBe(false);

            const result2 = await handler(mockEvent, { age: 200 });
            expect(result2.success).toBe(false);

            const result3 = await handler(mockEvent, { age: 25 });
            expect(result3.success).toBe(true);
        });

        test('should validate integer type', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {
                    count: { type: 'number', integer: true }
                },
                async (event, params) => ({ success: true })
            );

            const result1 = await handler(mockEvent, { count: 3.14 });
            expect(result1.success).toBe(false);

            const result2 = await handler(mockEvent, { count: 42 });
            expect(result2.success).toBe(true);
        });

        test('should detect prototype pollution', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {
                    config: { type: 'object', required: true }
                },
                async (event, params) => ({ success: true })
            );

            const result1 = await handler(mockEvent, {
                config: { __proto__: { polluted: true } }
            });
            expect(result1.success).toBe(false);
            expect(result1.error).toContain('forbidden properties');

            const result2 = await handler(mockEvent, {
                config: { constructor: {} }
            });
            expect(result2.success).toBe(false);
        });

        test('should validate array constraints', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {
                    items: { type: 'array', maxItems: 5, minItems: 1 }
                },
                async (event, params) => ({ success: true })
            );

            const result1 = await handler(mockEvent, { items: [] });
            expect(result1.success).toBe(false);

            const result2 = await handler(mockEvent, { items: [1, 2, 3, 4, 5, 6] });
            expect(result2.success).toBe(false);

            const result3 = await handler(mockEvent, { items: [1, 2, 3] });
            expect(result3.success).toBe(true);
        });
    });

    describe('Rate Limiting', () => {
        beforeEach(() => {
            ipcSecurity.registerSender(1);
        });

        test('should enforce rate limits', async () => {
            const mockEvent = { sender: { id: 1 } };
            mockRateLimiter.checkLimit.mockResolvedValue(false);

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => ({ success: true }),
                { rateLimit: mockRateLimiter }
            );

            const result = await handler(mockEvent);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Rate limit exceeded');
            expect(mockAuditModule.logSecurityEvent).toHaveBeenCalledWith(
                'rate_limit_exceeded',
                expect.any(Object)
            );
        });

        test('should allow requests within rate limit', async () => {
            const mockEvent = { sender: { id: 1 } };
            mockRateLimiter.checkLimit.mockResolvedValue(true);

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => ({ success: true }),
                { rateLimit: mockRateLimiter }
            );

            const result = await handler(mockEvent);

            expect(result.success).toBe(true);
            expect(mockRateLimiter.checkLimit).toHaveBeenCalled();
        });
    });

    describe('Error Sanitization', () => {
        beforeEach(() => {
            ipcSecurity.registerSender(1);
        });

        test('should sanitize file paths in errors', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => {
                    throw new Error('File not found: /home/user/secret/config.json');
                }
            );

            const result = await handler(mockEvent);

            expect(result.success).toBe(false);
            expect(result.error).not.toContain('/home/user');
            expect(result.error).not.toContain('secret');
        });

        test('should sanitize potential secrets in errors', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => {
                    throw new Error('API key sk-ant-1234567890abcdefghijklmnop is invalid');
                }
            );

            const result = await handler(mockEvent);

            expect(result.success).toBe(false);
            expect(result.error).not.toContain('sk-ant-');
            expect(result.error).not.toContain('1234567890abcdefghijklmnop');
        });

        test('should log full error internally', async () => {
            const mockEvent = { sender: { id: 1 } };
            const errorMessage = 'Detailed error with sensitive info';

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => {
                    throw new Error(errorMessage);
                }
            );

            await handler(mockEvent);

            // Error should be logged (check logger spy if implemented)
            // Full error details preserved in logs, not in response
        });
    });

    describe('CSRF Protection', () => {
        beforeEach(() => {
            ipcSecurity.registerSender(1);
        });

        test('should generate CSRF token', () => {
            const token = ipcSecurity.generateCSRFToken(1);
            expect(token).toBeDefined();
            expect(token.length).toBe(64); // 32 bytes = 64 hex chars
        });

        test('should validate CSRF token', () => {
            const token = ipcSecurity.generateCSRFToken(1);
            expect(ipcSecurity.validateCSRFToken(1, token)).toBe(true);
        });

        test('should reject invalid CSRF token', () => {
            ipcSecurity.generateCSRFToken(1);
            expect(ipcSecurity.validateCSRFToken(1, 'invalid')).toBe(false);
        });

        test('should require CSRF token when enabled', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => ({ success: true }),
                { requireCSRF: true }
            );

            // No token
            const result1 = await handler(mockEvent, {});
            expect(result1.success).toBe(false);
            expect(result1.error).toContain('CSRF');

            // Valid token
            const token = ipcSecurity.generateCSRFToken(1);
            const result2 = await handler(mockEvent, { csrfToken: token });
            expect(result2.success).toBe(true);
        });
    });

    describe('Schema Helpers', () => {
        test('should provide string schema helper', () => {
            const schema = ipcSecurity.schemas.string({ maxLength: 100 });
            expect(schema.type).toBe('string');
            expect(schema.maxLength).toBe(100);
        });

        test('should provide dbName schema', () => {
            const schema = ipcSecurity.schemas.dbName();
            expect(schema.type).toBe('string');
            expect(schema.required).toBe(true);
            expect(schema.pattern).toBeDefined();
        });

        test('should provide prompt schema', () => {
            const schema = ipcSecurity.schemas.prompt();
            expect(schema.type).toBe('string');
            expect(schema.required).toBe(true);
            expect(schema.minLength).toBe(1);
            expect(schema.maxLength).toBe(10000);
        });
    });

    describe('Access Logging', () => {
        beforeEach(() => {
            ipcSecurity.registerSender(1);
        });

        test('should log IPC access when enabled', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => ({ success: true }),
                { logAccess: true }
            );

            await handler(mockEvent);

            expect(mockAuditModule.logEvent).toHaveBeenCalledWith(
                'ipc_access',
                expect.objectContaining({
                    handler: 'test-handler',
                    senderId: 1
                })
            );
        });

        test('should not log when disabled', async () => {
            const mockEvent = { sender: { id: 1 } };

            const handler = ipcSecurity.secureHandler(
                'test-handler',
                {},
                async () => ({ success: true }),
                { logAccess: false }
            );

            await handler(mockEvent);

            expect(mockAuditModule.logEvent).not.toHaveBeenCalled();
        });
    });
});
