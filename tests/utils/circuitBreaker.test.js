// Mock logger before requiring circuitBreaker
jest.mock('../../src/utils/logger', () => global.testUtils.createMockLogger());

const circuitBreakerManager = require('../../src/utils/circuitBreaker');

describe('CircuitBreakerManager', () => {
  beforeEach(() => {
    // Reset all circuit breakers
    circuitBreakerManager.resetAll();
  });

  describe('basic functionality', () => {
    test('should execute function successfully when circuit is closed', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      const result = await circuitBreakerManager.execute('test-service', mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should track failures and open circuit when threshold is reached', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Service unavailable'));
      
      // Execute multiple failing requests
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreakerManager.execute('test-service', mockFn);
        } catch (error) {
          // Expected to fail
        }
      }
      
      const stats = circuitBreakerManager.getAllStats()['test-service'];
      expect(stats.state).toBe('OPEN');
    });

    test('should use fallback when circuit is open', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Service unavailable'));
      const fallbackFn = jest.fn().mockResolvedValue('fallback-result');
      
      const breaker = circuitBreakerManager.getBreaker('test-service', {
        failureThreshold: 2
      });
      
      // Cause circuit to open
      try {
        await breaker.execute(mockFn);
      } catch (e) {}
      try {
        await breaker.execute(mockFn);
      } catch (e) {}
      
      // Now circuit should be open, use fallback
      const result = await breaker.execute(mockFn, fallbackFn);
      
      expect(result).toBe('fallback-result');
      expect(fallbackFn).toHaveBeenCalled();
    });

    test('should timeout long-running operations', async () => {
      const slowFn = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 1000))
      );
      
      const breaker = circuitBreakerManager.getBreaker('test-service', {
        timeout: 100 // 100ms timeout
      });
      
      await expect(breaker.execute(slowFn)).rejects.toThrow('Operation timeout');
    });
  });

  describe('circuit states', () => {
    test('should transition from OPEN to HALF_OPEN after reset timeout', async () => {
      const mockFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      
      const breaker = circuitBreakerManager.getBreaker('test-service', {
        failureThreshold: 2,
        resetTimeout: 50 // 50ms reset timeout
      });
      
      // Cause circuit to open
      try { await breaker.execute(mockFn); } catch (e) {}
      try { await breaker.execute(mockFn); } catch (e) {}
      
      expect(breaker.getState()).toBe('OPEN');
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 60));
      
      // Next call should attempt recovery
      const result = await breaker.execute(mockFn);
      expect(result).toBe('success');
      expect(breaker.getState()).toBe('CLOSED');
    });

    test('should close circuit after successful attempts in HALF_OPEN state', async () => {
      const mockFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      
      const breaker = circuitBreakerManager.getBreaker('test-service', {
        failureThreshold: 2,
        successThreshold: 1,
        resetTimeout: 10
      });
      
      // Open circuit
      try { await breaker.execute(mockFn); } catch (e) {}
      try { await breaker.execute(mockFn); } catch (e) {}
      
      // Wait and execute successful call
      await new Promise(resolve => setTimeout(resolve, 20));
      await breaker.execute(mockFn);
      
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('statistics and monitoring', () => {
    test('should track request statistics', async () => {
      const successFn = jest.fn().mockResolvedValue('success');
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      
      const breaker = circuitBreakerManager.getBreaker('test-service');
      
      // Execute some successful and failed requests
      await breaker.execute(successFn);
      await breaker.execute(successFn);
      try {
        await breaker.execute(failFn);
      } catch (e) {}
      
      const stats = breaker.getStats();
      
      expect(stats.totalRequests).toBe(3);
      expect(stats.successfulRequests).toBe(2);
      expect(stats.failedRequests).toBe(1);
      expect(parseFloat(stats.successRate)).toBeCloseTo(66.67, 1);
    });

    test('should provide overall health status', () => {
      const breaker1 = circuitBreakerManager.getBreaker('service1');
      const breaker2 = circuitBreakerManager.getBreaker('service2');
      
      expect(circuitBreakerManager.isHealthy()).toBe(true);
      
      // Force one circuit to open
      breaker1.open();
      
      expect(circuitBreakerManager.isHealthy()).toBe(false);
    });
  });

  describe('configuration', () => {
    test('should create circuit breaker with custom options', () => {
      const options = {
        failureThreshold: 10,
        successThreshold: 3,
        timeout: 5000,
        resetTimeout: 60000
      };
      
      const breaker = circuitBreakerManager.getBreaker('custom-service', options);
      
      expect(breaker.options.failureThreshold).toBe(10);
      expect(breaker.options.successThreshold).toBe(3);
      expect(breaker.options.timeout).toBe(5000);
      expect(breaker.options.resetTimeout).toBe(60000);
    });

    test('should reuse existing circuit breaker for same service name', () => {
      const breaker1 = circuitBreakerManager.getBreaker('reuse-test');
      const breaker2 = circuitBreakerManager.getBreaker('reuse-test');
      
      expect(breaker1).toBe(breaker2);
    });
  });

  describe('manager operations', () => {
    test('should reset specific circuit breaker', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      const breaker = circuitBreakerManager.getBreaker('reset-test', {
        failureThreshold: 1
      });
      
      // Open circuit
      try {
        await breaker.execute(failFn);
      } catch (e) {}
      
      expect(breaker.getState()).toBe('OPEN');
      
      // Reset circuit
      circuitBreakerManager.reset('reset-test');
      
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.failures).toBe(0);
    });

    test('should reset all circuit breakers', async () => {
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      
      const breaker1 = circuitBreakerManager.getBreaker('service1', { failureThreshold: 1 });
      const breaker2 = circuitBreakerManager.getBreaker('service2', { failureThreshold: 1 });
      
      // Open both circuits
      try { await breaker1.execute(failFn); } catch (e) {}
      try { await breaker2.execute(failFn); } catch (e) {}
      
      expect(breaker1.getState()).toBe('OPEN');
      expect(breaker2.getState()).toBe('OPEN');
      
      // Reset all
      circuitBreakerManager.resetAll();
      
      expect(breaker1.getState()).toBe('CLOSED');
      expect(breaker2.getState()).toBe('CLOSED');
    });

    test('should get statistics for all circuit breakers', async () => {
      const successFn = jest.fn().mockResolvedValue('success');
      
      await circuitBreakerManager.execute('service1', successFn);
      await circuitBreakerManager.execute('service2', successFn);
      
      const allStats = circuitBreakerManager.getAllStats();
      
      expect(allStats).toHaveProperty('service1');
      expect(allStats).toHaveProperty('service2');
      expect(allStats.service1.totalRequests).toBe(1);
      expect(allStats.service2.totalRequests).toBe(1);
    });
  });
});