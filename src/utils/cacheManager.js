const crypto = require('crypto');
const logger = require('./logger');

class CacheManager {
    constructor() {
        this.cache = new Map();
        this.maxCacheSize = 100; // Maximum number of cached items
        this.cacheStats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            totalRequests: 0
        };
        
        // Cache configuration
        this.config = {
            enabled: true,
            ttl: 3600000, // 1 hour in milliseconds
            maxSimilarity: 0.85, // Minimum similarity for cache hit
            maxPromptLength: 1000 // Only cache prompts shorter than this
        };
    }

    /**
     * Generate cache key from prompt
     */
    generateCacheKey(prompt) {
        // Normalize prompt for better cache hits
        const normalizedPrompt = prompt.toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
        
        return crypto.createHash('sha256')
            .update(normalizedPrompt)
            .digest('hex')
            .substring(0, 16);
    }

    /**
     * Calculate similarity between two prompts
     */
    calculateSimilarity(prompt1, prompt2) {
        const normalize = (str) => str.toLowerCase().replace(/\s+/g, ' ').trim();
        const a = normalize(prompt1);
        const b = normalize(prompt2);

        if (a === b) return 1.0;
        if (a.length === 0 || b.length === 0) return 0.0;

        // Simple Jaccard similarity using word sets
        const wordsA = new Set(a.split(' '));
        const wordsB = new Set(b.split(' '));
        
        const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
        const union = new Set([...wordsA, ...wordsB]);
        
        return intersection.size / union.size;
    }

    /**
     * Find similar cached prompts
     */
    findSimilarCachedPrompt(prompt) {
        if (!this.config.enabled) return null;

        let bestMatch = null;
        let bestSimilarity = 0;

        for (const [key, cachedItem] of this.cache.entries()) {
            if (this.isExpired(cachedItem)) {
                this.cache.delete(key);
                this.cacheStats.evictions++;
                continue;
            }

            const similarity = this.calculateSimilarity(prompt, cachedItem.prompt);
            if (similarity > bestSimilarity && similarity >= this.config.maxSimilarity) {
                bestSimilarity = similarity;
                bestMatch = cachedItem;
            }
        }

        return bestMatch;
    }

    /**
     * Get cached result for prompt
     */
    get(prompt) {
        this.cacheStats.totalRequests++;

        if (!this.config.enabled || prompt.length > this.config.maxPromptLength) {
            this.cacheStats.misses++;
            return null;
        }

        // First try exact match
        const exactKey = this.generateCacheKey(prompt);
        const exactMatch = this.cache.get(exactKey);
        
        if (exactMatch && !this.isExpired(exactMatch)) {
            this.cacheStats.hits++;
            exactMatch.lastAccessed = Date.now();
            exactMatch.hitCount++;
            
            logger.debug('Cache hit (exact match)', {
                key: exactKey,
                hitCount: exactMatch.hitCount,
                age: Date.now() - exactMatch.createdAt
            });
            
            return exactMatch.result;
        }

        // Try similarity match
        const similarMatch = this.findSimilarCachedPrompt(prompt);
        if (similarMatch) {
            this.cacheStats.hits++;
            similarMatch.lastAccessed = Date.now();
            similarMatch.hitCount++;
            
            logger.debug('Cache hit (similarity match)', {
                originalPrompt: prompt.substring(0, 50) + '...',
                cachedPrompt: similarMatch.prompt.substring(0, 50) + '...',
                similarity: this.calculateSimilarity(prompt, similarMatch.prompt),
                hitCount: similarMatch.hitCount
            });
            
            return similarMatch.result;
        }

        this.cacheStats.misses++;
        return null;
    }

    /**
     * Store result in cache
     */
    set(prompt, result) {
        if (!this.config.enabled || prompt.length > this.config.maxPromptLength) {
            return;
        }

        // Don't cache failed results
        if (!result.success) {
            return;
        }

        const key = this.generateCacheKey(prompt);
        const cacheItem = {
            key,
            prompt,
            result,
            createdAt: Date.now(),
            lastAccessed: Date.now(),
            hitCount: 0
        };

        // Evict old items if cache is full
        if (this.cache.size >= this.maxCacheSize) {
            this.evictLeastUsed();
        }

        this.cache.set(key, cacheItem);
        
        logger.debug('Item cached', {
            key,
            promptLength: prompt.length,
            cacheSize: this.cache.size
        });
    }

    /**
     * Check if cache item is expired
     */
    isExpired(cacheItem) {
        return Date.now() - cacheItem.createdAt > this.config.ttl;
    }

    /**
     * Evict least recently used items
     */
    evictLeastUsed() {
        if (this.cache.size === 0) return;

        // Find the item with the lowest score (combination of recency and frequency)
        let leastUsedKey = null;
        let leastUsedScore = Infinity;

        for (const [key, item] of this.cache.entries()) {
            // Score based on recency and frequency
            const recencyScore = Date.now() - item.lastAccessed;
            const frequencyScore = 1 / (item.hitCount + 1);
            const score = recencyScore * frequencyScore;

            if (score < leastUsedScore) {
                leastUsedScore = score;
                leastUsedKey = key;
            }
        }

        if (leastUsedKey) {
            this.cache.delete(leastUsedKey);
            this.cacheStats.evictions++;
            
            logger.debug('Cache item evicted', {
                key: leastUsedKey,
                reason: 'least_used'
            });
        }
    }

    /**
     * Clear expired items
     */
    clearExpired() {
        let expiredCount = 0;
        const now = Date.now();

        for (const [key, item] of this.cache.entries()) {
            if (now - item.createdAt > this.config.ttl) {
                this.cache.delete(key);
                expiredCount++;
            }
        }

        if (expiredCount > 0) {
            this.cacheStats.evictions += expiredCount;
            logger.info('Expired cache items cleared', { count: expiredCount });
        }

        return expiredCount;
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const hitRate = this.cacheStats.totalRequests > 0 ? 
            (this.cacheStats.hits / this.cacheStats.totalRequests) * 100 : 0;

        return {
            size: this.cache.size,
            maxSize: this.maxCacheSize,
            hitRate: hitRate.toFixed(2) + '%',
            hits: this.cacheStats.hits,
            misses: this.cacheStats.misses,
            evictions: this.cacheStats.evictions,
            totalRequests: this.cacheStats.totalRequests,
            config: this.config
        };
    }

    /**
     * Update cache configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        // If cache was disabled, clear it
        if (!this.config.enabled) {
            this.clear();
        }
        
        // If max size was reduced, evict items
        if (this.config.maxCacheSize && this.cache.size > this.config.maxCacheSize) {
            this.maxCacheSize = this.config.maxCacheSize;
            while (this.cache.size > this.maxCacheSize) {
                this.evictLeastUsed();
            }
        }

        logger.info('Cache configuration updated', { config: this.config });
    }

    /**
     * Clear entire cache
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        logger.info('Cache cleared', { itemsRemoved: size });
    }

    /**
     * Get detailed cache contents (for debugging)
     */
    getContents() {
        const contents = [];
        for (const [key, item] of this.cache.entries()) {
            contents.push({
                key,
                prompt: item.prompt.substring(0, 100) + '...',
                createdAt: new Date(item.createdAt).toISOString(),
                lastAccessed: new Date(item.lastAccessed).toISOString(),
                hitCount: item.hitCount,
                age: Date.now() - item.createdAt,
                expired: this.isExpired(item)
            });
        }
        return contents.sort((a, b) => b.lastAccessed - a.lastAccessed);
    }

    /**
     * Warm up cache with common patterns
     */
    warmUp(patterns = []) {
        logger.info('Warming up cache with common patterns', { patternCount: patterns.length });
        
        patterns.forEach(pattern => {
            // This would ideally pre-generate common components
            // For now, just log the intent
            logger.debug('Cache warm-up pattern registered', { 
                pattern: pattern.substring(0, 50) + '...' 
            });
        });
    }

    /**
     * Export cache for persistence
     */
    export() {
        const exportData = {
            items: Array.from(this.cache.entries()).map(([key, item]) => ({
                key,
                prompt: item.prompt,
                result: item.result,
                createdAt: item.createdAt,
                lastAccessed: item.lastAccessed,
                hitCount: item.hitCount
            })),
            stats: this.cacheStats,
            config: this.config,
            exportedAt: Date.now()
        };
        
        return exportData;
    }

    /**
     * Import cache from exported data
     */
    import(exportData) {
        if (!exportData || !exportData.items) {
            logger.error('Invalid cache import data');
            return false;
        }

        try {
            this.cache.clear();
            
            exportData.items.forEach(item => {
                // Only import non-expired items
                if (!this.isExpired(item)) {
                    this.cache.set(item.key, {
                        key: item.key,
                        prompt: item.prompt,
                        result: item.result,
                        createdAt: item.createdAt,
                        lastAccessed: item.lastAccessed,
                        hitCount: item.hitCount
                    });
                }
            });

            // Restore stats if available
            if (exportData.stats) {
                this.cacheStats = { ...this.cacheStats, ...exportData.stats };
            }

            logger.info('Cache imported successfully', {
                itemsImported: this.cache.size,
                originalSize: exportData.items.length
            });

            return true;
        } catch (error) {
            logger.error('Cache import failed', error);
            return false;
        }
    }
}

module.exports = new CacheManager();