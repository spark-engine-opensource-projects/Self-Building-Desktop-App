const DatabaseManager = require('../../src/utils/databaseManager');
const path = require('path');
const fs = require('fs').promises;

describe('DatabaseManager', () => {
    let dbManager;
    let testDataPath;

    beforeEach(async () => {
        // Create temporary test directory
        testDataPath = path.join(__dirname, '..', 'temp', `test_${Date.now()}`);
        await fs.mkdir(testDataPath, { recursive: true });
        dbManager = new DatabaseManager(testDataPath);
    });

    afterEach(async () => {
        // Clean up connections
        if (dbManager) {
            dbManager.closeAllConnections();
        }
        
        // Clean up test files
        try {
            await fs.rm(testDataPath, { recursive: true, force: true });
        } catch (error) {
            console.warn('Failed to cleanup test files:', error.message);
        }
    });

    describe('Database Connection', () => {
        test('should create new database connection', async () => {
            const db = await dbManager.connectDatabase('test_db');
            expect(db).toBeDefined();
            expect(dbManager.connections.has('test_db')).toBe(true);
        });

        test('should reuse existing database connection', async () => {
            const db1 = await dbManager.connectDatabase('test_db');
            const db2 = await dbManager.connectDatabase('test_db');
            expect(db1).toBe(db2);
        });

        test('should handle invalid database names', async () => {
            await expect(dbManager.connectDatabase('../malicious')).rejects.toThrow();
        });
    });

    describe('Table Creation', () => {
        test('should create table with valid schema', async () => {
            const schema = {
                columns: {
                    name: { type: 'string', required: true },
                    email: { type: 'string', unique: true },
                    age: { type: 'integer', default: 0 }
                }
            };

            const result = await dbManager.createTable('test_db', 'users', schema);
            expect(result.success).toBe(true);
            expect(result.table).toBe('users');
        });

        test('should reject invalid table names', async () => {
            const schema = { columns: { name: { type: 'string' } } };
            
            await expect(dbManager.createTable('test_db', '123invalid', schema))
                .rejects.toThrow('Invalid table name');
            
            await expect(dbManager.createTable('test_db', 'DROP TABLE users', schema))
                .rejects.toThrow('Invalid table name');
        });

        test('should handle complex table constraints', async () => {
            const schema = {
                columns: {
                    userId: { type: 'integer', required: true },
                    productId: { type: 'integer', required: true },
                    quantity: { type: 'integer', default: 1 }
                },
                constraints: [
                    {
                        type: 'unique',
                        columns: ['userId', 'productId']
                    },
                    {
                        type: 'check',
                        condition: 'quantity > 0'
                    }
                ]
            };

            const result = await dbManager.createTable('test_db', 'cart_items', schema);
            expect(result.success).toBe(true);
        });
    });

    describe('Data Operations', () => {
        beforeEach(async () => {
            const schema = {
                columns: {
                    name: { type: 'string', required: true },
                    email: { type: 'string', unique: true },
                    age: { type: 'integer', default: 18 },
                    active: { type: 'boolean', default: true },
                    metadata: { type: 'json' }
                }
            };
            await dbManager.createTable('test_db', 'users', schema);
        });

        test('should insert data successfully', async () => {
            const userData = {
                name: 'John Doe',
                email: 'john@example.com',
                age: 25,
                active: true,
                metadata: { role: 'admin', preferences: {} }
            };

            const result = await dbManager.insertData('test_db', 'users', userData);
            expect(result.success).toBe(true);
            expect(result.id).toBeDefined();
            expect(result.data.name).toBe('John Doe');
        });

        test('should handle data type conversions', async () => {
            const userData = {
                name: 'Jane Doe',
                email: 'jane@example.com',
                age: '30', // String should convert to integer
                active: 'true', // String should convert to boolean
                metadata: { role: 'user' } // Object should convert to JSON string
            };

            const result = await dbManager.insertData('test_db', 'users', userData);
            expect(result.success).toBe(true);
            expect(typeof result.data.age).toBe('number');
        });

        test('should query data with filters', async () => {
            // Insert test data
            await dbManager.insertData('test_db', 'users', {
                name: 'Alice', email: 'alice@example.com', age: 25, active: true
            });
            await dbManager.insertData('test_db', 'users', {
                name: 'Bob', email: 'bob@example.com', age: 30, active: false
            });
            await dbManager.insertData('test_db', 'users', {
                name: 'Charlie', email: 'charlie@example.com', age: 35, active: true
            });

            // Test basic filter
            const activeUsers = await dbManager.queryData('test_db', 'users', {
                where: { active: true }
            });
            expect(activeUsers.success).toBe(true);
            expect(activeUsers.data.length).toBe(2);

            // Test comparison operators
            const oldUsers = await dbManager.queryData('test_db', 'users', {
                where: { age: { $gte: 30 } }
            });
            expect(oldUsers.success).toBe(true);
            expect(oldUsers.data.length).toBe(2);

            // Test LIKE operator
            const bobUsers = await dbManager.queryData('test_db', 'users', {
                where: { name: { $like: 'Bob%' } }
            });
            expect(bobUsers.success).toBe(true);
            expect(bobUsers.data.length).toBe(1);
            expect(bobUsers.data[0].name).toBe('Bob');
        });

        test('should update data successfully', async () => {
            // Insert test data
            const insertResult = await dbManager.insertData('test_db', 'users', {
                name: 'Test User', email: 'test@example.com', age: 25
            });

            // Update data
            const updateResult = await dbManager.updateData('test_db', 'users', insertResult.id, {
                name: 'Updated User',
                age: 26
            });
            expect(updateResult.success).toBe(true);
            expect(updateResult.changes).toBe(1);

            // Verify update
            const queryResult = await dbManager.queryData('test_db', 'users', {
                where: { id: insertResult.id }
            });
            expect(queryResult.data[0].name).toBe('Updated User');
            expect(queryResult.data[0].age).toBe(26);
            expect(queryResult.data[0].email).toBe('test@example.com'); // Should remain unchanged
        });

        test('should delete data successfully', async () => {
            // Insert test data
            const insertResult = await dbManager.insertData('test_db', 'users', {
                name: 'To Delete', email: 'delete@example.com', age: 25
            });

            // Delete data
            const deleteResult = await dbManager.deleteData('test_db', 'users', insertResult.id);
            expect(deleteResult.success).toBe(true);
            expect(deleteResult.changes).toBe(1);

            // Verify deletion
            const queryResult = await dbManager.queryData('test_db', 'users', {
                where: { id: insertResult.id }
            });
            expect(queryResult.data.length).toBe(0);
        });
    });

    describe('Database Management', () => {
        test('should list tables in database', async () => {
            // Create test tables
            const schema = { columns: { name: { type: 'string' } } };
            await dbManager.createTable('test_db', 'users', schema);
            await dbManager.createTable('test_db', 'products', schema);

            const result = await dbManager.listTables('test_db');
            expect(result.success).toBe(true);
            expect(result.tables).toContain('users');
            expect(result.tables).toContain('products');
            expect(result.count).toBe(2);
        });

        test('should list all databases', async () => {
            await dbManager.connectDatabase('db1');
            await dbManager.connectDatabase('db2');

            const result = await dbManager.listDatabases();
            expect(result.success).toBe(true);
            expect(result.databases).toContain('db1');
            expect(result.databases).toContain('db2');
        });

        test('should export database to JSON', async () => {
            // Create table and add data
            const schema = {
                columns: {
                    name: { type: 'string' },
                    value: { type: 'integer' }
                }
            };
            await dbManager.createTable('test_db', 'config', schema);
            await dbManager.insertData('test_db', 'config', { name: 'setting1', value: 123 });
            await dbManager.insertData('test_db', 'config', { name: 'setting2', value: 456 });

            const exportResult = await dbManager.exportDatabase('test_db');
            expect(exportResult.success).toBe(true);
            expect(exportResult.export.database).toBe('test_db');
            expect(exportResult.export.tables.config).toBeDefined();
            expect(exportResult.export.tables.config.data.length).toBe(2);
        });
    });

    describe('SQL Execution', () => {
        test('should execute safe SELECT queries', async () => {
            // Create table and add data
            const schema = { columns: { name: { type: 'string' } } };
            await dbManager.createTable('test_db', 'items', schema);
            await dbManager.insertData('test_db', 'items', { name: 'item1' });
            await dbManager.insertData('test_db', 'items', { name: 'item2' });

            const result = await dbManager.executeSQL('test_db', 'SELECT * FROM items WHERE name = ?', ['item1']);
            expect(result.success).toBe(true);
            expect(result.type).toBe('select');
            expect(result.data.length).toBe(1);
            expect(result.data[0].name).toBe('item1');
        });

        test('should block dangerous SQL operations', async () => {
            await expect(dbManager.executeSQL('test_db', 'DROP TABLE users'))
                .rejects.toThrow('SQL query contains potentially dangerous operations');

            await expect(dbManager.executeSQL('test_db', 'PRAGMA user_version = 1'))
                .rejects.toThrow('SQL query contains potentially dangerous operations');

            await expect(dbManager.executeSQL('test_db', 'ATTACH DATABASE "test.db" AS test'))
                .rejects.toThrow('SQL query contains potentially dangerous operations');
        });

        test('should execute safe modification queries', async () => {
            const schema = { columns: { name: { type: 'string' } } };
            await dbManager.createTable('test_db', 'temp_items', schema);

            const result = await dbManager.executeSQL('test_db', 
                'INSERT INTO temp_items (name) VALUES (?)', 
                ['test_item']
            );
            expect(result.success).toBe(true);
            expect(result.type).toBe('modify');
            expect(result.lastInsertRowid).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        test('should handle database connection errors gracefully', async () => {
            // Test with invalid path
            const invalidDbManager = new DatabaseManager('/invalid/path/that/does/not/exist');
            await expect(invalidDbManager.connectDatabase('test')).rejects.toThrow();
        });

        test('should handle schema validation errors', async () => {
            const invalidSchema = {
                columns: {
                    // Missing type
                    name: { required: true }
                }
            };

            await expect(dbManager.createTable('test_db', 'invalid_table', invalidSchema))
                .rejects.toThrow();
        });

        test('should handle constraint violations', async () => {
            const schema = {
                columns: {
                    email: { type: 'string', unique: true, required: true }
                }
            };
            await dbManager.createTable('test_db', 'unique_test', schema);

            // Insert first record
            await dbManager.insertData('test_db', 'unique_test', { email: 'test@example.com' });

            // Try to insert duplicate
            await expect(dbManager.insertData('test_db', 'unique_test', { email: 'test@example.com' }))
                .rejects.toThrow();
        });
    });

    describe('Performance', () => {
        test('should handle bulk data operations efficiently', async () => {
            const schema = {
                columns: {
                    name: { type: 'string' },
                    value: { type: 'integer' }
                }
            };
            await dbManager.createTable('test_db', 'bulk_test', schema);

            const startTime = Date.now();
            
            // Insert 100 records
            const insertPromises = [];
            for (let i = 0; i < 100; i++) {
                insertPromises.push(
                    dbManager.insertData('test_db', 'bulk_test', {
                        name: `item_${i}`,
                        value: i
                    })
                );
            }
            await Promise.all(insertPromises);

            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

            // Verify all records inserted
            const queryResult = await dbManager.queryData('test_db', 'bulk_test');
            expect(queryResult.data.length).toBe(100);
        }, 10000);

        test('should handle pagination efficiently', async () => {
            const schema = { columns: { value: { type: 'integer' } } };
            await dbManager.createTable('test_db', 'pagination_test', schema);

            // Insert test data
            for (let i = 0; i < 50; i++) {
                await dbManager.insertData('test_db', 'pagination_test', { value: i });
            }

            // Test pagination
            const page1 = await dbManager.queryData('test_db', 'pagination_test', {
                orderBy: 'value',
                limit: 10,
                offset: 0
            });
            expect(page1.data.length).toBe(10);
            expect(page1.data[0].value).toBe(0);

            const page2 = await dbManager.queryData('test_db', 'pagination_test', {
                orderBy: 'value', 
                limit: 10,
                offset: 10
            });
            expect(page2.data.length).toBe(10);
            expect(page2.data[0].value).toBe(10);
        });
    });
});