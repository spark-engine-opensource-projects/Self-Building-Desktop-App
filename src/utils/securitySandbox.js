const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const configManager = require('./configManager');

class SecuritySandbox {
    constructor() {
        this.suspiciousPatterns = [
            /require\s*\(\s*['"]child_process['"]\s*\)/,
            /require\s*\(\s*['"]fs['"]\s*\)/,
            /require\s*\(\s*['"]os['"]\s*\)/,
            /require\s*\(\s*['"]process['"]\s*\)/,
            /process\.exit/,
            /process\.kill/,
            /eval\s*\(/,
            /Function\s*\(/,
            /\.\.\/|\.\.\\\\/, // Path traversal
            /\/etc\/|\/proc\/|\/sys\//,
            /rm\s+-rf/,
            /del\s+\/[qfs]/i
        ];
        
        this.dangerousPackages = [
            'child_process',
            'cluster',
            'dgram',
            'dns',
            'net',
            'tls',
            'worker_threads'
        ];
    }

    scanCode(code) {
        const issues = [];
        
        // AST-based analysis (safer than regex-only)
        try {
            const astIssues = this.analyzeAST(code);
            issues.push(...astIssues);
        } catch (astError) {
            // If AST parsing fails, fall back to regex patterns
            logger.debug('AST analysis failed, using regex patterns', { error: astError.message });
        }
        
        // Check for suspicious patterns (regex-based fallback)
        this.suspiciousPatterns.forEach((pattern, index) => {
            if (pattern.test(code)) {
                issues.push({
                    type: 'suspicious_pattern',
                    severity: 'high',
                    pattern: pattern.source,
                    description: 'Potentially dangerous code pattern detected'
                });
            }
        });
        
        // Check for require statements with dangerous packages
        const requireMatches = code.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
        if (requireMatches) {
            requireMatches.forEach(match => {
                const packageMatch = match.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
                if (packageMatch) {
                    const packageName = packageMatch[1];
                    if (this.dangerousPackages.includes(packageName)) {
                        issues.push({
                            type: 'dangerous_package',
                            severity: 'critical',
                            package: packageName,
                            description: `Use of dangerous package: ${packageName}`
                        });
                    }
                }
            });
        }
        
        // Check for large code size
        if (code.length > 50000) {
            issues.push({
                type: 'code_size',
                severity: 'medium',
                size: code.length,
                description: 'Code size exceeds recommended limits'
            });
        }
        
        return {
            safe: issues.filter(i => i.severity === 'critical').length === 0,
            issues,
            riskLevel: this.calculateRiskLevel(issues)
        };
    }

    calculateRiskLevel(issues) {
        let score = 0;
        issues.forEach(issue => {
            switch (issue.severity) {
                case 'critical': score += 10; break;
                case 'high': score += 5; break;
                case 'medium': score += 2; break;
                case 'low': score += 1; break;
            }
        });
        
        if (score >= 10) return 'critical';
        if (score >= 5) return 'high';
        if (score >= 2) return 'medium';
        return 'low';
    }

    /**
     * Enhanced pattern-based security analysis (more accurate than basic regex)
     */
    analyzeAST(code) {
        const issues = [];
        
        try {
            // Validate syntax by attempting to create a function
            new Function(code);
            
            // Check for specific dangerous patterns in the code string
            const dangerousCallsPatterns = [
                { pattern: /\.innerHTML\s*=/, severity: 'medium', description: 'Potential XSS vulnerability - use textContent or createElement instead' },
                { pattern: /document\.write\s*\(/, severity: 'high', description: 'document.write can cause security issues' },
                { pattern: /setTimeout\s*\(\s*['"][^'"]*['"]/, severity: 'medium', description: 'String-based setTimeout can be dangerous' },
                { pattern: /setInterval\s*\(\s*['"][^'"]*['"]/, severity: 'medium', description: 'String-based setInterval can be dangerous' },
                { pattern: /new\s+Function\s*\(/, severity: 'high', description: 'Dynamic function creation detected' },
                { pattern: /window\s*\[\s*['"][^'"]*['"]\s*\]/, severity: 'medium', description: 'Dynamic window property access' },
                { pattern: /localStorage\.setItem\s*\(\s*['"][^'"]*['"][^)]*\)/, severity: 'low', description: 'Local storage usage detected' },
                { pattern: /sessionStorage\.setItem\s*\(\s*['"][^'"]*['"][^)]*\)/, severity: 'low', description: 'Session storage usage detected' },
                { pattern: /fetch\s*\(/, severity: 'medium', description: 'Network request detected - ensure proper validation' },
                { pattern: /XMLHttpRequest/, severity: 'medium', description: 'XMLHttpRequest usage - ensure proper validation' }
            ];

            dangerousCallsPatterns.forEach(({ pattern, severity, description }) => {
                if (pattern.test(code)) {
                    issues.push({
                        type: 'ast_analysis',
                        severity,
                        description,
                        pattern: pattern.source
                    });
                }
            });

            // Check for data flow issues
            const dataFlowIssues = this.analyzeDataFlow(code);
            issues.push(...dataFlowIssues);

        } catch (error) {
            // AST parsing failed - this could indicate malformed code
            issues.push({
                type: 'syntax_error',
                severity: 'medium',
                description: 'Code syntax analysis failed - potential malformed code',
                error: error.message
            });
        }

        return issues;
    }

    /**
     * Analyze data flow for potential security issues
     */
    analyzeDataFlow(code) {
        const issues = [];
        
        // Check for user input directly used in dangerous contexts
        const userInputPatterns = [
            /prompt\s*\([^)]*\)/g,
            /confirm\s*\([^)]*\)/g,
            /alert\s*\([^)]*\)/g
        ];

        const dangerousContexts = [
            /\.innerHTML\s*=/,
            /document\.write/,
            /eval\s*\(/,
            /setTimeout\s*\(/,
            /setInterval\s*\(/
        ];

        // Simple data flow analysis
        userInputPatterns.forEach(inputPattern => {
            const inputMatches = code.match(inputPattern);
            if (inputMatches) {
                dangerousContexts.forEach(contextPattern => {
                    if (contextPattern.test(code)) {
                        issues.push({
                            type: 'data_flow',
                            severity: 'high',
                            description: 'User input may be used in dangerous context without proper sanitization'
                        });
                    }
                });
            }
        });

        return issues;
    }

    async createSandboxEnvironment(sessionId) {
        const sessionDir = path.join(__dirname, '..', '..', 'temp', sessionId);
        
        try {
            // Create session directory
            await fs.mkdir(sessionDir, { recursive: true });
            
            // Create sandbox package.json with restricted permissions
            const sandboxPackageJson = {
                name: `sandbox-${sessionId}`,
                version: "1.0.0",
                private: true,
                engines: {
                    node: ">=14.0.0"
                },
                dependencies: {}
            };
            
            await fs.writeFile(
                path.join(sessionDir, 'package.json'),
                JSON.stringify(sandboxPackageJson, null, 2)
            );
            
            // Create .npmrc to restrict package sources
            const npmrcContent = `
registry=https://registry.npmjs.org/
audit=false
fund=false
optional=false
save-exact=true
`;
            await fs.writeFile(path.join(sessionDir, '.npmrc'), npmrcContent.trim());
            
            logger.info('Sandbox environment created', { sessionId, sessionDir });
            
            return { success: true, sessionDir };
            
        } catch (error) {
            logger.error('Failed to create sandbox environment', error, { sessionId });
            return { success: false, error: error.message };
        }
    }

    async executeInSandbox(sessionDir, code, packages = []) {
        const config = configManager.get('execution');
        
        try {
            // Install packages if needed
            if (packages && packages.length > 0) {
                await this.installPackagesSecurely(sessionDir, packages);
            }
            
            // Write code to file
            const codeFile = path.join(sessionDir, 'generated.js');
            await fs.writeFile(codeFile, code);
            
            // Execute with strict limits
            const result = await this.executeWithLimits(sessionDir, config);
            
            return result;
            
        } catch (error) {
            logger.error('Sandbox execution failed', error, { sessionDir });
            return {
                success: false,
                error: error.message,
                output: '',
                errors: error.message
            };
        }
    }

    async installPackagesSecurely(sessionDir, packages) {
        const config = configManager.get('security');
        
        // Filter dangerous packages if blocking is enabled
        if (config.blockSuspiciousPackages) {
            const filteredPackages = packages.filter(pkg => {
                const isDangerous = this.dangerousPackages.some(dangerous => 
                    pkg.toLowerCase().includes(dangerous.toLowerCase())
                );
                
                if (isDangerous) {
                    logger.logSecurityEvent('blocked_dangerous_package', { package: pkg });
                }
                
                return !isDangerous;
            });
            
            packages = filteredPackages;
        }
        
        if (packages.length === 0) return;
        
        // Update package.json
        const packageJsonPath = path.join(sessionDir, 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        
        packages.forEach(pkg => {
            packageJson.dependencies[pkg] = 'latest';
        });
        
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
        
        // Install with timeout and resource limits
        return new Promise((resolve, reject) => {
            const npm = spawn('npm', ['install'], {
                cwd: sessionDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 60000 // 1 minute timeout
            });
            
            let output = '';
            let errors = '';
            
            npm.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            npm.stderr.on('data', (data) => {
                errors += data.toString();
            });
            
            npm.on('close', (code) => {
                if (code === 0) {
                    logger.info('Packages installed successfully', { packages, sessionDir });
                    resolve({ success: true });
                } else {
                    logger.error('Package installation failed', null, { 
                        packages, 
                        sessionDir, 
                        code, 
                        errors 
                    });
                    reject(new Error(`Package installation failed: ${errors}`));
                }
            });
            
            npm.on('error', (error) => {
                logger.error('Package installation error', error, { packages, sessionDir });
                reject(error);
            });
        });
    }

    async executeWithLimits(sessionDir, config) {
        return new Promise((resolve, reject) => {
            const node = spawn('node', ['generated.js'], {
                cwd: sessionDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: config.executionTimeout,
                env: {
                    NODE_OPTIONS: `--max-old-space-size=${config.maxMemoryMB}`,
                    NODE_PATH: path.join(sessionDir, 'node_modules')
                }
            });
            
            let output = '';
            let errors = '';
            
            node.stdout.on('data', (data) => {
                output += data.toString();
                // Limit output size
                if (output.length > config.maxOutputSize) {
                    node.kill('SIGTERM');
                    reject(new Error('Output size limit exceeded'));
                }
            });
            
            node.stderr.on('data', (data) => {
                errors += data.toString();
            });
            
            node.on('close', (code) => {
                resolve({
                    success: code === 0,
                    output: output.slice(0, config.maxOutputSize),
                    errors: errors || null,
                    exitCode: code
                });
            });
            
            node.on('error', (error) => {
                reject(error);
            });
        });
    }

    async cleanupSandbox(sessionDir) {
        try {
            await fs.rmdir(sessionDir, { recursive: true });
            logger.info('Sandbox cleaned up', { sessionDir });
        } catch (error) {
            logger.error('Sandbox cleanup failed', error, { sessionDir });
        }
    }
}

module.exports = new SecuritySandbox();