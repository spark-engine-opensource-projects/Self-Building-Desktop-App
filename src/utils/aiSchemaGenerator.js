const logger = require('./logger');
const configManager = require('./configManager');

class AISchemaGenerator {
    constructor(anthropic) {
        this.anthropic = anthropic;
    }

    /**
     * Generate database schema from natural language description
     */
    async generateSchema(description) {
        try {
            const prompt = this.buildSchemaPrompt(description);
            const aiConfig = configManager.get('ai') || {};
            const model = aiConfig.model || 'claude-opus-4-5-20251101';

            const response = await this.anthropic.messages.create({
                model: model,
                max_tokens: 4000,
                temperature: 0.1,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            const schemaText = response.content[0].text;
            const schema = this.parseSchemaResponse(schemaText);
            
            logger.info('AI schema generated successfully', { 
                description: description.substring(0, 100),
                tables: Object.keys(schema.tables).length
            });

            return {
                success: true,
                schema: schema,
                description: description,
                raw_response: schemaText
            };
        } catch (error) {
            logger.error('Failed to generate schema', { description, error });
            throw error;
        }
    }

    /**
     * Build the prompt for schema generation
     */
    buildSchemaPrompt(description) {
        return `You are an expert database designer for SQLite. Create a database schema based on:

"${description}"

**STRICT REQUIREMENTS:**

1. Use ONLY these SQLite types: string, integer, number (for decimals), boolean, date, json
2. Use snake_case for all table and column names (e.g., user_profile, created_at)
3. Keep table names singular or plural consistently (prefer plural: users, orders, products)
4. Every table should have sensible indexes on frequently queried columns
5. Include 2-3 realistic sample records per table

**Schema Format:**
\`\`\`json
{
  "database_name": "descriptive_name",
  "description": "Brief description",
  "tables": {
    "users": {
      "description": "What this table stores",
      "columns": {
        "email": {
          "type": "string",
          "required": true,
          "unique": true,
          "description": "User email address"
        },
        "name": {
          "type": "string",
          "required": true
        },
        "age": {
          "type": "integer",
          "default": 0
        },
        "balance": {
          "type": "number"
        },
        "is_active": {
          "type": "boolean",
          "default": true
        },
        "settings": {
          "type": "json"
        }
      },
      "constraints": [
        {
          "type": "foreign_key",
          "column": "role_id",
          "references": {"table": "roles", "column": "id"}
        },
        {
          "type": "unique",
          "columns": ["email", "tenant_id"]
        },
        {
          "type": "check",
          "condition": "age >= 0"
        }
      ],
      "indexes": [
        {"name": "idx_users_email", "columns": ["email"], "unique": true},
        {"name": "idx_users_name", "columns": ["name"], "unique": false}
      ],
      "sample_data": [
        {"email": "john@example.com", "name": "John Doe", "age": 30}
      ]
    }
  },
  "relationships": [
    {
      "type": "one_to_many",
      "from_table": "users",
      "to_table": "orders",
      "description": "User has many orders"
    }
  ]
}
\`\`\`

**Column Types Reference:**
- string: Text data (names, emails, descriptions)
- integer: Whole numbers (counts, IDs, booleans stored as 0/1)
- number: Decimal numbers (prices, percentages, measurements)
- boolean: True/false (stored as INTEGER 0/1 in SQLite)
- date: Date/datetime strings (ISO format recommended)
- json: JSON objects stored as TEXT

**Design Principles:**
- Normalize to 3NF unless denormalization improves common queries
- Add indexes on: foreign keys, columns used in WHERE/ORDER BY, unique columns
- Use meaningful defaults (0 for counts, empty string for optional text, current timestamp for dates)
- Consider soft deletes (is_deleted column) instead of hard deletes for audit trails

**Important:** Return ONLY the JSON schema, no additional text.`;
    }

    /**
     * Parse the AI response and extract schema
     */
    parseSchemaResponse(response) {
        try {
            // Extract JSON from response (handle code blocks)
            const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            const jsonText = jsonMatch ? jsonMatch[1] : response;
            
            const schema = JSON.parse(jsonText);
            
            // Validate schema structure
            this.validateSchema(schema);
            
            return schema;
        } catch (error) {
            logger.error('Failed to parse schema response', { response, error });
            throw new Error(`Invalid schema format: ${error.message}`);
        }
    }

    /**
     * Validate and automatically fix common schema issues
     */
    validateAndFixSchema(schema) {
        if (!schema.tables || typeof schema.tables !== 'object') {
            throw new Error('Schema must contain a tables object');
        }

        // Type mapping from common variations to SQLite types
        const typeMapping = {
            'string': 'TEXT',
            'text': 'TEXT',
            'varchar': 'TEXT',
            'char': 'TEXT',
            'integer': 'INTEGER',
            'int': 'INTEGER',
            'number': 'REAL',
            'float': 'REAL',
            'double': 'REAL',
            'real': 'REAL',
            'boolean': 'INTEGER',
            'bool': 'INTEGER',
            'date': 'TEXT',
            'datetime': 'TEXT',
            'timestamp': 'TEXT',
            'json': 'TEXT',
            'blob': 'BLOB'
        };

        Object.entries(schema.tables).forEach(([tableName, table]) => {
            if (!table.columns || typeof table.columns !== 'object') {
                throw new Error(`Table ${tableName} must contain columns`);
            }

            // Ensure table has an id column
            const columns = table.columns;
            if (!columns.id && !Object.values(columns).some(col => col.primaryKey)) {
                logger.info(`Adding auto-increment id column to table ${tableName}`);
                table.columns = {
                    id: {
                        type: 'INTEGER',
                        primaryKey: true,
                        autoIncrement: true,
                        description: 'Primary key'
                    },
                    ...table.columns
                };
            }

            // Fix column types and add timestamps
            let hasCreatedAt = false;
            let hasUpdatedAt = false;

            Object.entries(table.columns).forEach(([columnName, column]) => {
                if (!column.type) {
                    throw new Error(`Column ${tableName}.${columnName} must have a type`);
                }

                // Convert type to SQLite-compatible type
                const lowerType = column.type.toLowerCase();
                if (typeMapping[lowerType]) {
                    column.type = typeMapping[lowerType];
                } else {
                    logger.warn(`Unknown column type ${column.type} for ${tableName}.${columnName}, defaulting to TEXT`);
                    column.type = 'TEXT';
                }

                // Track timestamp columns
                if (columnName === 'created_at') hasCreatedAt = true;
                if (columnName === 'updated_at') hasUpdatedAt = true;
            });

            // Add created_at and updated_at if not present
            if (!hasCreatedAt) {
                table.columns.created_at = {
                    type: 'TEXT',
                    default: 'CURRENT_TIMESTAMP',
                    description: 'Record creation timestamp'
                };
            }

            if (!hasUpdatedAt) {
                table.columns.updated_at = {
                    type: 'TEXT',
                    default: 'CURRENT_TIMESTAMP',
                    description: 'Record update timestamp'
                };
            }

            // Validate foreign key references
            if (table.constraints && Array.isArray(table.constraints)) {
                table.constraints.forEach(constraint => {
                    if (constraint.type === 'foreign_key') {
                        const refTable = constraint.references?.table;
                        if (refTable && !schema.tables[refTable]) {
                            logger.warn(`Foreign key references non-existent table: ${refTable}`);
                        }
                    }
                });
            }
        });

        return schema;
    }

    /**
     * Validate schema structure (legacy method, now calls validateAndFixSchema)
     */
    validateSchema(schema) {
        return this.validateAndFixSchema(schema);
    }

    /**
     * Generate sample SQL INSERT statements from schema
     */
    generateSampleInserts(schema) {
        const inserts = [];

        Object.entries(schema.tables).forEach(([tableName, table]) => {
            if (table.sample_data && Array.isArray(table.sample_data)) {
                table.sample_data.forEach(record => {
                    const columns = Object.keys(record).join(', ');
                    const values = Object.values(record)
                        .map(val => typeof val === 'string' ? `'${val}'` : val)
                        .join(', ');
                    
                    inserts.push(`INSERT INTO ${tableName} (${columns}) VALUES (${values});`);
                });
            }
        });

        return inserts;
    }

    /**
     * Generate CREATE INDEX statements from schema
     */
    generateIndexes(schema) {
        const indexes = [];

        Object.entries(schema.tables).forEach(([tableName, table]) => {
            if (table.indexes && Array.isArray(table.indexes)) {
                table.indexes.forEach(index => {
                    const uniqueClause = index.unique ? 'UNIQUE ' : '';
                    const columns = index.columns.join(', ');
                    indexes.push(
                        `CREATE ${uniqueClause}INDEX ${index.name} ON ${tableName} (${columns});`
                    );
                });
            }
        });

        return indexes;
    }

    /**
     * Generate complete database setup script
     */
    async generateDatabaseScript(description) {
        try {
            const schemaResult = await this.generateSchema(description);
            const schema = schemaResult.schema;

            const script = {
                description: schema.description,
                database_name: schema.database_name,
                tables: [],
                indexes: this.generateIndexes(schema),
                sample_inserts: this.generateSampleInserts(schema),
                relationships: schema.relationships || []
            };

            // Generate CREATE TABLE statements
            Object.entries(schema.tables).forEach(([tableName, table]) => {
                script.tables.push({
                    name: tableName,
                    description: table.description,
                    schema: {
                        columns: table.columns,
                        constraints: table.constraints || []
                    }
                });
            });

            return {
                success: true,
                script: script,
                raw_schema: schema
            };
        } catch (error) {
            logger.error('Failed to generate database script', { description, error });
            throw error;
        }
    }

    /**
     * Generate data model code (for AI code generation)
     */
    generateDataModel(schema) {
        const models = {};

        Object.entries(schema.tables).forEach(([tableName, table]) => {
            const className = this.toPascalCase(tableName);
            
            models[className] = {
                tableName: tableName,
                columns: table.columns,
                relationships: this.extractTableRelationships(tableName, schema.relationships || []),
                methods: this.generateModelMethods(tableName, table.columns)
            };
        });

        return models;
    }

    /**
     * Extract relationships for a specific table
     */
    extractTableRelationships(tableName, relationships) {
        return relationships.filter(rel => 
            rel.from_table === tableName || rel.to_table === tableName
        );
    }

    /**
     * Generate common model methods
     */
    generateModelMethods(tableName, columns) {
        const methods = [];
        const columnNames = Object.keys(columns);

        // Generate finder methods for unique columns
        columnNames.forEach(columnName => {
            const column = columns[columnName];
            if (column.unique || columnName === 'email' || columnName === 'username') {
                methods.push({
                    name: `findBy${this.toPascalCase(columnName)}`,
                    type: 'finder',
                    column: columnName
                });
            }
        });

        // Generate validation methods
        methods.push({
            name: 'validate',
            type: 'validator',
            columns: columnNames.filter(col => columns[col].required)
        });

        return methods;
    }

    /**
     * Convert string to PascalCase
     */
    toPascalCase(str) {
        return str
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
    }

    /**
     * Suggest schema improvements
     */
    async suggestImprovements(schema, context = '') {
        try {
            const prompt = `Analyze this database schema and suggest improvements:

Schema:
${JSON.stringify(schema, null, 2)}

Context: ${context}

Please provide specific suggestions for:
1. **Performance**: Indexing, query optimization
2. **Security**: Data protection, access control
3. **Scalability**: Future growth considerations  
4. **Data Integrity**: Constraints, validation
5. **Maintainability**: Naming, structure

Format as JSON:
{
  "improvements": [
    {
      "category": "performance|security|scalability|integrity|maintainability",
      "priority": "high|medium|low",
      "title": "Brief improvement title",
      "description": "Detailed explanation",
      "implementation": "How to implement this change"
    }
  ],
  "score": 85,
  "summary": "Overall assessment"
}`;

            const aiConfig = configManager.get('ai') || {};
            const model = aiConfig.model || 'claude-opus-4-5-20251101';

            const response = await this.anthropic.messages.create({
                model: model,
                max_tokens: 2000,
                temperature: 0.1,
                messages: [{ role: 'user', content: prompt }]
            });

            const improvementsText = response.content[0].text;
            const jsonMatch = improvementsText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            const improvements = JSON.parse(jsonMatch ? jsonMatch[1] : improvementsText);

            return {
                success: true,
                improvements: improvements
            };
        } catch (error) {
            logger.error('Failed to generate schema improvements', { error });
            throw error;
        }
    }
}

module.exports = AISchemaGenerator;