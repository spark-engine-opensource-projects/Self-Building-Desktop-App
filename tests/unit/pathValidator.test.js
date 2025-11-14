const path = require('path');
const pathValidator = require('../../src/utils/pathValidator');

describe('Path Validator', () => {
    describe('validatePath', () => {
        test('should allow safe relative paths', () => {
            const safePaths = [
                'file.txt',
                'subfolder/file.txt',
                './current/file.txt',
                'deeply/nested/folder/file.txt'
            ];
            
            safePaths.forEach(filePath => {
                expect(() => {
                    pathValidator.validatePath(filePath, 'project');
                }).not.toThrow();
            });
        });

        test('should block path traversal attempts', () => {
            const maliciousPaths = [
                '../../../etc/passwd',
                '..\\..\\..\\windows\\system32',
                'folder/../../outside',
                '/etc/passwd',
                'C:\\Windows\\System32',
                '~/.ssh/id_rsa'
            ];
            
            maliciousPaths.forEach(filePath => {
                expect(() => {
                    pathValidator.validatePath(filePath, 'project');
                }).toThrow(/path traversal|suspicious/i);
            });
        });

        test('should reject null bytes in paths', () => {
            const nullBytePaths = [
                'file.txt\x00.jpg',
                'folder\x00/file.txt',
                '\x00etc/passwd'
            ];
            
            nullBytePaths.forEach(filePath => {
                expect(() => {
                    pathValidator.validatePath(filePath, 'project');
                }).toThrow(/null bytes/i);
            });
        });

        test('should detect suspicious patterns', () => {
            const suspiciousPaths = [
                '${HOME}/file.txt',
                '$(whoami).txt',
                '%USERPROFILE%\\file.txt',
                'file.txt..',
                '~/sensitive/file'
            ];
            
            suspiciousPaths.forEach(filePath => {
                expect(() => {
                    pathValidator.validatePath(filePath, 'project');
                }).toThrow(/suspicious|traversal/i);
            });
        });

        test('should reject Windows reserved names', () => {
            const reservedNames = [
                'con',
                'prn',
                'aux',
                'nul',
                'com1',
                'lpt1',
                'con.txt',
                'PRN.log'
            ];
            
            reservedNames.forEach(filePath => {
                expect(() => {
                    pathValidator.validatePath(filePath, 'project');
                }).toThrow(/suspicious/i);
            });
        });

        test('should handle different base types', () => {
            const baseTypes = ['project', 'data', 'sessions', 'cache'];
            
            baseTypes.forEach(baseType => {
                const result = pathValidator.validatePath('test.txt', baseType);
                expect(result).toContain('test.txt');
            });
        });

        test('should reject unknown base types', () => {
            expect(() => {
                pathValidator.validatePath('file.txt', 'unknown_base');
            }).toThrow(/unknown base directory/i);
        });
    });

    describe('isPathSafe', () => {
        test('should return true for paths within base directory', () => {
            const baseDir = '/home/user/project';
            
            expect(pathValidator.isPathSafe('/home/user/project/file.txt', baseDir)).toBe(true);
            expect(pathValidator.isPathSafe('/home/user/project/sub/file.txt', baseDir)).toBe(true);
            expect(pathValidator.isPathSafe('/home/user/project', baseDir)).toBe(true);
        });

        test('should return false for paths outside base directory', () => {
            const baseDir = '/home/user/project';
            
            expect(pathValidator.isPathSafe('/home/user/other/file.txt', baseDir)).toBe(false);
            expect(pathValidator.isPathSafe('/etc/passwd', baseDir)).toBe(false);
            expect(pathValidator.isPathSafe('/home/user', baseDir)).toBe(false);
        });
    });

    describe('containsSuspiciousPatterns', () => {
        test('should detect parent directory traversal', () => {
            expect(pathValidator.containsSuspiciousPatterns('../file')).toBe(true);
            expect(pathValidator.containsSuspiciousPatterns('..\\file')).toBe(true);
            expect(pathValidator.containsSuspiciousPatterns('folder/..')).toBe(true);
        });

        test('should detect variable expansion attempts', () => {
            expect(pathValidator.containsSuspiciousPatterns('${VAR}')).toBe(true);
            expect(pathValidator.containsSuspiciousPatterns('$(cmd)')).toBe(true);
            expect(pathValidator.containsSuspiciousPatterns('%VAR%')).toBe(true);
        });

        test('should detect home directory expansion', () => {
            expect(pathValidator.containsSuspiciousPatterns('~/file')).toBe(true);
            expect(pathValidator.containsSuspiciousPatterns('~user/file')).toBe(true);
        });

        test('should detect control characters', () => {
            expect(pathValidator.containsSuspiciousPatterns('file\x00')).toBe(true);
            expect(pathValidator.containsSuspiciousPatterns('file\x1f')).toBe(true);
            expect(pathValidator.containsSuspiciousPatterns('file\x7f')).toBe(true);
        });

        test('should allow safe paths', () => {
            expect(pathValidator.containsSuspiciousPatterns('normal_file.txt')).toBe(false);
            expect(pathValidator.containsSuspiciousPatterns('folder/file.txt')).toBe(false);
            expect(pathValidator.containsSuspiciousPatterns('file-name_123.ext')).toBe(false);
        });
    });

    describe('file operations', () => {
        // These tests would need mocking of fs operations
        
        test('safeReadFile should validate path before reading', async () => {
            await expect(
                pathValidator.safeReadFile('../../../etc/passwd', 'project')
            ).rejects.toThrow(/traversal/i);
        });

        test('safeWriteFile should validate path before writing', async () => {
            await expect(
                pathValidator.safeWriteFile('../outside.txt', 'data', 'project')
            ).rejects.toThrow(/traversal/i);
        });

        test('safeDeleteFile should validate path before deleting', async () => {
            await expect(
                pathValidator.safeDeleteFile('/etc/important', 'project')
            ).rejects.toThrow(/traversal/i);
        });

        test('safeDeleteDirectory should prevent base directory deletion', async () => {
            // This would need to mock the base directory
            const baseTypes = ['project', 'data', 'sessions', 'cache'];
            
            for (const baseType of baseTypes) {
                await expect(
                    pathValidator.safeDeleteDirectory('', baseType)
                ).rejects.toThrow(/cannot delete base/i);
            }
        });
    });

    describe('getSafePaths', () => {
        test('should return all configured safe paths', () => {
            const safePaths = pathValidator.getSafePaths();
            
            expect(safePaths).toHaveProperty('project');
            expect(safePaths).toHaveProperty('data');
            expect(safePaths).toHaveProperty('sessions');
            expect(safePaths).toHaveProperty('cache');
            
            Object.values(safePaths).forEach(p => {
                expect(p).toBeTruthy();
                expect(typeof p).toBe('string');
            });
        });
    });

    describe('addSafePath', () => {
        test('should add new safe base path', () => {
            const testPath = '/test/custom/path';
            pathValidator.addSafePath('custom', testPath);
            
            const safePaths = pathValidator.getSafePaths();
            expect(safePaths.custom).toBeDefined();
            
            // Should now work with the new base type
            expect(() => {
                pathValidator.validatePath('file.txt', 'custom');
            }).not.toThrow();
        });
    });
});