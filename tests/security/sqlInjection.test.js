const sqlValidator = require('../../src/utils/sqlValidator');

describe('SQL Injection Security Tests', () => {
    describe('Classic SQL Injection Attempts', () => {
        test('should block OR 1=1 injection', () => {
            const maliciousQueries = [
                "SELECT * FROM users WHERE username = 'admin' OR '1'='1'",
                "SELECT * FROM users WHERE id = 1 OR 1=1"
            ];

            maliciousQueries.forEach(query => {
                expect(() => sqlValidator.validateQuery(query, [])).toThrow();
            });
        });

        test('should block UNION SELECT injection', () => {
            const maliciousQueries = [
                "SELECT * FROM users WHERE id = 1 UNION SELECT * FROM passwords",
                "SELECT name FROM products WHERE id = 1 UNION ALL SELECT password FROM users"
            ];

            maliciousQueries.forEach(query => {
                expect(() => sqlValidator.validateQuery(query, [])).toThrow();
            });
        });

        test('should block comment-based injection', () => {
            const maliciousQueries = [
                "SELECT * FROM users WHERE username = 'admin'--",
                "SELECT * FROM users WHERE username = 'admin' /*",
            ];

            maliciousQueries.forEach(query => {
                expect(() => sqlValidator.validateQuery(query, [])).toThrow();
            });
        });

        test('should block semicolon command injection', () => {
            const maliciousQueries = [
                "SELECT * FROM users; DROP TABLE users;",
                "SELECT * FROM users; INSERT INTO users VALUES (1)"
            ];

            maliciousQueries.forEach(query => {
                expect(() => sqlValidator.validateQuery(query, [])).toThrow();
            });
        });
    });

    describe('Advanced SQL Injection Techniques', () => {
        test('should block stacked queries', () => {
            const stackedQueries = [
                "SELECT * FROM users; INSERT INTO users (username) VALUES ('hacker')",
                "SELECT * FROM users; UPDATE users SET role='admin'",
                "SELECT * FROM users; DELETE FROM logs"
            ];

            stackedQueries.forEach(query => {
                expect(() => sqlValidator.validateQuery(query, [])).toThrow();
            });
        });

        test('should block hex encoding injection', () => {
            const hexInjections = [
                "SELECT * FROM users WHERE username = 0x61646D696E",
            ];

            hexInjections.forEach(query => {
                expect(() => sqlValidator.validateQuery(query, [])).toThrow();
            });
        });
    });

    describe('Dangerous SQL Keywords', () => {
        test('should block EXEC statements', () => {
            const execAttempts = [
                'EXEC xp_cmdshell "dir"',
                'EXECUTE sp_configure'
            ];

            execAttempts.forEach(query => {
                // EXEC with xp_/sp_ triggers suspicious pattern detection
                expect(() => sqlValidator.validateQuery(query, [])).toThrow(/suspicious|dangerous|not allowed/i);
            });
        });

        test('should block ATTACH statements', () => {
            const attachAttempts = [
                'ATTACH DATABASE "/etc/passwd" AS hack',
                'DETACH DATABASE main'
            ];

            attachAttempts.forEach(query => {
                expect(() => sqlValidator.validateQuery(query, [])).toThrow(/dangerous|not allowed/i);
            });
        });

        test('should block PRAGMA statements', () => {
            expect(() => sqlValidator.validateQuery('PRAGMA table_info(users)', [])).toThrow(/dangerous|not allowed/i);
        });
    });

    describe('Parameter Validation', () => {
        test('should validate parameter count matches placeholders', () => {
            const query = 'SELECT * FROM users WHERE id = ? AND name = ?';

            // Too few parameters
            expect(() => sqlValidator.validateQuery(query, ['admin'])).toThrow(/parameter count/i);

            // Too many parameters
            expect(() => sqlValidator.validateQuery(query, ['admin', 'user', 'extra'])).toThrow(/parameter count/i);

            // Correct count
            expect(() => sqlValidator.validateQuery(query, ['admin', 'user'])).not.toThrow();
        });

        test('should validate parameters are properly typed', () => {
            const params = ['valid_string', 123, null, true];
            const sanitized = sqlValidator.sanitizeParameters(params);

            expect(sanitized[0]).toBe('valid_string');
            expect(sanitized[1]).toBe(123);
            expect(sanitized[2]).toBeNull();
            expect(sanitized[3]).toBe(true);
        });

        test('should sanitize string parameters', () => {
            const dangerous = ["test'value", "test;value", "test\"value"];
            const sanitized = sqlValidator.sanitizeParameters(dangerous);

            sanitized.forEach(param => {
                expect(param).not.toContain("'");
                expect(param).not.toContain(";");
                expect(param).not.toContain('"');
            });
        });
    });

    describe('Safe Query Validation', () => {
        test('should allow safe SELECT queries with parameters', () => {
            const safeQueries = [
                { sql: "SELECT * FROM users WHERE id = ?", params: [1] },
                { sql: "SELECT username, email FROM users WHERE active = ?", params: [1] },
                { sql: "SELECT COUNT(*) FROM products", params: [] }
            ];

            safeQueries.forEach(({ sql, params }) => {
                expect(() => sqlValidator.validateQuery(sql, params)).not.toThrow();
            });
        });

        test('should allow safe INSERT queries with parameters', () => {
            const safeQueries = [
                { sql: "INSERT INTO users (username, email) VALUES (?, ?)", params: ['john', 'john@test.com'] },
                { sql: "INSERT INTO logs (message) VALUES (?)", params: ['test message'] }
            ];

            safeQueries.forEach(({ sql, params }) => {
                expect(() => sqlValidator.validateQuery(sql, params)).not.toThrow();
            });
        });

        test('should allow safe UPDATE queries with parameters', () => {
            const safeQueries = [
                { sql: "UPDATE users SET email = ? WHERE id = ?", params: ['new@test.com', 1] },
                { sql: "UPDATE products SET price = ? WHERE category = ?", params: [9.99, 'electronics'] }
            ];

            safeQueries.forEach(({ sql, params }) => {
                expect(() => sqlValidator.validateQuery(sql, params)).not.toThrow();
            });
        });

        test('should allow safe DELETE queries with parameters', () => {
            const sql = "DELETE FROM users WHERE id = ?";
            expect(() => sqlValidator.validateQuery(sql, [1])).not.toThrow();
        });
    });

    describe('Allowed Table Operations', () => {
        test('should allow CREATE TABLE', () => {
            const createSQL = "CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)";
            expect(() => sqlValidator.validateQuery(createSQL, [])).not.toThrow();
        });

        test('should allow DROP TABLE', () => {
            const dropSQL = "DROP TABLE test_table";
            expect(() => sqlValidator.validateQuery(dropSQL, [])).not.toThrow();
        });

        test('should allow ALTER TABLE', () => {
            const alterSQL = "ALTER TABLE users ADD COLUMN new_col TEXT";
            expect(() => sqlValidator.validateQuery(alterSQL, [])).not.toThrow();
        });

        test('should allow CREATE INDEX', () => {
            const indexSQL = "CREATE INDEX idx_username ON users(username)";
            expect(() => sqlValidator.validateQuery(indexSQL, [])).not.toThrow();
        });
    });

    describe('Identifier Validation', () => {
        test('should escape valid identifiers', () => {
            const validIdentifiers = ['users', 'user_data', 'Products', 'order_items_2024'];

            validIdentifiers.forEach(identifier => {
                const escaped = sqlValidator.escapeIdentifier(identifier);
                expect(escaped).toBe(`"${identifier}"`);
            });
        });

        test('should reject invalid identifiers', () => {
            const invalidIdentifiers = [
                'users; DROP TABLE',
                '../../../etc/passwd',
                "users' OR '1'='1",
                '123_start_with_number'
            ];

            invalidIdentifiers.forEach(identifier => {
                expect(() => sqlValidator.escapeIdentifier(identifier)).toThrow();
            });
        });
    });

    describe('Safe Query Builders', () => {
        test('should build safe INSERT query', () => {
            const result = sqlValidator.buildSafeInsert('users', {
                username: 'john',
                email: 'john@test.com'
            });

            expect(result.sql).toContain('INSERT INTO');
            expect(result.sql).toContain('"users"');
            expect(result.params).toEqual(['john', 'john@test.com']);
            expect(result.validated).toBe(true);
        });

        test('should build safe SELECT query', () => {
            const result = sqlValidator.buildSafeSelect('users', ['username', 'email'], 'id = ?', [1]);

            expect(result.sql).toContain('SELECT');
            expect(result.sql).toContain('"users"');
            expect(result.validated).toBe(true);
        });

        test('should build safe UPDATE query', () => {
            const result = sqlValidator.buildSafeUpdate('users', { email: 'new@test.com' }, 'id = ?', [1]);

            expect(result.sql).toContain('UPDATE');
            expect(result.sql).toContain('"users"');
            expect(result.validated).toBe(true);
        });

        test('should build safe DELETE query', () => {
            const result = sqlValidator.buildSafeDelete('users', 'id = ?', [1]);

            expect(result.sql).toContain('DELETE');
            expect(result.sql).toContain('"users"');
            expect(result.validated).toBe(true);
        });
    });

    describe('Table Schema Validation', () => {
        test('should validate valid table schema', () => {
            const schema = {
                id: { type: 'INTEGER' },
                username: { type: 'TEXT' },
                active: { type: 'BOOLEAN' }
            };

            expect(() => sqlValidator.validateTableSchema(schema)).not.toThrow();
        });

        test('should reject invalid column types', () => {
            const schema = {
                id: { type: 'INVALID_TYPE' }
            };

            expect(() => sqlValidator.validateTableSchema(schema)).toThrow(/invalid column type/i);
        });

        test('should reject invalid column names', () => {
            const schema = {
                'column; DROP TABLE': { type: 'TEXT' }
            };

            expect(() => sqlValidator.validateTableSchema(schema)).toThrow();
        });
    });

    describe('Input Sanitization', () => {
        test('should sanitize string inputs', () => {
            const inputs = [
                { input: "normal input", expected: "normal input" },
                { input: "input with 'quotes'", expected: "input with quotes" },
                { input: "input; with; semicolons", expected: "input with semicolons" },
                { input: 'input with "double"', expected: "input with double" }
            ];

            inputs.forEach(({ input, expected }) => {
                const sanitized = sqlValidator.sanitizeParameters([input])[0];
                expect(sanitized).toBe(expected);
            });
        });
    });

    describe('Prepared Statement Validation', () => {
        test('should prepare safe query with validation', () => {
            const sql = "SELECT * FROM users WHERE id = ?";
            const params = [1];

            const prepared = sqlValidator.prepareSafeQuery(sql, params);

            expect(prepared.sql).toBe(sql);
            expect(prepared.params).toEqual([1]);
            expect(prepared.validated).toBe(true);
            expect(prepared.timestamp).toBeDefined();
        });

        test('should reject unsafe query in preparation', () => {
            const sql = "SELECT * FROM users; DROP TABLE users;";

            expect(() => sqlValidator.prepareSafeQuery(sql, [])).toThrow();
        });
    });
});
