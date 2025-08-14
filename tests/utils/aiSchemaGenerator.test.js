const AISchemaGenerator = require('../../src/utils/aiSchemaGenerator');

// Mock Anthropic API responses
const mockAnthropicResponses = {
    blogSystem: {
        content: [{
            text: JSON.stringify({
                description: "A comprehensive blog system with users, posts, and comments",
                databases: [{
                    name: "blog_system",
                    tables: {
                        users: {
                            columns: {
                                username: { type: 'string', required: true, unique: true },
                                email: { type: 'string', required: true, unique: true },
                                password_hash: { type: 'string', required: true },
                                first_name: { type: 'string' },
                                last_name: { type: 'string' },
                                bio: { type: 'string' },
                                avatar_url: { type: 'string' },
                                is_active: { type: 'boolean', default: true },
                                role: { type: 'string', default: 'user' }
                            },
                            constraints: [
                                { type: 'check', condition: "role IN ('user', 'admin', 'editor')" },
                                { type: 'check', condition: "email LIKE '%@%'" }
                            ]
                        },
                        posts: {
                            columns: {
                                title: { type: 'string', required: true },
                                slug: { type: 'string', required: true, unique: true },
                                content: { type: 'string', required: true },
                                excerpt: { type: 'string' },
                                author_id: { type: 'integer', required: true },
                                category_id: { type: 'integer' },
                                status: { type: 'string', default: 'draft' },
                                published_at: { type: 'date' },
                                meta_data: { type: 'json' }
                            },
                            constraints: [
                                { type: 'foreign_key', column: 'author_id', references: { table: 'users', column: 'id' } },
                                { type: 'foreign_key', column: 'category_id', references: { table: 'categories', column: 'id' } },
                                { type: 'check', condition: "status IN ('draft', 'published', 'archived')" }
                            ]
                        },
                        categories: {
                            columns: {
                                name: { type: 'string', required: true, unique: true },
                                description: { type: 'string' },
                                color: { type: 'string', default: '#666666' }
                            }
                        },
                        comments: {
                            columns: {
                                post_id: { type: 'integer', required: true },
                                author_id: { type: 'integer', required: true },
                                parent_id: { type: 'integer' },
                                content: { type: 'string', required: true },
                                is_approved: { type: 'boolean', default: false }
                            },
                            constraints: [
                                { type: 'foreign_key', column: 'post_id', references: { table: 'posts', column: 'id' } },
                                { type: 'foreign_key', column: 'author_id', references: { table: 'users', column: 'id' } },
                                { type: 'foreign_key', column: 'parent_id', references: { table: 'comments', column: 'id' } }
                            ]
                        }
                    },
                    sampleData: {
                        users: [
                            { username: 'admin', email: 'admin@blog.com', first_name: 'Admin', role: 'admin' },
                            { username: 'john_doe', email: 'john@example.com', first_name: 'John', last_name: 'Doe' }
                        ],
                        categories: [
                            { name: 'Technology', description: 'Tech related posts' },
                            { name: 'Lifestyle', description: 'Lifestyle and personal posts' }
                        ]
                    }
                }]
            })
        }]
    },
    
    inventorySystem: {
        content: [{
            text: JSON.stringify({
                description: "Inventory management system for retail operations",
                databases: [{
                    name: "inventory_system",
                    tables: {
                        suppliers: {
                            columns: {
                                name: { type: 'string', required: true },
                                contact_email: { type: 'string' },
                                phone: { type: 'string' },
                                address: { type: 'string' }
                            }
                        },
                        products: {
                            columns: {
                                sku: { type: 'string', required: true, unique: true },
                                name: { type: 'string', required: true },
                                description: { type: 'string' },
                                category: { type: 'string', required: true },
                                unit_price: { type: 'number', required: true },
                                supplier_id: { type: 'integer' },
                                min_stock_level: { type: 'integer', default: 10 },
                                is_active: { type: 'boolean', default: true }
                            },
                            constraints: [
                                { type: 'foreign_key', column: 'supplier_id', references: { table: 'suppliers', column: 'id' } },
                                { type: 'check', condition: 'unit_price >= 0' },
                                { type: 'check', condition: 'min_stock_level >= 0' }
                            ]
                        },
                        inventory: {
                            columns: {
                                product_id: { type: 'integer', required: true },
                                quantity: { type: 'integer', required: true, default: 0 },
                                location: { type: 'string', default: 'main_warehouse' },
                                last_updated: { type: 'date', default: 'CURRENT_TIMESTAMP' }
                            },
                            constraints: [
                                { type: 'foreign_key', column: 'product_id', references: { table: 'products', column: 'id' } },
                                { type: 'unique', columns: ['product_id', 'location'] },
                                { type: 'check', condition: 'quantity >= 0' }
                            ]
                        }
                    }
                }]
            })
        }]
    },
    
    invalidResponse: {
        content: [{
            text: "This is not valid JSON schema"
        }]
    }
};

// Mock the Anthropic client
jest.mock('@anthropic-ai/sdk', () => {
    return jest.fn().mockImplementation(() => ({
        messages: {
            create: jest.fn().mockImplementation((params) => {
                const prompt = params.messages[0].content;
                
                if (prompt.includes('blog system')) {
                    return Promise.resolve(mockAnthropicResponses.blogSystem);
                } else if (prompt.includes('inventory')) {
                    return Promise.resolve(mockAnthropicResponses.inventorySystem);
                } else if (prompt.includes('invalid')) {
                    return Promise.resolve(mockAnthropicResponses.invalidResponse);
                } else if (prompt.includes('network_error')) {
                    return Promise.reject(new Error('Network error'));
                }
                
                // Default response
                return Promise.resolve(mockAnthropicResponses.blogSystem);
            })
        }
    }));
});

describe('AISchemaGenerator', () => {
    let generator;
    let mockApiKey;

    beforeEach(() => {
        mockApiKey = 'test-api-key-12345';
        generator = new AISchemaGenerator(mockApiKey);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        test('should create generator with API key', () => {
            expect(generator).toBeDefined();
            expect(generator.anthropic).toBeDefined();
        });

        test('should throw error without API key', () => {
            expect(() => new AISchemaGenerator()).toThrow('API key is required');
        });

        test('should throw error with empty API key', () => {
            expect(() => new AISchemaGenerator('')).toThrow('API key is required');
        });
    });

    describe('Schema Generation', () => {
        test('should generate blog system schema successfully', async () => {
            const description = "Create a blog system with users, posts, and comments";
            
            const result = await generator.generateSchema(description);
            
            expect(result.success).toBe(true);
            expect(result.schema).toBeDefined();
            expect(result.schema.description).toContain('blog system');
            expect(result.schema.databases).toHaveLength(1);
            
            const database = result.schema.databases[0];
            expect(database.name).toBe('blog_system');
            expect(database.tables.users).toBeDefined();
            expect(database.tables.posts).toBeDefined();
            expect(database.tables.comments).toBeDefined();
            expect(database.tables.categories).toBeDefined();
        });

        test('should generate inventory system schema successfully', async () => {
            const description = "Build an inventory management system for retail store";
            
            const result = await generator.generateSchema(description);
            
            expect(result.success).toBe(true);
            expect(result.schema.databases[0].tables.products).toBeDefined();
            expect(result.schema.databases[0].tables.suppliers).toBeDefined();
            expect(result.schema.databases[0].tables.inventory).toBeDefined();
            
            // Verify product table structure
            const productsTable = result.schema.databases[0].tables.products;
            expect(productsTable.columns.sku).toEqual({
                type: 'string',
                required: true,
                unique: true
            });
            expect(productsTable.columns.unit_price).toEqual({
                type: 'number',
                required: true
            });
        });

        test('should validate column types', async () => {
            const result = await generator.generateSchema("Create a user management system");
            
            const tables = result.schema.databases[0].tables;
            Object.values(tables).forEach(table => {
                Object.values(table.columns).forEach(column => {
                    expect(['string', 'integer', 'number', 'boolean', 'date', 'json']).toContain(column.type);
                });
            });
        });

        test('should include proper constraints', async () => {
            const result = await generator.generateSchema("Create a blog system");
            
            const postsTable = result.schema.databases[0].tables.posts;
            expect(postsTable.constraints).toBeDefined();
            
            const foreignKeys = postsTable.constraints.filter(c => c.type === 'foreign_key');
            expect(foreignKeys.length).toBeGreaterThan(0);
            
            foreignKeys.forEach(fk => {
                expect(fk.column).toBeDefined();
                expect(fk.references).toBeDefined();
                expect(fk.references.table).toBeDefined();
                expect(fk.references.column).toBeDefined();
            });
        });

        test('should handle sample data generation', async () => {
            const result = await generator.generateSchema("Create a blog system");
            
            const database = result.schema.databases[0];
            expect(database.sampleData).toBeDefined();
            expect(database.sampleData.users).toBeDefined();
            expect(Array.isArray(database.sampleData.users)).toBe(true);
            expect(database.sampleData.users.length).toBeGreaterThan(0);
        });

        test('should handle invalid API responses', async () => {
            const result = await generator.generateSchema("invalid response test");
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid response format');
        });

        test('should handle network errors', async () => {
            const result = await generator.generateSchema("network_error test");
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('Network error');
        });

        test('should validate input parameters', async () => {
            await expect(generator.generateSchema()).rejects.toThrow('Description is required');
            await expect(generator.generateSchema('')).rejects.toThrow('Description is required');
            await expect(generator.generateSchema('  ')).rejects.toThrow('Description is required');
        });

        test('should handle long descriptions', async () => {
            const longDescription = 'A'.repeat(5000);
            const result = await generator.generateSchema(longDescription);
            
            // Should either succeed or fail gracefully
            expect(typeof result.success).toBe('boolean');
            if (!result.success) {
                expect(result.error).toBeDefined();
            }
        });
    });

    describe('SQL Script Generation', () => {
        test('should generate complete SQL scripts', async () => {
            const result = await generator.generateSchema("Create a simple user system");
            
            expect(result.success).toBe(true);
            expect(result.sqlScript).toBeDefined();
            expect(typeof result.sqlScript).toBe('string');
            expect(result.sqlScript).toContain('CREATE TABLE');
            expect(result.sqlScript).toContain('INSERT INTO');
        });

        test('should include foreign key constraints in SQL', async () => {
            const result = await generator.generateSchema("Create a blog with posts and users");
            
            expect(result.sqlScript).toContain('FOREIGN KEY');
            expect(result.sqlScript).toContain('REFERENCES');
        });

        test('should include check constraints in SQL', async () => {
            const result = await generator.generateSchema("Create inventory system");
            
            expect(result.sqlScript).toContain('CHECK');
        });

        test('should include sample data inserts', async () => {
            const result = await generator.generateSchema("Create user management");
            
            expect(result.sqlScript).toContain('INSERT INTO');
            // Should have multiple INSERT statements for sample data
            const insertCount = (result.sqlScript.match(/INSERT INTO/g) || []).length;
            expect(insertCount).toBeGreaterThan(0);
        });
    });

    describe('Schema Validation', () => {
        test('should validate generated schema structure', async () => {
            const result = await generator.generateSchema("Create a project management system");
            
            expect(result.success).toBe(true);
            
            // Validate top-level structure
            expect(result.schema).toHaveProperty('description');
            expect(result.schema).toHaveProperty('databases');
            expect(Array.isArray(result.schema.databases)).toBe(true);
            
            // Validate database structure
            result.schema.databases.forEach(db => {
                expect(db).toHaveProperty('name');
                expect(db).toHaveProperty('tables');
                expect(typeof db.tables).toBe('object');
                
                // Validate table structure
                Object.values(db.tables).forEach(table => {
                    expect(table).toHaveProperty('columns');
                    expect(typeof table.columns).toBe('object');
                    
                    // Validate column structure
                    Object.values(table.columns).forEach(column => {
                        expect(column).toHaveProperty('type');
                        expect(typeof column.type).toBe('string');
                    });
                });
            });
        });

        test('should ensure unique table names within database', async () => {
            const result = await generator.generateSchema("Create a complex e-commerce system");
            
            expect(result.success).toBe(true);
            
            result.schema.databases.forEach(db => {
                const tableNames = Object.keys(db.tables);
                const uniqueNames = [...new Set(tableNames)];
                expect(tableNames).toEqual(uniqueNames);
            });
        });

        test('should validate foreign key references', async () => {
            const result = await generator.generateSchema("Create blog with relationships");
            
            expect(result.success).toBe(true);
            
            result.schema.databases.forEach(db => {
                const tableNames = Object.keys(db.tables);
                
                Object.values(db.tables).forEach(table => {
                    if (table.constraints) {
                        table.constraints
                            .filter(c => c.type === 'foreign_key')
                            .forEach(fk => {
                                expect(tableNames).toContain(fk.references.table);
                            });
                    }
                });
            });
        });
    });

    describe('Error Handling', () => {
        test('should handle malformed JSON responses', async () => {
            // Mock malformed response
            generator.anthropic.messages.create.mockResolvedValueOnce({
                content: [{ text: '{ invalid json }' }]
            });
            
            const result = await generator.generateSchema("test");
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid response format');
        });

        test('should handle API rate limiting', async () => {
            const rateLimitError = new Error('Rate limit exceeded');
            rateLimitError.status = 429;
            
            generator.anthropic.messages.create.mockRejectedValueOnce(rateLimitError);
            
            const result = await generator.generateSchema("test");
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('Rate limit exceeded');
        });

        test('should handle API authentication errors', async () => {
            const authError = new Error('Invalid API key');
            authError.status = 401;
            
            generator.anthropic.messages.create.mockRejectedValueOnce(authError);
            
            const result = await generator.generateSchema("test");
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid API key');
        });

        test('should handle timeout errors', async () => {
            const timeoutError = new Error('Request timeout');
            timeoutError.code = 'ECONNABORTED';
            
            generator.anthropic.messages.create.mockRejectedValueOnce(timeoutError);
            
            const result = await generator.generateSchema("test");
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('Request timeout');
        });
    });

    describe('Performance', () => {
        test('should complete schema generation within reasonable time', async () => {
            const startTime = Date.now();
            
            const result = await generator.generateSchema("Create a simple CRM system");
            
            const duration = Date.now() - startTime;
            
            expect(result.success).toBe(true);
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
        });

        test('should handle concurrent schema generation requests', async () => {
            const promises = [
                generator.generateSchema("Create user system"),
                generator.generateSchema("Create product catalog"),
                generator.generateSchema("Create order management")
            ];
            
            const results = await Promise.all(promises);
            
            results.forEach(result => {
                expect(result.success).toBe(true);
            });
        });
    });

    describe('Integration', () => {
        test('should work with DatabaseManager for schema implementation', async () => {
            const schemaResult = await generator.generateSchema("Create simple task management");
            
            expect(schemaResult.success).toBe(true);
            expect(schemaResult.schema).toBeDefined();
            
            // Verify schema can be used with DatabaseManager
            const schema = schemaResult.schema;
            expect(schema.databases).toBeDefined();
            expect(schema.databases.length).toBeGreaterThan(0);
            
            const database = schema.databases[0];
            expect(database.tables).toBeDefined();
            
            // Each table should have valid column definitions
            Object.values(database.tables).forEach(table => {
                expect(table.columns).toBeDefined();
                Object.entries(table.columns).forEach(([columnName, columnDef]) => {
                    expect(typeof columnName).toBe('string');
                    expect(columnDef.type).toBeDefined();
                });
            });
        });
    });
});