/**
 * Safe DOM manipulation helpers to avoid innerHTML security issues
 */

class DOMHelpers {
    /**
     * Create an element with text content safely
     */
    static createElement(tag, className = '', textContent = '') {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (textContent) element.textContent = textContent;
        return element;
    }

    /**
     * Create a table from data safely
     */
    static createTable(data, columns) {
        const table = document.createElement('table');
        table.className = 'data-table';
        
        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col.label || col.key;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create body
        const tbody = document.createElement('tbody');
        data.forEach(row => {
            const tr = document.createElement('tr');
            columns.forEach(col => {
                const td = document.createElement('td');
                const value = row[col.key];
                
                if (col.type === 'actions') {
                    // Create action buttons
                    col.actions.forEach(action => {
                        const btn = document.createElement('button');
                        btn.className = action.className || 'btn-action';
                        btn.textContent = action.label;
                        btn.onclick = () => action.handler(row);
                        td.appendChild(btn);
                    });
                } else {
                    td.textContent = value !== null && value !== undefined ? value : '';
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        
        return table;
    }

    /**
     * Create pagination controls
     */
    static createPagination(currentPage, totalPages, onPageChange) {
        const container = document.createElement('div');
        container.className = 'pagination-controls';
        
        // Previous button
        const prevBtn = document.createElement('button');
        prevBtn.className = 'pagination-btn';
        prevBtn.textContent = '← Previous';
        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick = () => onPageChange(currentPage - 1);
        container.appendChild(prevBtn);
        
        // Page info
        const pageInfo = document.createElement('span');
        pageInfo.className = 'pagination-info';
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        container.appendChild(pageInfo);
        
        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.className = 'pagination-btn';
        nextBtn.textContent = 'Next →';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick = () => onPageChange(currentPage + 1);
        container.appendChild(nextBtn);
        
        return container;
    }

    /**
     * Create a select dropdown safely
     */
    static createSelect(options, selectedValue = '', placeholder = 'Select...') {
        const select = document.createElement('select');
        
        // Add placeholder option
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = placeholder;
        select.appendChild(placeholderOption);
        
        // Add options
        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value || opt;
            option.textContent = opt.label || opt;
            if (option.value === selectedValue) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        
        return select;
    }

    /**
     * Create a table item with schema info
     */
    static createTableItem(tableName, schema, onSelect) {
        const item = document.createElement('div');
        item.className = 'table-item';
        
        const header = document.createElement('div');
        header.className = 'table-header';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'table-name';
        nameSpan.textContent = tableName;
        header.appendChild(nameSpan);
        
        const columnsSpan = document.createElement('span');
        columnsSpan.className = 'table-columns';
        const columnCount = schema ? Object.keys(schema.columns || {}).length : 0;
        columnsSpan.textContent = `${columnCount} columns`;
        header.appendChild(columnsSpan);
        
        item.appendChild(header);
        
        if (schema && schema.columns) {
            const columnsList = document.createElement('div');
            columnsList.className = 'table-columns-list';
            
            Object.entries(schema.columns).forEach(([colName, colDef]) => {
                const colDiv = document.createElement('div');
                colDiv.className = 'column-item';
                colDiv.textContent = `${colName}: ${colDef.type}`;
                columnsList.appendChild(colDiv);
            });
            
            item.appendChild(columnsList);
        }
        
        item.onclick = () => onSelect(tableName);
        
        return item;
    }

    /**
     * Clear element content safely
     */
    static clearElement(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    /**
     * Create error display
     */
    static createErrorDisplay(title, message, suggestions = [], canRetry = false, onRetry = null) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-display';
        
        // Header
        const header = document.createElement('div');
        header.className = 'error-header';
        
        const titleEl = document.createElement('h3');
        titleEl.textContent = `❌ ${title}`;
        header.appendChild(titleEl);
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'error-close';
        closeBtn.textContent = '×';
        closeBtn.onclick = () => errorDiv.remove();
        header.appendChild(closeBtn);
        
        errorDiv.appendChild(header);
        
        // Message
        const messageDiv = document.createElement('div');
        messageDiv.className = 'error-message';
        messageDiv.textContent = message;
        errorDiv.appendChild(messageDiv);
        
        // Suggestions
        if (suggestions && suggestions.length > 0) {
            const suggestionsDiv = document.createElement('div');
            suggestionsDiv.className = 'error-suggestions';
            
            const suggestionsTitle = document.createElement('strong');
            suggestionsTitle.textContent = 'Suggestions:';
            suggestionsDiv.appendChild(suggestionsTitle);
            
            const ul = document.createElement('ul');
            suggestions.forEach(s => {
                const li = document.createElement('li');
                li.textContent = s;
                ul.appendChild(li);
            });
            suggestionsDiv.appendChild(ul);
            
            errorDiv.appendChild(suggestionsDiv);
        }
        
        // Retry button
        if (canRetry && onRetry) {
            const retryBtn = document.createElement('button');
            retryBtn.className = 'btn btn-primary';
            retryBtn.textContent = 'Retry';
            retryBtn.onclick = onRetry;
            errorDiv.appendChild(retryBtn);
        }
        
        return errorDiv;
    }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DOMHelpers;
}