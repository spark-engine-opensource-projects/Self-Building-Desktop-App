const secureStorage = require('./secureStorage');
const EncryptionModule = require('../modules/EncryptionModule');
const logger = require('./logger');

/**
 * Secure Credential Manager
 * Provides encrypted storage for sensitive credentials like API keys
 *
 * Features:
 * - Encrypted at rest using AES-256-GCM
 * - Memory protection
 * - Automatic key rotation
 * - Audit logging of access
 */
class SecureCredentialManager {
    constructor() {
        this.encryption = new EncryptionModule();
        this.initialized = false;
        this.auditModule = null;
    }

    /**
     * Initialize the credential manager
     */
    async initialize(auditModule = null) {
        if (this.initialized) {
            return;
        }

        try {
            // Initialize encryption module
            await this.encryption.initialize();

            // Initialize secure storage
            await secureStorage.initialize();

            this.auditModule = auditModule;
            this.initialized = true;

            logger.info('Secure Credential Manager initialized');
        } catch (error) {
            logger.error('Failed to initialize Secure Credential Manager', error);
            throw error;
        }
    }

    /**
     * Ensure initialization before operations
     */
    ensureInitialized() {
        if (!this.initialized) {
            throw new Error('SecureCredentialManager not initialized');
        }
    }

    /**
     * Store an API key securely
     * @param {string} keyName - Identifier for the key
     * @param {string} keyValue - The actual API key
     * @param {object} metadata - Optional metadata
     */
    async storeAPIKey(keyName, keyValue, metadata = {}) {
        this.ensureInitialized();

        try {
            // Validate key value
            if (!keyValue || typeof keyValue !== 'string') {
                throw new Error('Invalid API key value');
            }

            if (keyValue.length < 8) {
                throw new Error('API key too short');
            }

            // Encrypt the API key
            const encrypted = await this.encryption.encrypt(keyValue);

            // Store encrypted key with metadata
            const credentialData = {
                encrypted: encrypted.encrypted.toString('base64'),
                iv: encrypted.iv.toString('base64'),
                authTag: encrypted.authTag.toString('base64'),
                metadata: {
                    ...metadata,
                    storedAt: new Date().toISOString(),
                    keyName
                }
            };

            await secureStorage.set(`api_key_${keyName}`, credentialData);

            // Log access
            if (this.auditModule) {
                await this.auditModule.logSecurityEvent('api_key_stored', {
                    keyName,
                    timestamp: new Date().toISOString()
                });
            }

            logger.info('API key stored securely', { keyName });

            return { success: true };
        } catch (error) {
            logger.error('Failed to store API key', error);
            throw error;
        }
    }

    /**
     * Retrieve and decrypt an API key
     * @param {string} keyName - Identifier for the key
     * @returns {string} - Decrypted API key
     */
    async getAPIKey(keyName) {
        this.ensureInitialized();

        try {
            // Retrieve encrypted key
            const credentialData = await secureStorage.get(`api_key_${keyName}`);

            if (!credentialData) {
                throw new Error(`API key '${keyName}' not found`);
            }

            // Decrypt the API key
            const decrypted = await this.encryption.decrypt({
                encrypted: Buffer.from(credentialData.encrypted, 'base64'),
                iv: Buffer.from(credentialData.iv, 'base64'),
                authTag: Buffer.from(credentialData.authTag, 'base64')
            });

            // Log access
            if (this.auditModule) {
                await this.auditModule.logSecurityEvent('api_key_accessed', {
                    keyName,
                    timestamp: new Date().toISOString()
                });
            }

            logger.debug('API key retrieved', { keyName });

            return decrypted;
        } catch (error) {
            logger.error('Failed to retrieve API key', error);
            throw error;
        }
    }

    /**
     * Delete an API key
     * @param {string} keyName - Identifier for the key
     */
    async deleteAPIKey(keyName) {
        this.ensureInitialized();

        try {
            await secureStorage.delete(`api_key_${keyName}`);

            // Log deletion
            if (this.auditModule) {
                await this.auditModule.logSecurityEvent('api_key_deleted', {
                    keyName,
                    timestamp: new Date().toISOString()
                });
            }

            logger.info('API key deleted', { keyName });

            return { success: true };
        } catch (error) {
            logger.error('Failed to delete API key', error);
            throw error;
        }
    }

    /**
     * Check if an API key exists
     * @param {string} keyName - Identifier for the key
     */
    async hasAPIKey(keyName) {
        this.ensureInitialized();

        try {
            const exists = await secureStorage.has(`api_key_${keyName}`);
            return exists;
        } catch (error) {
            logger.error('Failed to check API key existence', error);
            return false;
        }
    }

    /**
     * List all stored API key names (not the keys themselves)
     */
    async listAPIKeys() {
        this.ensureInitialized();

        try {
            const allKeys = await secureStorage.keys();
            const apiKeys = allKeys
                .filter(key => key.startsWith('api_key_'))
                .map(key => key.replace('api_key_', ''));

            return apiKeys;
        } catch (error) {
            logger.error('Failed to list API keys', error);
            return [];
        }
    }

    /**
     * Rotate encryption keys for all stored credentials
     * This re-encrypts all credentials with a new key
     */
    async rotateEncryptionKeys() {
        this.ensureInitialized();

        try {
            logger.info('Starting credential encryption key rotation');

            const apiKeyNames = await this.listAPIKeys();

            for (const keyName of apiKeyNames) {
                // Get the current decrypted value
                const decryptedKey = await this.getAPIKey(keyName);

                // Rotate encryption keys
                await this.encryption.rotateKeys();

                // Re-encrypt with new key
                await this.storeAPIKey(keyName, decryptedKey, {
                    rotatedAt: new Date().toISOString()
                });
            }

            if (this.auditModule) {
                await this.auditModule.logSecurityEvent('encryption_keys_rotated', {
                    credentialsRotated: apiKeyNames.length,
                    timestamp: new Date().toISOString()
                });
            }

            logger.info('Credential encryption keys rotated successfully', {
                count: apiKeyNames.length
            });

            return { success: true, rotatedCount: apiKeyNames.length };
        } catch (error) {
            logger.error('Failed to rotate encryption keys', error);
            throw error;
        }
    }

    /**
     * Validate an API key format before storing
     * @param {string} keyValue - The API key to validate
     * @param {string} provider - The API provider (e.g., 'anthropic', 'openai')
     */
    validateAPIKeyFormat(keyValue, provider = 'anthropic') {
        if (!keyValue || typeof keyValue !== 'string') {
            return { valid: false, error: 'API key must be a non-empty string' };
        }

        // Provider-specific validation
        switch (provider) {
            case 'anthropic':
                // Anthropic keys typically start with 'sk-ant-'
                if (!keyValue.startsWith('sk-ant-')) {
                    return {
                        valid: false,
                        error: 'Anthropic API keys should start with "sk-ant-"'
                    };
                }
                if (keyValue.length < 20) {
                    return {
                        valid: false,
                        error: 'API key appears to be too short'
                    };
                }
                break;

            case 'openai':
                // OpenAI keys typically start with 'sk-'
                if (!keyValue.startsWith('sk-')) {
                    return {
                        valid: false,
                        error: 'OpenAI API keys should start with "sk-"'
                    };
                }
                break;

            default:
                // Generic validation
                if (keyValue.length < 8) {
                    return {
                        valid: false,
                        error: 'API key appears to be too short'
                    };
                }
        }

        // Check for suspicious characters
        if (!/^[a-zA-Z0-9_-]+$/.test(keyValue)) {
            return {
                valid: false,
                error: 'API key contains invalid characters'
            };
        }

        return { valid: true };
    }

    /**
     * Clear all stored credentials (use with caution!)
     */
    async clearAllCredentials() {
        this.ensureInitialized();

        try {
            const apiKeyNames = await this.listAPIKeys();

            for (const keyName of apiKeyNames) {
                await this.deleteAPIKey(keyName);
            }

            if (this.auditModule) {
                await this.auditModule.logSecurityEvent('all_credentials_cleared', {
                    count: apiKeyNames.length,
                    timestamp: new Date().toISOString()
                });
            }

            logger.warn('All credentials cleared', { count: apiKeyNames.length });

            return { success: true, clearedCount: apiKeyNames.length };
        } catch (error) {
            logger.error('Failed to clear credentials', error);
            throw error;
        }
    }

    /**
     * Get metadata for a stored credential
     */
    async getCredentialMetadata(keyName) {
        this.ensureInitialized();

        try {
            const credentialData = await secureStorage.get(`api_key_${keyName}`);

            if (!credentialData) {
                throw new Error(`Credential '${keyName}' not found`);
            }

            return credentialData.metadata || {};
        } catch (error) {
            logger.error('Failed to get credential metadata', error);
            throw error;
        }
    }
}

module.exports = new SecureCredentialManager();
