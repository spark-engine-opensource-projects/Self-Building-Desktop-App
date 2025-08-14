const logger = require('./logger');

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
            
            const response = await this.anthropic.messages.create({
                model: 'claude-3-5-sonnet-20241022',
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
        return `You are an expert database designer. Create a comprehensive database schema based on the following description:

"${description}"

Please provide a detailed database schema in JSON format that includes:

1. **Tables**: All necessary tables with proper relationships
2. **Columns**: Appropriate data types and constraints
3. **Relationships**: Foreign keys and relationships between tables
4. **Indexes**: Suggested indexes for performance
5. **Sample Data**: A few example records for each table

**Schema Format:**
\`\`\`json
{
  "database_name": "descriptive_name",
  "description": "Brief description of the database purpose",
  "tables": {
    "table_name": {
      "description": "What this table stores",
      "columns": {
        "column_name": {
          "type": "string|integer|number|boolean|date|json",
          "required": true|false,
          "unique": true|false,
          "default": "default_value",
          "description": "Column purpose"
        }
      },
      "constraints": [
        {
          "type": "foreign_key",
          "column": "foreign_column",
          "references": {
            "table": "other_table",
            "column": "id"
          }
        }
      ],
      "indexes": [
        {
          "name": "idx_name",
          "columns": ["column1", "column2"],
          "unique": true|false
        }
      ],
      "sample_data": [
        {
          "column_name": "sample_value"
        }
      ]
    }
  },
  "relationships": [
    {
      "type": "one_to_many|many_to_many|one_to_one",
      "from_table": "table1",
      "to_table": "table2",
      "description": "Relationship description"
    }
  ]
}
\`\`\`

**Guidelines:**
- Use appropriate SQLite-compatible data types
- Include proper foreign key relationships
- Add reasonable default values where appropriate
- Create meaningful sample data that demonstrates the schema
- Include common fields like created_at, updated_at where relevant
- Design for scalability and data integrity
- Use descriptive but concise names

**Important:** Return ONLY the JSON schema, no additional text or explanations.`;
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
     * Validate schema structure
     */
    validateSchema(schema) {
        if (!schema.tables || typeof schema.tables !== 'object') {
            throw new Error('Schema must contain a tables object');
        }

        Object.entries(schema.tables).forEach(([tableName, table]) => {
            if (!table.columns || typeof table.columns !== 'object') {
                throw new Error(`Table ${tableName} must contain columns`);
            }

            Object.entries(table.columns).forEach(([columnName, column]) => {
                if (!column.type) {
                    throw new Error(`Column ${tableName}.${columnName} must have a type`);
                }

                const validTypes = ['string', 'integer', 'number', 'boolean', 'date', 'json', 'blob'];
                if (!validTypes.includes(column.type)) {
                    throw new Error(`Invalid column type: ${column.type}`);
                }
            });
        });
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

            const response = await this.anthropic.messages.create({
                model: 'claude-3-5-sonnet-20241022',
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