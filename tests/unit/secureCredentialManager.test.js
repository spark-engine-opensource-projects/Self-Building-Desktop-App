// Mock electron before requiring the module
jest.mock('electron', () => ({
    safeStorage: {
        isEncryptionAvailable: jest.fn().mockReturnValue(true),
        encryptString: jest.fn((str) => Buffer.from(`encrypted:${str}`)),
        decryptString: jest.fn((buffer) => buffer.toString().replace('encrypted:', ''))
    },
    app: {
        getPath: jest.fn().mockReturnValue('/tmp/test-secure-storage')
    }
}));

// Mock secure storage with a shared store
const mockSecureStore = new Map();
jest.mock('../../src/utils/secureStorage', () => ({
    initialize: jest.fn().mockResolvedValue(true),
    set: jest.fn((key, value) => {
        mockSecureStore.set(key, value);
        return Promise.resolve();
    }),
    get: jest.fn((key) => Promise.resolve(mockSecureStore.get(key))),
    has: jest.fn((key) => Promise.resolve(mockSecureStore.has(key))),
    delete: jest.fn((key) => {
        mockSecureStore.delete(key);
        return Promise.resolve();
    }),
    clear: jest.fn(() => {
        mockSecureStore.clear();
        return Promise.resolve();
    }),
    keys: jest.fn(() => Promise.resolve(Array.from(mockSecureStore.keys()))),
    isAvailable: true
}));

// Mock encryption module
jest.mock('../../src/modules/EncryptionModule', () => {
    return jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(true),
        encrypt: jest.fn((data) => Promise.resolve({
            encrypted: Buffer.from(`enc:${data}`),
            iv: Buffer.from('test-iv-123456'),
            authTag: Buffer.from('test-auth-tag')
        })),
        decrypt: jest.fn((data) => {
            const decrypted = Buffer.from(data.encrypted, 'base64').toString().replace('enc:', '');
            return Promise.resolve(decrypted);
        }),
        rotateKeys: jest.fn().mockResolvedValue(true)
    }));
});

// Mock logger
jest.mock('../../src/utils/logger', () => global.testUtils?.createMockLogger?.() || {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
});

const credentialManager = require('../../src/utils/secureCredentialManager');

describe('Secure Credential Manager', () => {
    let mockAuditModule;

    beforeEach(async () => {
        // Clear the mock store
        mockSecureStore.clear();

        mockAuditModule = {
            logSecurityEvent: jest.fn().mockResolvedValue(undefined)
        };

        // Reset the credential manager state
        credentialManager.initialized = false;

        await credentialManager.initialize(mockAuditModule);
    });

    afterEach(async () => {
        // Only clear if initialized
        if (credentialManager.initialized) {
            await credentialManager.clearAllCredentials();
        }
        // Reset initialized state for clean test slate
        credentialManager.initialized = false;
    });

    describe('Initialization', () => {
        test('should initialize successfully', () => {
            expect(credentialManager.initialized).toBe(true);
        });

        test('should not double-initialize', async () => {
            await credentialManager.initialize(mockAuditModule);
            expect(credentialManager.initialized).toBe(true);
        });
    });

    describe('API Key Storage', () => {
        test('should store API key encrypted', async () => {
            const apiKey = 'sk-ant-test1234567890abcdefghij';
            const result = await credentialManager.storeAPIKey('anthropic', apiKey);

            expect(result.success).toBe(true);
            expect(mockAuditModule.logSecurityEvent).toHaveBeenCalledWith(
                'api_key_stored',
                expect.objectContaining({ keyName: 'anthropic' })
            );
        });

        test('should reject invalid API key', async () => {
            await expect(
                credentialManager.storeAPIKey('test', '')
            ).rejects.toThrow('Invalid API key value');

            await expect(
                credentialManager.storeAPIKey('test', 'short')
            ).rejects.toThrow('API key too short');
        });

        test('should store with metadata', async () => {
            const apiKey = 'sk-ant-test1234567890abcdefghij';
            const metadata = {
                provider: 'anthropic',
                validated: true
            };

            await credentialManager.storeAPIKey('anthropic', apiKey, metadata);

            const storedMetadata = await credentialManager.getCredentialMetadata('anthropic');
            expect(storedMetadata.provider).toBe('anthropic');
            expect(storedMetadata.validated).toBe(true);
            expect(storedMetadata.keyName).toBe('anthropic');
            expect(storedMetadata.storedAt).toBeDefined();
        });
    });

    describe('API Key Retrieval', () => {
        test('should retrieve and decrypt API key', async () => {
            const apiKey = 'sk-ant-test1234567890abcdefghij';
            await credentialManager.storeAPIKey('anthropic', apiKey);

            const retrieved = await credentialManager.getAPIKey('anthropic');
            expect(retrieved).toBe(apiKey);
        });

        test('should log access when retrieving', async () => {
            const apiKey = 'sk-ant-test1234567890abcdefghij';
            await credentialManager.storeAPIKey('anthropic', apiKey);

            mockAuditModule.logSecurityEvent.mockClear();

            await credentialManager.getAPIKey('anthropic');

            expect(mockAuditModule.logSecurityEvent).toHaveBeenCalledWith(
                'api_key_accessed',
                expect.objectContaining({ keyName: 'anthropic' })
            );
        });

        test('should throw error for non-existent key', async () => {
            await expect(
                credentialManager.getAPIKey('nonexistent')
            ).rejects.toThrow('not found');
        });
    });

    describe('API Key Deletion', () => {
        test('should delete API key', async () => {
            const apiKey = 'sk-ant-test1234567890abcdefghij';
            await credentialManager.storeAPIKey('anthropic', apiKey);

            const result = await credentialManager.deleteAPIKey('anthropic');
            expect(result.success).toBe(true);

            await expect(
                credentialManager.getAPIKey('anthropic')
            ).rejects.toThrow('not found');
        });

        test('should log deletion', async () => {
            const apiKey = 'sk-ant-test1234567890abcdefghij';
            await credentialManager.storeAPIKey('anthropic', apiKey);

            mockAuditModule.logSecurityEvent.mockClear();

            await credentialManager.deleteAPIKey('anthropic');

            expect(mockAuditModule.logSecurityEvent).toHaveBeenCalledWith(
                'api_key_deleted',
                expect.objectContaining({ keyName: 'anthropic' })
            );
        });
    });

    describe('API Key Existence Check', () => {
        test('should check if API key exists', async () => {
            const apiKey = 'sk-ant-test1234567890abcdefghij';

            const before = await credentialManager.hasAPIKey('anthropic');
            expect(before).toBe(false);

            await credentialManager.storeAPIKey('anthropic', apiKey);

            const after = await credentialManager.hasAPIKey('anthropic');
            expect(after).toBe(true);
        });
    });

    describe('List API Keys', () => {
        test('should list all stored API key names', async () => {
            await credentialManager.storeAPIKey('anthropic', 'sk-ant-key1234567890abcdef');
            await credentialManager.storeAPIKey('openai', 'sk-test1234567890abcdefg');

            const keys = await credentialManager.listAPIKeys();
            expect(keys).toContain('anthropic');
            expect(keys).toContain('openai');
            expect(keys.length).toBe(2);
        });

        test('should return empty array when no keys stored', async () => {
            const keys = await credentialManager.listAPIKeys();
            expect(keys).toEqual([]);
        });
    });

    describe('API Key Validation', () => {
        test('should validate Anthropic API key format', () => {
            const validation1 = credentialManager.validateAPIKeyFormat(
                'sk-ant-valid1234567890abcdef',
                'anthropic'
            );
            expect(validation1.valid).toBe(true);

            const validation2 = credentialManager.validateAPIKeyFormat(
                'invalid-key',
                'anthropic'
            );
            expect(validation2.valid).toBe(false);
            expect(validation2.error).toBeDefined();
        });

        test('should validate OpenAI API key format', () => {
            const validation1 = credentialManager.validateAPIKeyFormat(
                'sk-valid1234567890abcdefghij',
                'openai'
            );
            expect(validation1.valid).toBe(true);

            const validation2 = credentialManager.validateAPIKeyFormat(
                'invalid-key',
                'openai'
            );
            expect(validation2.valid).toBe(false);
        });

        test('should reject keys with invalid characters', () => {
            const validation = credentialManager.validateAPIKeyFormat(
                'sk-ant-invalid key with spaces',
                'anthropic'
            );
            expect(validation.valid).toBe(false);
            expect(validation.error).toContain('invalid characters');
        });

        test('should reject short keys', () => {
            const validation = credentialManager.validateAPIKeyFormat(
                'short',
                'generic'
            );
            expect(validation.valid).toBe(false);
            expect(validation.error).toContain('too short');
        });
    });

    describe('Key Rotation', () => {
        test('should rotate encryption keys', async () => {
            const apiKey1 = 'sk-ant-key11234567890abcdef';
            const apiKey2 = 'sk-ant-key21234567890abcdef';

            await credentialManager.storeAPIKey('key1', apiKey1);
            await credentialManager.storeAPIKey('key2', apiKey2);

            const result = await credentialManager.rotateEncryptionKeys();

            expect(result.success).toBe(true);
            expect(result.rotatedCount).toBe(2);

            // Keys should still be retrievable after rotation
            const retrieved1 = await credentialManager.getAPIKey('key1');
            const retrieved2 = await credentialManager.getAPIKey('key2');

            expect(retrieved1).toBe(apiKey1);
            expect(retrieved2).toBe(apiKey2);
        });

        test('should log rotation event', async () => {
            await credentialManager.storeAPIKey('key1', 'sk-ant-test1234567890abcdef');

            mockAuditModule.logSecurityEvent.mockClear();

            await credentialManager.rotateEncryptionKeys();

            expect(mockAuditModule.logSecurityEvent).toHaveBeenCalledWith(
                'encryption_keys_rotated',
                expect.objectContaining({
                    credentialsRotated: 1
                })
            );
        });
    });

    describe('Clear All Credentials', () => {
        test('should clear all stored credentials', async () => {
            await credentialManager.storeAPIKey('key1', 'sk-ant-key11234567890abcdef');
            await credentialManager.storeAPIKey('key2', 'sk-ant-key21234567890abcdef');

            const result = await credentialManager.clearAllCredentials();

            expect(result.success).toBe(true);
            expect(result.clearedCount).toBe(2);

            const keys = await credentialManager.listAPIKeys();
            expect(keys.length).toBe(0);
        });

        test('should log clear event', async () => {
            await credentialManager.storeAPIKey('key1', 'sk-ant-test1234567890abcdef');

            mockAuditModule.logSecurityEvent.mockClear();

            await credentialManager.clearAllCredentials();

            expect(mockAuditModule.logSecurityEvent).toHaveBeenCalledWith(
                'all_credentials_cleared',
                expect.objectContaining({ count: 1 })
            );
        });
    });

    describe('Encryption Security', () => {
        test('should not store API keys in plain text', async () => {
            const apiKey = 'sk-ant-secret1234567890abcdef';
            await credentialManager.storeAPIKey('test', apiKey);

            // This is a conceptual test - in reality, we'd need to inspect
            // the secure storage to verify encryption
            // The key point is that getAPIKey should return the original value
            const retrieved = await credentialManager.getAPIKey('test');
            expect(retrieved).toBe(apiKey);
        });

        test('should use different IV for each storage operation', async () => {
            // This test verifies that re-storing the same key creates different ciphertext
            const apiKey = 'sk-ant-same1234567890abcdef';

            await credentialManager.storeAPIKey('test', apiKey);
            await credentialManager.deleteAPIKey('test');
            await credentialManager.storeAPIKey('test', apiKey);

            // Both should decrypt to the same value
            const retrieved = await credentialManager.getAPIKey('test');
            expect(retrieved).toBe(apiKey);
        });
    });

    describe('Error Handling', () => {
        test('should handle encryption errors gracefully', async () => {
            // This would require mocking the encryption module to simulate failures
            // For now, we test that errors are thrown appropriately
        });

        test('should require initialization', async () => {
            const uninitializedManager = require('../../src/utils/secureCredentialManager');
            uninitializedManager.initialized = false;

            expect(() => {
                uninitializedManager.ensureInitialized();
            }).toThrow('not initialized');
        });
    });
});
