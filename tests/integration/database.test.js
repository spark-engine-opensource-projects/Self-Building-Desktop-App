const path = require('path');
const fs = require('fs').promises;
const DatabaseManager = require('../../src/utils/databaseManager');
const databaseOptimizer = require('../../src/utils/databaseOptimizer');
const sqlValidator = require('../../src/utils/sqlValidator');

describe('Database Integration Tests', () => {
    let dbManager;
    let testDbName;
    let testDataPath;

    beforeAll(async () => {
        // Setup test environment
        testDataPath = path.join(__dirname, '..', 'temp', 'test-data');
        await fs.mkdir(testDataPath, { recursive: true });
        
        dbManager = new DatabaseManager(testDataPath);
        testDbName = `test_${Date.now()}`;
    });

    afterAll(async () => {
        // Cleanup
        await dbManager.closeAllConnections();
        await fs.rmdir(testDataPath, { recursive: true });
    });

    describe('Database Connection Management', () => {
        test('should create and connect to database', async () => {
            const result = await dbManager.createDatabase(testDbName);
            expect(result.success).toBe(true);
            expect(result.database).toBe(testDbName);

            const db = await dbManager.connectDatabase(testDbName);
            expect(db).toBeTruthy();
            expect(db.open).toBe(true);
        });

        test('should manage connection pool', async () => {
            const connections = [];
            
            // Create multiple connections
            for (let i = 0; i < 5; i++) {
                const db = await dbManager.connectDatabase(`test_pool_${i}`);
                connections.push(db);
            }

            expect(dbManager.connections.size).toBeGreaterThanOrEqual(5);

            // Close oldest when limit reached
            dbManager.maxConnections = 3;
            await dbManager.connectDatabase('test_pool_new');
            
            expect(dbManager.connections.size).toBeLessThanOrEqual(dbManager.maxConnections + 2);
        });

        test('should handle stale connections', async () => {
            const dbName = 'test_stale';
            const db = await dbManager.connectDatabase(dbName);
            
            // Simulate stale connection
            dbManager.connectionTimestamps.set(dbName, Date.now() - dbManager.maxConnectionAge - 1000);
            
            const newDb = await dbManager.connectDatabase(dbName);
            expect(newDb).toBeTruthy();
            expect(newDb).not.toBe(db); // Should be a new connection
        });
    });

    describe('SQL Validation Integration', () => {
        test('should validate queries before execution', async () => {
            const db = await dbManager.connectDatabase(testDbName);
            
            // Create test table
            await dbManager.createTable(testDbName, 'users', {
                id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
                name: { type: 'TEXT', notNull: true },
                email: { type: 'TEXT', unique: true }
            });

            // Try SQL injection - should be blocked
            const maliciousSQL = "'; DROP TABLE users; --";
            await expect(
                dbManager.executeSQL(testDbName, maliciousSQL)
            ).rejects.toThrow(/suspicious|dangerous/i);

            // Safe query should work
            const safeResult = await dbManager.executeSQL(
                testDbName,
                'SELECT * FROM users WHERE id = ?',
                [1]
            );
            expect(safeResult.success).toBe(true);
        });

        test('should use safe query builders', async () => {
            const db = await dbManager.connectDatabase(testDbName);
            
            // Test safe insert
            const insertResult = await dbManager.insertData(testDbName, 'users', {
                name: 'John Doe',
                email: 'john@example.com'
            });
            expect(insertResult.success).toBe(true);

            // Test safe select
            const selectResult = await dbManager.queryData(testDbName, 'users', {
                where: { name: 'John Doe' }
            });
            expect(selectResult.success).toBe(true);
            expect(selectResult.data.length).toBeGreaterThan(0);
        });
    });

    describe('Query Optimization Integration', () => {
        test('should cache query results', async () => {
            const db = await dbManager.connectDatabase(testDbName);
            
            // First query - cache miss
            const startTime1 = Date.now();
            const result1 = await databaseOptimizer.executeWithCache(
                db,
                'SELECT * FROM users WHERE name = ?',
                ['John Doe']
            );
            const time1 = Date.now() - startTime1;

            // Second query - cache hit
            const startTime2 = Date.now();
            const result2 = await databaseOptimizer.executeWithCache(
                db,
                'SELECT * FROM users WHERE name = ?',
                ['John Doe']
            );
            const time2 = Date.now() - startTime2;

            expect(result1).toEqual(result2);
            expect(time2).toBeLessThan(time1); // Cache hit should be faster
        });

        test('should optimize queries', () => {
            const queries = [
                {
                    original: 'SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM banned)',
                    optimized: /NOT EXISTS/
                },
                {
                    original: 'SELECT   *   FROM    users',
                    optimized: /SELECT \* FROM users/
                }
            ];

            queries.forEach(({ original, optimized }) => {
                const result = databaseOptimizer.optimizeQuery(original);
                expect(result.sql).toMatch(optimized);
            });
        });

        test('should track query statistics', async () => {
            const db = await dbManager.connectDatabase(testDbName);
            
            // Execute queries multiple times
            for (let i = 0; i < 5; i++) {
                await databaseOptimizer.executeDirectly(
                    db,
                    'SELECT * FROM users WHERE id = ?',
                    [i]
                );
            }

            const stats = databaseOptimizer.getQueryStats();
            expect(stats.length).toBeGreaterThan(0);
            expect(stats[0].count).toBeGreaterThanOrEqual(5);
            expect(stats[0].avgDuration).toBeDefined();
        });
    });

    describe('Batch Operations Integration', () => {
        test('should batch insert operations', async () => {
            const db = await dbManager.connectDatabase(testDbName);
            
            // Queue batch inserts
            const batchData = [];
            for (let i = 0; i < 100; i++) {
                batchData.push({
                    name: `User ${i}`,
                    email: `user${i}@example.com`
                });
            }

            batchData.forEach(data => {
                databaseOptimizer.addToBatch('users', 'insert', data);
            });

            // Flush batch
            const result = await databaseOptimizer.flushBatch('users', db);
            expect(result.success).toBe(true);
            expect(result.operations).toBe(100);

            // Verify data was inserted
            const queryResult = await dbManager.queryData(testDbName, 'users', {});
            expect(queryResult.data.length).toBeGreaterThanOrEqual(100);
        });

        test('should handle mixed batch operations', async () => {
            const db = await dbManager.connectDatabase(testDbName);
            
            // Queue different operations
            databaseOptimizer.addToBatch('users', 'insert', {
                name: 'New User',
                email: 'new@example.com'
            });
            
            databaseOptimizer.addToBatch('users', 'update', {
                id: 1,
                data: { name: 'Updated User' }
            });
            
            databaseOptimizer.addToBatch('users', 'delete', {
                id: 2
            });

            // Flush all operations
            const result = await databaseOptimizer.flushBatch('users', db);
            expect(result.success).toBe(true);
            expect(result.operations).toBeGreaterThan(0);
        });

        test('should handle transaction failures', async () => {
            const db = await dbManager.connectDatabase(testDbName);
            
            // Queue invalid operation
            databaseOptimizer.addToBatch('non_existent_table', 'insert', {
                data: 'test'
            });

            // Should rollback on failure
            const result = await databaseOptimizer.flushBatch('non_existent_table', db);
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('Schema Management Integration', () => {
        test('should create tables with validation', async () => {
            const schema = {
                id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
                username: { type: 'TEXT', notNull: true, unique: true },
                created_at: { type: 'DATE', default: 'CURRENT_TIMESTAMP' }
            };

            const result = await dbManager.createTable(testDbName, 'test_table', schema);
            expect(result.success).toBe(true);

            // Verify table structure
            const db = await dbManager.connectDatabase(testDbName);
            const tableInfo = db.prepare('PRAGMA table_info(test_table)').all();
            expect(tableInfo).toHaveLength(3);
            expect(tableInfo.find(col => col.name === 'username')).toBeDefined();
        });

        test('should handle migrations', async () => {
            const db = await dbManager.connectDatabase(testDbName);
            
            // Add migration tracking
            const migration = {
                version: 1,
                description: 'Add test column',
                sql: 'ALTER TABLE users ADD COLUMN test_field TEXT'
            };

            await dbManager.runMigration(testDbName, migration);
            
            // Verify migration was applied
            const tableInfo = db.prepare('PRAGMA table_info(users)').all();
            expect(tableInfo.find(col => col.name === 'test_field')).toBeDefined();
        });
    });

    describe('Performance Integration', () => {
        test('should handle concurrent operations', async () => {
            const promises = [];
            
            // Simulate concurrent database operations
            for (let i = 0; i < 10; i++) {
                promises.push(
                    dbManager.insertData(testDbName, 'users', {
                        name: `Concurrent User ${i}`,
                        email: `concurrent${i}@example.com`
                    })
                );
            }

            const results = await Promise.all(promises);
            expect(results.every(r => r.success)).toBe(true);
        });

        test('should generate index suggestions', async () => {
            const db = await dbManager.connectDatabase(testDbName);
            
            // Execute many queries on same column
            for (let i = 0; i < 150; i++) {
                await databaseOptimizer.executeDirectly(
                    db,
                    'SELECT * FROM users WHERE email = ?',
                    [`user${i}@example.com`]
                );
            }

            const suggestions = databaseOptimizer.getIndexSuggestions();
            expect(suggestions.length).toBeGreaterThan(0);
            expect(suggestions[0].column).toBe('email');
            expect(suggestions[0].priority).toBeDefined();
        });
    });

    describe('Error Recovery Integration', () => {
        test('should recover from connection errors', async () => {
            const dbName = 'test_recovery';
            const db = await dbManager.connectDatabase(dbName);
            
            // Simulate connection error by closing database
            db.close();
            
            // Should automatically reconnect
            const result = await dbManager.queryData(dbName, 'users', {});
            expect(result).toBeDefined();
        });

        test('should handle cleanup on shutdown', async () => {
            // Create multiple connections
            for (let i = 0; i < 3; i++) {
                await dbManager.connectDatabase(`cleanup_test_${i}`);
            }

            const connectionCount = dbManager.connections.size;
            
            // Close all connections
            await dbManager.closeAllConnections();
            
            expect(dbManager.connections.size).toBe(0);
            expect(dbManager.connectionTimestamps.size).toBe(0);
        });
    });
});