const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

/**
 * AuthenticationModule - Comprehensive authentication and authorization system
 * Implements JWT, OAuth, 2FA, biometric, and session management
 */
class AuthenticationModule extends EventEmitter {
    constructor() {
        super();
        this.users = new Map();
        this.sessions = new Map();
        this.tokens = new Map();
        this.refreshTokens = new Map();
        this.resetTokens = new Map();
        this.twoFactorSecrets = new Map();
        this.loginAttempts = new Map();
        this.blacklistedTokens = new Set();
        this.permissions = new Map();
        this.roles = new Map();
        this.apiKeys = new Map();
        
        this.config = {
            jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
            jwtExpiry: process.env.JWT_EXPIRY || '15m',
            refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
            resetTokenExpiry: 3600000, // 1 hour
            maxLoginAttempts: 5,
            lockoutDuration: 900000, // 15 minutes
            passwordMinLength: 8,
            passwordRequirements: {
                uppercase: true,
                lowercase: true,
                numbers: true,
                symbols: true
            },
            sessionTimeout: 1800000, // 30 minutes
            rememberMeDuration: 2592000000, // 30 days
            twoFactorEnabled: true,
            biometricEnabled: false
        };

        this.oauth = {
            providers: new Map(),
            states: new Map()
        };

        this.setupDefaultRoles();
    }

    /**
     * Initialize authentication module
     */
    async initialize(config = {}) {
        try {
            this.config = { ...this.config, ...config };
            
            // Load users from storage
            await this.loadUsers();
            
            // Setup session cleanup
            this.startSessionCleanup();
            
            // Initialize OAuth providers if configured
            if (config.oauth) {
                await this.setupOAuthProviders(config.oauth);
            }
            
            console.log('Authentication module initialized');
            this.emit('initialized');
            
            return { success: true };
        } catch (error) {
            console.error('Failed to initialize authentication module:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup default roles and permissions
     */
    setupDefaultRoles() {
        // Define default roles
        this.roles.set('admin', {
            name: 'Administrator',
            permissions: ['*'], // All permissions
            level: 100
        });
        
        this.roles.set('moderator', {
            name: 'Moderator',
            permissions: [
                'user:read',
                'user:update',
                'content:read',
                'content:update',
                'content:delete'
            ],
            level: 50
        });
        
        this.roles.set('user', {
            name: 'User',
            permissions: [
                'profile:read',
                'profile:update',
                'content:read',
                'content:create'
            ],
            level: 10
        });
        
        this.roles.set('guest', {
            name: 'Guest',
            permissions: ['content:read'],
            level: 0
        });
    }

    /**
     * Register a new user
     */
    async register(userData) {
        try {
            const { username, email, password, role = 'user' } = userData;
            
            // Validate input
            if (!username || !email || !password) {
                throw new Error('Username, email, and password are required');
            }
            
            // Check if user already exists
            if (this.getUserByUsername(username) || this.getUserByEmail(email)) {
                throw new Error('User already exists');
            }
            
            // Validate password strength
            const passwordValidation = this.validatePassword(password);
            if (!passwordValidation.valid) {
                throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
            }
            
            // Hash password
            const hashedPassword = await bcrypt.hash(password, 12);
            
            // Create user object
            const userId = this.generateUserId();
            const user = {
                id: userId,
                username,
                email,
                password: hashedPassword,
                role,
                createdAt: Date.now(),
                lastLogin: null,
                emailVerified: false,
                twoFactorEnabled: false,
                locked: false,
                metadata: userData.metadata || {}
            };
            
            // Save user
            this.users.set(userId, user);
            await this.saveUsers();
            
            // Generate verification token
            const verificationToken = this.generateVerificationToken(userId);
            
            this.emit('user-registered', { userId, username, email });
            
            return {
                success: true,
                userId,
                verificationToken,
                message: 'User registered successfully'
            };
        } catch (error) {
            console.error('Registration failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Login user
     */
    async login(credentials, options = {}) {
        try {
            const { username, password, rememberMe = false } = credentials;
            
            // Find user by username or email
            const user = this.getUserByUsername(username) || this.getUserByEmail(username);
            
            if (!user) {
                this.recordFailedLogin(username);
                throw new Error('Invalid credentials');
            }
            
            // Check if account is locked
            if (user.locked) {
                const lockoutInfo = this.checkLockout(user.id);
                if (lockoutInfo.locked) {
                    throw new Error(`Account locked. Try again in ${lockoutInfo.remainingTime} minutes`);
                } else {
                    // Unlock if lockout period has passed
                    user.locked = false;
                    await this.saveUsers();
                }
            }
            
            // Verify password
            const passwordValid = await bcrypt.compare(password, user.password);
            if (!passwordValid) {
                this.recordFailedLogin(user.username);
                throw new Error('Invalid credentials');
            }
            
            // Check if 2FA is enabled
            if (user.twoFactorEnabled && !options.twoFactorCode) {
                return {
                    success: false,
                    requiresTwoFactor: true,
                    userId: user.id,
                    message: 'Two-factor authentication required'
                };
            }
            
            // Verify 2FA code if provided
            if (user.twoFactorEnabled && options.twoFactorCode) {
                const twoFactorValid = this.verifyTwoFactorCode(user.id, options.twoFactorCode);
                if (!twoFactorValid) {
                    throw new Error('Invalid two-factor code');
                }
            }
            
            // Clear failed login attempts
            this.loginAttempts.delete(user.username);
            
            // Update last login
            user.lastLogin = Date.now();
            await this.saveUsers();
            
            // Create session
            const session = await this.createSession(user.id, {
                rememberMe,
                ipAddress: options.ipAddress,
                userAgent: options.userAgent
            });
            
            // Generate tokens
            const accessToken = this.generateAccessToken(user.id, session.id);
            const refreshToken = this.generateRefreshToken(user.id, session.id);
            
            this.emit('user-logged-in', { userId: user.id, sessionId: session.id });
            
            return {
                success: true,
                userId: user.id,
                accessToken,
                refreshToken,
                session,
                user: this.sanitizeUser(user)
            };
        } catch (error) {
            console.error('Login failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Logout user
     */
    async logout(token) {
        try {
            const decoded = this.verifyAccessToken(token);
            if (!decoded) {
                throw new Error('Invalid token');
            }
            
            // Blacklist the token
            this.blacklistedTokens.add(token);
            
            // Remove session
            if (decoded.sessionId) {
                this.sessions.delete(decoded.sessionId);
            }
            
            // Remove refresh token
            this.refreshTokens.delete(decoded.userId);
            
            this.emit('user-logged-out', { userId: decoded.userId });
            
            return { success: true, message: 'Logged out successfully' };
        } catch (error) {
            console.error('Logout failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verify access token
     */
    verifyAccessToken(token) {
        try {
            // Check if token is blacklisted
            if (this.blacklistedTokens.has(token)) {
                return null;
            }
            
            const decoded = jwt.verify(token, this.config.jwtSecret);
            
            // Check if session is still valid
            const session = this.sessions.get(decoded.sessionId);
            if (!session || session.expired) {
                return null;
            }
            
            return decoded;
        } catch (error) {
            return null;
        }
    }

    /**
     * Refresh access token
     */
    async refreshAccessToken(refreshToken) {
        try {
            const tokenData = this.refreshTokens.get(refreshToken);
            if (!tokenData || tokenData.expired) {
                throw new Error('Invalid or expired refresh token');
            }
            
            const user = this.users.get(tokenData.userId);
            if (!user) {
                throw new Error('User not found');
            }
            
            // Generate new access token
            const accessToken = this.generateAccessToken(tokenData.userId, tokenData.sessionId);
            
            // Optionally rotate refresh token
            const newRefreshToken = this.generateRefreshToken(tokenData.userId, tokenData.sessionId);
            this.refreshTokens.delete(refreshToken);
            
            return {
                success: true,
                accessToken,
                refreshToken: newRefreshToken
            };
        } catch (error) {
            console.error('Token refresh failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup two-factor authentication
     */
    async setupTwoFactor(userId) {
        try {
            const user = this.users.get(userId);
            if (!user) {
                throw new Error('User not found');
            }
            
            // Generate secret
            const secret = speakeasy.generateSecret({
                name: `MyApp (${user.email})`,
                length: 32
            });
            
            // Store secret temporarily
            this.twoFactorSecrets.set(userId, {
                secret: secret.base32,
                tempSecret: secret.base32,
                verified: false
            });
            
            // Generate QR code
            const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
            
            return {
                success: true,
                secret: secret.base32,
                qrCode: qrCodeUrl,
                backupCodes: this.generateBackupCodes()
            };
        } catch (error) {
            console.error('2FA setup failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Enable two-factor authentication
     */
    async enableTwoFactor(userId, verificationCode) {
        try {
            const user = this.users.get(userId);
            if (!user) {
                throw new Error('User not found');
            }
            
            const secretData = this.twoFactorSecrets.get(userId);
            if (!secretData || !secretData.tempSecret) {
                throw new Error('2FA setup not initiated');
            }
            
            // Verify the code
            const verified = speakeasy.totp.verify({
                secret: secretData.tempSecret,
                encoding: 'base32',
                token: verificationCode,
                window: 1
            });
            
            if (!verified) {
                throw new Error('Invalid verification code');
            }
            
            // Enable 2FA
            user.twoFactorEnabled = true;
            secretData.secret = secretData.tempSecret;
            secretData.verified = true;
            delete secretData.tempSecret;
            
            await this.saveUsers();
            
            this.emit('two-factor-enabled', { userId });
            
            return { success: true, message: 'Two-factor authentication enabled' };
        } catch (error) {
            console.error('2FA enable failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verify two-factor code
     */
    verifyTwoFactorCode(userId, code) {
        const secretData = this.twoFactorSecrets.get(userId);
        if (!secretData || !secretData.secret) {
            return false;
        }
        
        return speakeasy.totp.verify({
            secret: secretData.secret,
            encoding: 'base32',
            token: code,
            window: 1
        });
    }

    /**
     * Generate backup codes
     */
    generateBackupCodes(count = 10) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
        }
        return codes;
    }

    /**
     * Setup OAuth providers
     */
    async setupOAuthProviders(providers) {
        for (const [name, config] of Object.entries(providers)) {
            this.oauth.providers.set(name, {
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                redirectUri: config.redirectUri,
                authorizationUrl: config.authorizationUrl,
                tokenUrl: config.tokenUrl,
                userInfoUrl: config.userInfoUrl,
                scope: config.scope || 'openid profile email'
            });
        }
    }

    /**
     * Get OAuth authorization URL
     */
    getOAuthAuthorizationUrl(provider) {
        const config = this.oauth.providers.get(provider);
        if (!config) {
            throw new Error(`OAuth provider '${provider}' not configured`);
        }
        
        const state = crypto.randomBytes(16).toString('hex');
        this.oauth.states.set(state, { provider, timestamp: Date.now() });
        
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            response_type: 'code',
            scope: config.scope,
            state
        });
        
        return `${config.authorizationUrl}?${params.toString()}`;
    }

    /**
     * Handle OAuth callback
     */
    async handleOAuthCallback(provider, code, state) {
        try {
            // Verify state
            const stateData = this.oauth.states.get(state);
            if (!stateData || stateData.provider !== provider) {
                throw new Error('Invalid state parameter');
            }
            
            // Clear state
            this.oauth.states.delete(state);
            
            const config = this.oauth.providers.get(provider);
            if (!config) {
                throw new Error(`OAuth provider '${provider}' not configured`);
            }
            
            // Exchange code for tokens
            const tokenResponse = await this.exchangeOAuthCode(provider, code);
            
            // Get user info
            const userInfo = await this.getOAuthUserInfo(provider, tokenResponse.access_token);
            
            // Find or create user
            let user = this.getUserByEmail(userInfo.email);
            
            if (!user) {
                // Create new user from OAuth
                const registerResult = await this.register({
                    username: userInfo.email.split('@')[0],
                    email: userInfo.email,
                    password: crypto.randomBytes(32).toString('hex'), // Random password
                    metadata: {
                        oauthProvider: provider,
                        oauthId: userInfo.id,
                        name: userInfo.name,
                        picture: userInfo.picture
                    }
                });
                
                user = this.users.get(registerResult.userId);
                user.emailVerified = true; // OAuth emails are pre-verified
            }
            
            // Create session
            const session = await this.createSession(user.id, { oauthProvider: provider });
            
            // Generate tokens
            const accessToken = this.generateAccessToken(user.id, session.id);
            const refreshToken = this.generateRefreshToken(user.id, session.id);
            
            return {
                success: true,
                userId: user.id,
                accessToken,
                refreshToken,
                user: this.sanitizeUser(user)
            };
        } catch (error) {
            console.error('OAuth callback failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Exchange OAuth code for tokens
     */
    async exchangeOAuthCode(provider, code) {
        const config = this.oauth.providers.get(provider);
        
        const response = await fetch(config.tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: config.clientId,
                client_secret: config.clientSecret,
                redirect_uri: config.redirectUri
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to exchange OAuth code');
        }
        
        return response.json();
    }

    /**
     * Get OAuth user info
     */
    async getOAuthUserInfo(provider, accessToken) {
        const config = this.oauth.providers.get(provider);
        
        const response = await fetch(config.userInfoUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to get OAuth user info');
        }
        
        return response.json();
    }

    /**
     * Create API key
     */
    async createApiKey(userId, name, permissions = []) {
        try {
            const user = this.users.get(userId);
            if (!user) {
                throw new Error('User not found');
            }
            
            const apiKey = `ak_${crypto.randomBytes(32).toString('hex')}`;
            const hashedKey = await bcrypt.hash(apiKey, 10);
            
            const keyData = {
                id: crypto.randomBytes(16).toString('hex'),
                userId,
                name,
                key: hashedKey,
                permissions,
                createdAt: Date.now(),
                lastUsed: null,
                usageCount: 0
            };
            
            this.apiKeys.set(keyData.id, keyData);
            
            this.emit('api-key-created', { userId, keyId: keyData.id });
            
            return {
                success: true,
                apiKey, // Return unhashed key only once
                keyId: keyData.id,
                message: 'API key created. Store it securely as it won\'t be shown again.'
            };
        } catch (error) {
            console.error('API key creation failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verify API key
     */
    async verifyApiKey(apiKey) {
        try {
            // Find matching API key
            for (const [keyId, keyData] of this.apiKeys) {
                const matches = await bcrypt.compare(apiKey, keyData.key);
                if (matches) {
                    // Update usage stats
                    keyData.lastUsed = Date.now();
                    keyData.usageCount++;
                    
                    return {
                        valid: true,
                        userId: keyData.userId,
                        permissions: keyData.permissions
                    };
                }
            }
            
            return { valid: false };
        } catch (error) {
            console.error('API key verification failed:', error);
            return { valid: false };
        }
    }

    /**
     * Request password reset
     */
    async requestPasswordReset(email) {
        try {
            const user = this.getUserByEmail(email);
            if (!user) {
                // Don't reveal if user exists
                return { success: true, message: 'If the email exists, a reset link has been sent' };
            }
            
            // Generate reset token
            const resetToken = crypto.randomBytes(32).toString('hex');
            const hashedToken = await bcrypt.hash(resetToken, 10);
            
            this.resetTokens.set(user.id, {
                token: hashedToken,
                expiry: Date.now() + this.config.resetTokenExpiry
            });
            
            this.emit('password-reset-requested', { userId: user.id, email });
            
            return {
                success: true,
                resetToken, // In production, send this via email
                message: 'Password reset token generated'
            };
        } catch (error) {
            console.error('Password reset request failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Reset password
     */
    async resetPassword(resetToken, newPassword) {
        try {
            // Find matching reset token
            let userId = null;
            
            for (const [id, tokenData] of this.resetTokens) {
                if (tokenData.expiry < Date.now()) {
                    this.resetTokens.delete(id);
                    continue;
                }
                
                const matches = await bcrypt.compare(resetToken, tokenData.token);
                if (matches) {
                    userId = id;
                    break;
                }
            }
            
            if (!userId) {
                throw new Error('Invalid or expired reset token');
            }
            
            // Validate new password
            const passwordValidation = this.validatePassword(newPassword);
            if (!passwordValidation.valid) {
                throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
            }
            
            // Update password
            const user = this.users.get(userId);
            user.password = await bcrypt.hash(newPassword, 12);
            
            // Clear reset token
            this.resetTokens.delete(userId);
            
            // Invalidate all sessions
            for (const [sessionId, session] of this.sessions) {
                if (session.userId === userId) {
                    this.sessions.delete(sessionId);
                }
            }
            
            await this.saveUsers();
            
            this.emit('password-reset', { userId });
            
            return { success: true, message: 'Password reset successfully' };
        } catch (error) {
            console.error('Password reset failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Change password
     */
    async changePassword(userId, currentPassword, newPassword) {
        try {
            const user = this.users.get(userId);
            if (!user) {
                throw new Error('User not found');
            }
            
            // Verify current password
            const passwordValid = await bcrypt.compare(currentPassword, user.password);
            if (!passwordValid) {
                throw new Error('Current password is incorrect');
            }
            
            // Validate new password
            const passwordValidation = this.validatePassword(newPassword);
            if (!passwordValidation.valid) {
                throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
            }
            
            // Update password
            user.password = await bcrypt.hash(newPassword, 12);
            await this.saveUsers();
            
            this.emit('password-changed', { userId });
            
            return { success: true, message: 'Password changed successfully' };
        } catch (error) {
            console.error('Password change failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Validate password strength
     */
    validatePassword(password) {
        const errors = [];
        
        if (password.length < this.config.passwordMinLength) {
            errors.push(`Password must be at least ${this.config.passwordMinLength} characters`);
        }
        
        if (this.config.passwordRequirements.uppercase && !/[A-Z]/.test(password)) {
            errors.push('Password must contain uppercase letters');
        }
        
        if (this.config.passwordRequirements.lowercase && !/[a-z]/.test(password)) {
            errors.push('Password must contain lowercase letters');
        }
        
        if (this.config.passwordRequirements.numbers && !/\d/.test(password)) {
            errors.push('Password must contain numbers');
        }
        
        if (this.config.passwordRequirements.symbols && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
            errors.push('Password must contain special characters');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Create session
     */
    async createSession(userId, options = {}) {
        const sessionId = crypto.randomBytes(32).toString('hex');
        
        const session = {
            id: sessionId,
            userId,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            expiresAt: options.rememberMe ? 
                Date.now() + this.config.rememberMeDuration :
                Date.now() + this.config.sessionTimeout,
            ipAddress: options.ipAddress,
            userAgent: options.userAgent,
            oauthProvider: options.oauthProvider
        };
        
        this.sessions.set(sessionId, session);
        
        return session;
    }

    /**
     * Update session activity
     */
    updateSessionActivity(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.lastActivity = Date.now();
            
            // Extend expiry if not remember me
            if (session.expiresAt - session.createdAt <= this.config.sessionTimeout) {
                session.expiresAt = Date.now() + this.config.sessionTimeout;
            }
        }
    }

    /**
     * Start session cleanup interval
     */
    startSessionCleanup() {
        setInterval(() => {
            const now = Date.now();
            
            for (const [sessionId, session] of this.sessions) {
                if (session.expiresAt < now) {
                    this.sessions.delete(sessionId);
                    this.emit('session-expired', { sessionId, userId: session.userId });
                }
            }
        }, 60000); // Check every minute
    }

    /**
     * Generate access token
     */
    generateAccessToken(userId, sessionId) {
        const user = this.users.get(userId);
        
        return jwt.sign(
            {
                userId,
                sessionId,
                username: user.username,
                email: user.email,
                role: user.role
            },
            this.config.jwtSecret,
            { expiresIn: this.config.jwtExpiry }
        );
    }

    /**
     * Generate refresh token
     */
    generateRefreshToken(userId, sessionId) {
        const token = crypto.randomBytes(64).toString('hex');
        
        this.refreshTokens.set(token, {
            userId,
            sessionId,
            createdAt: Date.now(),
            expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
        });
        
        return token;
    }

    /**
     * Generate verification token
     */
    generateVerificationToken(userId) {
        return jwt.sign(
            { userId, purpose: 'email-verification' },
            this.config.jwtSecret,
            { expiresIn: '24h' }
        );
    }

    /**
     * Verify email
     */
    async verifyEmail(token) {
        try {
            const decoded = jwt.verify(token, this.config.jwtSecret);
            
            if (decoded.purpose !== 'email-verification') {
                throw new Error('Invalid token purpose');
            }
            
            const user = this.users.get(decoded.userId);
            if (!user) {
                throw new Error('User not found');
            }
            
            user.emailVerified = true;
            await this.saveUsers();
            
            this.emit('email-verified', { userId: decoded.userId });
            
            return { success: true, message: 'Email verified successfully' };
        } catch (error) {
            console.error('Email verification failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check user permissions
     */
    hasPermission(userId, permission) {
        const user = this.users.get(userId);
        if (!user) return false;
        
        const role = this.roles.get(user.role);
        if (!role) return false;
        
        // Check for wildcard permission
        if (role.permissions.includes('*')) return true;
        
        // Check specific permission
        return role.permissions.includes(permission);
    }

    /**
     * Grant permission to user
     */
    async grantPermission(userId, permission) {
        try {
            const user = this.users.get(userId);
            if (!user) {
                throw new Error('User not found');
            }
            
            if (!this.permissions.has(userId)) {
                this.permissions.set(userId, new Set());
            }
            
            this.permissions.get(userId).add(permission);
            
            this.emit('permission-granted', { userId, permission });
            
            return { success: true };
        } catch (error) {
            console.error('Failed to grant permission:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Revoke permission from user
     */
    async revokePermission(userId, permission) {
        try {
            const user = this.users.get(userId);
            if (!user) {
                throw new Error('User not found');
            }
            
            if (this.permissions.has(userId)) {
                this.permissions.get(userId).delete(permission);
            }
            
            this.emit('permission-revoked', { userId, permission });
            
            return { success: true };
        } catch (error) {
            console.error('Failed to revoke permission:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update user role
     */
    async updateUserRole(userId, newRole) {
        try {
            const user = this.users.get(userId);
            if (!user) {
                throw new Error('User not found');
            }
            
            if (!this.roles.has(newRole)) {
                throw new Error('Invalid role');
            }
            
            const oldRole = user.role;
            user.role = newRole;
            
            await this.saveUsers();
            
            this.emit('role-updated', { userId, oldRole, newRole });
            
            return { success: true };
        } catch (error) {
            console.error('Failed to update role:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Record failed login attempt
     */
    recordFailedLogin(username) {
        if (!this.loginAttempts.has(username)) {
            this.loginAttempts.set(username, {
                count: 0,
                firstAttempt: Date.now(),
                lastAttempt: Date.now()
            });
        }
        
        const attempts = this.loginAttempts.get(username);
        attempts.count++;
        attempts.lastAttempt = Date.now();
        
        // Lock account if max attempts exceeded
        if (attempts.count >= this.config.maxLoginAttempts) {
            const user = this.getUserByUsername(username);
            if (user) {
                user.locked = true;
                user.lockedUntil = Date.now() + this.config.lockoutDuration;
                this.saveUsers();
                
                this.emit('account-locked', { userId: user.id, username });
            }
        }
    }

    /**
     * Check account lockout status
     */
    checkLockout(userId) {
        const user = this.users.get(userId);
        if (!user || !user.locked) {
            return { locked: false };
        }
        
        if (user.lockedUntil && user.lockedUntil < Date.now()) {
            // Lockout period has expired
            return { locked: false };
        }
        
        const remainingTime = Math.ceil((user.lockedUntil - Date.now()) / 60000);
        return { locked: true, remainingTime };
    }

    /**
     * Get user by username
     */
    getUserByUsername(username) {
        for (const user of this.users.values()) {
            if (user.username === username) {
                return user;
            }
        }
        return null;
    }

    /**
     * Get user by email
     */
    getUserByEmail(email) {
        for (const user of this.users.values()) {
            if (user.email === email) {
                return user;
            }
        }
        return null;
    }

    /**
     * Sanitize user object for response
     */
    sanitizeUser(user) {
        const { password, ...sanitized } = user;
        return sanitized;
    }

    /**
     * Generate user ID
     */
    generateUserId() {
        return `user_${crypto.randomBytes(16).toString('hex')}`;
    }

    /**
     * Load users from storage
     */
    async loadUsers() {
        try {
            const usersPath = path.join(process.cwd(), 'data', 'users.json');
            const data = await fs.readFile(usersPath, 'utf8');
            const users = JSON.parse(data);
            
            for (const user of users) {
                this.users.set(user.id, user);
            }
        } catch (error) {
            // File doesn't exist yet
            console.log('No existing users found');
        }
    }

    /**
     * Save users to storage
     */
    async saveUsers() {
        try {
            const usersPath = path.join(process.cwd(), 'data', 'users.json');
            await fs.mkdir(path.dirname(usersPath), { recursive: true });
            
            const users = Array.from(this.users.values());
            await fs.writeFile(usersPath, JSON.stringify(users, null, 2), 'utf8');
        } catch (error) {
            console.error('Failed to save users:', error);
        }
    }

    /**
     * Get authentication statistics
     */
    getStatistics() {
        return {
            totalUsers: this.users.size,
            activeSessions: this.sessions.size,
            lockedAccounts: Array.from(this.users.values()).filter(u => u.locked).length,
            verifiedEmails: Array.from(this.users.values()).filter(u => u.emailVerified).length,
            twoFactorEnabled: Array.from(this.users.values()).filter(u => u.twoFactorEnabled).length,
            apiKeys: this.apiKeys.size,
            roles: Array.from(this.roles.keys()),
            oauthProviders: Array.from(this.oauth.providers.keys())
        };
    }

    /**
     * Cleanup authentication module
     */
    async cleanup() {
        try {
            // Save users before cleanup
            await this.saveUsers();
            
            // Clear all data
            this.users.clear();
            this.sessions.clear();
            this.tokens.clear();
            this.refreshTokens.clear();
            this.resetTokens.clear();
            this.twoFactorSecrets.clear();
            this.loginAttempts.clear();
            this.blacklistedTokens.clear();
            this.permissions.clear();
            this.apiKeys.clear();
            
            console.log('Authentication module cleaned up');
            return { success: true };
        } catch (error) {
            console.error('Failed to cleanup authentication module:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = AuthenticationModule;