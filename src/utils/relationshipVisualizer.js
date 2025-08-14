/**
 * Database Relationship Visualizer
 * Creates visual representations of database schemas and relationships
 */
class RelationshipVisualizer {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' ? 
            document.getElementById(container) : container;
        
        this.options = {
            width: options.width || 800,
            height: options.height || 600,
            nodeWidth: options.nodeWidth || 200,
            nodeHeight: options.nodeHeight || 30,
            padding: options.padding || 20,
            showTypes: options.showTypes !== false,
            showConstraints: options.showConstraints !== false,
            theme: options.theme || 'light',
            ...options
        };
        
        this.tables = new Map();
        this.relationships = [];
        this.svg = null;
        
        this.initializeSVG();
    }

    /**
     * Initialize SVG canvas
     */
    initializeSVG() {
        this.container.innerHTML = '';
        
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('width', this.options.width);
        this.svg.setAttribute('height', this.options.height);
        this.svg.setAttribute('viewBox', `0 0 ${this.options.width} ${this.options.height}`);
        this.svg.classList.add('relationship-visualizer');
        
        // Add styles
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = this.getStyles();
        this.svg.appendChild(style);
        
        // Create groups
        this.relationshipGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.relationshipGroup.classList.add('relationships');
        this.svg.appendChild(this.relationshipGroup);
        
        this.tableGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.tableGroup.classList.add('tables');
        this.svg.appendChild(this.tableGroup);
        
        this.container.appendChild(this.svg);
    }

    /**
     * Load and visualize database schema
     */
    visualizeSchema(schema) {
        this.tables.clear();
        this.relationships = [];
        
        // Process tables
        Object.entries(schema.tables || {}).forEach(([tableName, tableSchema]) => {
            this.addTable(tableName, tableSchema);
        });
        
        // Process relationships
        this.extractRelationships();
        
        // Layout and render
        this.layoutTables();
        this.renderVisualization();
    }

    /**
     * Add a table to the visualization
     */
    addTable(name, schema) {
        const table = {
            name,
            columns: schema.columns || {},
            constraints: schema.constraints || [],
            x: 0,
            y: 0,
            width: this.options.nodeWidth,
            height: this.calculateTableHeight(schema)
        };
        
        this.tables.set(name, table);
    }

    /**
     * Calculate table height based on columns
     */
    calculateTableHeight(schema) {
        const columnCount = Object.keys(schema.columns || {}).length;
        const headerHeight = 40;
        const columnHeight = 25;
        return headerHeight + (columnCount * columnHeight) + 10;
    }

    /**
     * Extract relationships from constraints
     */
    extractRelationships() {
        this.tables.forEach((table, tableName) => {
            table.constraints.forEach(constraint => {
                if (constraint.type === 'foreign_key') {
                    this.relationships.push({
                        from: tableName,
                        to: constraint.references.table,
                        fromColumn: constraint.column,
                        toColumn: constraint.references.column,
                        type: 'foreign_key'
                    });
                }
            });
        });
    }

    /**
     * Layout tables using force-directed algorithm
     */
    layoutTables() {
        const tables = Array.from(this.tables.values());
        const padding = this.options.padding;
        
        if (tables.length === 0) return;
        
        // Simple grid layout for small schemas
        if (tables.length <= 6) {
            const cols = Math.ceil(Math.sqrt(tables.length));
            const rows = Math.ceil(tables.length / cols);
            
            tables.forEach((table, index) => {
                const col = index % cols;
                const row = Math.floor(index / cols);
                
                table.x = padding + col * (this.options.nodeWidth + padding * 2);
                table.y = padding + row * (table.height + padding * 2);
            });
        } else {
            // Force-directed layout for larger schemas
            this.forceDirectedLayout(tables);
        }
    }

    /**
     * Force-directed layout algorithm
     */
    forceDirectedLayout(tables) {
        const iterations = 100;
        const centerX = this.options.width / 2;
        const centerY = this.options.height / 2;
        
        // Initialize random positions
        tables.forEach(table => {
            table.x = Math.random() * (this.options.width - table.width);
            table.y = Math.random() * (this.options.height - table.height);
        });
        
        for (let i = 0; i < iterations; i++) {
            // Apply forces
            tables.forEach(table => {
                let fx = 0, fy = 0;
                
                // Repulsion from other tables
                tables.forEach(other => {
                    if (table === other) return;
                    
                    const dx = table.x - other.x;
                    const dy = table.y - other.y;
                    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                    const force = 1000 / (distance * distance);
                    
                    fx += (dx / distance) * force;
                    fy += (dy / distance) * force;
                });
                
                // Attraction to related tables
                this.relationships.forEach(rel => {
                    let other = null;
                    let attraction = 1;
                    
                    if (rel.from === table.name) {
                        other = this.tables.get(rel.to);
                        attraction = -1;
                    } else if (rel.to === table.name) {
                        other = this.tables.get(rel.from);
                        attraction = -1;
                    }
                    
                    if (other) {
                        const dx = table.x - other.x;
                        const dy = table.y - other.y;
                        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                        const force = distance * 0.01;
                        
                        fx += (dx / distance) * force * attraction;
                        fy += (dy / distance) * force * attraction;
                    }
                });
                
                // Apply forces with damping
                const damping = 0.9;
                table.x += fx * damping;
                table.y += fy * damping;
                
                // Keep within bounds
                table.x = Math.max(this.options.padding, 
                    Math.min(this.options.width - table.width - this.options.padding, table.x));
                table.y = Math.max(this.options.padding, 
                    Math.min(this.options.height - table.height - this.options.padding, table.y));
            });
        }
    }

    /**
     * Render the complete visualization
     */
    renderVisualization() {
        // Clear existing content
        this.relationshipGroup.innerHTML = '';
        this.tableGroup.innerHTML = '';
        
        // Render relationships first (so they appear behind tables)
        this.relationships.forEach(rel => {
            this.renderRelationship(rel);
        });
        
        // Render tables
        this.tables.forEach(table => {
            this.renderTable(table);
        });
    }

    /**
     * Render a relationship line
     */
    renderRelationship(relationship) {
        const fromTable = this.tables.get(relationship.from);
        const toTable = this.tables.get(relationship.to);
        
        if (!fromTable || !toTable) return;
        
        // Calculate connection points
        const fromPoint = this.getConnectionPoint(fromTable, toTable, relationship.fromColumn);
        const toPoint = this.getConnectionPoint(toTable, fromTable, relationship.toColumn);
        
        // Create path
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const pathData = this.createConnectionPath(fromPoint, toPoint);
        
        path.setAttribute('d', pathData);
        path.classList.add('relationship-line');
        path.setAttribute('data-from', relationship.from);
        path.setAttribute('data-to', relationship.to);
        
        // Add arrow marker
        this.addArrowMarker(path, toPoint, relationship.type);
        
        this.relationshipGroup.appendChild(path);
        
        // Add relationship label
        if (this.options.showConstraints) {
            const midPoint = this.getMidPoint(fromPoint, toPoint);
            const label = this.createLabel(
                `${relationship.fromColumn} → ${relationship.toColumn}`, 
                midPoint.x, 
                midPoint.y - 5
            );
            label.classList.add('relationship-label');
            this.relationshipGroup.appendChild(label);
        }
    }

    /**
     * Render a table
     */
    renderTable(table) {
        const tableGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        tableGroup.classList.add('table');
        tableGroup.setAttribute('data-table', table.name);
        
        // Table background
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', table.x);
        bg.setAttribute('y', table.y);
        bg.setAttribute('width', table.width);
        bg.setAttribute('height', table.height);
        bg.classList.add('table-bg');
        tableGroup.appendChild(bg);
        
        // Table header
        const header = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        header.setAttribute('x', table.x);
        header.setAttribute('y', table.y);
        header.setAttribute('width', table.width);
        header.setAttribute('height', 30);
        header.classList.add('table-header');
        tableGroup.appendChild(header);
        
        // Table name
        const nameText = this.createLabel(table.name, table.x + 10, table.y + 20);
        nameText.classList.add('table-name');
        tableGroup.appendChild(nameText);
        
        // Columns
        let yOffset = 35;
        Object.entries(table.columns).forEach(([columnName, columnDef]) => {
            const columnGroup = this.renderColumn(
                table.x, 
                table.y + yOffset, 
                table.width, 
                columnName, 
                columnDef
            );
            tableGroup.appendChild(columnGroup);
            yOffset += 25;
        });
        
        this.tableGroup.appendChild(tableGroup);
    }

    /**
     * Render a table column
     */
    renderColumn(x, y, width, name, definition) {
        const columnGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        columnGroup.classList.add('column');
        
        // Column background (for hover effects)
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', x);
        bg.setAttribute('y', y - 12);
        bg.setAttribute('width', width);
        bg.setAttribute('height', 22);
        bg.classList.add('column-bg');
        columnGroup.appendChild(bg);
        
        // Column name
        const nameText = this.createLabel(name, x + 10, y);
        nameText.classList.add('column-name');
        
        // Add modifiers
        if (definition.required) nameText.classList.add('required');
        if (definition.unique) nameText.classList.add('unique');
        if (name === 'id') nameText.classList.add('primary-key');
        
        columnGroup.appendChild(nameText);
        
        // Column type
        if (this.options.showTypes && definition.type) {
            const typeText = this.createLabel(definition.type, x + width - 10, y);
            typeText.classList.add('column-type');
            typeText.setAttribute('text-anchor', 'end');
            columnGroup.appendChild(typeText);
        }
        
        return columnGroup;
    }

    /**
     * Create a text label
     */
    createLabel(text, x, y) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', y);
        label.textContent = text;
        return label;
    }

    /**
     * Get connection point on table edge
     */
    getConnectionPoint(fromTable, toTable, column) {
        // Simple center-to-center for now
        return {
            x: fromTable.x + fromTable.width / 2,
            y: fromTable.y + fromTable.height / 2
        };
    }

    /**
     * Create curved connection path
     */
    createConnectionPath(from, to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const curve = Math.abs(dx) * 0.3;
        
        return `M ${from.x},${from.y} C ${from.x + curve},${from.y} ${to.x - curve},${to.y} ${to.x},${to.y}`;
    }

    /**
     * Add arrow marker to path
     */
    addArrowMarker(path, endPoint, type) {
        // Create marker definition if not exists
        let defs = this.svg.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            this.svg.insertBefore(defs, this.svg.firstChild);
        }
        
        if (!defs.querySelector('#arrow')) {
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'arrow');
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '9');
            marker.setAttribute('refY', '3');
            marker.setAttribute('markerWidth', '6');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('orient', 'auto');
            
            const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            arrowPath.setAttribute('d', 'M0,0 L0,6 L9,3 z');
            arrowPath.setAttribute('fill', '#666');
            
            marker.appendChild(arrowPath);
            defs.appendChild(marker);
        }
        
        path.setAttribute('marker-end', 'url(#arrow)');
    }

    /**
     * Get mid point between two points
     */
    getMidPoint(from, to) {
        return {
            x: (from.x + to.x) / 2,
            y: (from.y + to.y) / 2
        };
    }

    /**
     * Get CSS styles for the visualization
     */
    getStyles() {
        return `
            .table-bg {
                fill: ${this.options.theme === 'dark' ? '#2d3748' : 'white'};
                stroke: ${this.options.theme === 'dark' ? '#4a5568' : '#e2e8f0'};
                stroke-width: 1;
                rx: 4;
            }
            
            .table-header {
                fill: ${this.options.theme === 'dark' ? '#4299e1' : '#e2e8f0'};
                rx: 4;
            }
            
            .table-name {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                font-weight: 600;
                fill: ${this.options.theme === 'dark' ? 'white' : '#2d3748'};
            }
            
            .column-bg {
                fill: transparent;
                cursor: pointer;
            }
            
            .column-bg:hover {
                fill: ${this.options.theme === 'dark' ? '#4a5568' : '#f7fafc'};
            }
            
            .column-name {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
                fill: ${this.options.theme === 'dark' ? '#e2e8f0' : '#4a5568'};
                cursor: pointer;
            }
            
            .column-name.required {
                font-weight: 600;
            }
            
            .column-name.primary-key {
                fill: ${this.options.theme === 'dark' ? '#f6e05e' : '#d69e2e'};
            }
            
            .column-name.unique {
                text-decoration: underline;
            }
            
            .column-type {
                font-family: 'SF Mono', Monaco, monospace;
                font-size: 10px;
                fill: ${this.options.theme === 'dark' ? '#a0aec0' : '#718096'};
            }
            
            .relationship-line {
                fill: none;
                stroke: ${this.options.theme === 'dark' ? '#63b3ed' : '#4299e1'};
                stroke-width: 2;
                cursor: pointer;
            }
            
            .relationship-line:hover {
                stroke-width: 3;
                stroke: ${this.options.theme === 'dark' ? '#90cdf4' : '#3182ce'};
            }
            
            .relationship-label {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 10px;
                fill: ${this.options.theme === 'dark' ? '#a0aec0' : '#718096'};
                text-anchor: middle;
                pointer-events: none;
            }
        `;
    }

    /**
     * Export visualization as SVG
     */
    exportSVG() {
        const svgString = new XMLSerializer().serializeToString(this.svg);
        return svgString;
    }

    /**
     * Export visualization as PNG (requires canvas conversion)
     */
    async exportPNG() {
        const svgString = this.exportSVG();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = this.options.width;
        canvas.height = this.options.height;
        
        const img = new Image();
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        
        return new Promise((resolve) => {
            img.onload = () => {
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                canvas.toBlob(resolve, 'image/png');
            };
            img.src = url;
        });
    }
}

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RelationshipVisualizer;
} else {
    window.RelationshipVisualizer = RelationshipVisualizer;
}