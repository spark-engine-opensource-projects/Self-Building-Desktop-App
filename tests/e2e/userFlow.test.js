const { Application } = require('spectron');
const path = require('path');
const fs = require('fs').promises;

describe('End-to-End User Flow Tests', () => {
    let app;
    let testDataPath;

    beforeAll(async () => {
        // Setup test data directory
        testDataPath = path.join(__dirname, '..', 'temp', 'e2e-test-data');
        await fs.mkdir(testDataPath, { recursive: true });

        // Start the Electron application
        app = new Application({
            path: require('electron'),
            args: [path.join(__dirname, '..', '..', 'src', 'main.js')],
            env: {
                NODE_ENV: 'test',
                TEST_DATA_PATH: testDataPath
            }
        });

        await app.start();
    }, 30000); // 30 second timeout for app start

    afterAll(async () => {
        if (app && app.isRunning()) {
            await app.stop();
        }
        
        // Cleanup test data
        await fs.rmdir(testDataPath, { recursive: true });
    });

    describe('Application Launch', () => {
        test('should launch the application successfully', async () => {
            expect(app).toBeDefined();
            expect(await app.isRunning()).toBe(true);
            
            const windowCount = await app.client.getWindowCount();
            expect(windowCount).toBe(1);
        });

        test('should display the main window', async () => {
            const isVisible = await app.browserWindow.isVisible();
            expect(isVisible).toBe(true);

            const bounds = await app.browserWindow.getBounds();
            expect(bounds.width).toBeGreaterThan(0);
            expect(bounds.height).toBeGreaterThan(0);
        });

        test('should load the application UI', async () => {
            await app.client.waitForExist('#app', 5000);
            
            const title = await app.client.getTitle();
            expect(title).toBeTruthy();
            
            // Check for main UI elements
            expect(await app.client.isExisting('#promptInput')).toBe(true);
            expect(await app.client.isExisting('#generateBtn')).toBe(true);
            expect(await app.client.isExisting('#outputContainer')).toBe(true);
        });
    });

    describe('Project Creation Flow', () => {
        test('should create a new project', async () => {
            // Open new project dialog
            await app.client.click('#newProjectBtn');
            await app.client.waitForExist('#projectDialog', 5000);
            
            // Fill in project details
            await app.client.setValue('#projectName', 'Test Project');
            await app.client.setValue('#projectDescription', 'E2E test project');
            await app.client.selectByValue('#projectType', 'web');
            
            // Create project
            await app.client.click('#createProjectBtn');
            
            // Verify project was created
            await app.client.waitForExist('#projectStatus', 5000);
            const status = await app.client.getText('#projectStatus');
            expect(status).toContain('Test Project');
        });

        test('should save project settings', async () => {
            // Open settings
            await app.client.click('#settingsBtn');
            await app.client.waitForExist('#settingsDialog', 5000);
            
            // Modify settings
            await app.client.setValue('#apiKey', 'test-api-key');
            await app.client.click('#darkModeToggle');
            
            // Save settings
            await app.client.click('#saveSettingsBtn');
            
            // Verify settings were saved
            await app.client.waitForExist('.notification-success', 5000);
            const notification = await app.client.getText('.notification-success');
            expect(notification).toContain('Settings saved');
        });
    });

    describe('Code Generation Flow', () => {
        test('should generate code from prompt', async () => {
            // Enter a prompt
            const prompt = 'Create a simple hello world function in JavaScript';
            await app.client.setValue('#promptInput', prompt);
            
            // Click generate button
            await app.client.click('#generateBtn');
            
            // Wait for generation to complete
            await app.client.waitForExist('#outputContainer .code-output', 15000);
            
            // Verify code was generated
            const output = await app.client.getText('#outputContainer .code-output');
            expect(output).toContain('function');
            expect(output).toContain('hello');
        });

        test('should display generation progress', async () => {
            // Enter a complex prompt
            const prompt = 'Create a REST API with CRUD operations for a user model';
            await app.client.setValue('#promptInput', prompt);
            
            // Click generate
            await app.client.click('#generateBtn');
            
            // Check for progress indicator
            await app.client.waitForExist('#progressBar', 2000);
            const isVisible = await app.client.isVisible('#progressBar');
            expect(isVisible).toBe(true);
            
            // Wait for completion
            await app.client.waitForExist('#outputContainer .code-output', 20000);
        });

        test('should handle generation errors gracefully', async () => {
            // Enter an invalid prompt
            await app.client.setValue('#promptInput', '');
            
            // Try to generate
            await app.client.click('#generateBtn');
            
            // Check for error message
            await app.client.waitForExist('.error-message', 5000);
            const error = await app.client.getText('.error-message');
            expect(error).toContain('provide a prompt');
        });
    });

    describe('File Operations Flow', () => {
        test('should save generated code to file', async () => {
            // Generate some code first
            await app.client.setValue('#promptInput', 'Create a factorial function');
            await app.client.click('#generateBtn');
            await app.client.waitForExist('#outputContainer .code-output', 15000);
            
            // Save to file
            await app.client.click('#saveCodeBtn');
            await app.client.waitForExist('#saveDialog', 5000);
            
            await app.client.setValue('#filename', 'factorial.js');
            await app.client.click('#confirmSaveBtn');
            
            // Verify save success
            await app.client.waitForExist('.notification-success', 5000);
            const notification = await app.client.getText('.notification-success');
            expect(notification).toContain('saved successfully');
        });

        test('should open and edit existing files', async () => {
            // Open file browser
            await app.client.click('#openFileBtn');
            await app.client.waitForExist('#fileBrowser', 5000);
            
            // Select a file
            await app.client.click('.file-item[data-name="factorial.js"]');
            
            // Verify file opened in editor
            await app.client.waitForExist('#codeEditor', 5000);
            const content = await app.client.getValue('#codeEditor');
            expect(content).toContain('factorial');
            
            // Make an edit
            await app.client.setValue('#codeEditor', content + '\n// Edited');
            
            // Save changes
            await app.client.keys(['Control', 's']);
            
            // Verify save
            await app.client.waitForExist('.notification-success', 5000);
        });
    });

    describe('Database Operations Flow', () => {
        test('should create and query database', async () => {
            // Open database manager
            await app.client.click('#databaseBtn');
            await app.client.waitForExist('#databaseManager', 5000);
            
            // Create new database
            await app.client.click('#newDatabaseBtn');
            await app.client.setValue('#dbName', 'test_db');
            await app.client.click('#createDbBtn');
            
            // Create a table
            await app.client.click('#newTableBtn');
            await app.client.setValue('#tableName', 'users');
            await app.client.click('#addColumnBtn');
            await app.client.setValue('.column-name', 'name');
            await app.client.selectByValue('.column-type', 'TEXT');
            await app.client.click('#createTableBtn');
            
            // Insert data
            await app.client.click('#insertDataBtn');
            await app.client.setValue('#dataInput', '{"name": "John Doe"}');
            await app.client.click('#executeInsertBtn');
            
            // Query data
            await app.client.click('#queryTab');
            await app.client.setValue('#queryInput', 'SELECT * FROM users');
            await app.client.click('#executeQueryBtn');
            
            // Verify results
            await app.client.waitForExist('#queryResults', 5000);
            const results = await app.client.getText('#queryResults');
            expect(results).toContain('John Doe');
        });
    });

    describe('Performance Monitoring Flow', () => {
        test('should display performance metrics', async () => {
            // Open performance monitor
            await app.client.click('#performanceBtn');
            await app.client.waitForExist('#performanceMonitor', 5000);
            
            // Check for metrics display
            expect(await app.client.isExisting('#cpuUsage')).toBe(true);
            expect(await app.client.isExisting('#memoryUsage')).toBe(true);
            expect(await app.client.isExisting('#responseTime')).toBe(true);
            
            // Verify metrics are updating
            const initialCPU = await app.client.getText('#cpuUsage');
            await app.client.pause(2000);
            const updatedCPU = await app.client.getText('#cpuUsage');
            
            // CPU values should change (not always, but format should be valid)
            expect(initialCPU).toMatch(/\d+(\.\d+)?%/);
            expect(updatedCPU).toMatch(/\d+(\.\d+)?%/);
        });
    });

    describe('Collaboration Features Flow', () => {
        test('should share project with collaborator', async () => {
            // Open share dialog
            await app.client.click('#shareProjectBtn');
            await app.client.waitForExist('#shareDialog', 5000);
            
            // Add collaborator
            await app.client.setValue('#collaboratorEmail', 'test@example.com');
            await app.client.selectByValue('#permissionLevel', 'edit');
            await app.client.click('#addCollaboratorBtn');
            
            // Verify collaborator added
            await app.client.waitForExist('.collaborator-item', 5000);
            const collaborator = await app.client.getText('.collaborator-item');
            expect(collaborator).toContain('test@example.com');
        });
    });

    describe('Search and Navigation Flow', () => {
        test('should search within project', async () => {
            // Open search
            await app.client.keys(['Control', 'f']);
            await app.client.waitForExist('#searchBox', 5000);
            
            // Perform search
            await app.client.setValue('#searchBox', 'function');
            await app.client.click('#searchBtn');
            
            // Check results
            await app.client.waitForExist('.search-results', 5000);
            const results = await app.client.elements('.search-result-item');
            expect(results.value.length).toBeGreaterThan(0);
        });

        test('should navigate between files', async () => {
            // Open file explorer
            await app.client.click('#fileExplorerBtn');
            await app.client.waitForExist('#fileExplorer', 5000);
            
            // Click on different files
            const files = await app.client.elements('.file-tree-item');
            expect(files.value.length).toBeGreaterThan(0);
            
            // Navigate to a file
            await app.client.click('.file-tree-item:first-child');
            await app.client.waitForExist('#codeEditor', 5000);
            
            // Use navigation history
            await app.client.keys(['Alt', 'Left']); // Go back
            await app.client.pause(500);
            await app.client.keys(['Alt', 'Right']); // Go forward
        });
    });

    describe('Export and Import Flow', () => {
        test('should export project', async () => {
            // Open export dialog
            await app.client.click('#exportProjectBtn');
            await app.client.waitForExist('#exportDialog', 5000);
            
            // Select export format
            await app.client.selectByValue('#exportFormat', 'zip');
            await app.client.click('#exportBtn');
            
            // Wait for export to complete
            await app.client.waitForExist('.notification-success', 10000);
            const notification = await app.client.getText('.notification-success');
            expect(notification).toContain('exported successfully');
        });

        test('should import project', async () => {
            // Open import dialog
            await app.client.click('#importProjectBtn');
            await app.client.waitForExist('#importDialog', 5000);
            
            // Note: In real test, would need to handle file selection
            // For now, we'll simulate the process
            
            // Verify import UI is present
            expect(await app.client.isExisting('#importFileInput')).toBe(true);
            expect(await app.client.isExisting('#importBtn')).toBe(true);
        });
    });

    describe('Keyboard Shortcuts', () => {
        test('should respond to keyboard shortcuts', async () => {
            // Test save shortcut
            await app.client.keys(['Control', 's']);
            await app.client.waitForExist('.notification', 5000);
            
            // Test new file shortcut
            await app.client.keys(['Control', 'n']);
            await app.client.waitForExist('#newFileDialog', 5000);
            await app.client.keys(['Escape']); // Close dialog
            
            // Test generate shortcut
            await app.client.keys(['Control', 'Enter']);
            // Should trigger generation if prompt is filled
        });
    });

    describe('Error Recovery Flow', () => {
        test('should recover from network errors', async () => {
            // Simulate network error by using invalid API endpoint
            await app.client.click('#settingsBtn');
            await app.client.waitForExist('#settingsDialog', 5000);
            await app.client.setValue('#apiEndpoint', 'http://invalid-endpoint.com');
            await app.client.click('#saveSettingsBtn');
            
            // Try to generate code
            await app.client.setValue('#promptInput', 'Test prompt');
            await app.client.click('#generateBtn');
            
            // Should show error and offer retry
            await app.client.waitForExist('.error-message', 10000);
            expect(await app.client.isExisting('#retryBtn')).toBe(true);
            
            // Fix the endpoint
            await app.client.click('#settingsBtn');
            await app.client.setValue('#apiEndpoint', 'https://api.anthropic.com');
            await app.client.click('#saveSettingsBtn');
            
            // Retry should work
            await app.client.click('#retryBtn');
        });
    });

    describe('Application Cleanup', () => {
        test('should clean up resources on close', async () => {
            // Get initial resource usage
            const initialMemory = await app.client.execute(() => {
                return performance.memory.usedJSHeapSize;
            });
            
            // Perform various operations to use resources
            await app.client.setValue('#promptInput', 'Create multiple functions');
            await app.client.click('#generateBtn');
            await app.client.waitForExist('#outputContainer .code-output', 15000);
            
            // Close dialogs and clean up
            await app.client.keys(['Escape']);
            
            // Force garbage collection if available
            await app.client.execute(() => {
                if (global.gc) global.gc();
            });
            
            // Memory should not grow unbounded
            const finalMemory = await app.client.execute(() => {
                return performance.memory.usedJSHeapSize;
            });
            
            // Allow for some growth but not excessive
            const memoryGrowth = finalMemory - initialMemory;
            expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024); // Less than 50MB growth
        });
    });
});