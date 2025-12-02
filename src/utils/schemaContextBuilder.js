/**
 * SchemaContextBuilder
 * Builds comprehensive schema context for AI prompts with caching
 * Enables AI to understand existing database structure and relationships
 */

const logger = require('./logger');
const { DATABASE } = require('../config/constants');

class SchemaContextBuilder {
    constructor(databaseManager) {
        this.databaseManager = databaseManager;

        // Cache configuration
        this.cache = {
            context: null,
            schemas: null,
            timestamp: 0
        };
        this.cacheTTL = DATABASE.SCHEMA_CACHE_TTL_MS || 60000; // 1 minute default
    }

    /**
     * Check if cache is still valid
     * @returns {boolean}
     */
    isCacheValid() {
        return this.cache.timestamp > 0 &&
               (Date.now() - this.cache.timestamp) < this.cacheTTL;
    }

    /**
     * Clear the cache
     */
    clearCache() {
        this.cache = {
            context: null,
            schemas: null,
            timestamp: 0
        };
        logger.debug('Schema context cache cleared');
    }

    /**
     * Get all schemas with caching
     * @param {string} dbName - Database name
     * @returns {Promise<Object>} - Schema information
     */
    async getSchemas(dbName = DATABASE.SHARED_DB_NAME) {
        if (this.isCacheValid() && this.cache.schemas) {
            logger.debug('Using cached schemas');
            return this.cache.schemas;
        }

        const result = await this.databaseManager.getAllSchemas(dbName);

        if (result.success) {
            this.cache.schemas = result.schemas;
            this.cache.timestamp = Date.now();
        }

        return result.schemas || {};
    }

    /**
     * Build comprehensive schema context for AI prompts
     * @param {string} dbName - Database name
     * @param {Object} options - Options for context building
     * @returns {Promise<string>} - Formatted context string
     */
    async buildContext(dbName = DATABASE.SHARED_DB_NAME, options = {}) {
        const {
            includeSSampleData = true,
            maxTables = DATABASE.MAX_SCHEMA_CONTEXT_TABLES || 20,
            maxSamplesPerTable = DATABASE.MAX_SAMPLE_ROWS_PER_TABLE || 3,
            relevantTables = null // Optional: filter to specific tables
        } = options;

        // Use cached context if available and no specific filter
        if (this.isCacheValid() && this.cache.context && !relevantTables) {
            logger.debug('Using cached schema context');
            return this.cache.context;
        }

        try {
            const schemas = await this.getSchemas(dbName);
            const tableNames = Object.keys(schemas);

            // Filter to relevant tables if specified
            let tablesToInclude = relevantTables
                ? tableNames.filter(t => relevantTables.includes(t))
                : tableNames.slice(0, maxTables);

            let context = this.buildContextHeader(dbName, tableNames.length);

            for (const tableName of tablesToInclude) {
                const tableSchema = schemas[tableName];
                context += await this.buildTableContext(
                    dbName,
                    tableName,
                    tableSchema,
                    includeSSampleData,
                    maxSamplesPerTable
                );
            }

            if (tableNames.length > maxTables && !relevantTables) {
                context += `\n... and ${tableNames.length - maxTables} more tables.\n`;
            }

            // Add relationship summary
            context += this.buildRelationshipSummary(schemas);

            // Cache the result (only if not filtered)
            if (!relevantTables) {
                this.cache.context = context;
                this.cache.timestamp = Date.now();
            }

            return context;
        } catch (error) {
            logger.error('Failed to build schema context', { error });
            return '## No database schema available\n';
        }
    }

    /**
     * Build the context header
     * @param {string} dbName - Database name
     * @param {number} tableCount - Number of tables
     * @returns {string}
     */
    buildContextHeader(dbName, tableCount) {
        return `## Existing Database Schema

Database: ${dbName}
Total tables: ${tableCount}

**IMPORTANT**: When generating code that needs data storage:
1. REUSE existing tables when the data model matches your needs
2. CREATE foreign key relationships to existing tables when appropriate
3. DO NOT create duplicate tables for data that already exists
4. If you need to add columns, create a related table instead of modifying existing ones

`;
    }

    /**
     * Build context for a single table
     * @param {string} dbName - Database name
     * @param {string} tableName - Table name
     * @param {Object} tableSchema - Table schema
     * @param {boolean} includeSampleData - Whether to include sample data
     * @param {number} maxSamples - Max sample rows
     * @returns {Promise<string>}
     */
    async buildTableContext(dbName, tableName, tableSchema, includeSampleData, maxSamples) {
        let context = `### Table: ${tableName}\n`;

        // Add ownership info
        if (tableSchema.owner) {
            context += `Owner App: ${tableSchema.owner.appName || tableSchema.owner.appId}\n`;
            if (tableSchema.owner.description) {
                context += `Purpose: ${tableSchema.owner.description}\n`;
            }
        }

        // Add columns
        context += `Columns:\n`;
        for (const [colName, colDef] of Object.entries(tableSchema.columns || {})) {
            const type = colDef.type || 'string';
            const constraints = [];
            if (colDef.required) constraints.push('NOT NULL');
            if (colDef.unique) constraints.push('UNIQUE');
            if (colDef.primaryKey) constraints.push('PRIMARY KEY');
            if (colDef.default !== undefined) constraints.push(`DEFAULT ${colDef.default}`);

            context += `  - ${colName}: ${type}${constraints.length ? ' (' + constraints.join(', ') + ')' : ''}\n`;
        }

        // Add relationships
        if (tableSchema.relationships && tableSchema.relationships.length > 0) {
            context += `Relationships:\n`;
            for (const rel of tableSchema.relationships) {
                const direction = rel.direction === 'outgoing' ? '→' : '←';
                context += `  ${direction} ${rel.table_name} (${rel.relationship_type})\n`;
            }
        }

        // Add sample data
        if (includeSampleData) {
            try {
                const sampleData = await this.databaseManager.queryData(dbName, tableName, { limit: maxSamples });

                if (sampleData.success && sampleData.data.length > 0) {
                    context += `Sample data (${sampleData.data.length} rows):\n`;
                    context += '```json\n';
                    context += JSON.stringify(sampleData.data, null, 2);
                    context += '\n```\n';
                }
            } catch (e) {
                // Skip sample data if query fails
            }
        }

        context += '\n';
        return context;
    }

    /**
     * Build a summary of all relationships
     * @param {Object} schemas - All table schemas
     * @returns {string}
     */
    buildRelationshipSummary(schemas) {
        const relationships = new Set();

        for (const [tableName, schema] of Object.entries(schemas)) {
            if (schema.relationships) {
                for (const rel of schema.relationships) {
                    if (rel.direction === 'outgoing') {
                        relationships.add(`${tableName} → ${rel.table_name} (${rel.relationship_type})`);
                    }
                }
            }
        }

        if (relationships.size === 0) {
            return '';
        }

        let summary = '## Data Relationships\n\n';
        for (const rel of relationships) {
            summary += `- ${rel}\n`;
        }
        summary += '\n';

        return summary;
    }

    /**
     * Detect which existing tables might be relevant to a user prompt
     * Uses simple keyword matching to identify potentially related tables
     * @param {string} prompt - User's prompt
     * @param {Object} schemas - Database schemas
     * @returns {string[]} - Array of relevant table names
     */
    detectRelevantTables(prompt, schemas) {
        const promptLower = prompt.toLowerCase();
        const relevantTables = [];

        // Keywords that suggest data relationships
        const relationshipKeywords = [
            'link', 'connect', 'related', 'relationship', 'join',
            'from', 'with', 'using', 'associated', 'reference'
        ];

        const hasRelationshipIntent = relationshipKeywords.some(kw => promptLower.includes(kw));

        for (const [tableName, schema] of Object.entries(schemas)) {
            const tableNameLower = tableName.toLowerCase();

            // Check if table name appears in prompt
            if (promptLower.includes(tableNameLower)) {
                relevantTables.push(tableName);
                continue;
            }

            // Check if any column names appear in prompt
            for (const colName of Object.keys(schema.columns || {})) {
                if (promptLower.includes(colName.toLowerCase())) {
                    relevantTables.push(tableName);
                    break;
                }
            }

            // If relationship intent detected, include related tables
            if (hasRelationshipIntent && schema.relationships) {
                for (const rel of schema.relationships) {
                    if (relevantTables.includes(rel.table_name)) {
                        relevantTables.push(tableName);
                        break;
                    }
                }
            }
        }

        return [...new Set(relevantTables)]; // Remove duplicates
    }

    /**
     * Build context specifically tailored to a user's prompt
     * @param {string} prompt - User's prompt
     * @param {string} dbName - Database name
     * @returns {Promise<string>}
     */
    async buildPromptAwareContext(prompt, dbName = DATABASE.SHARED_DB_NAME) {
        try {
            const schemas = await this.getSchemas(dbName);
            const tableNames = Object.keys(schemas);

            if (tableNames.length === 0) {
                return '## No existing database tables\n\nThis is a fresh database. You may create any tables needed for the application.\n';
            }

            // Detect which tables might be relevant
            const relevantTables = this.detectRelevantTables(prompt, schemas);

            if (relevantTables.length > 0) {
                // Build focused context with relevant tables first
                let context = this.buildContextHeader(dbName, tableNames.length);
                context += `### Tables potentially relevant to your request:\n\n`;

                for (const tableName of relevantTables) {
                    context += await this.buildTableContext(
                        dbName,
                        tableName,
                        schemas[tableName],
                        true,
                        DATABASE.MAX_SAMPLE_ROWS_PER_TABLE || 3
                    );
                }

                // Add summary of other tables
                const otherTables = tableNames.filter(t => !relevantTables.includes(t));
                if (otherTables.length > 0) {
                    context += `### Other available tables:\n`;
                    for (const tableName of otherTables.slice(0, 10)) {
                        const cols = Object.keys(schemas[tableName].columns || {}).slice(0, 5);
                        context += `- ${tableName} (columns: ${cols.join(', ')}${cols.length >= 5 ? '...' : ''})\n`;
                    }
                    if (otherTables.length > 10) {
                        context += `  ... and ${otherTables.length - 10} more tables\n`;
                    }
                }

                context += this.buildRelationshipSummary(schemas);
                return context;
            }

            // No specific relevance detected, return full context
            return await this.buildContext(dbName);
        } catch (error) {
            logger.error('Failed to build prompt-aware context', { error });
            return await this.buildContext(dbName);
        }
    }

    /**
     * Get a quick summary of the database for lightweight context
     * @param {string} dbName - Database name
     * @returns {Promise<string>}
     */
    async getQuickSummary(dbName = DATABASE.SHARED_DB_NAME) {
        try {
            const schemas = await this.getSchemas(dbName);
            const tableNames = Object.keys(schemas);

            if (tableNames.length === 0) {
                return 'Database is empty - no tables exist yet.';
            }

            let summary = `Database has ${tableNames.length} table(s): `;
            summary += tableNames.slice(0, 5).join(', ');
            if (tableNames.length > 5) {
                summary += `, and ${tableNames.length - 5} more`;
            }

            return summary;
        } catch (error) {
            return 'Database schema unavailable.';
        }
    }

    /**
     * Suggest which existing tables to reuse based on a new table schema
     * @param {Object} newSchema - The proposed new table schema
     * @param {string} dbName - Database name
     * @returns {Promise<Object>} - Suggestions for reusing existing tables
     */
    async suggestTableReuse(newSchema, dbName = DATABASE.SHARED_DB_NAME) {
        try {
            const schemas = await this.getSchemas(dbName);
            const suggestions = {
                exactMatch: null,
                similarTables: [],
                potentialRelationships: []
            };

            const newColumns = Object.keys(newSchema.columns || {});

            for (const [tableName, existingSchema] of Object.entries(schemas)) {
                const existingColumns = Object.keys(existingSchema.columns || {});

                // Check for column overlap
                const overlap = newColumns.filter(c => existingColumns.includes(c));
                const overlapRatio = overlap.length / Math.max(newColumns.length, existingColumns.length);

                if (overlapRatio > 0.8) {
                    // Very similar - might be duplicate
                    suggestions.exactMatch = {
                        tableName,
                        matchingColumns: overlap,
                        reason: 'This table has very similar structure'
                    };
                } else if (overlapRatio > 0.3) {
                    // Some overlap - might want to create relationship
                    suggestions.similarTables.push({
                        tableName,
                        matchingColumns: overlap,
                        reason: 'Consider creating a relationship instead of duplicating data'
                    });
                }

                // Check for potential foreign key relationships
                for (const col of newColumns) {
                    if (col.endsWith('_id') || col.endsWith('Id')) {
                        const potentialTable = col.replace(/_id$/i, '').replace(/Id$/, '');
                        if (tableName.toLowerCase() === potentialTable.toLowerCase() ||
                            tableName.toLowerCase() === potentialTable.toLowerCase() + 's') {
                            suggestions.potentialRelationships.push({
                                column: col,
                                referencesTable: tableName,
                                reason: `Column ${col} likely references ${tableName}`
                            });
                        }
                    }
                }
            }

            return suggestions;
        } catch (error) {
            logger.error('Failed to suggest table reuse', { error });
            return { exactMatch: null, similarTables: [], potentialRelationships: [] };
        }
    }
}

module.exports = SchemaContextBuilder;
