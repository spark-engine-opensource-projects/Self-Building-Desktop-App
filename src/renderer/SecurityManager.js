/**
 * SecurityManager - Handles password protection, session timeout, and CSRF tokens
 * for the AI Dynamic Application Builder
 */
class SecurityManager {
    constructor(options = {}) {
        this.isLocked = false;
        this.hasPassword = false;
        this.sessionTimeout = parseInt(localStorage.getItem('sessionTimeout') || '300000'); // 5 min default
        this.lastActivity = Date.now();
        this.timeoutCheckInterval = null;
        this.lockCallbacks = [];
        this.unlockCallbacks = [];

        // CSRF Token management
        this.csrfToken = null;
        this.csrfTokenFetching = false;

        // UI Elements
        this.lockScreen = document.getElementById('lockScreen');
        this.passwordSetupScreen = document.getElementById('passwordSetupScreen');
        this.settingsModal = document.getElementById('settingsModal');
        this.welcomeModal = document.getElementById('welcomeModal');
        this.passwordPromptModal = document.getElementById('passwordPromptModal');

        // First-time user tracking
        this.isFirstTimeUser = !localStorage.getItem('hasCompletedOnboarding');
        this.hasSeenPasswordPrompt = localStorage.getItem('hasSeenPasswordPrompt') === 'true';

        // Bind methods
        this.handleActivity = this.handleActivity.bind(this);
        this.checkTimeout = this.checkTimeout.bind(this);
    }

    /**
     * Initialize the security manager
     */
    async initialize() {
        try {
            // Check if password is set
            console.log('[SecurityManager] Checking password status...');
            const status = await window.electronAPI.checkAppPasswordStatus();
            console.log('[SecurityManager] Password status response:', status);

            this.hasPassword = status && status.hasPassword === true;
            console.log('[SecurityManager] hasPassword:', this.hasPassword);

            // If password is set, show lock screen
            if (this.hasPassword) {
                console.log('[SecurityManager] Password is set, showing lock screen');
                this.lock('Enter your password to continue');
                this.showLockButton(true);
            } else {
                console.log('[SecurityManager] No password set');
            }

            // Set up activity listeners
            this.setupActivityTracking();

            // Set up UI event listeners
            this.setupEventListeners();

            // Start timeout checker if password is enabled
            if (this.hasPassword && this.sessionTimeout > 0) {
                this.startTimeoutChecker();
            }

            // If user has password, they're not a first-time user (mark onboarding complete)
            if (this.hasPassword) {
                localStorage.setItem('hasCompletedOnboarding', 'true');
                this.isFirstTimeUser = false;
            }

            // Show welcome modal ONLY for true first-time users (no password, never completed onboarding)
            if (this.isFirstTimeUser && !this.hasPassword) {
                this.showWelcomeModal();
            }

            console.log('SecurityManager initialized', {
                hasPassword: this.hasPassword,
                isFirstTimeUser: this.isFirstTimeUser,
                isLocked: this.isLocked
            });
        } catch (error) {
            console.error('Failed to initialize SecurityManager:', error);
        }
    }

    /**
     * Set up activity tracking for session timeout
     */
    setupActivityTracking() {
        const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
        events.forEach(event => {
            document.addEventListener(event, this.handleActivity, { passive: true });
        });
    }

    /**
     * Handle user activity
     */
    handleActivity() {
        this.lastActivity = Date.now();
    }

    /**
     * Start the timeout checker
     */
    startTimeoutChecker() {
        if (this.timeoutCheckInterval) {
            clearInterval(this.timeoutCheckInterval);
        }

        if (this.sessionTimeout > 0) {
            this.timeoutCheckInterval = setInterval(this.checkTimeout, 10000); // Check every 10 seconds
        }
    }

    /**
     * Stop the timeout checker
     */
    stopTimeoutChecker() {
        if (this.timeoutCheckInterval) {
            clearInterval(this.timeoutCheckInterval);
            this.timeoutCheckInterval = null;
        }
    }

    /**
     * Check if session has timed out
     */
    checkTimeout() {
        if (!this.hasPassword || this.isLocked || this.sessionTimeout === 0) {
            return;
        }

        const elapsed = Date.now() - this.lastActivity;
        if (elapsed >= this.sessionTimeout) {
            this.lock('Session locked due to inactivity');
        }
    }

    /**
     * Set up UI event listeners
     */
    setupEventListeners() {
        // Unlock button
        const unlockBtn = document.getElementById('unlockBtn');
        const unlockPassword = document.getElementById('unlockPassword');

        if (unlockBtn) {
            unlockBtn.addEventListener('click', () => this.handleUnlock());
        }

        if (unlockPassword) {
            unlockPassword.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleUnlock();
            });
        }

        // Settings button
        const settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.showSettings());
        }

        // Close settings button
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');
        if (closeSettingsBtn) {
            closeSettingsBtn.addEventListener('click', () => this.hideSettings());
        }

        // Lock button
        const lockAppBtn = document.getElementById('lockAppBtn');
        if (lockAppBtn) {
            lockAppBtn.addEventListener('click', () => this.lock('App locked'));
        }

        // Password setup buttons
        const setupPasswordBtn = document.getElementById('setupPasswordBtn');
        const skipPasswordBtn = document.getElementById('skipPasswordBtn');

        if (setupPasswordBtn) {
            setupPasswordBtn.addEventListener('click', () => this.handleSetupPassword());
        }

        if (skipPasswordBtn) {
            skipPasswordBtn.addEventListener('click', () => this.hidePasswordSetup());
        }

        // Timeout select
        const timeoutSelect = document.getElementById('timeoutSelect');
        if (timeoutSelect) {
            timeoutSelect.value = this.sessionTimeout.toString();
            timeoutSelect.addEventListener('change', (e) => this.setSessionTimeout(parseInt(e.target.value)));
        }

        // Change password button
        const changePasswordBtn = document.getElementById('changePasswordBtn');
        if (changePasswordBtn) {
            changePasswordBtn.addEventListener('click', () => this.handleChangePassword());
        }

        // Remove password button
        const removePasswordBtn = document.getElementById('removePasswordBtn');
        if (removePasswordBtn) {
            removePasswordBtn.addEventListener('click', () => this.handleRemovePassword());
        }

        // Set password from settings (when no password exists)
        const passwordActions = document.getElementById('passwordActions');
        if (passwordActions) {
            passwordActions.addEventListener('click', (e) => {
                if (e.target.id === 'setPasswordFromSettings') {
                    this.hideSettings();
                    this.showPasswordSetup();
                }
            });
        }

        // Settings modal background click to close
        if (this.settingsModal) {
            this.settingsModal.addEventListener('click', (e) => {
                if (e.target === this.settingsModal) {
                    this.hideSettings();
                }
            });
        }

        // Welcome modal - Get Started button
        const welcomeGetStartedBtn = document.getElementById('welcomeGetStartedBtn');
        if (welcomeGetStartedBtn) {
            welcomeGetStartedBtn.addEventListener('click', () => this.handleWelcomeComplete());
        }

        // Password prompt buttons
        const promptSetPasswordBtn = document.getElementById('promptSetPasswordBtn');
        const promptSkipPasswordBtn = document.getElementById('promptSkipPasswordBtn');

        if (promptSetPasswordBtn) {
            promptSetPasswordBtn.addEventListener('click', () => this.handlePasswordPromptSetup());
        }

        if (promptSkipPasswordBtn) {
            promptSkipPasswordBtn.addEventListener('click', () => this.handlePasswordPromptSkip());
        }
    }

    /**
     * Lock the application
     */
    lock(message = 'App locked') {
        console.log('[SecurityManager] lock() called with message:', message);
        console.log('[SecurityManager] lockScreen element:', this.lockScreen);

        if (!this.hasPassword) {
            console.log('[SecurityManager] lock() - no password set, returning');
            return;
        }

        this.isLocked = true;

        if (this.lockScreen) {
            const lockMessage = document.getElementById('lockMessage');
            const lockError = document.getElementById('lockError');
            const unlockPassword = document.getElementById('unlockPassword');

            if (lockMessage) lockMessage.textContent = message;
            if (lockError) lockError.style.display = 'none';
            if (unlockPassword) unlockPassword.value = '';

            this.lockScreen.style.display = 'flex';
            console.log('[SecurityManager] Lock screen displayed');

            // Focus password input
            setTimeout(() => {
                if (unlockPassword) unlockPassword.focus();
            }, 100);
        } else {
            console.error('[SecurityManager] Lock screen element not found!');
        }

        // Notify callbacks
        this.lockCallbacks.forEach(cb => cb());
    }

    /**
     * Unlock the application
     */
    async handleUnlock() {
        const unlockPassword = document.getElementById('unlockPassword');
        const lockError = document.getElementById('lockError');
        const unlockBtn = document.getElementById('unlockBtn');

        if (!unlockPassword) return;

        const password = unlockPassword.value;

        if (!password) {
            this.showLockError('Please enter your password');
            return;
        }

        // Disable button during verification
        if (unlockBtn) unlockBtn.disabled = true;

        try {
            const result = await window.electronAPI.verifyAppPassword(password);

            if (result.success && result.valid) {
                this.isLocked = false;
                this.lastActivity = Date.now();

                if (this.lockScreen) {
                    this.lockScreen.style.display = 'none';
                }

                // Clear password field
                unlockPassword.value = '';

                // Restart timeout checker
                this.startTimeoutChecker();

                // Notify callbacks
                this.unlockCallbacks.forEach(cb => cb());
            } else {
                this.showLockError(result.error || 'Incorrect password');
            }
        } catch (error) {
            this.showLockError('Failed to verify password');
            console.error('Unlock error:', error);
        } finally {
            if (unlockBtn) unlockBtn.disabled = false;
        }
    }

    /**
     * Show lock error message
     */
    showLockError(message) {
        const lockError = document.getElementById('lockError');
        if (lockError) {
            lockError.textContent = message;
            lockError.style.display = 'block';
        }
    }

    /**
     * Show password setup screen
     */
    showPasswordSetup() {
        if (this.passwordSetupScreen) {
            const setupError = document.getElementById('setupError');
            const setupPassword = document.getElementById('setupPassword');
            const confirmPassword = document.getElementById('confirmPassword');

            if (setupError) setupError.style.display = 'none';
            if (setupPassword) setupPassword.value = '';
            if (confirmPassword) confirmPassword.value = '';

            this.passwordSetupScreen.style.display = 'flex';

            setTimeout(() => {
                if (setupPassword) setupPassword.focus();
            }, 100);
        }
    }

    /**
     * Hide password setup screen
     */
    hidePasswordSetup() {
        if (this.passwordSetupScreen) {
            this.passwordSetupScreen.style.display = 'none';
        }
    }

    /**
     * Handle password setup
     */
    async handleSetupPassword() {
        const setupPassword = document.getElementById('setupPassword');
        const confirmPassword = document.getElementById('confirmPassword');
        const setupError = document.getElementById('setupError');
        const setupBtn = document.getElementById('setupPasswordBtn');

        if (!setupPassword || !confirmPassword) return;

        const password = setupPassword.value;
        const confirm = confirmPassword.value;

        // Validate
        if (password.length < 4) {
            this.showSetupError('Password must be at least 4 characters');
            return;
        }

        if (password !== confirm) {
            this.showSetupError('Passwords do not match');
            return;
        }

        // Disable button
        if (setupBtn) setupBtn.disabled = true;

        try {
            const result = await window.electronAPI.setAppPassword(password);

            if (result.success) {
                this.hasPassword = true;
                this.hidePasswordSetup();
                this.showLockButton(true);
                this.startTimeoutChecker();
                this.showNotification('Password set successfully!', 'success');
            } else {
                this.showSetupError(result.error || 'Failed to set password');
            }
        } catch (error) {
            this.showSetupError('Failed to set password');
            console.error('Setup password error:', error);
        } finally {
            if (setupBtn) setupBtn.disabled = false;
        }
    }

    /**
     * Show setup error
     */
    showSetupError(message) {
        const setupError = document.getElementById('setupError');
        if (setupError) {
            setupError.textContent = message;
            setupError.style.display = 'block';
        }
    }

    /**
     * Show settings modal
     */
    async showSettings() {
        if (this.settingsModal) {
            // Update password status
            await this.updatePasswordStatus();

            this.settingsModal.style.display = 'flex';
        }
    }

    /**
     * Hide settings modal
     */
    hideSettings() {
        if (this.settingsModal) {
            this.settingsModal.style.display = 'none';

            // Clear sensitive fields
            const inputs = ['currentPasswordInput', 'newPasswordInput', 'confirmNewPasswordInput', 'removePasswordInput'];
            inputs.forEach(id => {
                const input = document.getElementById(id);
                if (input) input.value = '';
            });

            // Hide error/success messages
            const messages = ['changePasswordError', 'changePasswordSuccess'];
            messages.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        }
    }

    // ============================================================
    // WELCOME MODAL (FIRST-TIME USER ONBOARDING)
    // ============================================================

    /**
     * Show welcome modal for first-time users
     */
    showWelcomeModal() {
        if (this.welcomeModal) {
            this.welcomeModal.style.display = 'flex';
        }
    }

    /**
     * Hide welcome modal
     */
    hideWelcomeModal() {
        if (this.welcomeModal) {
            this.welcomeModal.style.display = 'none';
        }
    }

    /**
     * Handle welcome modal completion
     */
    handleWelcomeComplete() {
        const dontShowAgain = document.getElementById('dontShowWelcomeAgain');

        if (dontShowAgain && dontShowAgain.checked) {
            localStorage.setItem('hasCompletedOnboarding', 'true');
            this.isFirstTimeUser = false;
        }

        this.hideWelcomeModal();
    }

    // ============================================================
    // PASSWORD PROMPT (AFTER API KEY SETUP)
    // ============================================================

    /**
     * Show password prompt modal (called after API key is set)
     */
    showPasswordPrompt() {
        // Don't show if user already has password or has seen the prompt
        if (this.hasPassword || this.hasSeenPasswordPrompt) {
            return;
        }

        if (this.passwordPromptModal) {
            this.passwordPromptModal.style.display = 'flex';
        }
    }

    /**
     * Hide password prompt modal
     */
    hidePasswordPrompt() {
        if (this.passwordPromptModal) {
            this.passwordPromptModal.style.display = 'none';
        }
    }

    /**
     * Handle user choosing to set up password from prompt
     */
    handlePasswordPromptSetup() {
        localStorage.setItem('hasSeenPasswordPrompt', 'true');
        this.hasSeenPasswordPrompt = true;
        this.hidePasswordPrompt();
        this.showPasswordSetup();
    }

    /**
     * Handle user skipping password prompt
     */
    handlePasswordPromptSkip() {
        localStorage.setItem('hasSeenPasswordPrompt', 'true');
        this.hasSeenPasswordPrompt = true;
        this.hidePasswordPrompt();
        this.showNotification('You can set up password protection anytime in Settings', 'info');
    }

    /**
     * Called by the app when API key is successfully set
     * This triggers the password prompt for first-time setup
     */
    onApiKeySet() {
        // Mark onboarding as complete
        localStorage.setItem('hasCompletedOnboarding', 'true');
        this.isFirstTimeUser = false;

        // Show password prompt if not already set
        if (!this.hasPassword && !this.hasSeenPasswordPrompt) {
            // Small delay so user sees the API key success first
            setTimeout(() => {
                this.showPasswordPrompt();
            }, 500);
        }
    }

    /**
     * Update password status in settings
     */
    async updatePasswordStatus() {
        try {
            const status = await window.electronAPI.checkAppPasswordStatus();
            this.hasPassword = status.hasPassword;

            const passwordStatusText = document.getElementById('passwordStatusText');
            const passwordActions = document.getElementById('passwordActions');
            const changePasswordSection = document.getElementById('changePasswordSection');
            const removePasswordSection = document.getElementById('removePasswordSection');

            if (passwordStatusText) {
                if (this.hasPassword) {
                    passwordStatusText.textContent = 'Enabled';
                    passwordStatusText.className = 'status-value enabled';
                } else {
                    passwordStatusText.textContent = 'Not set';
                    passwordStatusText.className = 'status-value disabled';
                }
            }

            if (passwordActions) {
                if (this.hasPassword) {
                    passwordActions.innerHTML = '';
                } else {
                    passwordActions.innerHTML = '<button id="setPasswordFromSettings" class="btn btn-primary">Set Password</button>';
                }
            }

            if (changePasswordSection) {
                changePasswordSection.style.display = this.hasPassword ? 'block' : 'none';
            }

            if (removePasswordSection) {
                removePasswordSection.style.display = this.hasPassword ? 'block' : 'none';
            }
        } catch (error) {
            console.error('Failed to update password status:', error);
        }
    }

    /**
     * Handle change password
     */
    async handleChangePassword() {
        const currentPassword = document.getElementById('currentPasswordInput');
        const newPassword = document.getElementById('newPasswordInput');
        const confirmNewPassword = document.getElementById('confirmNewPasswordInput');
        const changeBtn = document.getElementById('changePasswordBtn');
        const errorEl = document.getElementById('changePasswordError');
        const successEl = document.getElementById('changePasswordSuccess');

        if (!currentPassword || !newPassword || !confirmNewPassword) return;

        // Reset messages
        if (errorEl) errorEl.style.display = 'none';
        if (successEl) successEl.style.display = 'none';

        const current = currentPassword.value;
        const newPwd = newPassword.value;
        const confirm = confirmNewPassword.value;

        // Validate
        if (!current) {
            this.showChangePasswordError('Please enter current password');
            return;
        }

        if (newPwd.length < 4) {
            this.showChangePasswordError('New password must be at least 4 characters');
            return;
        }

        if (newPwd !== confirm) {
            this.showChangePasswordError('New passwords do not match');
            return;
        }

        if (changeBtn) changeBtn.disabled = true;

        try {
            const result = await window.electronAPI.changeAppPassword(current, newPwd);

            if (result.success) {
                // Clear fields
                currentPassword.value = '';
                newPassword.value = '';
                confirmNewPassword.value = '';

                if (successEl) {
                    successEl.textContent = 'Password changed successfully!';
                    successEl.style.display = 'block';
                }

                this.showNotification('Password changed successfully!', 'success');
            } else {
                this.showChangePasswordError(result.error || 'Failed to change password');
            }
        } catch (error) {
            this.showChangePasswordError('Failed to change password');
            console.error('Change password error:', error);
        } finally {
            if (changeBtn) changeBtn.disabled = false;
        }
    }

    /**
     * Show change password error
     */
    showChangePasswordError(message) {
        const errorEl = document.getElementById('changePasswordError');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    /**
     * Handle remove password
     */
    async handleRemovePassword() {
        const removePassword = document.getElementById('removePasswordInput');
        const removeBtn = document.getElementById('removePasswordBtn');

        if (!removePassword) return;

        const password = removePassword.value;

        if (!password) {
            this.showNotification('Please enter your current password', 'error');
            return;
        }

        if (removeBtn) removeBtn.disabled = true;

        try {
            const result = await window.electronAPI.removeAppPassword(password);

            if (result.success) {
                this.hasPassword = false;
                removePassword.value = '';

                // Update UI
                this.showLockButton(false);
                this.stopTimeoutChecker();
                await this.updatePasswordStatus();

                this.showNotification('Password removed successfully', 'success');
            } else {
                this.showNotification(result.error || 'Failed to remove password', 'error');
            }
        } catch (error) {
            this.showNotification('Failed to remove password', 'error');
            console.error('Remove password error:', error);
        } finally {
            if (removeBtn) removeBtn.disabled = false;
        }
    }

    /**
     * Set session timeout
     */
    setSessionTimeout(timeout) {
        this.sessionTimeout = timeout;
        localStorage.setItem('sessionTimeout', timeout.toString());

        if (timeout > 0 && this.hasPassword) {
            this.startTimeoutChecker();
        } else {
            this.stopTimeoutChecker();
        }

        this.showNotification(`Session timeout set to ${this.formatTimeout(timeout)}`, 'info');
    }

    /**
     * Format timeout for display
     */
    formatTimeout(ms) {
        if (ms === 0) return 'Never';
        if (ms < 60000) return `${ms / 1000} seconds`;
        if (ms < 3600000) return `${ms / 60000} minutes`;
        return `${ms / 3600000} hour(s)`;
    }

    /**
     * Show/hide lock button
     */
    showLockButton(show) {
        const lockBtn = document.getElementById('lockAppBtn');
        if (lockBtn) {
            lockBtn.style.display = show ? 'inline-flex' : 'none';
        }
    }

    /**
     * Show notification (uses app's notification system if available)
     */
    showNotification(message, type = 'info') {
        if (window.app && typeof window.app.showNotification === 'function') {
            window.app.showNotification(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    // ============================================================
    // CSRF TOKEN METHODS
    // ============================================================

    /**
     * Fetch and cache the CSRF token from the main process
     * @returns {Promise<string>} The CSRF token
     */
    async fetchCsrfToken() {
        if (this.csrfToken) {
            return this.csrfToken;
        }

        // Prevent multiple simultaneous fetches
        if (this.csrfTokenFetching) {
            // Wait for the current fetch to complete
            await new Promise(resolve => setTimeout(resolve, 100));
            return this.csrfToken;
        }

        this.csrfTokenFetching = true;

        try {
            const result = await window.electronAPI.getCsrfToken();
            if (result.success) {
                this.csrfToken = result.token;
                console.log('CSRF token fetched successfully');
            } else {
                console.error('Failed to fetch CSRF token:', result.error);
            }
        } catch (error) {
            console.error('Error fetching CSRF token:', error);
        } finally {
            this.csrfTokenFetching = false;
        }

        return this.csrfToken;
    }

    /**
     * Get the current CSRF token (fetches if not available)
     * @returns {Promise<string>} The CSRF token
     */
    async getCsrfToken() {
        if (!this.csrfToken) {
            await this.fetchCsrfToken();
        }
        return this.csrfToken;
    }

    /**
     * Add CSRF token to request data
     * @param {Object} data - The request data
     * @returns {Promise<Object>} Data with CSRF token added
     */
    async addCsrfToken(data = {}) {
        const token = await this.getCsrfToken();
        if (!token) {
            console.warn('No CSRF token available');
        }
        return { ...data, _csrf: token };
    }

    /**
     * Clear the cached CSRF token (for refresh scenarios)
     */
    clearCsrfToken() {
        this.csrfToken = null;
    }

    /**
     * Register callback for lock event
     */
    onLock(callback) {
        this.lockCallbacks.push(callback);
    }

    /**
     * Register callback for unlock event
     */
    onUnlock(callback) {
        this.unlockCallbacks.push(callback);
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stopTimeoutChecker();

        const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
        events.forEach(event => {
            document.removeEventListener(event, this.handleActivity);
        });
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SecurityManager;
}
