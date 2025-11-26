const AISchemaGenerator = require('../../src/utils/aiSchemaGenerator');

// Mock configManager
jest.mock('../../src/utils/configManager', () => ({
    get: jest.fn().mockReturnValue({
        model: 'claude-3-5-sonnet-20241022'
    }),
    initialize: jest.fn().mockResolvedValue(true)
}));

// Mock logger
jest.mock('../../src/utils/logger', () => global.testUtils?.createMockLogger?.() || {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
});

// Mock responses
const mockBlogSchema = {
    database_name: "blog_system",
    description: "A comprehensive blog system with users, posts, and comments",
    tables: {
        users: {
            description: "User accounts",
            columns: {
                username: { type: 'string', required: true, unique: true },
                email: { type: 'string', required: true, unique: true },
                password_hash: { type: 'string', required: true }
            },
            constraints: [],
            sample_data: [
                { username: 'admin', email: 'admin@blog.com' }
            ]
        },
        posts: {
            description: "Blog posts",
            columns: {
                title: { type: 'string', required: true },
                content: { type: 'string', required: true },
                author_id: { type: 'integer', required: true }
            },
            constraints: [
                { type: 'foreign_key', column: 'author_id', references: { table: 'users', column: 'id' } }
            ],
            indexes: [
                { name: 'idx_posts_author', columns: ['author_id'], unique: false }
            ],
            sample_data: [
                { title: 'First Post', content: 'Hello World' }
            ]
        }
    },
    relationships: [
        { type: 'one_to_many', from_table: 'users', to_table: 'posts', description: 'User has many posts' }
    ]
};

describe('AISchemaGenerator', () => {
    let generator;
    let mockAnthropicClient;

    beforeEach(() => {
        mockAnthropicClient = {
            messages: {
                create: jest.fn().mockResolvedValue({
                    content: [{
                        text: JSON.stringify(mockBlogSchema)
                    }]
                })
            }
        };
        generator = new AISchemaGenerator(mockAnthropicClient);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Initialization', () => {
        test('should create generator with anthropic client', () => {
            expect(generator).toBeDefined();
            expect(generator.anthropic).toBe(mockAnthropicClient);
        });
    });

    describe('Schema Generation', () => {
        test('should generate schema successfully', async () => {
            const description = "Create a blog system with users and posts";

            const result = await generator.generateSchema(description);

            expect(result.success).toBe(true);
            expect(result.schema).toBeDefined();
            expect(result.schema.tables).toBeDefined();
            expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: expect.any(String),
                    messages: expect.arrayContaining([
                        expect.objectContaining({
                            role: 'user',
                            content: expect.stringContaining(description)
                        })
                    ])
                })
            );
        });

        test('should include tables in response', async () => {
            const result = await generator.generateSchema("Create user management");

            expect(result.success).toBe(true);
            expect(result.schema.tables).toBeDefined();
            expect(typeof result.schema.tables).toBe('object');
        });

        test('should handle API errors gracefully', async () => {
            mockAnthropicClient.messages.create.mockRejectedValueOnce(new Error('API Error'));

            await expect(generator.generateSchema("test"))
                .rejects.toThrow('API Error');
        });

        test('should handle invalid JSON responses', async () => {
            mockAnthropicClient.messages.create.mockResolvedValueOnce({
                content: [{ text: 'invalid json {{{' }]
            });

            await expect(generator.generateSchema("test"))
                .rejects.toThrow(/Invalid schema format/);
        });
    });

    describe('Schema Validation', () => {
        test('should validate schema with tables', () => {
            const validSchema = {
                tables: {
                    users: {
                        columns: {
                            name: { type: 'string' }
                        }
                    }
                }
            };

            expect(() => generator.validateSchema(validSchema)).not.toThrow();
        });

        test('should throw error for schema without tables', () => {
            const invalidSchema = { data: {} };

            expect(() => generator.validateSchema(invalidSchema))
                .toThrow('Schema must contain a tables object');
        });

        test('should throw error for table without columns', () => {
            const invalidSchema = {
                tables: {
                    users: { data: {} }
                }
            };

            expect(() => generator.validateSchema(invalidSchema))
                .toThrow('Table users must contain columns');
        });

        test('should throw error for column without type', () => {
            const invalidSchema = {
                tables: {
                    users: {
                        columns: {
                            name: { required: true }
                        }
                    }
                }
            };

            expect(() => generator.validateSchema(invalidSchema))
                .toThrow('must have a type');
        });

        test('should convert unknown types to TEXT', () => {
            const schema = {
                tables: {
                    users: {
                        columns: {
                            custom_field: { type: 'unknown_type' }
                        }
                    }
                }
            };

            const validated = generator.validateAndFixSchema(schema);
            expect(validated.tables.users.columns.custom_field.type).toBe('TEXT');
        });

        test('should add id column if missing', () => {
            const schema = {
                tables: {
                    users: {
                        columns: {
                            name: { type: 'string' }
                        }
                    }
                }
            };

            const validated = generator.validateAndFixSchema(schema);
            expect(validated.tables.users.columns.id).toBeDefined();
            expect(validated.tables.users.columns.id.primaryKey).toBe(true);
        });

        test('should add timestamp columns if missing', () => {
            const schema = {
                tables: {
                    users: {
                        columns: {
                            name: { type: 'string' }
                        }
                    }
                }
            };

            const validated = generator.validateAndFixSchema(schema);
            expect(validated.tables.users.columns.created_at).toBeDefined();
            expect(validated.tables.users.columns.updated_at).toBeDefined();
        });
    });

    describe('Type Mapping', () => {
        const typeTestCases = [
            ['string', 'TEXT'],
            ['text', 'TEXT'],
            ['varchar', 'TEXT'],
            ['integer', 'INTEGER'],
            ['int', 'INTEGER'],
            ['number', 'REAL'],
            ['float', 'REAL'],
            ['double', 'REAL'],
            ['boolean', 'INTEGER'],
            ['bool', 'INTEGER'],
            ['date', 'TEXT'],
            ['datetime', 'TEXT'],
            ['timestamp', 'TEXT'],
            ['json', 'TEXT'],
            ['blob', 'BLOB']
        ];

        test.each(typeTestCases)('should convert %s to %s', (inputType, expectedType) => {
            const schema = {
                tables: {
                    test: {
                        columns: {
                            test_col: { type: inputType }
                        }
                    }
                }
            };

            const validated = generator.validateAndFixSchema(schema);
            expect(validated.tables.test.columns.test_col.type).toBe(expectedType);
        });
    });

    describe('SQL Generation', () => {
        test('should generate sample inserts', () => {
            const inserts = generator.generateSampleInserts(mockBlogSchema);

            expect(Array.isArray(inserts)).toBe(true);
            expect(inserts.length).toBeGreaterThan(0);
            expect(inserts[0]).toContain('INSERT INTO');
        });

        test('should generate index statements', () => {
            const indexes = generator.generateIndexes(mockBlogSchema);

            expect(Array.isArray(indexes)).toBe(true);
            expect(indexes.length).toBeGreaterThan(0);
            expect(indexes[0]).toContain('CREATE');
            expect(indexes[0]).toContain('INDEX');
        });

        test('should handle tables without sample data', () => {
            const schemaNoSamples = {
                tables: {
                    empty_table: {
                        columns: { name: { type: 'string' } }
                    }
                }
            };

            const inserts = generator.generateSampleInserts(schemaNoSamples);
            expect(Array.isArray(inserts)).toBe(true);
        });

        test('should handle tables without indexes', () => {
            const schemaNoIndexes = {
                tables: {
                    simple_table: {
                        columns: { name: { type: 'string' } }
                    }
                }
            };

            const indexes = generator.generateIndexes(schemaNoIndexes);
            expect(Array.isArray(indexes)).toBe(true);
            expect(indexes.length).toBe(0);
        });
    });

    describe('Data Model Generation', () => {
        test('should generate data models from schema', () => {
            const models = generator.generateDataModel(mockBlogSchema);

            expect(models).toBeDefined();
            expect(models.Users).toBeDefined();
            expect(models.Posts).toBeDefined();
            expect(models.Users.tableName).toBe('users');
        });

        test('should include relationships in models', () => {
            const models = generator.generateDataModel(mockBlogSchema);

            expect(models.Users.relationships).toBeDefined();
            expect(Array.isArray(models.Users.relationships)).toBe(true);
        });

        test('should generate model methods', () => {
            const models = generator.generateDataModel(mockBlogSchema);

            expect(models.Users.methods).toBeDefined();
            expect(Array.isArray(models.Users.methods)).toBe(true);
        });
    });

    describe('Utility Functions', () => {
        test('should convert to PascalCase', () => {
            expect(generator.toPascalCase('user_profile')).toBe('UserProfile');
            expect(generator.toPascalCase('order_items')).toBe('OrderItems');
            expect(generator.toPascalCase('users')).toBe('Users');
        });

        test('should extract table relationships', () => {
            const relationships = [
                { from_table: 'users', to_table: 'posts', type: 'one_to_many' },
                { from_table: 'posts', to_table: 'comments', type: 'one_to_many' }
            ];

            const userRels = generator.extractTableRelationships('users', relationships);
            expect(userRels.length).toBe(1);
            expect(userRels[0].from_table).toBe('users');

            const postRels = generator.extractTableRelationships('posts', relationships);
            expect(postRels.length).toBe(2);
        });
    });

    describe('Prompt Building', () => {
        test('should build schema prompt with description', () => {
            const description = "Create a user management system";
            const prompt = generator.buildSchemaPrompt(description);

            expect(prompt).toContain(description);
            expect(prompt).toContain('database designer');
            expect(prompt).toContain('Schema Format');
            expect(prompt).toContain('```json');
        });
    });

    describe('Response Parsing', () => {
        test('should parse JSON response', () => {
            const response = JSON.stringify(mockBlogSchema);
            const parsed = generator.parseSchemaResponse(response);

            expect(parsed.tables).toBeDefined();
        });

        test('should parse JSON from code block', () => {
            const response = '```json\n' + JSON.stringify(mockBlogSchema) + '\n```';
            const parsed = generator.parseSchemaResponse(response);

            expect(parsed.tables).toBeDefined();
        });

        test('should throw error for invalid JSON', () => {
            const response = 'not valid json {{{';

            expect(() => generator.parseSchemaResponse(response))
                .toThrow(/Invalid schema format/);
        });
    });

    describe('Database Script Generation', () => {
        test('should generate complete database script', async () => {
            const result = await generator.generateDatabaseScript("Create blog system");

            expect(result.success).toBe(true);
            expect(result.script).toBeDefined();
            expect(result.script.tables).toBeDefined();
            expect(Array.isArray(result.script.tables)).toBe(true);
        });

        test('should include indexes in script', async () => {
            const result = await generator.generateDatabaseScript("Create blog");

            expect(result.script.indexes).toBeDefined();
            expect(Array.isArray(result.script.indexes)).toBe(true);
        });

        test('should include sample inserts in script', async () => {
            const result = await generator.generateDatabaseScript("Create users");

            expect(result.script.sample_inserts).toBeDefined();
            expect(Array.isArray(result.script.sample_inserts)).toBe(true);
        });
    });

    describe('Schema Improvements', () => {
        test('should suggest schema improvements', async () => {
            mockAnthropicClient.messages.create.mockResolvedValueOnce({
                content: [{
                    text: JSON.stringify({
                        improvements: [
                            {
                                category: 'performance',
                                priority: 'high',
                                title: 'Add index',
                                description: 'Add index on email column',
                                implementation: 'CREATE INDEX idx_email ON users(email)'
                            }
                        ],
                        score: 85,
                        summary: 'Good schema with minor improvements needed'
                    })
                }]
            });

            const result = await generator.suggestImprovements(mockBlogSchema, 'Web application');

            expect(result.success).toBe(true);
            expect(result.improvements).toBeDefined();
            expect(result.improvements.improvements).toBeDefined();
        });

        test('should handle improvement suggestion errors', async () => {
            mockAnthropicClient.messages.create.mockRejectedValueOnce(new Error('API Error'));

            await expect(generator.suggestImprovements(mockBlogSchema))
                .rejects.toThrow('API Error');
        });
    });
});
