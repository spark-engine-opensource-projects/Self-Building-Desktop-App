const EventEmitter = require('events');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

/**
 * CollaborationModule - Real-time collaboration features for the application
 * Implements WebSocket-based collaboration with conflict resolution
 */
class CollaborationModule extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map(); // Active collaboration sessions
        this.users = new Map(); // Connected users
        this.documents = new Map(); // Shared documents
        this.changes = new Map(); // Document change history
        this.locks = new Map(); // Document locks for editing
        this.wsServer = null;
        this.wsClient = null;
        this.currentSession = null;
        this.userId = this.generateUserId();
        this.isHost = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.heartbeatInterval = null;
        this.conflictResolutionStrategy = 'last-write-wins'; // or 'manual', 'merge'
    }

    /**
     * Initialize collaboration module
     */
    async initialize(config = {}) {
        try {
            this.config = {
                port: config.port || 3001,
                maxUsers: config.maxUsers || 10,
                autoSave: config.autoSave !== false,
                saveInterval: config.saveInterval || 5000,
                encryptionEnabled: config.encryptionEnabled !== false,
                ...config
            };

            if (this.config.autoSave) {
                this.startAutoSave();
            }

            this.setupEventHandlers();
            
            console.log('Collaboration module initialized');
            return { success: true };
        } catch (error) {
            console.error('Failed to initialize collaboration module:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        this.on('user-joined', this.handleUserJoined.bind(this));
        this.on('user-left', this.handleUserLeft.bind(this));
        this.on('document-changed', this.handleDocumentChanged.bind(this));
        this.on('cursor-moved', this.handleCursorMoved.bind(this));
        this.on('selection-changed', this.handleSelectionChanged.bind(this));
    }

    /**
     * Start a collaboration session as host
     */
    async startSession(sessionConfig = {}) {
        try {
            if (this.wsServer) {
                throw new Error('Session already active');
            }

            const sessionId = this.generateSessionId();
            const sessionData = {
                id: sessionId,
                host: this.userId,
                name: sessionConfig.name || 'Collaboration Session',
                created: Date.now(),
                config: sessionConfig,
                users: [this.userId],
                documents: [],
                password: sessionConfig.password || null
            };

            this.sessions.set(sessionId, sessionData);
            this.currentSession = sessionData;
            this.isHost = true;

            // Start WebSocket server
            this.wsServer = new WebSocket.Server({ 
                port: this.config.port,
                verifyClient: this.verifyClient.bind(this)
            });

            this.wsServer.on('connection', this.handleConnection.bind(this));
            this.wsServer.on('error', this.handleServerError.bind(this));

            // Start heartbeat
            this.startHeartbeat();

            console.log(`Collaboration session started: ${sessionId}`);
            this.emit('session-started', sessionData);

            return {
                success: true,
                sessionId,
                joinLink: this.generateJoinLink(sessionId),
                sessionData
            };
        } catch (error) {
            console.error('Failed to start session:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Join an existing collaboration session
     */
    async joinSession(joinLink, password = null) {
        try {
            if (this.wsClient) {
                throw new Error('Already connected to a session');
            }

            const sessionInfo = this.parseJoinLink(joinLink);
            
            // Connect to WebSocket server
            this.wsClient = new WebSocket(`ws://${sessionInfo.host}:${sessionInfo.port}`, {
                headers: {
                    'x-session-id': sessionInfo.sessionId,
                    'x-user-id': this.userId,
                    'x-password': password || ''
                }
            });

            return new Promise((resolve, reject) => {
                this.wsClient.on('open', () => {
                    console.log('Connected to collaboration session');
                    this.sendMessage({
                        type: 'join',
                        userId: this.userId,
                        sessionId: sessionInfo.sessionId
                    });
                    
                    this.startHeartbeat();
                    resolve({ success: true, sessionId: sessionInfo.sessionId });
                });

                this.wsClient.on('message', this.handleMessage.bind(this));
                this.wsClient.on('close', this.handleDisconnect.bind(this));
                this.wsClient.on('error', (error) => {
                    reject({ success: false, error: error.message });
                });
            });
        } catch (error) {
            console.error('Failed to join session:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Share a document in the collaboration session
     */
    async shareDocument(documentPath, options = {}) {
        try {
            if (!this.currentSession) {
                throw new Error('No active session');
            }

            const content = await fs.readFile(documentPath, 'utf8');
            const documentId = this.generateDocumentId();
            
            const document = {
                id: documentId,
                path: documentPath,
                name: path.basename(documentPath),
                content,
                version: 1,
                owner: this.userId,
                shared: Date.now(),
                locks: [],
                cursors: new Map(),
                selections: new Map(),
                readOnly: options.readOnly || false
            };

            this.documents.set(documentId, document);
            
            // Initialize change tracking
            this.changes.set(documentId, []);

            // Broadcast document to other users
            this.broadcast({
                type: 'document-shared',
                document: this.serializeDocument(document)
            });

            this.emit('document-shared', document);
            
            return { success: true, documentId };
        } catch (error) {
            console.error('Failed to share document:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Apply changes to a shared document
     */
    async applyDocumentChange(documentId, change) {
        try {
            const document = this.documents.get(documentId);
            if (!document) {
                throw new Error('Document not found');
            }

            // Check for locks
            if (this.isDocumentLocked(documentId, this.userId)) {
                throw new Error('Document is locked by another user');
            }

            // Apply operational transformation for conflict resolution
            const transformedChange = await this.transformChange(documentId, change);
            
            // Apply the change
            document.content = this.applyChange(document.content, transformedChange);
            document.version++;
            
            // Track change history
            const changeRecord = {
                id: this.generateChangeId(),
                userId: this.userId,
                timestamp: Date.now(),
                change: transformedChange,
                version: document.version
            };
            
            this.changes.get(documentId).push(changeRecord);
            
            // Broadcast change to other users
            this.broadcast({
                type: 'document-changed',
                documentId,
                change: changeRecord,
                userId: this.userId
            }, this.userId);

            this.emit('document-changed', { documentId, change: changeRecord });
            
            return { success: true, version: document.version };
        } catch (error) {
            console.error('Failed to apply document change:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Lock a document for exclusive editing
     */
    async lockDocument(documentId, duration = 30000) {
        try {
            const document = this.documents.get(documentId);
            if (!document) {
                throw new Error('Document not found');
            }

            // Check if already locked
            const existingLock = this.locks.get(documentId);
            if (existingLock && existingLock.userId !== this.userId) {
                return { 
                    success: false, 
                    error: 'Document locked by another user',
                    lockedBy: existingLock.userId,
                    until: existingLock.until
                };
            }

            const lock = {
                userId: this.userId,
                timestamp: Date.now(),
                until: Date.now() + duration
            };

            this.locks.set(documentId, lock);

            // Auto-release lock after duration
            setTimeout(() => {
                this.unlockDocument(documentId);
            }, duration);

            // Broadcast lock status
            this.broadcast({
                type: 'document-locked',
                documentId,
                lock
            });

            return { success: true, lock };
        } catch (error) {
            console.error('Failed to lock document:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Unlock a document
     */
    async unlockDocument(documentId) {
        try {
            const lock = this.locks.get(documentId);
            if (lock && lock.userId === this.userId) {
                this.locks.delete(documentId);
                
                this.broadcast({
                    type: 'document-unlocked',
                    documentId,
                    userId: this.userId
                });
                
                return { success: true };
            }
            
            return { success: false, error: 'Not locked by current user' };
        } catch (error) {
            console.error('Failed to unlock document:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update cursor position for a document
     */
    updateCursorPosition(documentId, position) {
        const document = this.documents.get(documentId);
        if (!document) return;

        document.cursors.set(this.userId, {
            position,
            timestamp: Date.now(),
            color: this.getUserColor(this.userId)
        });

        this.broadcast({
            type: 'cursor-updated',
            documentId,
            userId: this.userId,
            position
        }, this.userId);
    }

    /**
     * Update selection for a document
     */
    updateSelection(documentId, selection) {
        const document = this.documents.get(documentId);
        if (!document) return;

        document.selections.set(this.userId, {
            selection,
            timestamp: Date.now(),
            color: this.getUserColor(this.userId)
        });

        this.broadcast({
            type: 'selection-updated',
            documentId,
            userId: this.userId,
            selection
        }, this.userId);
    }

    /**
     * Handle WebSocket connection
     */
    handleConnection(ws, request) {
        const userId = request.headers['x-user-id'];
        const sessionId = request.headers['x-session-id'];
        
        const user = {
            id: userId,
            ws,
            connected: Date.now(),
            lastActivity: Date.now(),
            sessionId
        };

        this.users.set(userId, user);
        
        ws.on('message', (data) => {
            this.handleMessage(data, userId);
        });

        ws.on('close', () => {
            this.handleUserDisconnect(userId);
        });

        ws.on('error', (error) => {
            console.error(`WebSocket error for user ${userId}:`, error);
        });

        // Send session state to new user
        this.sendSessionState(userId);
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleMessage(data, userId = null) {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'join':
                    this.handleUserJoin(message);
                    break;
                case 'document-change':
                    this.applyDocumentChange(message.documentId, message.change);
                    break;
                case 'cursor-update':
                    this.updateCursorPosition(message.documentId, message.position);
                    break;
                case 'selection-update':
                    this.updateSelection(message.documentId, message.selection);
                    break;
                case 'document-lock':
                    this.lockDocument(message.documentId, message.duration);
                    break;
                case 'document-unlock':
                    this.unlockDocument(message.documentId);
                    break;
                case 'chat-message':
                    this.handleChatMessage(message);
                    break;
                case 'heartbeat':
                    this.handleHeartbeat(userId || message.userId);
                    break;
                default:
                    console.warn('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    /**
     * Broadcast message to all connected users
     */
    broadcast(message, excludeUserId = null) {
        const data = JSON.stringify(message);
        
        if (this.wsServer) {
            // Host broadcasting
            this.users.forEach((user, userId) => {
                if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
                    user.ws.send(data);
                }
            });
        } else if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
            // Client sending to host
            this.wsClient.send(data);
        }
    }

    /**
     * Send message to specific user or server
     */
    sendMessage(message, targetUserId = null) {
        const data = JSON.stringify(message);
        
        if (targetUserId) {
            const user = this.users.get(targetUserId);
            if (user && user.ws.readyState === WebSocket.OPEN) {
                user.ws.send(data);
            }
        } else if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
            this.wsClient.send(data);
        }
    }

    /**
     * Transform change for operational transformation
     */
    async transformChange(documentId, change) {
        const history = this.changes.get(documentId) || [];
        
        // Simple operational transformation
        // In production, use a proper OT library like ot.js
        let transformedChange = { ...change };
        
        // Get concurrent changes since the change's base version
        const concurrentChanges = history.filter(c => 
            c.version > change.baseVersion && 
            c.userId !== change.userId
        );
        
        // Transform against each concurrent change
        for (const concurrent of concurrentChanges) {
            transformedChange = this.transformAgainst(transformedChange, concurrent.change);
        }
        
        return transformedChange;
    }

    /**
     * Transform one change against another
     */
    transformAgainst(change1, change2) {
        // Simple transformation logic
        // In production, implement proper OT algorithms
        
        if (change1.type === 'insert' && change2.type === 'insert') {
            if (change1.position < change2.position) {
                return change1;
            } else {
                return {
                    ...change1,
                    position: change1.position + change2.text.length
                };
            }
        } else if (change1.type === 'delete' && change2.type === 'insert') {
            if (change1.position < change2.position) {
                return change1;
            } else {
                return {
                    ...change1,
                    position: change1.position + change2.text.length
                };
            }
        } else if (change1.type === 'insert' && change2.type === 'delete') {
            if (change1.position <= change2.position) {
                return change1;
            } else if (change1.position > change2.position + change2.length) {
                return {
                    ...change1,
                    position: change1.position - change2.length
                };
            } else {
                return {
                    ...change1,
                    position: change2.position
                };
            }
        } else if (change1.type === 'delete' && change2.type === 'delete') {
            if (change1.position < change2.position) {
                return change1;
            } else if (change1.position > change2.position + change2.length) {
                return {
                    ...change1,
                    position: change1.position - change2.length
                };
            } else {
                // Overlapping deletes
                return {
                    ...change1,
                    position: Math.min(change1.position, change2.position),
                    length: Math.max(0, change1.length - change2.length)
                };
            }
        }
        
        return change1;
    }

    /**
     * Apply a change to document content
     */
    applyChange(content, change) {
        switch (change.type) {
            case 'insert':
                return content.slice(0, change.position) + 
                       change.text + 
                       content.slice(change.position);
            
            case 'delete':
                return content.slice(0, change.position) + 
                       content.slice(change.position + change.length);
            
            case 'replace':
                return content.slice(0, change.position) + 
                       change.text + 
                       content.slice(change.position + change.length);
            
            default:
                return content;
        }
    }

    /**
     * Resolve conflicts between changes
     */
    async resolveConflict(documentId, localChange, remoteChange) {
        switch (this.conflictResolutionStrategy) {
            case 'last-write-wins':
                return remoteChange.timestamp > localChange.timestamp ? 
                       remoteChange : localChange;
            
            case 'merge':
                return this.mergeChanges(localChange, remoteChange);
            
            case 'manual':
                this.emit('conflict-detected', {
                    documentId,
                    localChange,
                    remoteChange
                });
                // Wait for user resolution
                return new Promise((resolve) => {
                    this.once(`conflict-resolved-${documentId}`, resolve);
                });
            
            default:
                return remoteChange;
        }
    }

    /**
     * Merge two changes
     */
    mergeChanges(change1, change2) {
        // Simple merge strategy
        // In production, use more sophisticated merging
        
        if (change1.type === 'insert' && change2.type === 'insert') {
            // Combine insertions
            return {
                type: 'insert',
                position: Math.min(change1.position, change2.position),
                text: change1.position < change2.position ? 
                      change1.text + change2.text : 
                      change2.text + change1.text,
                timestamp: Date.now()
            };
        }
        
        // For other cases, use last-write-wins
        return change2.timestamp > change1.timestamp ? change2 : change1;
    }

    /**
     * Send current session state to a user
     */
    sendSessionState(userId) {
        const user = this.users.get(userId);
        if (!user) return;

        const state = {
            type: 'session-state',
            session: this.currentSession,
            users: Array.from(this.users.keys()),
            documents: Array.from(this.documents.values()).map(d => this.serializeDocument(d))
        };

        user.ws.send(JSON.stringify(state));
    }

    /**
     * Handle user joining session
     */
    handleUserJoin(message) {
        console.log(`User ${message.userId} joined session`);
        
        this.currentSession.users.push(message.userId);
        
        this.broadcast({
            type: 'user-joined',
            userId: message.userId,
            timestamp: Date.now()
        }, message.userId);
        
        this.emit('user-joined', message.userId);
    }

    /**
     * Handle user disconnect
     */
    handleUserDisconnect(userId) {
        console.log(`User ${userId} disconnected`);
        
        this.users.delete(userId);
        
        // Remove user from current session
        if (this.currentSession) {
            this.currentSession.users = this.currentSession.users.filter(
                id => id !== userId
            );
        }
        
        // Clean up user's locks
        this.locks.forEach((lock, documentId) => {
            if (lock.userId === userId) {
                this.locks.delete(documentId);
            }
        });
        
        // Clean up user's cursors and selections
        this.documents.forEach(document => {
            document.cursors.delete(userId);
            document.selections.delete(userId);
        });
        
        this.broadcast({
            type: 'user-left',
            userId,
            timestamp: Date.now()
        });
        
        this.emit('user-left', userId);
    }

    /**
     * Handle disconnect from session
     */
    handleDisconnect() {
        console.log('Disconnected from collaboration session');
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.reconnect(), 1000 * this.reconnectAttempts);
        } else {
            this.emit('session-disconnected');
        }
    }

    /**
     * Reconnect to session
     */
    async reconnect() {
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        // Implement reconnection logic
        // This would reconnect using saved session info
    }

    /**
     * Start heartbeat to keep connection alive
     */
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            this.sendMessage({
                type: 'heartbeat',
                userId: this.userId,
                timestamp: Date.now()
            });
        }, 30000); // Every 30 seconds
    }

    /**
     * Stop heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Handle heartbeat message
     */
    handleHeartbeat(userId) {
        const user = this.users.get(userId);
        if (user) {
            user.lastActivity = Date.now();
        }
    }

    /**
     * Start auto-save timer
     */
    startAutoSave() {
        setInterval(() => {
            this.documents.forEach((document, documentId) => {
                this.saveDocument(documentId);
            });
        }, this.config.saveInterval);
    }

    /**
     * Save document to disk
     */
    async saveDocument(documentId) {
        try {
            const document = this.documents.get(documentId);
            if (!document) return;

            await fs.writeFile(document.path, document.content, 'utf8');
            
            this.emit('document-saved', { documentId, path: document.path });
            
            return { success: true };
        } catch (error) {
            console.error('Failed to save document:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Handle chat messages
     */
    handleChatMessage(message) {
        this.broadcast({
            type: 'chat-message',
            userId: message.userId,
            text: message.text,
            timestamp: Date.now()
        }, message.userId);
        
        this.emit('chat-message', message);
    }

    /**
     * Handle various events
     */
    handleUserJoined(userId) {
        console.log(`User joined: ${userId}`);
    }

    handleUserLeft(userId) {
        console.log(`User left: ${userId}`);
    }

    handleDocumentChanged(data) {
        console.log(`Document changed: ${data.documentId}`);
    }

    handleCursorMoved(data) {
        console.log(`Cursor moved for user: ${data.userId}`);
    }

    handleSelectionChanged(data) {
        console.log(`Selection changed for user: ${data.userId}`);
    }

    /**
     * Verify WebSocket client
     */
    verifyClient(info) {
        const sessionId = info.req.headers['x-session-id'];
        const password = info.req.headers['x-password'];
        
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        
        if (session.password && session.password !== password) {
            return false;
        }
        
        if (session.users.length >= this.config.maxUsers) {
            return false;
        }
        
        return true;
    }

    /**
     * Check if document is locked by another user
     */
    isDocumentLocked(documentId, userId) {
        const lock = this.locks.get(documentId);
        return lock && lock.userId !== userId && lock.until > Date.now();
    }

    /**
     * Serialize document for transmission
     */
    serializeDocument(document) {
        return {
            id: document.id,
            name: document.name,
            content: document.content,
            version: document.version,
            owner: document.owner,
            shared: document.shared,
            readOnly: document.readOnly,
            cursors: Array.from(document.cursors.entries()),
            selections: Array.from(document.selections.entries())
        };
    }

    /**
     * Generate user ID
     */
    generateUserId() {
        return `user_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Generate session ID
     */
    generateSessionId() {
        return `session_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Generate document ID
     */
    generateDocumentId() {
        return `doc_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Generate change ID
     */
    generateChangeId() {
        return `change_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Generate join link for session
     */
    generateJoinLink(sessionId) {
        const host = require('os').hostname();
        return `collab://${host}:${this.config.port}/${sessionId}`;
    }

    /**
     * Parse join link
     */
    parseJoinLink(joinLink) {
        const match = joinLink.match(/collab:\/\/([^:]+):(\d+)\/(.+)/);
        if (!match) throw new Error('Invalid join link');
        
        return {
            host: match[1],
            port: parseInt(match[2]),
            sessionId: match[3]
        };
    }

    /**
     * Get user color for cursor/selection display
     */
    getUserColor(userId) {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
            '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE'
        ];
        
        const index = Array.from(this.users.keys()).indexOf(userId);
        return colors[index % colors.length];
    }

    /**
     * Export session data
     */
    async exportSession() {
        if (!this.currentSession) {
            throw new Error('No active session');
        }

        return {
            session: this.currentSession,
            documents: Array.from(this.documents.values()).map(d => this.serializeDocument(d)),
            changes: Array.from(this.changes.entries()),
            users: Array.from(this.users.keys())
        };
    }

    /**
     * Get collaboration statistics
     */
    getStatistics() {
        return {
            activeUsers: this.users.size,
            sharedDocuments: this.documents.size,
            totalChanges: Array.from(this.changes.values())
                .reduce((sum, changes) => sum + changes.length, 0),
            lockedDocuments: this.locks.size,
            sessionDuration: this.currentSession ? 
                Date.now() - this.currentSession.created : 0
        };
    }

    /**
     * Cleanup and close collaboration
     */
    async cleanup() {
        try {
            // Save all documents
            for (const [documentId] of this.documents) {
                await this.saveDocument(documentId);
            }

            // Stop heartbeat
            this.stopHeartbeat();

            // Close WebSocket connections
            if (this.wsServer) {
                this.wsServer.close();
                this.wsServer = null;
            }

            if (this.wsClient) {
                this.wsClient.close();
                this.wsClient = null;
            }

            // Clear data
            this.sessions.clear();
            this.users.clear();
            this.documents.clear();
            this.changes.clear();
            this.locks.clear();

            console.log('Collaboration module cleaned up');
            return { success: true };
        } catch (error) {
            console.error('Failed to cleanup collaboration module:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = CollaborationModule;