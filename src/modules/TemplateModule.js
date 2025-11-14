const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');
const Handlebars = require('handlebars');
const { marked } = require('marked');
const yaml = require('js-yaml');

/**
 * TemplateModule - Project and code template management system
 * Provides template creation, customization, and generation capabilities
 */
class TemplateModule extends EventEmitter {
    constructor() {
        super();
        this.templates = new Map();
        this.categories = new Map();
        this.customHelpers = new Map();
        this.customPartials = new Map();
        this.templatePath = '';
        this.userTemplatesPath = '';
        this.communityTemplatesPath = '';
        this.templateCache = new Map();
        this.metadata = new Map();
        this.variables = new Map();
        this.handlebars = Handlebars.create();
    }

    /**
     * Initialize template module
     */
    async initialize(config = {}) {
        try {
            this.templatePath = config.templatePath || path.join(process.cwd(), 'templates');
            this.userTemplatesPath = config.userTemplatesPath || path.join(this.templatePath, 'user');
            this.communityTemplatesPath = config.communityTemplatesPath || path.join(this.templatePath, 'community');
            
            // Create template directories if they don't exist
            await this.ensureDirectories();
            
            // Load built-in templates
            await this.loadBuiltInTemplates();
            
            // Load user templates
            await this.loadUserTemplates();
            
            // Register default Handlebars helpers
            this.registerDefaultHelpers();
            
            // Register default partials
            await this.registerDefaultPartials();
            
            console.log('Template module initialized');
            this.emit('initialized');
            
            return { success: true, templateCount: this.templates.size };
        } catch (error) {
            console.error('Failed to initialize template module:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Ensure template directories exist
     */
    async ensureDirectories() {
        const dirs = [
            this.templatePath,
            this.userTemplatesPath,
            this.communityTemplatesPath,
            path.join(this.templatePath, 'builtin'),
            path.join(this.templatePath, 'cache')
        ];
        
        for (const dir of dirs) {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    /**
     * Load built-in templates
     */
    async loadBuiltInTemplates() {
        const builtInTemplates = {
            // React Component Template
            'react-component': {
                category: 'react',
                name: 'React Component',
                description: 'Create a new React component',
                variables: {
                    componentName: { type: 'string', required: true },
                    useState: { type: 'boolean', default: false },
                    useEffect: { type: 'boolean', default: false },
                    typescript: { type: 'boolean', default: false }
                },
                files: {
                    'component.jsx': `import React{{#if useState}}, { useState }{{/if}}{{#if useEffect}}, { useEffect }{{/if}} from 'react';
{{#if typescript}}
interface {{componentName}}Props {
    // Define props here
}
{{/if}}

const {{componentName}}{{#if typescript}}: React.FC<{{componentName}}Props>{{/if}} = (props) => {
    {{#if useState}}
    const [state, setState] = useState(initialState);
    {{/if}}
    
    {{#if useEffect}}
    useEffect(() => {
        // Component did mount
        return () => {
            // Component will unmount
        };
    }, []);
    {{/if}}
    
    return (
        <div className="{{kebabCase componentName}}">
            <h1>{{componentName}}</h1>
            {/* Component content */}
        </div>
    );
};

export default {{componentName}};`,
                    'component.css': `.{{kebabCase componentName}} {
    /* Component styles */
}`,
                    'component.test.js': `import React from 'react';
import { render, screen } from '@testing-library/react';
import {{componentName}} from './{{componentName}}';

describe('{{componentName}}', () => {
    test('renders component', () => {
        render(<{{componentName}} />);
        const element = screen.getByText(/{{componentName}}/i);
        expect(element).toBeInTheDocument();
    });
});`
                }
            },
            
            // Express API Template
            'express-api': {
                category: 'node',
                name: 'Express API',
                description: 'Create an Express.js REST API',
                variables: {
                    projectName: { type: 'string', required: true },
                    database: { type: 'select', options: ['none', 'mongodb', 'postgresql', 'mysql'], default: 'none' },
                    authentication: { type: 'boolean', default: false },
                    typescript: { type: 'boolean', default: false }
                },
                files: {
                    'package.json': `{
    "name": "{{kebabCase projectName}}",
    "version": "1.0.0",
    "description": "{{projectName}} API",
    "main": "{{#if typescript}}dist/{{/if}}index.js",
    "scripts": {
        {{#if typescript}}
        "build": "tsc",
        "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
        {{else}}
        "dev": "nodemon index.js",
        {{/if}}
        "start": "node {{#if typescript}}dist/{{/if}}index.js",
        "test": "jest"
    },
    "dependencies": {
        "express": "^4.18.0",
        "cors": "^2.8.5",
        "dotenv": "^16.0.0"{{#if database}},{{/if}}
        {{#equals database "mongodb"}}
        "mongoose": "^7.0.0"
        {{/equals}}
        {{#equals database "postgresql"}}
        "pg": "^8.10.0",
        "sequelize": "^6.30.0"
        {{/equals}}
        {{#equals database "mysql"}}
        "mysql2": "^3.2.0",
        "sequelize": "^6.30.0"
        {{/equals}}
        {{#if authentication}},
        "jsonwebtoken": "^9.0.0",
        "bcryptjs": "^2.4.3"
        {{/if}}
    },
    "devDependencies": {
        {{#if typescript}}
        "typescript": "^5.0.0",
        "@types/node": "^18.0.0",
        "@types/express": "^4.17.17",
        "ts-node-dev": "^2.0.0",
        {{else}}
        "nodemon": "^2.0.0",
        {{/if}}
        "jest": "^29.0.0"
    }
}`,
                    'index.js': `{{#if typescript}}import{{else}}const{{/if}} express{{#unless typescript}} = require('express'){{/unless}};
{{#if typescript}}import{{else}}const{{/if}} cors{{#unless typescript}} = require('cors'){{/unless}};
{{#if typescript}}import{{else}}const{{/if}} dotenv{{#unless typescript}} = require('dotenv'){{/unless}};
{{#if database}}
{{#equals database "mongodb"}}
{{#if typescript}}import{{else}}const{{/if}} mongoose{{#unless typescript}} = require('mongoose'){{/unless}};
{{/equals}}
{{#equals database "postgresql"}}
{{#if typescript}}import{{else}}const{{/if}} { Sequelize }{{#unless typescript}} = require('sequelize'){{/unless}};
{{/equals}}
{{/if}}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

{{#if database}}
// Database connection
{{#equals database "mongodb"}}
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/{{kebabCase projectName}}')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));
{{/equals}}
{{#equals database "postgresql"}}
const sequelize = new Sequelize(process.env.DATABASE_URL || 'postgres://localhost/{{kebabCase projectName}}');
sequelize.authenticate()
    .then(() => console.log('Connected to PostgreSQL'))
    .catch(err => console.error('PostgreSQL connection error:', err));
{{/equals}}
{{/if}}

// Routes
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to {{projectName}} API' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
});

{{#if typescript}}export default{{else}}module.exports =
{{/if}} app;`,
                    '.env': `PORT=3000
NODE_ENV=development
{{#if database}}
{{#equals database "mongodb"}}
MONGODB_URI=mongodb://localhost/{{kebabCase projectName}}
{{/equals}}
{{#equals database "postgresql"}}
DATABASE_URL=postgres://localhost/{{kebabCase projectName}}
{{/equals}}
{{#equals database "mysql"}}
DATABASE_URL=mysql://localhost/{{kebabCase projectName}}
{{/equals}}
{{/if}}
{{#if authentication}}
JWT_SECRET={{generateSecret}}
JWT_EXPIRE=7d
{{/if}}`
                }
            },
            
            // Python Flask Template
            'python-flask': {
                category: 'python',
                name: 'Flask Application',
                description: 'Create a Flask web application',
                variables: {
                    projectName: { type: 'string', required: true },
                    database: { type: 'boolean', default: false },
                    restful: { type: 'boolean', default: true }
                },
                files: {
                    'app.py': `from flask import Flask, jsonify{{#if database}}, g{{/if}}
{{#if restful}}from flask_restful import Api, Resource{{/if}}
{{#if database}}import sqlite3{{/if}}
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')
{{#if restful}}
api = Api(app)
{{/if}}

{{#if database}}
DATABASE = '{{kebabCase projectName}}.db'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()
{{/if}}

{{#if restful}}
class HelloWorld(Resource):
    def get(self):
        return {'message': 'Hello from {{projectName}}!'}

api.add_resource(HelloWorld, '/')
{{else}}
@app.route('/')
def hello():
    return jsonify({'message': 'Hello from {{projectName}}!'})
{{/if}}

@app.route('/health')
def health():
    return jsonify({'status': 'OK'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)`,
                    'requirements.txt': `Flask==2.3.0
{{#if restful}}Flask-RESTful==0.3.10{{/if}}
{{#if database}}Flask-SQLAlchemy==3.0.0{{/if}}
python-dotenv==1.0.0
pytest==7.3.0`,
                    '.env': `FLASK_APP=app.py
FLASK_ENV=development
SECRET_KEY={{generateSecret}}`
                }
            },
            
            // HTML/CSS/JS Template
            'html-css-js': {
                category: 'web',
                name: 'HTML/CSS/JavaScript',
                description: 'Create a basic web page',
                variables: {
                    title: { type: 'string', required: true },
                    bootstrap: { type: 'boolean', default: false },
                    jquery: { type: 'boolean', default: false }
                },
                files: {
                    'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{title}}</title>
    {{#if bootstrap}}
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    {{/if}}
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    {{#if bootstrap}}<div class="container">{{/if}}
    <header>
        <h1>{{title}}</h1>
        <nav>
            <ul>
                <li><a href="#home">Home</a></li>
                <li><a href="#about">About</a></li>
                <li><a href="#contact">Contact</a></li>
            </ul>
        </nav>
    </header>
    
    <main>
        <section id="home">
            <h2>Welcome</h2>
            <p>This is your new website!</p>
        </section>
    </main>
    
    <footer>
        <p>&copy; {{currentYear}} {{title}}. All rights reserved.</p>
    </footer>
    {{#if bootstrap}}</div>{{/if}}
    
    {{#if jquery}}
    <script src="https://code.jquery.com/jquery-3.7.0.min.js"></script>
    {{/if}}
    {{#if bootstrap}}
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    {{/if}}
    <script src="script.js"></script>
</body>
</html>`,
                    'styles.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    line-height: 1.6;
    color: #333;
}

header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 2rem 0;
    text-align: center;
}

nav ul {
    list-style: none;
    display: flex;
    justify-content: center;
    gap: 2rem;
    margin-top: 1rem;
}

nav a {
    color: white;
    text-decoration: none;
    transition: opacity 0.3s;
}

nav a:hover {
    opacity: 0.8;
}

main {
    max-width: 1200px;
    margin: 2rem auto;
    padding: 0 1rem;
}

footer {
    background: #f4f4f4;
    text-align: center;
    padding: 1rem;
    position: fixed;
    bottom: 0;
    width: 100%;
}`,
                    'script.js': `{{#if jquery}}
$(document).ready(function() {
    console.log('{{title}} loaded!');
    
    // Smooth scrolling for navigation links
    $('nav a').on('click', function(e) {
        if (this.hash !== '') {
            e.preventDefault();
            const hash = this.hash;
            $('html, body').animate({
                scrollTop: $(hash).offset().top
            }, 800);
        }
    });
});
{{else}}
document.addEventListener('DOMContentLoaded', function() {
    console.log('{{title}} loaded!');
    
    // Smooth scrolling for navigation links
    document.querySelectorAll('nav a').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            if (this.getAttribute('href').startsWith('#')) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            }
        });
    });
});
{{/if}}`
                }
            },
            
            // Docker Template
            'docker': {
                category: 'devops',
                name: 'Docker Configuration',
                description: 'Create Docker configuration files',
                variables: {
                    projectType: { type: 'select', options: ['node', 'python', 'java'], required: true },
                    port: { type: 'number', default: 3000 }
                },
                files: {
                    'Dockerfile': `{{#equals projectType "node"}}
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE {{port}}

CMD ["node", "index.js"]
{{/equals}}
{{#equals projectType "python"}}
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE {{port}}

CMD ["python", "app.py"]
{{/equals}}
{{#equals projectType "java"}}
FROM openjdk:17-alpine

WORKDIR /app

COPY target/*.jar app.jar

EXPOSE {{port}}

CMD ["java", "-jar", "app.jar"]
{{/equals}}`,
                    'docker-compose.yml': `version: '3.8'

services:
    app:
        build: .
        ports:
            - "{{port}}:{{port}}"
        environment:
            - NODE_ENV=production
        {{#equals projectType "node"}}
        volumes:
            - ./:/app
            - /app/node_modules
        {{/equals}}
        {{#equals projectType "python"}}
        volumes:
            - ./:/app
        {{/equals}}
        restart: unless-stopped
    
    # Add more services as needed (database, cache, etc.)`,
                    '.dockerignore': `{{#equals projectType "node"}}
node_modules
npm-debug.log
.env
.git
.gitignore
README.md
.vscode
coverage
.nyc_output
{{/equals}}
{{#equals projectType "python"}}
__pycache__
*.pyc
*.pyo
*.pyd
.Python
env
venv
.env
.git
.gitignore
README.md
.vscode
.pytest_cache
{{/equals}}
{{#equals projectType "java"}}
target/
!target/*.jar
.git
.gitignore
README.md
.idea
*.iml
{{/equals}}`
                }
            }
        };
        
        // Register built-in templates
        for (const [id, template] of Object.entries(builtInTemplates)) {
            this.registerTemplate(id, template);
        }
    }

    /**
     * Load user templates from filesystem
     */
    async loadUserTemplates() {
        try {
            const templateDirs = await fs.readdir(this.userTemplatesPath, { withFileTypes: true });
            
            for (const dir of templateDirs) {
                if (dir.isDirectory()) {
                    const templatePath = path.join(this.userTemplatesPath, dir.name);
                    const metadataPath = path.join(templatePath, 'template.yaml');
                    
                    try {
                        const metadataContent = await fs.readFile(metadataPath, 'utf8');
                        const metadata = yaml.load(metadataContent);
                        
                        // Load template files
                        const files = {};
                        if (metadata.files) {
                            for (const file of metadata.files) {
                                const filePath = path.join(templatePath, file);
                                files[file] = await fs.readFile(filePath, 'utf8');
                            }
                        }
                        
                        const template = {
                            ...metadata,
                            files,
                            source: 'user'
                        };
                        
                        this.registerTemplate(dir.name, template);
                    } catch (error) {
                        console.warn(`Failed to load user template ${dir.name}:`, error.message);
                    }
                }
            }
        } catch (error) {
            // User templates directory might not exist yet
            console.log('No user templates found');
        }
    }

    /**
     * Register a template
     */
    registerTemplate(id, template) {
        this.templates.set(id, template);
        
        // Add to category
        if (template.category) {
            if (!this.categories.has(template.category)) {
                this.categories.set(template.category, []);
            }
            this.categories.get(template.category).push(id);
        }
        
        // Store metadata
        this.metadata.set(id, {
            name: template.name,
            description: template.description,
            category: template.category,
            variables: template.variables || {},
            tags: template.tags || []
        });
        
        this.emit('template-registered', { id, name: template.name });
    }

    /**
     * Register default Handlebars helpers
     */
    registerDefaultHelpers() {
        // String case transformations
        this.handlebars.registerHelper('camelCase', (str) => {
            return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        });
        
        this.handlebars.registerHelper('kebabCase', (str) => {
            return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
        });
        
        this.handlebars.registerHelper('snakeCase', (str) => {
            return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
        });
        
        this.handlebars.registerHelper('pascalCase', (str) => {
            return str.replace(/(^|-)([a-z])/g, (g) => g[g.length - 1].toUpperCase());
        });
        
        this.handlebars.registerHelper('upperCase', (str) => str.toUpperCase());
        this.handlebars.registerHelper('lowerCase', (str) => str.toLowerCase());
        
        // Comparison helpers
        this.handlebars.registerHelper('equals', (a, b, options) => {
            return a === b ? options.fn(this) : options.inverse(this);
        });
        
        this.handlebars.registerHelper('notEquals', (a, b, options) => {
            return a !== b ? options.fn(this) : options.inverse(this);
        });
        
        this.handlebars.registerHelper('greaterThan', (a, b, options) => {
            return a > b ? options.fn(this) : options.inverse(this);
        });
        
        this.handlebars.registerHelper('lessThan', (a, b, options) => {
            return a < b ? options.fn(this) : options.inverse(this);
        });
        
        // Date helpers
        this.handlebars.registerHelper('currentYear', () => new Date().getFullYear());
        this.handlebars.registerHelper('currentDate', () => new Date().toISOString());
        
        // Utility helpers
        this.handlebars.registerHelper('generateSecret', () => {
            return require('crypto').randomBytes(32).toString('hex');
        });
        
        this.handlebars.registerHelper('uuid', () => {
            return require('crypto').randomUUID();
        });
        
        this.handlebars.registerHelper('json', (obj) => JSON.stringify(obj, null, 2));
    }

    /**
     * Register custom Handlebars helper
     */
    registerHelper(name, helper) {
        this.handlebars.registerHelper(name, helper);
        this.customHelpers.set(name, helper);
    }

    /**
     * Register default partials
     */
    async registerDefaultPartials() {
        const defaultPartials = {
            header: '/* Generated on {{currentDate}} */\n',
            footer: '\n/* End of generated file */',
            license: `/*
 * Copyright (c) {{currentYear}}
 * Licensed under the MIT License
 */\n`
        };
        
        for (const [name, content] of Object.entries(defaultPartials)) {
            this.handlebars.registerPartial(name, content);
        }
    }

    /**
     * Register custom partial
     */
    registerPartial(name, content) {
        this.handlebars.registerPartial(name, content);
        this.customPartials.set(name, content);
    }

    /**
     * Generate files from template
     */
    async generateFromTemplate(templateId, variables = {}, outputPath = null) {
        try {
            const template = this.templates.get(templateId);
            if (!template) {
                throw new Error(`Template '${templateId}' not found`);
            }
            
            // Validate required variables
            const validation = this.validateVariables(template.variables || {}, variables);
            if (!validation.valid) {
                throw new Error(`Variable validation failed: ${validation.errors.join(', ')}`);
            }
            
            // Merge with defaults
            const finalVariables = this.mergeWithDefaults(template.variables || {}, variables);
            
            // Generate files
            const generatedFiles = [];
            
            for (const [fileName, content] of Object.entries(template.files || {})) {
                // Process file name with variables
                const processedFileName = this.handlebars.compile(fileName)(finalVariables);
                
                // Process file content
                const processedContent = this.handlebars.compile(content)(finalVariables);
                
                // Determine output path
                const filePath = outputPath ? 
                    path.join(outputPath, processedFileName) : 
                    processedFileName;
                
                // Ensure directory exists
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                
                // Write file
                await fs.writeFile(filePath, processedContent, 'utf8');
                
                generatedFiles.push({
                    path: filePath,
                    content: processedContent
                });
            }
            
            // Run post-generation hooks if defined
            if (template.postGenerate) {
                await this.runPostGenerateHook(template.postGenerate, outputPath, finalVariables);
            }
            
            this.emit('template-generated', {
                templateId,
                files: generatedFiles,
                variables: finalVariables
            });
            
            return {
                success: true,
                files: generatedFiles,
                outputPath
            };
        } catch (error) {
            console.error('Failed to generate from template:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Validate template variables
     */
    validateVariables(templateVars, providedVars) {
        const errors = [];
        
        for (const [name, config] of Object.entries(templateVars)) {
            if (config.required && !(name in providedVars)) {
                errors.push(`Required variable '${name}' is missing`);
                continue;
            }
            
            if (name in providedVars) {
                const value = providedVars[name];
                
                // Type validation
                if (config.type) {
                    const actualType = typeof value;
                    if (config.type === 'number' && actualType !== 'number') {
                        errors.push(`Variable '${name}' must be a number`);
                    } else if (config.type === 'boolean' && actualType !== 'boolean') {
                        errors.push(`Variable '${name}' must be a boolean`);
                    } else if (config.type === 'select' && config.options) {
                        if (!config.options.includes(value)) {
                            errors.push(`Variable '${name}' must be one of: ${config.options.join(', ')}`);
                        }
                    }
                }
                
                // Pattern validation
                if (config.pattern && typeof value === 'string') {
                    const regex = new RegExp(config.pattern);
                    if (!regex.test(value)) {
                        errors.push(`Variable '${name}' does not match pattern: ${config.pattern}`);
                    }
                }
                
                // Min/max validation for numbers
                if (config.type === 'number') {
                    if (config.min !== undefined && value < config.min) {
                        errors.push(`Variable '${name}' must be at least ${config.min}`);
                    }
                    if (config.max !== undefined && value > config.max) {
                        errors.push(`Variable '${name}' must be at most ${config.max}`);
                    }
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Merge provided variables with defaults
     */
    mergeWithDefaults(templateVars, providedVars) {
        const result = { ...providedVars };
        
        for (const [name, config] of Object.entries(templateVars)) {
            if (!(name in result) && 'default' in config) {
                result[name] = config.default;
            }
        }
        
        return result;
    }

    /**
     * Create custom template
     */
    async createTemplate(id, config) {
        try {
            // Validate template configuration
            if (!config.name) {
                throw new Error('Template name is required');
            }
            
            if (!config.files || Object.keys(config.files).length === 0) {
                throw new Error('Template must have at least one file');
            }
            
            // Save to user templates
            const templatePath = path.join(this.userTemplatesPath, id);
            await fs.mkdir(templatePath, { recursive: true });
            
            // Save metadata
            const metadata = {
                name: config.name,
                description: config.description || '',
                category: config.category || 'custom',
                variables: config.variables || {},
                tags: config.tags || [],
                author: config.author || 'User',
                version: config.version || '1.0.0',
                files: Object.keys(config.files)
            };
            
            await fs.writeFile(
                path.join(templatePath, 'template.yaml'),
                yaml.dump(metadata),
                'utf8'
            );
            
            // Save template files
            for (const [fileName, content] of Object.entries(config.files)) {
                await fs.writeFile(
                    path.join(templatePath, fileName),
                    content,
                    'utf8'
                );
            }
            
            // Register the template
            this.registerTemplate(id, {
                ...config,
                source: 'user'
            });
            
            this.emit('template-created', { id, name: config.name });
            
            return { success: true, id, path: templatePath };
        } catch (error) {
            console.error('Failed to create template:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update existing template
     */
    async updateTemplate(id, updates) {
        try {
            const template = this.templates.get(id);
            if (!template) {
                throw new Error(`Template '${id}' not found`);
            }
            
            if (template.source !== 'user') {
                throw new Error('Cannot modify built-in templates');
            }
            
            // Update template
            const updatedTemplate = { ...template, ...updates };
            
            // Save updates
            const templatePath = path.join(this.userTemplatesPath, id);
            
            // Update metadata
            const metadata = {
                name: updatedTemplate.name,
                description: updatedTemplate.description,
                category: updatedTemplate.category,
                variables: updatedTemplate.variables,
                tags: updatedTemplate.tags,
                files: Object.keys(updatedTemplate.files)
            };
            
            await fs.writeFile(
                path.join(templatePath, 'template.yaml'),
                yaml.dump(metadata),
                'utf8'
            );
            
            // Update files
            for (const [fileName, content] of Object.entries(updatedTemplate.files)) {
                await fs.writeFile(
                    path.join(templatePath, fileName),
                    content,
                    'utf8'
                );
            }
            
            // Re-register template
            this.registerTemplate(id, updatedTemplate);
            
            this.emit('template-updated', { id });
            
            return { success: true, id };
        } catch (error) {
            console.error('Failed to update template:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete template
     */
    async deleteTemplate(id) {
        try {
            const template = this.templates.get(id);
            if (!template) {
                throw new Error(`Template '${id}' not found`);
            }
            
            if (template.source !== 'user') {
                throw new Error('Cannot delete built-in templates');
            }
            
            // Remove from filesystem
            const templatePath = path.join(this.userTemplatesPath, id);
            await fs.rmdir(templatePath, { recursive: true });
            
            // Remove from memory
            this.templates.delete(id);
            this.metadata.delete(id);
            
            // Remove from category
            if (template.category) {
                const categoryTemplates = this.categories.get(template.category);
                if (categoryTemplates) {
                    const index = categoryTemplates.indexOf(id);
                    if (index > -1) {
                        categoryTemplates.splice(index, 1);
                    }
                }
            }
            
            this.emit('template-deleted', { id });
            
            return { success: true, id };
        } catch (error) {
            console.error('Failed to delete template:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Export template for sharing
     */
    async exportTemplate(id, outputPath) {
        try {
            const template = this.templates.get(id);
            if (!template) {
                throw new Error(`Template '${id}' not found`);
            }
            
            const exportData = {
                id,
                ...template,
                exported: new Date().toISOString(),
                version: template.version || '1.0.0'
            };
            
            const exportPath = path.join(outputPath, `${id}.template.json`);
            await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2), 'utf8');
            
            this.emit('template-exported', { id, path: exportPath });
            
            return { success: true, path: exportPath };
        } catch (error) {
            console.error('Failed to export template:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Import template from file
     */
    async importTemplate(filePath, options = {}) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const templateData = JSON.parse(content);
            
            const id = options.id || templateData.id;
            
            // Check for conflicts
            if (this.templates.has(id) && !options.overwrite) {
                throw new Error(`Template '${id}' already exists`);
            }
            
            // Create template
            await this.createTemplate(id, templateData);
            
            this.emit('template-imported', { id, path: filePath });
            
            return { success: true, id };
        } catch (error) {
            console.error('Failed to import template:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get template by ID
     */
    getTemplate(id) {
        return this.templates.get(id);
    }

    /**
     * Get all templates
     */
    getAllTemplates() {
        return Array.from(this.templates.entries()).map(([id, template]) => ({
            id,
            ...this.metadata.get(id),
            source: template.source || 'builtin'
        }));
    }

    /**
     * Get templates by category
     */
    getTemplatesByCategory(category) {
        const templateIds = this.categories.get(category) || [];
        return templateIds.map(id => ({
            id,
            ...this.metadata.get(id)
        }));
    }

    /**
     * Search templates
     */
    searchTemplates(query) {
        const results = [];
        const searchQuery = query.toLowerCase();
        
        for (const [id, metadata] of this.metadata) {
            const name = (metadata.name || '').toLowerCase();
            const description = (metadata.description || '').toLowerCase();
            const tags = (metadata.tags || []).map(t => t.toLowerCase());
            
            if (name.includes(searchQuery) || 
                description.includes(searchQuery) ||
                tags.some(tag => tag.includes(searchQuery))) {
                results.push({ id, ...metadata });
            }
        }
        
        return results;
    }

    /**
     * Run post-generation hook
     */
    async runPostGenerateHook(hook, outputPath, variables) {
        if (typeof hook === 'string') {
            // Execute shell command
            const command = this.handlebars.compile(hook)(variables);
            
            return new Promise((resolve, reject) => {
                require('child_process').exec(command, { cwd: outputPath }, (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        } else if (typeof hook === 'function') {
            // Execute function
            await hook(outputPath, variables);
        }
    }

    /**
     * Clone template
     */
    async cloneTemplate(sourceId, newId, modifications = {}) {
        try {
            const sourceTemplate = this.templates.get(sourceId);
            if (!sourceTemplate) {
                throw new Error(`Source template '${sourceId}' not found`);
            }
            
            const clonedTemplate = {
                ...sourceTemplate,
                ...modifications,
                name: modifications.name || `${sourceTemplate.name} (Copy)`,
                source: 'user'
            };
            
            await this.createTemplate(newId, clonedTemplate);
            
            this.emit('template-cloned', { sourceId, newId });
            
            return { success: true, id: newId };
        } catch (error) {
            console.error('Failed to clone template:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get template statistics
     */
    getStatistics() {
        const stats = {
            total: this.templates.size,
            byCategory: {},
            bySource: {
                builtin: 0,
                user: 0,
                community: 0
            }
        };
        
        for (const [, template] of this.templates) {
            // Count by source
            const source = template.source || 'builtin';
            stats.bySource[source]++;
            
            // Count by category
            const category = template.category || 'uncategorized';
            stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
        }
        
        return stats;
    }

    /**
     * Cleanup template module
     */
    async cleanup() {
        try {
            // Clear caches
            this.templateCache.clear();
            
            // Clear collections
            this.templates.clear();
            this.categories.clear();
            this.metadata.clear();
            this.variables.clear();
            this.customHelpers.clear();
            this.customPartials.clear();
            
            console.log('Template module cleaned up');
            return { success: true };
        } catch (error) {
            console.error('Failed to cleanup template module:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = TemplateModule;