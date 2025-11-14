const sqlValidator = require('../../src/utils/sqlValidator');

describe('SQL Validator', () => {
    describe('validateQuery', () => {
        test('should allow safe SELECT queries', () => {
            const query = 'SELECT * FROM users WHERE id = ?';
            const params = [1];
            
            expect(() => {
                sqlValidator.validateQuery(query, params);
            }).not.toThrow();
        });

        test('should allow safe INSERT queries', () => {
            const query = 'INSERT INTO users (name, email) VALUES (?, ?)';
            const params = ['John', 'john@example.com'];
            
            expect(() => {
                sqlValidator.validateQuery(query, params);
            }).not.toThrow();
        });

        test('should block dangerous keywords', () => {
            const dangerousQueries = [
                'DROP TABLE users; SELECT * FROM admin',
                'SELECT * FROM users; EXEC xp_cmdshell',
                'GRANT ALL PRIVILEGES ON *.* TO "root"',
                'ATTACH DATABASE "hack.db" AS hack',
                'PRAGMA key = "password"'
            ];

            dangerousQueries.forEach(query => {
                expect(() => {
                    sqlValidator.validateQuery(query);
                }).toThrow(/dangerous|not allowed/i);
            });
        });

        test('should detect SQL injection patterns', () => {
            const injectionQueries = [
                "SELECT * FROM users WHERE id = '1' OR '1'='1'",
                "SELECT * FROM users WHERE name = 'admin'--",
                "SELECT * FROM users WHERE id = 1 UNION SELECT * FROM passwords",
                "'; DROP TABLE users; --",
                "SELECT * FROM users WHERE id = 0x1234"
            ];

            injectionQueries.forEach(query => {
                expect(() => {
                    sqlValidator.validateQuery(query);
                }).toThrow(/suspicious|pattern/i);
            });
        });

        test('should validate parameter count', () => {
            const query = 'SELECT * FROM users WHERE id = ? AND name = ?';
            
            // Too few parameters
            expect(() => {
                sqlValidator.validateQuery(query, [1]);
            }).toThrow(/parameter count mismatch/i);
            
            // Too many parameters
            expect(() => {
                sqlValidator.validateQuery(query, [1, 'John', 'extra']);
            }).toThrow(/parameter count mismatch/i);
            
            // Correct parameters
            expect(() => {
                sqlValidator.validateQuery(query, [1, 'John']);
            }).not.toThrow();
        });

        test('should validate parameter types', () => {
            const query = 'INSERT INTO users (data) VALUES (?)';
            
            // Valid types
            const validParams = [
                [null],
                ['string'],
                [123],
                [true],
                [new Date()],
                [Buffer.from('data')]
            ];
            
            validParams.forEach(params => {
                expect(() => {
                    sqlValidator.validateQuery(query, params);
                }).not.toThrow();
            });
            
            // Invalid types
            const invalidParams = [
                [() => {}],
                [{ malicious: 'object' }],
                [Symbol('test')]
            ];
            
            invalidParams.forEach(params => {
                expect(() => {
                    sqlValidator.validateQuery(query, params);
                }).toThrow(/invalid parameter/i);
            });
        });
    });

    describe('buildSafeInsert', () => {
        test('should build safe INSERT query', () => {
            const table = 'users';
            const data = {
                name: 'John Doe',
                email: 'john@example.com',
                age: 30
            };
            
            const result = sqlValidator.buildSafeInsert(table, data);
            
            expect(result.sql).toMatch(/INSERT INTO "users"/);
            expect(result.sql).toMatch(/"name"/);
            expect(result.sql).toMatch(/"email"/);
            expect(result.sql).toMatch(/"age"/);
            expect(result.params).toEqual(['John Doe', 'john@example.com', 30]);
        });

        test('should escape table and column names', () => {
            const table = 'user_data';
            const data = { user_name: 'test' };
            
            const result = sqlValidator.buildSafeInsert(table, data);
            
            expect(result.sql).toContain('"user_data"');
            expect(result.sql).toContain('"user_name"');
        });

        test('should reject invalid identifiers', () => {
            expect(() => {
                sqlValidator.buildSafeInsert('users; DROP TABLE', {});
            }).toThrow(/invalid identifier/i);
            
            expect(() => {
                sqlValidator.buildSafeInsert('users', { 'col; DROP': 'value' });
            }).toThrow(/invalid identifier/i);
        });
    });

    describe('buildSafeUpdate', () => {
        test('should build safe UPDATE query', () => {
            const table = 'users';
            const data = { name: 'Jane', email: 'jane@example.com' };
            const whereClause = 'id = ?';
            const whereParams = [1];
            
            const result = sqlValidator.buildSafeUpdate(table, data, whereClause, whereParams);
            
            expect(result.sql).toMatch(/UPDATE "users" SET/);
            expect(result.sql).toMatch(/"name" = \?/);
            expect(result.sql).toMatch(/"email" = \?/);
            expect(result.sql).toMatch(/WHERE id = \?/);
            expect(result.params).toEqual(['Jane', 'jane@example.com', 1]);
        });
    });

    describe('buildSafeSelect', () => {
        test('should build safe SELECT query', () => {
            const table = 'users';
            const columns = ['id', 'name', 'email'];
            
            const result = sqlValidator.buildSafeSelect(table, columns);
            
            expect(result.sql).toBe('SELECT "id", "name", "email" FROM "users"');
            expect(result.params).toEqual([]);
        });

        test('should handle SELECT * queries', () => {
            const table = 'users';
            
            const result = sqlValidator.buildSafeSelect(table);
            
            expect(result.sql).toBe('SELECT * FROM "users"');
        });

        test('should add WHERE clause when provided', () => {
            const table = 'users';
            const columns = ['name'];
            const whereClause = 'age > ? AND active = ?';
            const whereParams = [18, true];
            
            const result = sqlValidator.buildSafeSelect(table, columns, whereClause, whereParams);
            
            expect(result.sql).toContain('WHERE age > ? AND active = ?');
            expect(result.params).toEqual([18, true]);
        });
    });

    describe('buildSafeDelete', () => {
        test('should build safe DELETE query', () => {
            const table = 'users';
            const whereClause = 'id = ?';
            const whereParams = [1];
            
            const result = sqlValidator.buildSafeDelete(table, whereClause, whereParams);
            
            expect(result.sql).toBe('DELETE FROM "users" WHERE id = ?');
            expect(result.params).toEqual([1]);
        });
    });

    describe('escapeIdentifier', () => {
        test('should escape valid identifiers', () => {
            expect(sqlValidator.escapeIdentifier('users')).toBe('"users"');
            expect(sqlValidator.escapeIdentifier('user_data')).toBe('"user_data"');
            expect(sqlValidator.escapeIdentifier('Table1')).toBe('"Table1"');
        });

        test('should reject invalid identifiers', () => {
            const invalidIdentifiers = [
                'users; DROP TABLE',
                'users"',
                "users'",
                '123table', // starts with number
                'table-name', // contains hyphen
                'table name' // contains space
            ];
            
            invalidIdentifiers.forEach(identifier => {
                expect(() => {
                    sqlValidator.escapeIdentifier(identifier);
                }).toThrow(/invalid identifier/i);
            });
        });
    });

    describe('sanitizeParameters', () => {
        test('should sanitize string parameters', () => {
            const params = [
                "normal string",
                "string with 'quotes'",
                'string with "double quotes"',
                "string with ; semicolon",
                "string with \\ backslash"
            ];
            
            const sanitized = sqlValidator.sanitizeParameters(params);
            
            sanitized.forEach(param => {
                expect(param).not.toMatch(/['";\\]/);
            });
        });

        test('should not modify non-string parameters', () => {
            const params = [123, true, null, new Date('2024-01-01')];
            const sanitized = sqlValidator.sanitizeParameters(params);
            
            expect(sanitized[0]).toBe(123);
            expect(sanitized[1]).toBe(true);
            expect(sanitized[2]).toBe(null);
            expect(sanitized[3]).toEqual(new Date('2024-01-01'));
        });
    });
});