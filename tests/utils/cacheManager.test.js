const path = require('path');

// Mock logger before requiring cacheManager
jest.mock('../../src/utils/logger', () => global.testUtils.createMockLogger());

const cacheManager = require('../../src/utils/cacheManager');

describe('CacheManager', () => {
  beforeEach(() => {
    cacheManager.clear();
    cacheManager.updateConfig({
      enabled: true,
      ttl: 3600000,
      maxSimilarity: 0.85,
      maxPromptLength: 1000
    });
  });

  describe('generateCacheKey', () => {
    test('should generate consistent keys for same input', () => {
      const prompt1 = 'Create a todo app';
      const prompt2 = 'Create a todo app';
      
      const key1 = cacheManager.generateCacheKey(prompt1);
      const key2 = cacheManager.generateCacheKey(prompt2);
      
      expect(key1).toBe(key2);
    });

    test('should generate different keys for different inputs', () => {
      const prompt1 = 'Create a todo app';
      const prompt2 = 'Create a calculator';
      
      const key1 = cacheManager.generateCacheKey(prompt1);
      const key2 = cacheManager.generateCacheKey(prompt2);
      
      expect(key1).not.toBe(key2);
    });

    test('should normalize whitespace and case', () => {
      const prompt1 = 'Create a TODO App';
      const prompt2 = '  create   a   todo   app  ';
      
      const key1 = cacheManager.generateCacheKey(prompt1);
      const key2 = cacheManager.generateCacheKey(prompt2);
      
      expect(key1).toBe(key2);
    });
  });

  describe('calculateSimilarity', () => {
    test('should return 1.0 for identical prompts', () => {
      const prompt1 = 'Create a todo app';
      const prompt2 = 'Create a todo app';
      
      const similarity = cacheManager.calculateSimilarity(prompt1, prompt2);
      expect(similarity).toBe(1.0);
    });

    test('should return 0.0 for empty prompts', () => {
      const similarity = cacheManager.calculateSimilarity('', 'Create a todo app');
      expect(similarity).toBe(0.0);
    });

    test('should calculate partial similarity', () => {
      const prompt1 = 'Create a todo app with database';
      const prompt2 = 'Create a todo list';
      
      const similarity = cacheManager.calculateSimilarity(prompt1, prompt2);
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });
  });

  describe('caching operations', () => {
    test('should store and retrieve cached results', () => {
      const prompt = 'Create a simple calculator';
      const result = {
        success: true,
        data: {
          code: 'console.log("calculator")',
          packages: [],
          description: 'A calculator'
        }
      };

      cacheManager.set(prompt, result);
      const retrieved = cacheManager.get(prompt);

      expect(retrieved).toEqual(result);
    });

    test('should return null for cache miss', () => {
      const result = cacheManager.get('nonexistent prompt');
      expect(result).toBeNull();
    });

    test('should not cache failed results', () => {
      const prompt = 'Create a calculator';
      const failedResult = {
        success: false,
        error: 'Generation failed'
      };

      cacheManager.set(prompt, failedResult);
      const retrieved = cacheManager.get(prompt);

      expect(retrieved).toBeNull();
    });

    test('should respect maxPromptLength setting', () => {
      cacheManager.updateConfig({ maxPromptLength: 10 });
      
      const longPrompt = 'This is a very long prompt that exceeds the limit';
      const result = { success: true, data: { code: 'test' } };

      cacheManager.set(longPrompt, result);
      const retrieved = cacheManager.get(longPrompt);

      expect(retrieved).toBeNull();
    });

    test('should find similar cached prompts', () => {
      const originalPrompt = 'Create a todo list application with React';
      const similarPrompt = 'Build a todo app using React';
      const result = {
        success: true,
        data: { code: 'test code', packages: [], description: 'test' }
      };

      cacheManager.set(originalPrompt, result);
      const retrieved = cacheManager.get(similarPrompt);

      expect(retrieved).toEqual(result);
    });
  });

  describe('cache management', () => {
    test('should evict least used items when cache is full', () => {
      // Set small cache size for testing
      cacheManager.maxCacheSize = 2;
      
      const results = {
        success: true,
        data: { code: 'test', packages: [], description: 'test' }
      };

      // Fill cache
      cacheManager.set('prompt1', results);
      cacheManager.set('prompt2', results);
      
      // Access first item to make it more recently used
      cacheManager.get('prompt1');
      
      // Add third item, should evict prompt2
      cacheManager.set('prompt3', results);
      
      expect(cacheManager.get('prompt1')).toEqual(results);
      expect(cacheManager.get('prompt2')).toBeNull();
      expect(cacheManager.get('prompt3')).toEqual(results);
    });

    test('should clear entire cache', () => {
      const result = {
        success: true,
        data: { code: 'test', packages: [], description: 'test' }
      };

      cacheManager.set('prompt1', result);
      cacheManager.set('prompt2', result);
      
      expect(cacheManager.getStats().size).toBe(2);
      
      cacheManager.clear();
      
      expect(cacheManager.getStats().size).toBe(0);
      expect(cacheManager.get('prompt1')).toBeNull();
      expect(cacheManager.get('prompt2')).toBeNull();
    });
  });

  describe('statistics', () => {
    test('should track cache statistics', () => {
      const result = {
        success: true,
        data: { code: 'test', packages: [], description: 'test' }
      };

      // Generate some hits and misses
      cacheManager.set('prompt1', result);
      cacheManager.get('prompt1'); // hit
      cacheManager.get('prompt2'); // miss
      cacheManager.get('prompt1'); // hit

      const stats = cacheManager.getStats();
      
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.totalRequests).toBe(3);
      expect(stats.hitRate).toBe('66.67%');
    });
  });

  describe('configuration', () => {
    test('should update configuration', () => {
      const newConfig = {
        enabled: false,
        ttl: 1800000,
        maxSimilarity: 0.9
      };

      cacheManager.updateConfig(newConfig);
      const stats = cacheManager.getStats();

      expect(stats.config.enabled).toBe(false);
      expect(stats.config.ttl).toBe(1800000);
      expect(stats.config.maxSimilarity).toBe(0.9);
    });

    test('should clear cache when disabled', () => {
      const result = {
        success: true,
        data: { code: 'test', packages: [], description: 'test' }
      };

      cacheManager.set('prompt1', result);
      expect(cacheManager.getStats().size).toBe(1);

      cacheManager.updateConfig({ enabled: false });
      expect(cacheManager.getStats().size).toBe(0);
    });
  });

  describe('import/export', () => {
    test('should export cache data', () => {
      const result = {
        success: true,
        data: { code: 'test', packages: [], description: 'test' }
      };

      cacheManager.set('prompt1', result);
      const exportData = cacheManager.export();

      expect(exportData).toHaveProperty('items');
      expect(exportData).toHaveProperty('stats');
      expect(exportData).toHaveProperty('config');
      expect(exportData).toHaveProperty('exportedAt');
      expect(exportData.items).toHaveLength(1);
    });

    test('should import cache data', () => {
      const exportData = {
        items: [{
          key: 'test-key',
          prompt: 'test prompt',
          result: { success: true, data: { code: 'test' } },
          createdAt: Date.now() - 1000,
          lastAccessed: Date.now() - 500,
          hitCount: 5
        }],
        stats: { hits: 10, misses: 2, totalRequests: 12 }
      };

      const success = cacheManager.import(exportData);
      expect(success).toBe(true);
      
      const retrieved = cacheManager.get('test prompt');
      expect(retrieved).toEqual({ success: true, data: { code: 'test' } });
    });
  });
});