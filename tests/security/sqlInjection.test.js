const path = require('path');
const fs = require('fs').promises;
const DatabaseManager = require('../../src/utils/databaseManager');
const sqlValidator = require('../../src/utils/sqlValidator');

describe('SQL Injection Security Tests', () => {
    let dbManager;
    let testDbName;
    let testDataPath;

    beforeAll(async () => {
        testDataPath = path.join(__dirname, '..', 'temp', 'security-test-data');
        await fs.mkdir(testDataPath, { recursive: true });
        
        dbManager = new DatabaseManager(testDataPath);
        testDbName = `security_test_${Date.now()}`;
        
        await dbManager.createDatabase(testDbName);
        
        // Create test table
        await dbManager.createTable(testDbName, 'users', {
            id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
            username: { type: 'TEXT', notNull: true },
            password: { type: 'TEXT', notNull: true },
            role: { type: 'TEXT', default: 'user' }
        });
        
        // Insert test data
        await dbManager.insertData(testDbName, 'users', {
            username: 'admin',
            password: 'hashed_admin_pass',
            role: 'admin'
        });
        
        await dbManager.insertData(testDbName, 'users', {
            username: 'testuser',
            password: 'hashed_user_pass',
            role: 'user'
        });
    });

    afterAll(async () => {
        await dbManager.closeAllConnections();
        await fs.rmdir(testDataPath, { recursive: true });
    });

    describe('Classic SQL Injection Attempts', () => {
        test('should block OR 1=1 injection', async () => {
            const maliciousInput = "admin' OR '1'='1";
            
            await expect(
                dbManager.executeSQL(
                    testDbName,
                    `SELECT * FROM users WHERE username = '${maliciousInput}'`
                )
            ).rejects.toThrow(/suspicious/i);
        });

        test('should block UNION SELECT injection', async () => {
            const maliciousInput = "1 UNION SELECT * FROM users WHERE role='admin'";
            
            await expect(
                dbManager.executeSQL(
                    testDbName,
                    `SELECT * FROM users WHERE id = ${maliciousInput}`
                )
            ).rejects.toThrow(/suspicious/i);
        });

        test('should block comment-based injection', async () => {
            const maliciousInputs = [
                "admin'--",
                "admin' /*",
                "admin' #"
            ];
            
            for (const input of maliciousInputs) {
                await expect(
                    dbManager.executeSQL(
                        testDbName,
                        `SELECT * FROM users WHERE username = '${input}'`
                    )
                ).rejects.toThrow(/suspicious/i);
            }
        });

        test('should block semicolon command injection', async () => {
            const maliciousInput = "'; DROP TABLE users; --";
            
            await expect(
                dbManager.executeSQL(
                    testDbName,
                    `SELECT * FROM users WHERE username = '${maliciousInput}'`
                )
            ).rejects.toThrow(/suspicious|dangerous/i);
        });
    });

    describe('Advanced SQL Injection Techniques', () => {
        test('should block blind SQL injection attempts', async () => {
            const blindInjections = [
                "admin' AND 1=1--",
                "admin' AND SLEEP(5)--",
                "admin' AND (SELECT COUNT(*) FROM users) > 0--",
                "admin' AND ASCII(SUBSTR((SELECT password FROM users LIMIT 1),1,1)) > 65--"
            ];
            
            for (const injection of blindInjections) {
                await expect(
                    dbManager.executeSQL(
                        testDbName,
                        `SELECT * FROM users WHERE username = '${injection}'`
                    )
                ).rejects.toThrow(/suspicious/i);
            }
        });

        test('should block time-based injection', async () => {
            const timeBasedInjections = [
                "admin' AND SLEEP(5)--",
                "admin' AND pg_sleep(5)--",
                "admin' WAITFOR DELAY '00:00:05'--",
                "admin' AND BENCHMARK(1000000,MD5('test'))--"
            ];
            
            for (const injection of timeBasedInjections) {
                await expect(
                    dbManager.executeSQL(
                        testDbName,
                        `SELECT * FROM users WHERE username = '${injection}'`
                    )
                ).rejects.toThrow();
            }
        });

        test('should block stacked queries', async () => {
            const stackedQueries = [
                "admin'; INSERT INTO users (username, password) VALUES ('hacker', 'pass')--",
                "admin'; UPDATE users SET role='admin' WHERE username='testuser'--",
                "admin'; DELETE FROM users WHERE role='user'--"
            ];
            
            for (const query of stackedQueries) {
                await expect(
                    dbManager.executeSQL(
                        testDbName,
                        `SELECT * FROM users WHERE username = '${query}'`
                    )
                ).rejects.toThrow(/suspicious|dangerous/i);
            }
        });

        test('should block hex encoding injection', async () => {
            const hexInjections = [
                "0x61646D696E", // 'admin' in hex
                "CHAR(97,100,109,105,110)", // 'admin' using CHAR
                "0x27204F522031", // ' OR 1 in hex
            ];
            
            for (const injection of hexInjections) {
                await expect(
                    dbManager.executeSQL(
                        testDbName,
                        `SELECT * FROM users WHERE username = ${injection}`
                    )
                ).rejects.toThrow(/suspicious/i);
            }
        });
    });

    describe('NoSQL-style Injection Attempts', () => {
        test('should block JSON operator injection', async () => {
            const jsonInjections = [
                "admin' AND JSON_EXTRACT(data, '$.password') = 'test'--",
                "admin' OR JSON_TYPE(data) IS NOT NULL--"
            ];
            
            for (const injection of jsonInjections) {
                await expect(
                    dbManager.executeSQL(
                        testDbName,
                        `SELECT * FROM users WHERE username = '${injection}'`
                    )
                ).rejects.toThrow();
            }
        });
    });

    describe('Parameter Validation', () => {
        test('should reject queries with mismatched parameters', async () => {
            const query = 'SELECT * FROM users WHERE username = ? AND role = ?';
            
            // Too few parameters
            await expect(
                dbManager.executeSQL(testDbName, query, ['admin'])
            ).rejects.toThrow(/parameter count/i);
            
            // Too many parameters
            await expect(
                dbManager.executeSQL(testDbName, query, ['admin', 'user', 'extra'])
            ).rejects.toThrow(/parameter count/i);
        });

        test('should reject invalid parameter types', async () => {
            const query = 'INSERT INTO users (username, password) VALUES (?, ?)';
            
            const invalidParams = [
                [() => {}, 'password'], // Function
                [{toString: () => "'; DROP TABLE--"}, 'password'], // Object with malicious toString
                [Symbol('test'), 'password'] // Symbol
            ];
            
            for (const params of invalidParams) {
                await expect(
                    dbManager.executeSQL(testDbName, query, params)
                ).rejects.toThrow(/invalid parameter/i);
            }
        });
    });

    describe('Safe Query Builders', () => {
        test('should safely handle special characters in parameters', async () => {
            const specialChars = [
                "O'Reilly",
                'User with "quotes"',
                "User; with; semicolons",
                "User\nwith\nnewlines",
                "User\\with\\backslashes"
            ];
            
            for (const username of specialChars) {
                const result = await dbManager.insertData(testDbName, 'users', {
                    username: username,
                    password: 'test_pass'
                });
                
                expect(result.success).toBe(true);
                
                // Verify data was inserted correctly
                const query = await dbManager.queryData(testDbName, 'users', {
                    where: { username: username }
                });
                
                expect(query.success).toBe(true);
                expect(query.data[0].username).toBe(username);
            }
        });

        test('should handle null and undefined safely', async () => {
            const result = await dbManager.insertData(testDbName, 'users', {
                username: 'nulltest',
                password: 'pass',
                role: null // Should use default
            });
            
            expect(result.success).toBe(true);
        });
    });

    describe('Dangerous SQL Keywords', () => {
        test('should block DROP statements', async () => {
            const dropAttempts = [
                'DROP TABLE users',
                'DROP DATABASE test',
                'DROP INDEX idx_users'
            ];
            
            for (const attempt of dropAttempts) {
                await expect(
                    dbManager.executeSQL(testDbName, attempt)
                ).rejects.toThrow(/dangerous|not allowed/i);
            }
        });

        test('should block ALTER statements', async () => {
            const alterAttempts = [
                'ALTER TABLE users ADD COLUMN hacked TEXT',
                'ALTER TABLE users DROP COLUMN password'
            ];
            
            for (const attempt of alterAttempts) {
                await expect(
                    dbManager.executeSQL(testDbName, attempt)
                ).rejects.toThrow(/dangerous|not allowed/i);
            }
        });

        test('should block system access attempts', async () => {
            const systemAttempts = [
                'EXEC xp_cmdshell "dir"',
                'EXEC sp_configure',
                'ATTACH DATABASE "/etc/passwd" AS hack'
            ];
            
            for (const attempt of systemAttempts) {
                await expect(
                    dbManager.executeSQL(testDbName, attempt)
                ).rejects.toThrow(/dangerous|not allowed/i);
            }
        });
    });

    describe('SQL Injection in Different Contexts', () => {
        test('should prevent injection in ORDER BY clauses', async () => {
            const maliciousOrderBy = [
                "(SELECT * FROM users)",
                "username; DROP TABLE users--",
                "1, (SELECT password FROM users WHERE role='admin')"
            ];
            
            for (const orderBy of maliciousOrderBy) {
                const query = `SELECT * FROM users ORDER BY ${orderBy}`;
                await expect(
                    dbManager.executeSQL(testDbName, query)
                ).rejects.toThrow();
            }
        });

        test('should prevent injection in LIMIT clauses', async () => {
            const maliciousLimit = [
                "1; DROP TABLE users--",
                "1 UNION SELECT * FROM users",
                "-1 OR 1=1"
            ];
            
            for (const limit of maliciousLimit) {
                const query = `SELECT * FROM users LIMIT ${limit}`;
                await expect(
                    dbManager.executeSQL(testDbName, query)
                ).rejects.toThrow();
            }
        });
    });

    describe('Input Sanitization', () => {
        test('should sanitize string inputs', () => {
            const inputs = [
                { input: "normal input", expected: "normal input" },
                { input: "input with 'quotes'", expected: "input with quotes" },
                { input: 'input with "double"', expected: "input with double" },
                { input: "input; with; semicolons", expected: "input with semicolons" },
                { input: "input\\with\\backslash", expected: "inputwithbackslash" }
            ];
            
            inputs.forEach(({ input, expected }) => {
                const sanitized = sqlValidator.sanitizeParameters([input])[0];
                expect(sanitized).toBe(expected);
            });
        });
    });

    describe('Prepared Statement Usage', () => {
        test('should use prepared statements for all queries', async () => {
            // Test that parameterized queries work correctly
            const username = "test_user_prepared";
            const password = "test_pass";
            
            // Insert using safe builder
            const insertResult = await dbManager.insertData(testDbName, 'users', {
                username: username,
                password: password
            });
            expect(insertResult.success).toBe(true);
            
            // Query using parameters
            const query = 'SELECT * FROM users WHERE username = ?';
            const result = await dbManager.executeSQL(testDbName, query, [username]);
            
            expect(result.success).toBe(true);
            expect(result.data[0].username).toBe(username);
        });
    });

    describe('Error Message Security', () => {
        test('should not reveal database structure in errors', async () => {
            try {
                await dbManager.executeSQL(
                    testDbName,
                    "SELECT * FROM non_existent_table"
                );
            } catch (error) {
                // Error should be generic, not revealing table names
                expect(error.message).not.toMatch(/non_existent_table/);
                expect(error.message).toMatch(/query failed|error/i);
            }
        });
    });
});