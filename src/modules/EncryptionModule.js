const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const { subtle } = require('crypto').webcrypto;

/**
 * EncryptionModule - Comprehensive encryption and data protection system
 * Implements AES, RSA, hashing, signing, and secure key management
 */
class EncryptionModule extends EventEmitter {
    constructor() {
        super();
        this.algorithm = 'aes-256-gcm';
        this.keyDerivationAlgorithm = 'pbkdf2';
        this.hashAlgorithm = 'sha256';
        this.rsaKeySize = 4096;
        this.keys = new Map();
        this.certificates = new Map();
        this.keyStore = null;
        this.masterKey = null;
        this.saltRounds = 100000;
        this.ivLength = 16;
        this.tagLength = 16;
        this.saltLength = 32;
    }

    /**
     * Initialize encryption module
     */
    async initialize(config = {}) {
        try {
            this.config = {
                keyStorePath: config.keyStorePath || path.join(process.cwd(), 'data', 'keystore'),
                autoRotate: config.autoRotate !== false,
                rotationInterval: config.rotationInterval || 30 * 24 * 60 * 60 * 1000, // 30 days
                secureMode: config.secureMode !== false,
                ...config
            };

            // Initialize key store
            await this.initializeKeyStore();

            // Load or generate master key
            await this.initializeMasterKey();

            // Load existing keys
            await this.loadKeys();

            // Setup key rotation if enabled
            if (this.config.autoRotate) {
                this.setupKeyRotation();
            }

            console.log('Encryption module initialized');
            this.emit('initialized');

            return { success: true };
        } catch (error) {
            console.error('Failed to initialize encryption module:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Initialize key store
     */
    async initializeKeyStore() {
        await fs.mkdir(this.config.keyStorePath, { recursive: true });
        
        this.keyStore = {
            path: this.config.keyStorePath,
            keys: new Map(),
            metadata: {
                created: Date.now(),
                lastModified: Date.now(),
                version: '1.0.0'
            }
        };
    }

    /**
     * Initialize master key
     */
    async initializeMasterKey() {
        const masterKeyPath = path.join(this.config.keyStorePath, 'master.key');
        
        try {
            // Try to load existing master key
            const keyData = await fs.readFile(masterKeyPath);
            this.masterKey = Buffer.from(keyData.toString(), 'hex');
        } catch (error) {
            // Generate new master key
            this.masterKey = crypto.randomBytes(32);
            await fs.writeFile(masterKeyPath, this.masterKey.toString('hex'), {
                mode: 0o600 // Read/write for owner only
            });
        }
    }

    /**
     * Encrypt data using AES-256-GCM
     */
    async encrypt(data, keyId = null) {
        try {
            // Convert data to buffer if needed
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
            
            // Get or generate key
            const key = keyId ? this.keys.get(keyId) : await this.generateKey();
            if (!key) {
                throw new Error('Encryption key not found');
            }

            // Generate IV
            const iv = crypto.randomBytes(this.ivLength);
            
            // Create cipher
            const cipher = crypto.createCipheriv(this.algorithm, key.value, iv);
            
            // Encrypt data
            const encrypted = Buffer.concat([
                cipher.update(buffer),
                cipher.final()
            ]);
            
            // Get auth tag
            const tag = cipher.getAuthTag();
            
            // Combine IV, tag, and encrypted data
            const result = Buffer.concat([iv, tag, encrypted]);
            
            this.emit('data-encrypted', { size: buffer.length });
            
            return {
                success: true,
                encrypted: result.toString('base64'),
                keyId: key.id,
                algorithm: this.algorithm
            };
        } catch (error) {
            console.error('Encryption failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Decrypt data using AES-256-GCM
     */
    async decrypt(encryptedData, keyId) {
        try {
            // Convert from base64
            const buffer = Buffer.from(encryptedData, 'base64');
            
            // Extract components
            const iv = buffer.slice(0, this.ivLength);
            const tag = buffer.slice(this.ivLength, this.ivLength + this.tagLength);
            const encrypted = buffer.slice(this.ivLength + this.tagLength);
            
            // Get key
            const key = this.keys.get(keyId);
            if (!key) {
                throw new Error('Decryption key not found');
            }

            // Create decipher
            const decipher = crypto.createDecipheriv(this.algorithm, key.value, iv);
            decipher.setAuthTag(tag);
            
            // Decrypt data
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);
            
            // Try to parse as JSON
            try {
                return {
                    success: true,
                    data: JSON.parse(decrypted.toString())
                };
            } catch {
                // Return as buffer if not JSON
                return {
                    success: true,
                    data: decrypted
                };
            }
        } catch (error) {
            console.error('Decryption failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Encrypt file
     */
    async encryptFile(inputPath, outputPath = null) {
        try {
            const data = await fs.readFile(inputPath);
            const result = await this.encrypt(data);
            
            if (!result.success) {
                throw new Error(result.error);
            }

            const encryptedPath = outputPath || `${inputPath}.enc`;
            
            // Write encrypted file
            await fs.writeFile(encryptedPath, result.encrypted);
            
            // Write metadata
            const metadataPath = `${encryptedPath}.meta`;
            await fs.writeFile(metadataPath, JSON.stringify({
                originalName: path.basename(inputPath),
                keyId: result.keyId,
                algorithm: result.algorithm,
                encryptedAt: Date.now(),
                size: data.length
            }, null, 2));
            
            this.emit('file-encrypted', { path: inputPath });
            
            return {
                success: true,
                encryptedPath,
                metadataPath,
                keyId: result.keyId
            };
        } catch (error) {
            console.error('File encryption failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Decrypt file
     */
    async decryptFile(encryptedPath, outputPath = null) {
        try {
            // Read encrypted data
            const encryptedData = await fs.readFile(encryptedPath, 'utf8');
            
            // Read metadata
            const metadataPath = `${encryptedPath}.meta`;
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            
            // Decrypt data
            const result = await this.decrypt(encryptedData, metadata.keyId);
            
            if (!result.success) {
                throw new Error(result.error);
            }

            const decryptedPath = outputPath || 
                path.join(path.dirname(encryptedPath), metadata.originalName);
            
            // Write decrypted file
            await fs.writeFile(decryptedPath, result.data);
            
            this.emit('file-decrypted', { path: decryptedPath });
            
            return {
                success: true,
                decryptedPath
            };
        } catch (error) {
            console.error('File decryption failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate RSA key pair
     */
    async generateRSAKeyPair(keySize = this.rsaKeySize) {
        try {
            const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
                modulusLength: keySize,
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem'
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem',
                    cipher: 'aes-256-cbc',
                    passphrase: this.masterKey.toString('hex')
                }
            });

            const keyId = this.generateKeyId();
            
            const keyPair = {
                id: keyId,
                publicKey,
                privateKey,
                type: 'rsa',
                size: keySize,
                created: Date.now()
            };

            this.keys.set(keyId, keyPair);
            await this.saveKeys();
            
            this.emit('rsa-keypair-generated', { keyId });
            
            return {
                success: true,
                keyId,
                publicKey
            };
        } catch (error) {
            console.error('RSA key generation failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Encrypt with RSA public key
     */
    async encryptRSA(data, publicKey) {
        try {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
            
            const encrypted = crypto.publicEncrypt(
                {
                    key: publicKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256'
                },
                buffer
            );
            
            return {
                success: true,
                encrypted: encrypted.toString('base64')
            };
        } catch (error) {
            console.error('RSA encryption failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Decrypt with RSA private key
     */
    async decryptRSA(encryptedData, keyId) {
        try {
            const keyPair = this.keys.get(keyId);
            if (!keyPair || keyPair.type !== 'rsa') {
                throw new Error('RSA key not found');
            }

            const buffer = Buffer.from(encryptedData, 'base64');
            
            const decrypted = crypto.privateDecrypt(
                {
                    key: keyPair.privateKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256',
                    passphrase: this.masterKey.toString('hex')
                },
                buffer
            );
            
            try {
                return {
                    success: true,
                    data: JSON.parse(decrypted.toString())
                };
            } catch {
                return {
                    success: true,
                    data: decrypted
                };
            }
        } catch (error) {
            console.error('RSA decryption failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Sign data with RSA private key
     */
    async sign(data, keyId) {
        try {
            const keyPair = this.keys.get(keyId);
            if (!keyPair || keyPair.type !== 'rsa') {
                throw new Error('RSA key not found');
            }

            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
            
            const sign = crypto.createSign('SHA256');
            sign.update(buffer);
            sign.end();
            
            const signature = sign.sign({
                key: keyPair.privateKey,
                passphrase: this.masterKey.toString('hex')
            });
            
            return {
                success: true,
                signature: signature.toString('base64')
            };
        } catch (error) {
            console.error('Signing failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verify signature with RSA public key
     */
    async verify(data, signature, publicKey) {
        try {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
            const signatureBuffer = Buffer.from(signature, 'base64');
            
            const verify = crypto.createVerify('SHA256');
            verify.update(buffer);
            verify.end();
            
            const isValid = verify.verify(publicKey, signatureBuffer);
            
            return {
                success: true,
                valid: isValid
            };
        } catch (error) {
            console.error('Verification failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Hash data
     */
    hash(data, algorithm = this.hashAlgorithm) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
        return crypto.createHash(algorithm).update(buffer).digest('hex');
    }

    /**
     * Compare hash
     */
    compareHash(data, hash, algorithm = this.hashAlgorithm) {
        const dataHash = this.hash(data, algorithm);
        return crypto.timingSafeEqual(
            Buffer.from(dataHash),
            Buffer.from(hash)
        );
    }

    /**
     * Derive key from password using PBKDF2
     */
    async deriveKey(password, salt = null, iterations = this.saltRounds) {
        return new Promise((resolve, reject) => {
            const saltBuffer = salt ? Buffer.from(salt, 'hex') : crypto.randomBytes(this.saltLength);
            
            crypto.pbkdf2(password, saltBuffer, iterations, 32, 'sha256', (err, derivedKey) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        key: derivedKey,
                        salt: saltBuffer.toString('hex'),
                        iterations
                    });
                }
            });
        });
    }

    /**
     * Generate encryption key
     */
    async generateKey(type = 'aes') {
        try {
            const keyId = this.generateKeyId();
            let key;

            switch (type) {
                case 'aes':
                    key = {
                        id: keyId,
                        type: 'aes',
                        value: crypto.randomBytes(32),
                        created: Date.now(),
                        algorithm: this.algorithm
                    };
                    break;
                
                case 'hmac':
                    key = {
                        id: keyId,
                        type: 'hmac',
                        value: crypto.randomBytes(64),
                        created: Date.now(),
                        algorithm: 'sha256'
                    };
                    break;
                
                default:
                    throw new Error(`Unknown key type: ${type}`);
            }

            this.keys.set(keyId, key);
            await this.saveKeys();
            
            this.emit('key-generated', { keyId, type });
            
            return key;
        } catch (error) {
            console.error('Key generation failed:', error);
            throw error;
        }
    }

    /**
     * Generate HMAC
     */
    generateHMAC(data, keyId) {
        const key = this.keys.get(keyId);
        if (!key || key.type !== 'hmac') {
            throw new Error('HMAC key not found');
        }

        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
        const hmac = crypto.createHmac(key.algorithm, key.value);
        hmac.update(buffer);
        
        return hmac.digest('hex');
    }

    /**
     * Verify HMAC
     */
    verifyHMAC(data, hmac, keyId) {
        const expectedHMAC = this.generateHMAC(data, keyId);
        return crypto.timingSafeEqual(
            Buffer.from(expectedHMAC),
            Buffer.from(hmac)
        );
    }

    /**
     * Encrypt sensitive fields in object
     */
    async encryptObject(obj, fieldsToEncrypt = []) {
        try {
            const result = { ...obj };
            const encryptionMap = {};

            for (const field of fieldsToEncrypt) {
                if (field in obj) {
                    const encrypted = await this.encrypt(obj[field]);
                    if (encrypted.success) {
                        result[field] = encrypted.encrypted;
                        encryptionMap[field] = {
                            keyId: encrypted.keyId,
                            algorithm: encrypted.algorithm
                        };
                    }
                }
            }

            return {
                success: true,
                data: result,
                encryptionMap
            };
        } catch (error) {
            console.error('Object encryption failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Decrypt sensitive fields in object
     */
    async decryptObject(obj, encryptionMap) {
        try {
            const result = { ...obj };

            for (const [field, info] of Object.entries(encryptionMap)) {
                if (field in obj) {
                    const decrypted = await this.decrypt(obj[field], info.keyId);
                    if (decrypted.success) {
                        result[field] = decrypted.data;
                    }
                }
            }

            return {
                success: true,
                data: result
            };
        } catch (error) {
            console.error('Object decryption failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate self-signed certificate
     */
    async generateCertificate(options = {}) {
        try {
            const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048
            });

            // Create certificate
            const cert = {
                subject: options.subject || '/C=US/ST=State/L=City/O=Organization/CN=localhost',
                issuer: options.issuer || '/C=US/ST=State/L=City/O=Organization/CN=localhost',
                validFrom: new Date(),
                validTo: new Date(Date.now() + (365 * 24 * 60 * 60 * 1000)), // 1 year
                serialNumber: crypto.randomBytes(16).toString('hex'),
                publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
                privateKey: privateKey.export({ 
                    type: 'pkcs8', 
                    format: 'pem',
                    cipher: 'aes-256-cbc',
                    passphrase: this.masterKey.toString('hex')
                })
            };

            const certId = this.generateKeyId();
            this.certificates.set(certId, cert);

            this.emit('certificate-generated', { certId });

            return {
                success: true,
                certId,
                certificate: cert
            };
        } catch (error) {
            console.error('Certificate generation failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Create secure tunnel
     */
    async createSecureTunnel(data, recipientPublicKey) {
        try {
            // Generate ephemeral AES key
            const aesKey = crypto.randomBytes(32);
            const iv = crypto.randomBytes(this.ivLength);
            
            // Encrypt data with AES
            const cipher = crypto.createCipheriv(this.algorithm, aesKey, iv);
            const encryptedData = Buffer.concat([
                cipher.update(Buffer.from(JSON.stringify(data))),
                cipher.final()
            ]);
            const tag = cipher.getAuthTag();
            
            // Encrypt AES key with recipient's RSA public key
            const encryptedKey = crypto.publicEncrypt(
                {
                    key: recipientPublicKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256'
                },
                aesKey
            );
            
            return {
                success: true,
                envelope: {
                    encryptedKey: encryptedKey.toString('base64'),
                    iv: iv.toString('base64'),
                    tag: tag.toString('base64'),
                    data: encryptedData.toString('base64')
                }
            };
        } catch (error) {
            console.error('Secure tunnel creation failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Open secure tunnel
     */
    async openSecureTunnel(envelope, privateKeyId) {
        try {
            const keyPair = this.keys.get(privateKeyId);
            if (!keyPair || keyPair.type !== 'rsa') {
                throw new Error('Private key not found');
            }

            // Decrypt AES key with private RSA key
            const aesKey = crypto.privateDecrypt(
                {
                    key: keyPair.privateKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256',
                    passphrase: this.masterKey.toString('hex')
                },
                Buffer.from(envelope.encryptedKey, 'base64')
            );
            
            // Decrypt data with AES key
            const decipher = crypto.createDecipheriv(
                this.algorithm,
                aesKey,
                Buffer.from(envelope.iv, 'base64')
            );
            decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
            
            const decryptedData = Buffer.concat([
                decipher.update(Buffer.from(envelope.data, 'base64')),
                decipher.final()
            ]);
            
            return {
                success: true,
                data: JSON.parse(decryptedData.toString())
            };
        } catch (error) {
            console.error('Secure tunnel opening failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup key rotation
     */
    setupKeyRotation() {
        setInterval(async () => {
            await this.rotateKeys();
        }, this.config.rotationInterval);
    }

    /**
     * Rotate encryption keys
     */
    async rotateKeys() {
        try {
            const now = Date.now();
            const keysToRotate = [];

            for (const [keyId, key] of this.keys) {
                if (now - key.created > this.config.rotationInterval) {
                    keysToRotate.push(keyId);
                }
            }

            for (const keyId of keysToRotate) {
                const oldKey = this.keys.get(keyId);
                
                // Generate new key of same type
                const newKey = await this.generateKey(oldKey.type);
                
                // Archive old key
                oldKey.archived = true;
                oldKey.archivedAt = now;
                oldKey.replacedBy = newKey.id;
                
                this.emit('key-rotated', { oldKeyId: keyId, newKeyId: newKey.id });
            }

            await this.saveKeys();

            return {
                success: true,
                rotatedCount: keysToRotate.length
            };
        } catch (error) {
            console.error('Key rotation failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Export key
     */
    async exportKey(keyId, password) {
        try {
            const key = this.keys.get(keyId);
            if (!key) {
                throw new Error('Key not found');
            }

            // Derive encryption key from password
            const derived = await this.deriveKey(password);
            
            // Encrypt key data
            const cipher = crypto.createCipheriv(
                'aes-256-gcm',
                derived.key,
                Buffer.from(derived.salt, 'hex').slice(0, 16)
            );
            
            const keyData = JSON.stringify({
                ...key,
                value: key.value ? key.value.toString('base64') : undefined
            });
            
            const encrypted = Buffer.concat([
                cipher.update(keyData, 'utf8'),
                cipher.final()
            ]);
            
            const tag = cipher.getAuthTag();
            
            return {
                success: true,
                exportData: {
                    keyId,
                    encrypted: encrypted.toString('base64'),
                    salt: derived.salt,
                    tag: tag.toString('base64'),
                    iterations: derived.iterations
                }
            };
        } catch (error) {
            console.error('Key export failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Import key
     */
    async importKey(exportData, password) {
        try {
            // Derive decryption key from password
            const derived = await this.deriveKey(password, exportData.salt, exportData.iterations);
            
            // Decrypt key data
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                derived.key,
                Buffer.from(exportData.salt, 'hex').slice(0, 16)
            );
            decipher.setAuthTag(Buffer.from(exportData.tag, 'base64'));
            
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(exportData.encrypted, 'base64')),
                decipher.final()
            ]);
            
            const keyData = JSON.parse(decrypted.toString());
            
            // Restore key
            if (keyData.value) {
                keyData.value = Buffer.from(keyData.value, 'base64');
            }
            
            this.keys.set(keyData.id, keyData);
            await this.saveKeys();
            
            this.emit('key-imported', { keyId: keyData.id });
            
            return {
                success: true,
                keyId: keyData.id
            };
        } catch (error) {
            console.error('Key import failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate secure random bytes
     */
    generateSecureRandom(length) {
        return crypto.randomBytes(length);
    }

    /**
     * Generate secure random string
     */
    generateSecureRandomString(length, charset = 'alphanumeric') {
        const charsets = {
            alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
            alphabetic: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
            numeric: '0123456789',
            hex: '0123456789abcdef',
            base64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
        };

        const chars = charsets[charset] || charsets.alphanumeric;
        const randomBytes = crypto.randomBytes(length);
        let result = '';

        for (let i = 0; i < length; i++) {
            result += chars[randomBytes[i] % chars.length];
        }

        return result;
    }

    /**
     * Generate key ID
     */
    generateKeyId() {
        return `key_${crypto.randomBytes(16).toString('hex')}`;
    }

    /**
     * Save keys to storage
     */
    async saveKeys() {
        try {
            const keysPath = path.join(this.config.keyStorePath, 'keys.enc');
            
            // Prepare keys for storage
            const keysData = {};
            for (const [keyId, key] of this.keys) {
                keysData[keyId] = {
                    ...key,
                    value: key.value ? key.value.toString('base64') : undefined
                };
            }
            
            // Encrypt keys with master key
            const cipher = crypto.createCipheriv(
                'aes-256-gcm',
                this.masterKey,
                this.masterKey.slice(0, 16)
            );
            
            const encrypted = Buffer.concat([
                cipher.update(JSON.stringify(keysData), 'utf8'),
                cipher.final()
            ]);
            
            const tag = cipher.getAuthTag();
            
            // Save encrypted keys
            await fs.writeFile(keysPath, Buffer.concat([tag, encrypted]), {
                mode: 0o600
            });
        } catch (error) {
            console.error('Failed to save keys:', error);
        }
    }

    /**
     * Load keys from storage
     */
    async loadKeys() {
        try {
            const keysPath = path.join(this.config.keyStorePath, 'keys.enc');
            const data = await fs.readFile(keysPath);
            
            // Extract tag and encrypted data
            const tag = data.slice(0, 16);
            const encrypted = data.slice(16);
            
            // Decrypt keys with master key
            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                this.masterKey,
                this.masterKey.slice(0, 16)
            );
            decipher.setAuthTag(tag);
            
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);
            
            const keysData = JSON.parse(decrypted.toString());
            
            // Restore keys
            for (const [keyId, key] of Object.entries(keysData)) {
                if (key.value) {
                    key.value = Buffer.from(key.value, 'base64');
                }
                this.keys.set(keyId, key);
            }
        } catch (error) {
            // No existing keys file
            console.log('No existing keys found');
        }
    }

    /**
     * Get encryption statistics
     */
    getStatistics() {
        let aesKeys = 0;
        let rsaKeys = 0;
        let hmacKeys = 0;
        let archivedKeys = 0;

        for (const key of this.keys.values()) {
            if (key.archived) {
                archivedKeys++;
            } else {
                switch (key.type) {
                    case 'aes': aesKeys++; break;
                    case 'rsa': rsaKeys++; break;
                    case 'hmac': hmacKeys++; break;
                }
            }
        }

        return {
            totalKeys: this.keys.size,
            aesKeys,
            rsaKeys,
            hmacKeys,
            archivedKeys,
            certificates: this.certificates.size,
            algorithm: this.algorithm,
            keyDerivationAlgorithm: this.keyDerivationAlgorithm,
            hashAlgorithm: this.hashAlgorithm
        };
    }

    /**
     * Cleanup encryption module
     */
    async cleanup() {
        try {
            // Save keys before cleanup
            await this.saveKeys();
            
            // Clear sensitive data
            this.keys.clear();
            this.certificates.clear();
            
            // Overwrite master key
            if (this.masterKey) {
                crypto.randomFillSync(this.masterKey);
                this.masterKey = null;
            }
            
            console.log('Encryption module cleaned up');
            return { success: true };
        } catch (error) {
            console.error('Failed to cleanup encryption module:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = EncryptionModule;