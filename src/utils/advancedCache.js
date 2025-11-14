const crypto = require('crypto');
const logger = require('./logger');

/**
 * Advanced Cache Manager with O(1) operations
 * Implements LRU eviction with hash-based indexing
 */
class AdvancedCache {
    constructor(options = {}) {
        // Cache configuration
        this.maxSize = options.maxSize || 100;
        this.maxMemoryMB = options.maxMemoryMB || 50;
        this.ttl = options.ttl || 3600000; // 1 hour
        this.similarityThreshold = options.similarityThreshold || 0.85;
        
        // Primary cache storage
        this.cache = new Map(); // key -> CacheEntry
        this.hashIndex = new Map(); // hash -> key
        this.sizeIndex = new Map(); // size -> Set of keys
        this.typeIndex = new Map(); // type -> Set of keys
        
        // LRU implementation using doubly linked list
        this.head = null; // Most recently used
        this.tail = null; // Least recently used
        this.nodeMap = new Map(); // key -> Node
        
        // Memory tracking
        this.currentMemoryBytes = 0;
        this.maxMemoryBytes = this.maxMemoryMB * 1024 * 1024;
        
        // Vector embeddings for semantic search (simplified)
        this.embeddings = new Map(); // key -> embedding vector
        
        // Statistics
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            memoryEvictions: 0,
            ttlEvictions: 0,
            totalRequests: 0,
            averageAccessTime: 0,
            cacheEfficiency: 0
        };
        
        // Performance metrics
        this.accessTimes = [];
        this.maxAccessTimeSamples = 1000;
        
        // Start maintenance
        this.startMaintenance();
    }
    
    /**
     * LRU Node for doubly linked list
     */
    createNode(key) {
        return {
            key: key,
            prev: null,
            next: null,
            accessCount: 0,
            lastAccess: Date.now()
        };
    }
    
    /**
     * Move node to head (mark as most recently used)
     */
    moveToHead(node) {
        // Remove from current position
        if (node.prev) node.prev.next = node.next;
        if (node.next) node.next.prev = node.prev;
        if (this.tail === node) this.tail = node.prev;
        
        // Add to head
        node.prev = null;
        node.next = this.head;
        if (this.head) this.head.prev = node;
        this.head = node;
        
        // Update tail if needed
        if (!this.tail) this.tail = node;
    }
    
    /**
     * Remove node from linked list
     */
    removeNode(node) {
        if (node.prev) node.prev.next = node.next;
        if (node.next) node.next.prev = node.prev;
        if (this.head === node) this.head = node.next;
        if (this.tail === node) this.tail = node.prev;
    }
    
    /**
     * Calculate hash for cache key
     */
    calculateHash(data) {
        const str = typeof data === 'string' ? data : JSON.stringify(data);
        return crypto.createHash('sha256').update(str).digest('hex');
    }
    
    /**
     * Calculate simple embedding (for demo - use real embeddings in production)
     */
    calculateEmbedding(text) {
        // Simplified embedding - in production use proper NLP model
        const words = text.toLowerCase().split(/\s+/);
        const vector = new Array(128).fill(0);
        
        words.forEach((word, idx) => {
            const hash = this.calculateHash(word);
            for (let i = 0; i < 128; i += 8) {
                const byte = parseInt(hash.substr(Math.floor(i/4), 2), 16);
                vector[i + (idx % 8)] += byte / 255;
            }
        });
        
        // Normalize vector
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        return magnitude > 0 ? vector.map(val => val / magnitude) : vector;
    }
    
    /**
     * Calculate cosine similarity between vectors
     */
    cosineSimilarity(vec1, vec2) {
        if (vec1.length !== vec2.length) return 0;
        
        let dotProduct = 0;
        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
        }
        
        return dotProduct; // Vectors are already normalized
    }
    
    /**
     * Set cache entry with O(1) complexity
     */
    set(key, value, options = {}) {
        const startTime = performance.now();
        
        try {
            // Calculate size
            const size = this.calculateSize(value);
            
            // Check memory limit
            if (size > this.maxMemoryBytes) {
                logger.warn('Cache entry too large', { key, size, maxSize: this.maxMemoryBytes });
                return false;
            }
            
            // Evict if necessary
            while (this.currentMemoryBytes + size > this.maxMemoryBytes || 
                   this.cache.size >= this.maxSize) {
                if (!this.evictLRU()) break;
            }
            
            // Create cache entry
            const entry = {
                key: key,
                value: value,
                size: size,
                timestamp: Date.now(),
                ttl: options.ttl || this.ttl,
                type: options.type || 'default',
                hits: 0,
                metadata: options.metadata || {}
            };
            
            // Add to cache
            this.cache.set(key, entry);
            
            // Update indices
            const hash = this.calculateHash(key);
            this.hashIndex.set(hash, key);
            
            // Update size index
            if (!this.sizeIndex.has(size)) {
                this.sizeIndex.set(size, new Set());
            }
            this.sizeIndex.get(size).add(key);
            
            // Update type index
            if (!this.typeIndex.has(entry.type)) {
                this.typeIndex.set(entry.type, new Set());
            }
            this.typeIndex.get(entry.type).add(key);
            
            // Update LRU list
            const node = this.createNode(key);
            this.nodeMap.set(key, node);
            this.moveToHead(node);
            
            // Calculate and store embedding for text values
            if (typeof value === 'string' || (value && value.prompt)) {
                const text = typeof value === 'string' ? value : value.prompt;
                const embedding = this.calculateEmbedding(text);
                this.embeddings.set(key, embedding);
            }
            
            // Update memory usage
            this.currentMemoryBytes += size;
            
            // Track performance
            const accessTime = performance.now() - startTime;
            this.trackAccessTime(accessTime);
            
            logger.debug('Cache entry added', { 
                key, 
                size, 
                totalSize: this.currentMemoryBytes,
                cacheSize: this.cache.size,
                accessTime: accessTime.toFixed(2) + 'ms'
            });
            
            return true;
            
        } catch (error) {
            logger.error('Failed to add cache entry', error, { key });
            return false;
        }
    }
    
    /**
     * Get cache entry with O(1) complexity
     */
    get(key, options = {}) {
        const startTime = performance.now();
        this.stats.totalRequests++;
        
        try {
            // Direct lookup
            if (this.cache.has(key)) {
                const entry = this.cache.get(key);
                
                // Check TTL
                if (this.isExpired(entry)) {
                    this.remove(key);
                    this.stats.misses++;
                    return null;
                }
                
                // Update stats
                entry.hits++;
                this.stats.hits++;
                
                // Update LRU
                const node = this.nodeMap.get(key);
                if (node) {
                    node.accessCount++;
                    node.lastAccess = Date.now();
                    this.moveToHead(node);
                }
                
                // Track performance
                const accessTime = performance.now() - startTime;
                this.trackAccessTime(accessTime);
                
                return entry.value;
            }
            
            // Hash lookup if key not found
            const hash = this.calculateHash(key);
            if (this.hashIndex.has(hash)) {
                const actualKey = this.hashIndex.get(hash);
                return this.get(actualKey);
            }
            
            this.stats.misses++;
            return null;
            
        } catch (error) {
            logger.error('Failed to get cache entry', error, { key });
            this.stats.misses++;
            return null;
        }
    }
    
    /**
     * Find similar entries using vector similarity
     */
    findSimilar(text, threshold = null) {
        const startTime = performance.now();
        threshold = threshold || this.similarityThreshold;
        
        try {
            const queryEmbedding = this.calculateEmbedding(text);
            const results = [];
            
            for (const [key, embedding] of this.embeddings) {
                const similarity = this.cosineSimilarity(queryEmbedding, embedding);
                
                if (similarity >= threshold) {
                    const entry = this.cache.get(key);
                    if (entry && !this.isExpired(entry)) {
                        results.push({
                            key: key,
                            value: entry.value,
                            similarity: similarity,
                            hits: entry.hits
                        });
                    }
                }
            }
            
            // Sort by similarity and hits
            results.sort((a, b) => {
                const simDiff = b.similarity - a.similarity;
                return simDiff !== 0 ? simDiff : b.hits - a.hits;
            });
            
            const accessTime = performance.now() - startTime;
            logger.debug('Similarity search completed', {
                query: text.substring(0, 50),
                results: results.length,
                threshold,
                time: accessTime.toFixed(2) + 'ms'
            });
            
            return results;
            
        } catch (error) {
            logger.error('Similarity search failed', error);
            return [];
        }
    }
    
    /**
     * Remove entry from cache
     */
    remove(key) {
        const entry = this.cache.get(key);
        if (!entry) return false;
        
        // Remove from main cache
        this.cache.delete(key);
        
        // Remove from indices
        const hash = this.calculateHash(key);
        this.hashIndex.delete(hash);
        
        // Remove from size index
        const sizeSet = this.sizeIndex.get(entry.size);
        if (sizeSet) {
            sizeSet.delete(key);
            if (sizeSet.size === 0) {
                this.sizeIndex.delete(entry.size);
            }
        }
        
        // Remove from type index
        const typeSet = this.typeIndex.get(entry.type);
        if (typeSet) {
            typeSet.delete(key);
            if (typeSet.size === 0) {
                this.typeIndex.delete(entry.type);
            }
        }
        
        // Remove from LRU list
        const node = this.nodeMap.get(key);
        if (node) {
            this.removeNode(node);
            this.nodeMap.delete(key);
        }
        
        // Remove embedding
        this.embeddings.delete(key);
        
        // Update memory
        this.currentMemoryBytes -= entry.size;
        
        return true;
    }
    
    /**
     * Evict least recently used item
     */
    evictLRU() {
        if (!this.tail) return false;
        
        const key = this.tail.key;
        this.remove(key);
        
        this.stats.evictions++;
        logger.debug('Evicted LRU entry', { key });
        
        return true;
    }
    
    /**
     * Check if entry is expired
     */
    isExpired(entry) {
        return Date.now() - entry.timestamp > entry.ttl;
    }
    
    /**
     * Calculate size of value in bytes
     */
    calculateSize(value) {
        // Rough estimation
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        return str.length * 2; // UTF-16 characters
    }
    
    /**
     * Track access time for performance metrics
     */
    trackAccessTime(time) {
        this.accessTimes.push(time);
        if (this.accessTimes.length > this.maxAccessTimeSamples) {
            this.accessTimes.shift();
        }
        
        // Calculate average
        const sum = this.accessTimes.reduce((a, b) => a + b, 0);
        this.stats.averageAccessTime = sum / this.accessTimes.length;
    }
    
    /**
     * Clean up expired entries
     */
    cleanupExpired() {
        let cleaned = 0;
        
        for (const [key, entry] of this.cache) {
            if (this.isExpired(entry)) {
                this.remove(key);
                cleaned++;
                this.stats.ttlEvictions++;
            }
        }
        
        if (cleaned > 0) {
            logger.info('Cleaned expired cache entries', { count: cleaned });
        }
        
        return cleaned;
    }
    
    /**
     * Get cache statistics
     */
    getStats() {
        const hitRate = this.stats.totalRequests > 0 
            ? (this.stats.hits / this.stats.totalRequests * 100).toFixed(2)
            : 0;
            
        const efficiency = this.cache.size > 0
            ? (this.stats.hits / (this.stats.hits + this.stats.evictions) * 100).toFixed(2)
            : 0;
        
        return {
            ...this.stats,
            hitRate: hitRate + '%',
            efficiency: efficiency + '%',
            size: this.cache.size,
            maxSize: this.maxSize,
            memoryUsage: (this.currentMemoryBytes / 1024 / 1024).toFixed(2) + ' MB',
            maxMemory: this.maxMemoryMB + ' MB',
            averageAccessTime: this.stats.averageAccessTime.toFixed(2) + ' ms'
        };
    }
    
    /**
     * Clear all cache entries
     */
    clear() {
        this.cache.clear();
        this.hashIndex.clear();
        this.sizeIndex.clear();
        this.typeIndex.clear();
        this.embeddings.clear();
        this.nodeMap.clear();
        this.head = null;
        this.tail = null;
        this.currentMemoryBytes = 0;
        
        logger.info('Cache cleared');
    }
    
    /**
     * Get entries by type
     */
    getByType(type) {
        const keys = this.typeIndex.get(type);
        if (!keys) return [];
        
        const results = [];
        for (const key of keys) {
            const entry = this.cache.get(key);
            if (entry && !this.isExpired(entry)) {
                results.push(entry.value);
            }
        }
        
        return results;
    }
    
    /**
     * Get entries by size range
     */
    getBySizeRange(minSize, maxSize) {
        const results = [];
        
        for (const [size, keys] of this.sizeIndex) {
            if (size >= minSize && size <= maxSize) {
                for (const key of keys) {
                    const entry = this.cache.get(key);
                    if (entry && !this.isExpired(entry)) {
                        results.push(entry.value);
                    }
                }
            }
        }
        
        return results;
    }
    
    /**
     * Start maintenance tasks
     */
    startMaintenance() {
        // Cleanup expired entries every minute
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpired();
        }, 60000);
        
        // Calculate efficiency every 5 minutes
        this.statsInterval = setInterval(() => {
            this.calculateEfficiency();
        }, 300000);
    }
    
    /**
     * Stop maintenance tasks
     */
    stopMaintenance() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }
    }
    
    /**
     * Calculate cache efficiency
     */
    calculateEfficiency() {
        if (this.stats.totalRequests > 0) {
            this.stats.cacheEfficiency = 
                (this.stats.hits / this.stats.totalRequests * 100).toFixed(2);
        }
    }
    
    /**
     * Export cache for persistence
     */
    export() {
        const data = {
            entries: [],
            stats: this.stats,
            timestamp: Date.now()
        };
        
        for (const [key, entry] of this.cache) {
            if (!this.isExpired(entry)) {
                data.entries.push({
                    key,
                    value: entry.value,
                    metadata: entry.metadata,
                    type: entry.type,
                    hits: entry.hits
                });
            }
        }
        
        return data;
    }
    
    /**
     * Import cache from persistence
     */
    import(data) {
        if (!data || !data.entries) return false;
        
        this.clear();
        
        for (const item of data.entries) {
            this.set(item.key, item.value, {
                metadata: item.metadata,
                type: item.type
            });
        }
        
        logger.info('Cache imported', { entries: data.entries.length });
        return true;
    }
}

// Export singleton instance
module.exports = new AdvancedCache();