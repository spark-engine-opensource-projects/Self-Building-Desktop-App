/**
 * IPC Handlers Module
 * Extracts IPC communication logic from main.js to improve maintainability
 * @module handlers/ipcHandlers
 */

const { dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');
const ipcValidator = require('../utils/ipcValidator');

/**
 * Register file-related IPC handlers
 * @param {Electron.IpcMain} ipcMain - Electron IPC main process
 * @param {BrowserWindow} getMainWindow - Function to get main window
 */
function registerFileHandlers(ipcMain, getMainWindow) {
    // Save file dialog handler
    ipcMain.handle('save-file-dialog', async (event, { defaultPath, filters }) => {
        const validation = ipcValidator.validateInput('save-file-dialog', { defaultPath, filters });
        if (!validation.valid) {
            logger.warn('Invalid save-file-dialog input', { errors: validation.errors });
            return { success: false, error: 'Invalid input' };
        }

        try {
            const result = await dialog.showSaveDialog(getMainWindow(), {
                defaultPath: defaultPath || 'generated-app.html',
                filters: filters || [
                    { name: 'HTML Files', extensions: ['html'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (!result.canceled && result.filePath) {
                return { success: true, filePath: result.filePath };
            }
            return { success: false, canceled: true };
        } catch (error) {
            logger.error('Save file dialog failed', { error: error.message });
            return { success: false, error: error.message };
        }
    });

    // Open file dialog handler
    ipcMain.handle('open-file-dialog', async (event, { filters }) => {
        try {
            const result = await dialog.showOpenDialog(getMainWindow(), {
                properties: ['openFile'],
                filters: filters || [
                    { name: 'JSON Files', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (!result.canceled && result.filePaths.length > 0) {
                const content = await fs.readFile(result.filePaths[0], 'utf8');
                return { success: true, filePath: result.filePaths[0], content };
            }
            return { success: false, canceled: true };
        } catch (error) {
            logger.error('Open file dialog failed', { error: error.message });
            return { success: false, error: error.message };
        }
    });

    // Write file handler
    ipcMain.handle('write-file', async (event, { filePath, content }) => {
        const validation = ipcValidator.validateInput('write-file', { filePath, content });
        if (!validation.valid) {
            logger.warn('Invalid write-file input', { errors: validation.errors });
            return { success: false, error: 'Invalid input' };
        }

        try {
            // Security: Prevent path traversal
            const normalizedPath = path.normalize(filePath);
            if (normalizedPath.includes('..')) {
                return { success: false, error: 'Invalid file path' };
            }

            await fs.writeFile(filePath, content, 'utf8');
            logger.info('File written successfully', { filePath });
            return { success: true };
        } catch (error) {
            logger.error('Write file failed', { error: error.message });
            return { success: false, error: error.message };
        }
    });
}

/**
 * Register configuration-related IPC handlers
 * @param {Electron.IpcMain} ipcMain - Electron IPC main process
 * @param {Object} configManager - Configuration manager instance
 */
function registerConfigHandlers(ipcMain, configManager) {
    // Get config handler
    ipcMain.handle('get-config', async () => {
        try {
            return { success: true, config: configManager.getAll() };
        } catch (error) {
            logger.error('Get config failed', { error: error.message });
            return { success: false, error: error.message };
        }
    });

    // Update config handler with validation
    ipcMain.handle('update-config', async (event, newConfig) => {
        try {
            // Security: Validate config object
            if (typeof newConfig !== 'object' || newConfig === null) {
                return { success: false, error: 'Invalid configuration object' };
            }

            // Prevent prototype pollution
            if ('__proto__' in newConfig || 'constructor' in newConfig || 'prototype' in newConfig) {
                logger.warn('Attempted prototype pollution in config update');
                return { success: false, error: 'Invalid configuration properties' };
            }

            await configManager.update(newConfig);
            return { success: true };
        } catch (error) {
            logger.error('Update config failed', { error: error.message });
            return { success: false, error: error.message };
        }
    });
}

/**
 * Register system information handlers
 * @param {Electron.IpcMain} ipcMain - Electron IPC main process
 * @param {Object} systemMonitor - System monitor instance
 * @param {Object} performanceMonitor - Performance monitor instance
 */
function registerSystemHandlers(ipcMain, systemMonitor, performanceMonitor) {
    // Get system stats
    ipcMain.handle('get-system-stats', async () => {
        try {
            const stats = systemMonitor.getStats();
            return { success: true, stats };
        } catch (error) {
            logger.error('Get system stats failed', { error: error.message });
            return { success: false, error: error.message };
        }
    });

    // Get performance metrics
    ipcMain.handle('get-performance-metrics', async () => {
        try {
            const metrics = performanceMonitor.getMetrics();
            return { success: true, metrics };
        } catch (error) {
            logger.error('Get performance metrics failed', { error: error.message });
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    registerFileHandlers,
    registerConfigHandlers,
    registerSystemHandlers
};
