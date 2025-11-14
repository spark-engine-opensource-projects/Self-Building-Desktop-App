const path = require('path');
const fs = require('fs').promises;
const pathValidator = require('../../src/utils/pathValidator');

describe('Path Traversal Security Tests', () => {
    let testDir;
    let safeDir;
    let sensitiveDir;
    
    beforeAll(async () => {
        // Setup test directory structure
        testDir = path.join(__dirname, '..', 'temp', 'path-security-test');
        safeDir = path.join(testDir, 'safe');
        sensitiveDir = path.join(testDir, 'sensitive');
        
        await fs.mkdir(safeDir, { recursive: true });
        await fs.mkdir(sensitiveDir, { recursive: true });
        
        // Create test files
        await fs.writeFile(path.join(safeDir, 'allowed.txt'), 'This is allowed content');
        await fs.writeFile(path.join(sensitiveDir, 'secret.txt'), 'This is sensitive data');
        
        // Add safe directory to pathValidator
        pathValidator.addSafePath('test', safeDir);
    });
    
    afterAll(async () => {
        await fs.rmdir(testDir, { recursive: true });
    });

    describe('Directory Traversal Attempts', () => {
        test('should block ../ traversal attempts', () => {
            const traversalAttempts = [
                '../../../etc/passwd',
                '../../sensitive/secret.txt',
                'safe/../../sensitive/secret.txt',
                'safe/../../../etc/shadow',
                '../'.repeat(10) + 'etc/passwd'
            ];
            
            traversalAttempts.forEach(attempt => {
                expect(() => {
                    pathValidator.validatePath(attempt, 'test');
                }).toThrow(/traversal|suspicious/i);
            });
        });

        test('should block ..\\ traversal attempts (Windows)', () => {
            const traversalAttempts = [
                '..\\..\\..\\windows\\system32\\config\\sam',
                '..\\..\\sensitive\\secret.txt',
                'safe\\..\\..\\sensitive\\secret.txt'
            ];
            
            traversalAttempts.forEach(attempt => {
                expect(() => {
                    pathValidator.validatePath(attempt, 'test');
                }).toThrow(/traversal|suspicious/i);
            });
        });

        test('should block encoded traversal attempts', () => {
            const encodedAttempts = [
                '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd', // URL encoded ../../../etc/passwd
                '..%252f..%252f..%252fetc%252fpasswd', // Double URL encoded
                '..%c0%af..%c0%af..%c0%afetc%c0%afpasswd', // UTF-8 encoded
                '..%c1%9c..%c1%9c..%c1%9cetc%c1%9cpasswd' // Alternative UTF-8
            ];
            
            encodedAttempts.forEach(attempt => {
                const decoded = decodeURIComponent(attempt);
                expect(() => {
                    pathValidator.validatePath(decoded, 'test');
                }).toThrow();
            });
        });

        test('should block null byte injection', () => {
            const nullByteAttempts = [
                'safe.txt\x00.jpg', // Null byte to bypass extension check
                'safe\x00/../../etc/passwd',
                'file.txt\x00',
                'safe/\x00../../sensitive/secret.txt'
            ];
            
            nullByteAttempts.forEach(attempt => {
                expect(() => {
                    pathValidator.validatePath(attempt, 'test');
                }).toThrow(/null byte/i);
            });
        });
    });

    describe('Absolute Path Attempts', () => {
        test('should block absolute Unix paths', () => {
            const absolutePaths = [
                '/etc/passwd',
                '/etc/shadow',
                '/var/log/auth.log',
                '/root/.ssh/id_rsa',
                '/home/user/.bashrc'
            ];
            
            absolutePaths.forEach(absPath => {
                expect(() => {
                    pathValidator.validatePath(absPath, 'test');
                }).toThrow(/traversal|suspicious/i);
            });
        });

        test('should block absolute Windows paths', () => {
            const absolutePaths = [
                'C:\\Windows\\System32\\config\\sam',
                'C:\\Users\\Admin\\Documents',
                'D:\\sensitive\\data.txt',
                '\\\\server\\share\\file.txt'
            ];
            
            absolutePaths.forEach(absPath => {
                expect(() => {
                    pathValidator.validatePath(absPath, 'test');
                }).toThrow(/traversal|suspicious/i);
            });
        });

        test('should block UNC paths', () => {
            const uncPaths = [
                '\\\\server\\share\\file.txt',
                '\\\\192.168.1.1\\share\\file.txt',
                '//server/share/file.txt'
            ];
            
            uncPaths.forEach(uncPath => {
                expect(() => {
                    pathValidator.validatePath(uncPath, 'test');
                }).toThrow(/traversal|suspicious/i);
            });
        });
    });

    describe('Special Character Injection', () => {
        test('should block environment variable expansion', () => {
            const envVarAttempts = [
                '$HOME/.ssh/id_rsa',
                '${HOME}/sensitive.txt',
                '%USERPROFILE%\\Documents\\passwords.txt',
                '%APPDATA%\\credentials.json',
                '$(pwd)/../../etc/passwd'
            ];
            
            envVarAttempts.forEach(attempt => {
                expect(() => {
                    pathValidator.validatePath(attempt, 'test');
                }).toThrow(/suspicious/i);
            });
        });

        test('should block command injection in paths', () => {
            const commandAttempts = [
                '$(whoami).txt',
                '`id`.log',
                'file;rm -rf /',
                'file|cat /etc/passwd',
                'file&net user admin password'
            ];
            
            commandAttempts.forEach(attempt => {
                expect(() => {
                    pathValidator.validatePath(attempt, 'test');
                }).toThrow(/suspicious/i);
            });
        });

        test('should block home directory expansion', () => {
            const homeAttempts = [
                '~/.ssh/id_rsa',
                '~/Documents/passwords.txt',
                '~root/.ssh/authorized_keys',
                '~/../otheruser/.ssh/id_rsa'
            ];
            
            homeAttempts.forEach(attempt => {
                expect(() => {
                    pathValidator.validatePath(attempt, 'test');
                }).toThrow(/suspicious|traversal/i);
            });
        });
    });

    describe('Windows Reserved Names', () => {
        test('should block Windows device names', () => {
            const deviceNames = [
                'CON', 'PRN', 'AUX', 'NUL',
                'COM1', 'COM2', 'COM3', 'COM4',
                'LPT1', 'LPT2', 'LPT3', 'LPT4',
                'con.txt', 'prn.log', 'aux.json'
            ];
            
            deviceNames.forEach(name => {
                expect(() => {
                    pathValidator.validatePath(name, 'test');
                }).toThrow(/suspicious/i);
            });
        });
    });

    describe('Symlink and Hardlink Attacks', () => {
        test('should validate resolved paths stay within boundaries', () => {
            const symlinkAttempts = [
                'link_to_sensitive', // Assuming this links outside safe dir
                './link/../../../etc/passwd'
            ];
            
            symlinkAttempts.forEach(attempt => {
                // The validator should resolve and check the final path
                const fullPath = path.join(safeDir, attempt);
                const resolved = path.resolve(fullPath);
                
                expect(pathValidator.isPathSafe(resolved, safeDir)).toBe(
                    resolved.startsWith(safeDir)
                );
            });
        });
    });

    describe('Safe File Operations', () => {
        test('should allow reading files within safe directory', async () => {
            await fs.writeFile(path.join(safeDir, 'test.txt'), 'test content');
            
            const content = await pathValidator.safeReadFile('test.txt', 'test');
            expect(content).toBe('test content');
        });

        test('should block reading files outside safe directory', async () => {
            await expect(
                pathValidator.safeReadFile('../sensitive/secret.txt', 'test')
            ).rejects.toThrow(/traversal/i);
            
            await expect(
                pathValidator.safeReadFile('/etc/passwd', 'test')
            ).rejects.toThrow(/traversal/i);
        });

        test('should allow writing files within safe directory', async () => {
            await pathValidator.safeWriteFile('new.txt', 'new content', 'test');
            
            const content = await fs.readFile(path.join(safeDir, 'new.txt'), 'utf8');
            expect(content).toBe('new content');
        });

        test('should block writing files outside safe directory', async () => {
            await expect(
                pathValidator.safeWriteFile('../sensitive/hack.txt', 'hacked', 'test')
            ).rejects.toThrow(/traversal/i);
        });

        test('should block deleting files outside safe directory', async () => {
            await expect(
                pathValidator.safeDeleteFile('../sensitive/secret.txt', 'test')
            ).rejects.toThrow(/traversal/i);
        });

        test('should prevent deletion of base directory', async () => {
            await expect(
                pathValidator.safeDeleteDirectory('', 'test')
            ).rejects.toThrow(/cannot delete base/i);
            
            await expect(
                pathValidator.safeDeleteDirectory('.', 'test')
            ).rejects.toThrow(/cannot delete base/i);
        });
    });

    describe('Complex Path Manipulation', () => {
        test('should handle complex valid paths', () => {
            const validPaths = [
                'subfolder/file.txt',
                './current/file.txt',
                'deeply/nested/folder/structure/file.txt',
                'file_with-special.chars-123.txt'
            ];
            
            validPaths.forEach(validPath => {
                expect(() => {
                    pathValidator.validatePath(validPath, 'test');
                }).not.toThrow();
            });
        });

        test('should detect obfuscated traversal attempts', () => {
            const obfuscatedAttempts = [
                'safe/./../../etc/passwd', // Using current directory
                'safe//../..//etc/passwd', // Double slashes
                'safe/.hidden/../../../etc/passwd', // Hidden folder
                '.../.../etc/passwd', // Triple dots
                '.../.../.../etc/passwd' // Multiple triple dots
            ];
            
            obfuscatedAttempts.forEach(attempt => {
                expect(() => {
                    pathValidator.validatePath(attempt, 'test');
                }).toThrow(/suspicious|traversal/i);
            });
        });

        test('should handle Unicode normalization attacks', () => {
            const unicodeAttempts = [
                'ﬁle.txt', // Ligature fi
                '／etc／passwd', // Fullwidth solidus
                '‥/‥/etc/passwd', // Two-dot leader
                '\u202e\u202detc/passwd' // Right-to-left override
            ];
            
            unicodeAttempts.forEach(attempt => {
                // Should either reject or normalize safely
                try {
                    const validated = pathValidator.validatePath(attempt, 'test');
                    expect(validated).not.toContain('/etc/');
                } catch (e) {
                    expect(e.message).toMatch(/suspicious|traversal/i);
                }
            });
        });
    });

    describe('Race Condition Prevention', () => {
        test('should handle TOCTOU attacks', async () => {
            const filename = 'race_test.txt';
            
            // Create file
            await fs.writeFile(path.join(safeDir, filename), 'original');
            
            // Simulate concurrent access attempts
            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(
                    pathValidator.safeWriteFile(filename, `write_${i}`, 'test')
                );
            }
            
            // All writes should complete without errors
            await expect(Promise.all(promises)).resolves.toBeDefined();
            
            // File should exist with some write
            const content = await fs.readFile(path.join(safeDir, filename), 'utf8');
            expect(content).toMatch(/write_\d/);
        });
    });

    describe('Error Message Security', () => {
        test('should not reveal directory structure in errors', () => {
            try {
                pathValidator.validatePath('/etc/passwd', 'test');
            } catch (error) {
                // Error should not reveal actual paths
                expect(error.message).not.toContain('/etc/passwd');
                expect(error.message).not.toContain(safeDir);
                expect(error.message).toMatch(/traversal|suspicious/i);
            }
        });
    });

    describe('Control Character Detection', () => {
        test('should detect control characters in paths', () => {
            const controlCharPaths = [
                'file\x00.txt', // Null
                'file\x08.txt', // Backspace
                'file\x1b.txt', // Escape
                'file\x7f.txt', // Delete
                'file\r\n.txt' // CRLF
            ];
            
            controlCharPaths.forEach(ctrlPath => {
                expect(
                    pathValidator.containsSuspiciousPatterns(ctrlPath)
                ).toBe(true);
            });
        });
    });

    describe('Path Length Limits', () => {
        test('should handle extremely long paths', () => {
            const longPath = 'a'.repeat(4096) + '.txt';
            
            // Should either handle gracefully or reject
            try {
                const validated = pathValidator.validatePath(longPath, 'test');
                expect(validated.length).toBeLessThanOrEqual(4096);
            } catch (e) {
                expect(e.message).toBeDefined();
            }
        });

        test('should handle deeply nested paths', () => {
            const deepPath = 'folder/'.repeat(100) + 'file.txt';
            
            // Should handle without stack overflow
            expect(() => {
                pathValidator.validatePath(deepPath, 'test');
            }).not.toThrow(/stack|overflow/i);
        });
    });
});