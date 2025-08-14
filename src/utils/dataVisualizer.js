class DataVisualizer {
    constructor() {
        this.chartColors = [
            '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
            '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1'
        ];
    }

    /**
     * Create a bar chart from database data
     */
    createBarChart(data, options = {}) {
        const {
            container,
            labelColumn,
            valueColumn,
            title = 'Bar Chart',
            width = 400,
            height = 300
        } = options;

        if (!container || !data || data.length === 0) {
            return this.createNoDataMessage(container, 'No data available for chart');
        }

        const svg = this.createSVG(container, width, height);
        const margin = { top: 40, right: 30, bottom: 60, left: 60 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;

        // Extract data
        const chartData = data.map(item => ({
            label: item[labelColumn] || 'Unknown',
            value: parseFloat(item[valueColumn]) || 0
        }));

        // Calculate scales
        const maxValue = Math.max(...chartData.map(d => d.value));
        const barWidth = chartWidth / chartData.length * 0.8;
        const barSpacing = chartWidth / chartData.length * 0.2;

        // Create title
        this.createTitle(svg, title, width / 2, 20);

        // Create bars
        chartData.forEach((d, i) => {
            const barHeight = (d.value / maxValue) * chartHeight;
            const x = margin.left + (i * (barWidth + barSpacing)) + barSpacing / 2;
            const y = margin.top + chartHeight - barHeight;

            // Bar
            const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bar.setAttribute('x', x);
            bar.setAttribute('y', y);
            bar.setAttribute('width', barWidth);
            bar.setAttribute('height', barHeight);
            bar.setAttribute('fill', this.chartColors[i % this.chartColors.length]);
            bar.setAttribute('rx', 2);
            svg.appendChild(bar);

            // Value label
            const valueLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            valueLabel.setAttribute('x', x + barWidth / 2);
            valueLabel.setAttribute('y', y - 5);
            valueLabel.setAttribute('text-anchor', 'middle');
            valueLabel.setAttribute('font-size', '12');
            valueLabel.setAttribute('fill', '#374151');
            valueLabel.textContent = d.value;
            svg.appendChild(valueLabel);

            // X-axis label
            const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            xLabel.setAttribute('x', x + barWidth / 2);
            xLabel.setAttribute('y', height - 10);
            xLabel.setAttribute('text-anchor', 'middle');
            xLabel.setAttribute('font-size', '12');
            xLabel.setAttribute('fill', '#6b7280');
            xLabel.textContent = d.label;
            svg.appendChild(xLabel);
        });

        // Y-axis line
        const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        yAxis.setAttribute('x1', margin.left);
        yAxis.setAttribute('y1', margin.top);
        yAxis.setAttribute('x2', margin.left);
        yAxis.setAttribute('y2', margin.top + chartHeight);
        yAxis.setAttribute('stroke', '#e5e7eb');
        yAxis.setAttribute('stroke-width', 1);
        svg.appendChild(yAxis);

        // X-axis line
        const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        xAxis.setAttribute('x1', margin.left);
        xAxis.setAttribute('y1', margin.top + chartHeight);
        xAxis.setAttribute('x2', margin.left + chartWidth);
        xAxis.setAttribute('y2', margin.top + chartHeight);
        xAxis.setAttribute('stroke', '#e5e7eb');
        xAxis.setAttribute('stroke-width', 1);
        svg.appendChild(xAxis);

        return svg;
    }

    /**
     * Create a pie chart from database data
     */
    createPieChart(data, options = {}) {
        const {
            container,
            labelColumn,
            valueColumn,
            title = 'Pie Chart',
            width = 400,
            height = 300
        } = options;

        if (!container || !data || data.length === 0) {
            return this.createNoDataMessage(container, 'No data available for chart');
        }

        const svg = this.createSVG(container, width, height);
        const radius = Math.min(width, height - 40) / 2 - 20;
        const centerX = width / 2;
        const centerY = height / 2;

        // Extract data
        const chartData = data.map(item => ({
            label: item[labelColumn] || 'Unknown',
            value: parseFloat(item[valueColumn]) || 0
        }));

        const total = chartData.reduce((sum, d) => sum + d.value, 0);
        let currentAngle = 0;

        // Create title
        this.createTitle(svg, title, width / 2, 20);

        // Create pie slices
        chartData.forEach((d, i) => {
            const sliceAngle = (d.value / total) * 2 * Math.PI;
            const startAngle = currentAngle;
            const endAngle = currentAngle + sliceAngle;

            // Create path for slice
            const largeArcFlag = sliceAngle > Math.PI ? 1 : 0;
            const x1 = centerX + radius * Math.cos(startAngle);
            const y1 = centerY + radius * Math.sin(startAngle);
            const x2 = centerX + radius * Math.cos(endAngle);
            const y2 = centerY + radius * Math.sin(endAngle);

            const pathData = [
                `M ${centerX} ${centerY}`,
                `L ${x1} ${y1}`,
                `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
                'Z'
            ].join(' ');

            const slice = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            slice.setAttribute('d', pathData);
            slice.setAttribute('fill', this.chartColors[i % this.chartColors.length]);
            slice.setAttribute('stroke', 'white');
            slice.setAttribute('stroke-width', 2);
            svg.appendChild(slice);

            // Add label
            const labelAngle = startAngle + sliceAngle / 2;
            const labelRadius = radius * 0.7;
            const labelX = centerX + labelRadius * Math.cos(labelAngle);
            const labelY = centerY + labelRadius * Math.sin(labelAngle);

            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', labelX);
            label.setAttribute('y', labelY);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'middle');
            label.setAttribute('font-size', '12');
            label.setAttribute('fill', 'white');
            label.setAttribute('font-weight', 'bold');
            label.textContent = `${d.label}: ${Math.round((d.value / total) * 100)}%`;
            svg.appendChild(label);

            currentAngle += sliceAngle;
        });

        return svg;
    }

    /**
     * Create a line chart from database data
     */
    createLineChart(data, options = {}) {
        const {
            container,
            xColumn,
            yColumn,
            title = 'Line Chart',
            width = 400,
            height = 300
        } = options;

        if (!container || !data || data.length === 0) {
            return this.createNoDataMessage(container, 'No data available for chart');
        }

        const svg = this.createSVG(container, width, height);
        const margin = { top: 40, right: 30, bottom: 60, left: 60 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;

        // Extract and sort data
        const chartData = data.map(item => ({
            x: item[xColumn] || 0,
            y: parseFloat(item[yColumn]) || 0
        })).sort((a, b) => a.x - b.x);

        // Calculate scales
        const minX = Math.min(...chartData.map(d => d.x));
        const maxX = Math.max(...chartData.map(d => d.x));
        const minY = Math.min(...chartData.map(d => d.y));
        const maxY = Math.max(...chartData.map(d => d.y));

        const xScale = (value) => margin.left + ((value - minX) / (maxX - minX)) * chartWidth;
        const yScale = (value) => margin.top + chartHeight - ((value - minY) / (maxY - minY)) * chartHeight;

        // Create title
        this.createTitle(svg, title, width / 2, 20);

        // Create line
        const pathData = chartData.map((d, i) => {
            const x = xScale(d.x);
            const y = yScale(d.y);
            return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
        }).join(' ');

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('d', pathData);
        line.setAttribute('stroke', this.chartColors[0]);
        line.setAttribute('stroke-width', 2);
        line.setAttribute('fill', 'none');
        svg.appendChild(line);

        // Create data points
        chartData.forEach(d => {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', xScale(d.x));
            circle.setAttribute('cy', yScale(d.y));
            circle.setAttribute('r', 4);
            circle.setAttribute('fill', this.chartColors[0]);
            circle.setAttribute('stroke', 'white');
            circle.setAttribute('stroke-width', 2);
            svg.appendChild(circle);
        });

        // Axes
        this.createAxes(svg, margin, chartWidth, chartHeight, minX, maxX, minY, maxY);

        return svg;
    }

    /**
     * Create a summary statistics card
     */
    createSummaryCard(data, column, options = {}) {
        const { container, title = `${column} Statistics` } = options;

        if (!container || !data || data.length === 0) {
            return this.createNoDataMessage(container, 'No data available');
        }

        const values = data.map(item => parseFloat(item[column])).filter(v => !isNaN(v));
        
        if (values.length === 0) {
            return this.createNoDataMessage(container, 'No numeric data available');
        }

        const stats = this.calculateStatistics(values);
        
        const card = document.createElement('div');
        card.className = 'summary-card';
        card.innerHTML = `
            <h4>${title}</h4>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">Count:</span>
                    <span class="stat-value">${stats.count}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Sum:</span>
                    <span class="stat-value">${stats.sum.toFixed(2)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Mean:</span>
                    <span class="stat-value">${stats.mean.toFixed(2)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Median:</span>
                    <span class="stat-value">${stats.median.toFixed(2)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Min:</span>
                    <span class="stat-value">${stats.min.toFixed(2)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Max:</span>
                    <span class="stat-value">${stats.max.toFixed(2)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Std Dev:</span>
                    <span class="stat-value">${stats.stdDev.toFixed(2)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Range:</span>
                    <span class="stat-value">${(stats.max - stats.min).toFixed(2)}</span>
                </div>
            </div>
        `;

        container.appendChild(card);
        return card;
    }

    /**
     * Create data table visualization
     */
    createDataTable(data, options = {}) {
        const { 
            container, 
            title = 'Data Table',
            maxRows = 100,
            searchable = true
        } = options;

        if (!container || !data || data.length === 0) {
            return this.createNoDataMessage(container, 'No data available');
        }

        const tableContainer = document.createElement('div');
        tableContainer.className = 'visualization-table-container';

        // Title
        const titleElement = document.createElement('h4');
        titleElement.textContent = title;
        tableContainer.appendChild(titleElement);

        // Search box (if enabled)
        if (searchable) {
            const searchBox = document.createElement('input');
            searchBox.type = 'text';
            searchBox.placeholder = 'Search data...';
            searchBox.className = 'table-search';
            searchBox.addEventListener('input', (e) => {
                this.filterTable(table, e.target.value);
            });
            tableContainer.appendChild(searchBox);
        }

        // Table
        const table = document.createElement('table');
        table.className = 'visualization-table';

        // Headers
        const columns = Object.keys(data[0]);
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            th.addEventListener('click', () => {
                this.sortTable(table, col);
            });
            th.style.cursor = 'pointer';
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');
        data.slice(0, maxRows).forEach(row => {
            const tr = document.createElement('tr');
            columns.forEach(col => {
                const td = document.createElement('td');
                let value = row[col];
                
                // Format different data types
                if (typeof value === 'number') {
                    value = value.toFixed(2);
                } else if (value === null || value === undefined) {
                    value = '-';
                } else if (typeof value === 'object') {
                    value = JSON.stringify(value);
                }
                
                td.textContent = value;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        tableContainer.appendChild(table);
        container.appendChild(tableContainer);

        if (data.length > maxRows) {
            const note = document.createElement('p');
            note.className = 'table-note';
            note.textContent = `Showing first ${maxRows} of ${data.length} rows`;
            tableContainer.appendChild(note);
        }

        return tableContainer;
    }

    // Helper methods
    createSVG(container, width, height) {
        container.innerHTML = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.style.background = '#ffffff';
        svg.style.border = '1px solid #e5e7eb';
        svg.style.borderRadius = '8px';
        container.appendChild(svg);
        return svg;
    }

    createTitle(svg, title, x, y) {
        const titleElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        titleElement.setAttribute('x', x);
        titleElement.setAttribute('y', y);
        titleElement.setAttribute('text-anchor', 'middle');
        titleElement.setAttribute('font-size', '16');
        titleElement.setAttribute('font-weight', 'bold');
        titleElement.setAttribute('fill', '#1f2937');
        titleElement.textContent = title;
        svg.appendChild(titleElement);
    }

    createNoDataMessage(container, message) {
        container.innerHTML = `
            <div class="no-data-viz">
                <p>${message}</p>
            </div>
        `;
        return container.firstElementChild;
    }

    createAxes(svg, margin, chartWidth, chartHeight, minX, maxX, minY, maxY) {
        // Y-axis
        const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        yAxis.setAttribute('x1', margin.left);
        yAxis.setAttribute('y1', margin.top);
        yAxis.setAttribute('x2', margin.left);
        yAxis.setAttribute('y2', margin.top + chartHeight);
        yAxis.setAttribute('stroke', '#e5e7eb');
        yAxis.setAttribute('stroke-width', 1);
        svg.appendChild(yAxis);

        // X-axis
        const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        xAxis.setAttribute('x1', margin.left);
        xAxis.setAttribute('y1', margin.top + chartHeight);
        xAxis.setAttribute('x2', margin.left + chartWidth);
        xAxis.setAttribute('y2', margin.top + chartHeight);
        xAxis.setAttribute('stroke', '#e5e7eb');
        xAxis.setAttribute('stroke-width', 1);
        svg.appendChild(xAxis);

        // Y-axis labels
        for (let i = 0; i <= 5; i++) {
            const value = minY + (maxY - minY) * (i / 5);
            const y = margin.top + chartHeight - (i / 5) * chartHeight;
            
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', margin.left - 10);
            label.setAttribute('y', y);
            label.setAttribute('text-anchor', 'end');
            label.setAttribute('dominant-baseline', 'middle');
            label.setAttribute('font-size', '11');
            label.setAttribute('fill', '#6b7280');
            label.textContent = value.toFixed(1);
            svg.appendChild(label);
        }
    }

    calculateStatistics(values) {
        const sorted = values.sort((a, b) => a - b);
        const count = values.length;
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / count;
        
        const median = count % 2 === 0
            ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
            : sorted[Math.floor(count / 2)];
        
        const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
        const stdDev = Math.sqrt(variance);
        
        return {
            count,
            sum,
            mean,
            median,
            min: Math.min(...values),
            max: Math.max(...values),
            stdDev
        };
    }

    filterTable(table, searchTerm) {
        const rows = table.querySelectorAll('tbody tr');
        const term = searchTerm.toLowerCase();
        
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(term) ? '' : 'none';
        });
    }

    sortTable(table, column) {
        // Basic table sorting implementation
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const headers = Array.from(table.querySelectorAll('th'));
        const columnIndex = headers.findIndex(header => header.textContent === column);
        
        if (columnIndex === -1) return;
        
        rows.sort((a, b) => {
            const aVal = a.children[columnIndex].textContent;
            const bVal = b.children[columnIndex].textContent;
            
            // Try numeric comparison first
            const aNum = parseFloat(aVal);
            const bNum = parseFloat(bVal);
            
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return aNum - bNum;
            }
            
            // String comparison
            return aVal.localeCompare(bVal);
        });
        
        // Re-append sorted rows
        rows.forEach(row => tbody.appendChild(row));
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataVisualizer;
}

// Make available globally in browser
if (typeof window !== 'undefined') {
    window.DataVisualizer = DataVisualizer;
}