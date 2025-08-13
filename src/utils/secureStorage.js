const { safeStorage } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const logger = require('./logger');

/**
 * Secure Storage Manager using Electron's safeStorage API
 * Provides encrypted storage for sensitive data like API keys
 */
class SecureStorage {
    constructor() {
        this.isAvailable = false;
        this.storageDir = null;
        this.encryptedDataFile = null;
    }

    /**
     * Initialize secure storage
     */
    async initialize() {
        try {
            // Check if encryption is available
            this.isAvailable = safeStorage.isEncryptionAvailable();
            
            if (!this.isAvailable) {
                logger.warn('Secure storage encryption not available on this platform');
                return false;
            }

            // Set up storage directory
            const userDataPath = app ? app.getPath('userData') : path.join(process.cwd(), 'userData');
            this.storageDir = path.join(userDataPath, 'secure');
            this.encryptedDataFile = path.join(this.storageDir, 'encrypted-data.bin');

            // Create directory if it doesn't exist
            await fs.mkdir(this.storageDir, { recursive: true });

            logger.info('Secure storage initialized', {
                available: this.isAvailable,
                storageDir: this.storageDir
            });

            return true;
        } catch (error) {
            logger.error('Failed to initialize secure storage', error);
            return false;
        }
    }

    /**
     * Store encrypted data
     */
    async store(key, value) {
        if (!this.isAvailable) {
            throw new Error('Secure storage not available');
        }

        try {
            // Load existing data
            const existingData = await this.loadEncryptedData();
            
            // Add/update the key
            existingData[key] = {
                value: value,
                encrypted: true,
                timestamp: new Date().toISOString()
            };

            // Encrypt and save
            const jsonData = JSON.stringify(existingData);
            const encryptedBuffer = safeStorage.encryptString(jsonData);
            
            await fs.writeFile(this.encryptedDataFile, encryptedBuffer);
            
            logger.info('Data stored securely', { key });
            return true;
        } catch (error) {
            logger.error('Failed to store encrypted data', error, { key });
            throw error;
        }
    }

    /**
     * Retrieve and decrypt data
     */
    async retrieve(key) {
        if (!this.isAvailable) {
            throw new Error('Secure storage not available');
        }

        try {
            const data = await this.loadEncryptedData();
            const item = data[key];
            
            if (!item) {
                return null;
            }

            logger.debug('Data retrieved securely', { key });
            return item.value;
        } catch (error) {
            logger.error('Failed to retrieve encrypted data', error, { key });
            throw error;
        }
    }

    /**
     * Remove encrypted data
     */
    async remove(key) {
        if (!this.isAvailable) {
            throw new Error('Secure storage not available');
        }

        try {
            const existingData = await this.loadEncryptedData();
            
            if (existingData[key]) {
                delete existingData[key];
                
                const jsonData = JSON.stringify(existingData);
                const encryptedBuffer = safeStorage.encryptString(jsonData);
                
                await fs.writeFile(this.encryptedDataFile, encryptedBuffer);
                
                logger.info('Data removed from secure storage', { key });
                return true;
            }
            
            return false;
        } catch (error) {
            logger.error('Failed to remove encrypted data', error, { key });
            throw error;
        }
    }

    /**
     * Check if key exists
     */
    async has(key) {
        if (!this.isAvailable) {
            return false;
        }

        try {
            const data = await this.loadEncryptedData();
            return key in data;
        } catch (error) {
            logger.error('Failed to check encrypted data existence', error, { key });
            return false;
        }
    }

    /**
     * List all stored keys (without values)
     */
    async keys() {
        if (!this.isAvailable) {
            return [];
        }

        try {
            const data = await this.loadEncryptedData();
            return Object.keys(data);
        } catch (error) {
            logger.error('Failed to list encrypted data keys', error);
            return [];
        }
    }

    /**
     * Clear all encrypted data
     */
    async clear() {
        if (!this.isAvailable) {
            return false;
        }

        try {
            await fs.unlink(this.encryptedDataFile);
            logger.info('All encrypted data cleared');
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, consider it cleared
                return true;
            }
            logger.error('Failed to clear encrypted data', error);
            throw error;
        }
    }

    /**
     * Load and decrypt all data
     */
    async loadEncryptedData() {
        try {
            const encryptedBuffer = await fs.readFile(this.encryptedDataFile);
            const decryptedString = safeStorage.decryptString(encryptedBuffer);
            return JSON.parse(decryptedString);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist yet, return empty object
                return {};
            }
            throw error;
        }
    }

    /**
     * Get storage statistics
     */
    async getStats() {
        try {
            const data = await this.loadEncryptedData();
            const keys = Object.keys(data);
            
            let totalSize = 0;
            try {
                const stats = await fs.stat(this.encryptedDataFile);
                totalSize = stats.size;
            } catch (error) {
                // File doesn't exist
                totalSize = 0;
            }

            return {
                available: this.isAvailable,
                keyCount: keys.length,
                storageSize: totalSize,
                storageDir: this.storageDir,
                keys: keys.map(key => ({
                    key,
                    timestamp: data[key].timestamp
                }))
            };
        } catch (error) {
            logger.error('Failed to get storage stats', error);
            return {
                available: this.isAvailable,
                keyCount: 0,
                storageSize: 0,
                storageDir: this.storageDir,
                keys: []
            };
        }
    }

    /**
     * Store API key securely
     */
    async storeApiKey(apiKey) {
        return await this.store('anthropic_api_key', apiKey);
    }

    /**
     * Retrieve API key
     */
    async getApiKey() {
        return await this.retrieve('anthropic_api_key');
    }

    /**
     * Remove API key
     */
    async removeApiKey() {
        return await this.remove('anthropic_api_key');
    }

    /**
     * Check if API key exists
     */
    async hasApiKey() {
        return await this.has('anthropic_api_key');
    }

    /**
     * Migrate from plaintext storage
     */
    async migrateFromPlaintext(plaintextApiKey) {
        if (!plaintextApiKey || !this.isAvailable) {
            return false;
        }

        try {
            await this.storeApiKey(plaintextApiKey);
            logger.info('API key migrated to secure storage');
            return true;
        } catch (error) {
            logger.error('Failed to migrate API key to secure storage', error);
            return false;
        }
    }

    /**
     * Export encrypted data (for backup)
     * Returns the encrypted buffer as base64
     */
    async exportEncrypted() {
        if (!this.isAvailable) {
            throw new Error('Secure storage not available');
        }

        try {
            const encryptedBuffer = await fs.readFile(this.encryptedDataFile);
            return {
                success: true,
                data: encryptedBuffer.toString('base64'),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    success: true,
                    data: null,
                    message: 'No encrypted data to export'
                };
            }
            throw error;
        }
    }

    /**
     * Import encrypted data (from backup)
     */
    async importEncrypted(base64Data) {
        if (!this.isAvailable) {
            throw new Error('Secure storage not available');
        }

        try {
            const encryptedBuffer = Buffer.from(base64Data, 'base64');
            
            // Verify we can decrypt it
            safeStorage.decryptString(encryptedBuffer);
            
            // Save the encrypted data
            await fs.writeFile(this.encryptedDataFile, encryptedBuffer);
            
            logger.info('Encrypted data imported successfully');
            return true;
        } catch (error) {
            logger.error('Failed to import encrypted data', error);
            throw error;
        }
    }
}

// Export singleton instance
module.exports = new SecureStorage();