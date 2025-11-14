const advancedCache = require('../../src/utils/advancedCache');

describe('Advanced Cache', () => {
    beforeEach(() => {
        advancedCache.clear();
    });

    afterEach(() => {
        advancedCache.clear();
    });

    describe('Basic Operations', () => {
        test('should set and get cache entries', () => {
            const key = 'test-key';
            const value = { data: 'test value' };
            
            expect(advancedCache.set(key, value)).toBe(true);
            expect(advancedCache.get(key)).toEqual(value);
        });

        test('should return null for non-existent keys', () => {
            expect(advancedCache.get('non-existent')).toBeNull();
        });

        test('should handle different data types', () => {
            const testData = [
                { key: 'string', value: 'test string' },
                { key: 'number', value: 42 },
                { key: 'boolean', value: true },
                { key: 'array', value: [1, 2, 3] },
                { key: 'object', value: { nested: { data: 'value' } } },
                { key: 'null', value: null }
            ];
            
            testData.forEach(({ key, value }) => {
                advancedCache.set(key, value);
                expect(advancedCache.get(key)).toEqual(value);
            });
        });

        test('should remove entries', () => {
            const key = 'remove-test';
            const value = 'test';
            
            advancedCache.set(key, value);
            expect(advancedCache.get(key)).toBe(value);
            
            expect(advancedCache.remove(key)).toBe(true);
            expect(advancedCache.get(key)).toBeNull();
            expect(advancedCache.remove(key)).toBe(false); // Already removed
        });
    });

    describe('LRU Eviction', () => {
        test('should evict least recently used items', () => {
            // Set max size to small number for testing
            const cache = advancedCache;
            cache.maxSize = 3;
            
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
            
            // Access key1 to make it recently used
            cache.get('key1');
            
            // Add new key, should evict key2 (least recently used)
            cache.set('key4', 'value4');
            
            expect(cache.get('key1')).toBe('value1'); // Still exists
            expect(cache.get('key2')).toBeNull(); // Evicted
            expect(cache.get('key3')).toBe('value3'); // Still exists
            expect(cache.get('key4')).toBe('value4'); // New entry
        });

        test('should update LRU order on access', () => {
            const cache = advancedCache;
            cache.maxSize = 2;
            
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            
            // Access key1 multiple times
            cache.get('key1');
            cache.get('key1');
            
            // Add new key, should evict key2
            cache.set('key3', 'value3');
            
            expect(cache.get('key1')).toBe('value1');
            expect(cache.get('key2')).toBeNull();
            expect(cache.get('key3')).toBe('value3');
        });
    });

    describe('TTL Expiration', () => {
        test('should expire entries after TTL', (done) => {
            const key = 'ttl-test';
            const value = 'expires soon';
            
            advancedCache.set(key, value, { ttl: 100 }); // 100ms TTL
            
            expect(advancedCache.get(key)).toBe(value);
            
            setTimeout(() => {
                expect(advancedCache.get(key)).toBeNull();
                done();
            }, 150);
        });

        test('should not expire entries before TTL', (done) => {
            const key = 'ttl-test-2';
            const value = 'still valid';
            
            advancedCache.set(key, value, { ttl: 200 });
            
            setTimeout(() => {
                expect(advancedCache.get(key)).toBe(value);
                done();
            }, 100);
        });
    });

    describe('Hash Indexing', () => {
        test('should use hash index for O(1) lookup', () => {
            // Add many entries
            const entries = 1000;
            for (let i = 0; i < entries; i++) {
                advancedCache.set(`key-${i}`, `value-${i}`);
            }
            
            // Measure lookup time - should be consistent
            const startTime = performance.now();
            const result = advancedCache.get('key-500');
            const endTime = performance.now();
            
            expect(result).toBe('value-500');
            expect(endTime - startTime).toBeLessThan(5); // Should be very fast
        });
    });

    describe('Similarity Search', () => {
        test('should find similar text entries', () => {
            advancedCache.set('key1', 'The quick brown fox jumps over the lazy dog');
            advancedCache.set('key2', 'The fast brown fox jumps over the lazy cat');
            advancedCache.set('key3', 'Something completely different');
            advancedCache.set('key4', 'The quick red fox leaps over the sleepy dog');
            
            const results = advancedCache.findSimilar('quick brown fox jumps lazy dog', 0.5);
            
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].similarity).toBeGreaterThan(0.5);
            
            // Should not include completely different text
            const differentResult = results.find(r => r.key === 'key3');
            expect(differentResult).toBeUndefined();
        });

        test('should respect similarity threshold', () => {
            advancedCache.set('exact', 'test query');
            advancedCache.set('similar', 'test query with extra');
            advancedCache.set('different', 'completely different text');
            
            const highThreshold = advancedCache.findSimilar('test query', 0.9);
            const lowThreshold = advancedCache.findSimilar('test query', 0.3);
            
            expect(highThreshold.length).toBeLessThan(lowThreshold.length);
        });

        test('should sort results by similarity', () => {
            advancedCache.set('exact', 'test query');
            advancedCache.set('very-similar', 'test query extra');
            advancedCache.set('somewhat-similar', 'test different query');
            
            const results = advancedCache.findSimilar('test query', 0.3);
            
            if (results.length > 1) {
                for (let i = 1; i < results.length; i++) {
                    expect(results[i-1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
                }
            }
        });
    });

    describe('Type Indexing', () => {
        test('should retrieve entries by type', () => {
            advancedCache.set('query1', 'SELECT *', { type: 'query' });
            advancedCache.set('query2', 'INSERT INTO', { type: 'query' });
            advancedCache.set('api1', { endpoint: '/users' }, { type: 'api' });
            advancedCache.set('api2', { endpoint: '/posts' }, { type: 'api' });
            
            const queries = advancedCache.getByType('query');
            const apis = advancedCache.getByType('api');
            
            expect(queries).toHaveLength(2);
            expect(apis).toHaveLength(2);
            expect(queries[0]).toMatch(/SELECT|INSERT/);
        });

        test('should return empty array for non-existent type', () => {
            const results = advancedCache.getByType('non-existent-type');
            expect(results).toEqual([]);
        });
    });

    describe('Size Indexing', () => {
        test('should retrieve entries by size range', () => {
            advancedCache.set('small', 'a');
            advancedCache.set('medium', 'a'.repeat(100));
            advancedCache.set('large', 'a'.repeat(1000));
            
            const smallEntries = advancedCache.getBySizeRange(0, 50);
            const mediumEntries = advancedCache.getBySizeRange(100, 500);
            const largeEntries = advancedCache.getBySizeRange(1000, 5000);
            
            expect(smallEntries).toContain('a');
            expect(mediumEntries).toContain('a'.repeat(100));
            expect(largeEntries).toContain('a'.repeat(1000));
        });
    });

    describe('Memory Management', () => {
        test('should respect memory limits', () => {
            const cache = advancedCache;
            cache.maxMemoryBytes = 1024; // 1KB limit for testing
            
            const largeValue = 'x'.repeat(512); // ~1KB in UTF-16
            
            expect(cache.set('key1', largeValue)).toBe(true);
            expect(cache.set('key2', largeValue)).toBe(true); // Should evict key1
            
            expect(cache.get('key1')).toBeNull(); // Evicted
            expect(cache.get('key2')).toBe(largeValue);
        });

        test('should reject entries larger than max memory', () => {
            const cache = advancedCache;
            cache.maxMemoryBytes = 100;
            
            const hugeValue = 'x'.repeat(1000);
            
            expect(cache.set('huge', hugeValue)).toBe(false);
            expect(cache.get('huge')).toBeNull();
        });
    });

    describe('Statistics', () => {
        test('should track cache statistics', () => {
            const cache = advancedCache;
            
            // Reset stats
            cache.stats = {
                hits: 0,
                misses: 0,
                evictions: 0,
                memoryEvictions: 0,
                ttlEvictions: 0,
                totalRequests: 0,
                averageAccessTime: 0,
                cacheEfficiency: 0
            };
            
            cache.set('key1', 'value1');
            cache.get('key1'); // Hit
            cache.get('key1'); // Hit
            cache.get('non-existent'); // Miss
            
            expect(cache.stats.hits).toBe(2);
            expect(cache.stats.misses).toBe(1);
            expect(cache.stats.totalRequests).toBe(3);
            
            const stats = cache.getStats();
            expect(stats.hitRate).toBe('66.67%');
        });

        test('should track eviction statistics', () => {
            const cache = advancedCache;
            cache.maxSize = 2;
            
            cache.stats.evictions = 0;
            
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3'); // Should trigger eviction
            
            expect(cache.stats.evictions).toBe(1);
        });
    });

    describe('Export and Import', () => {
        test('should export cache data', () => {
            advancedCache.set('key1', 'value1', { type: 'test' });
            advancedCache.set('key2', 'value2', { type: 'test' });
            
            const exported = advancedCache.export();
            
            expect(exported).toHaveProperty('entries');
            expect(exported).toHaveProperty('stats');
            expect(exported).toHaveProperty('timestamp');
            expect(exported.entries).toHaveLength(2);
            expect(exported.entries[0]).toHaveProperty('key');
            expect(exported.entries[0]).toHaveProperty('value');
        });

        test('should import cache data', () => {
            const importData = {
                entries: [
                    { key: 'imported1', value: 'value1', type: 'imported' },
                    { key: 'imported2', value: 'value2', type: 'imported' }
                ]
            };
            
            advancedCache.clear();
            expect(advancedCache.import(importData)).toBe(true);
            
            expect(advancedCache.get('imported1')).toBe('value1');
            expect(advancedCache.get('imported2')).toBe('value2');
        });

        test('should handle invalid import data', () => {
            expect(advancedCache.import(null)).toBe(false);
            expect(advancedCache.import({})).toBe(false);
            expect(advancedCache.import({ invalid: 'data' })).toBe(false);
        });
    });

    describe('Cleanup', () => {
        test('should clean up expired entries', () => {
            const cache = advancedCache;
            
            // Set entries with short TTL
            cache.set('expire1', 'value1', { ttl: 50 });
            cache.set('expire2', 'value2', { ttl: 50 });
            cache.set('keep', 'value3', { ttl: 10000 });
            
            setTimeout(() => {
                const cleaned = cache.cleanupExpired();
                expect(cleaned).toBe(2);
                expect(cache.get('expire1')).toBeNull();
                expect(cache.get('expire2')).toBeNull();
                expect(cache.get('keep')).toBe('value3');
            }, 100);
        });

        test('should clear all entries', () => {
            advancedCache.set('key1', 'value1');
            advancedCache.set('key2', 'value2');
            advancedCache.set('key3', 'value3');
            
            advancedCache.clear();
            
            expect(advancedCache.get('key1')).toBeNull();
            expect(advancedCache.get('key2')).toBeNull();
            expect(advancedCache.get('key3')).toBeNull();
            expect(advancedCache.cache.size).toBe(0);
        });
    });
});