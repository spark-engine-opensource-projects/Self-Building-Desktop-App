const errorHandler = require('../../src/utils/errorHandler');

describe('Error Handler', () => {
    beforeEach(() => {
        errorHandler.clearHistory();
    });

    describe('identifyErrorType', () => {
        test('should identify NetworkError', () => {
            const error = new Error('ECONNREFUSED connection refused');
            expect(errorHandler.identifyErrorType(error)).toBe('NetworkError');
        });

        test('should identify DatabaseError', () => {
            const error = new Error('SQLITE_ERROR: table not found');
            expect(errorHandler.identifyErrorType(error)).toBe('DatabaseError');
        });

        test('should identify ValidationError', () => {
            const error = new Error('Validation failed: required field missing');
            expect(errorHandler.identifyErrorType(error)).toBe('ValidationError');
        });

        test('should identify TimeoutError', () => {
            const error = new Error('Operation timed out');
            expect(errorHandler.identifyErrorType(error)).toBe('TimeoutError');
        });

        test('should identify FileSystemError', () => {
            const error = new Error('ENOENT: no such file or directory');
            expect(errorHandler.identifyErrorType(error)).toBe('FileSystemError');
        });

        test('should return UnknownError for unrecognized errors', () => {
            const error = new Error('Something unexpected happened');
            expect(errorHandler.identifyErrorType(error)).toBe('UnknownError');
        });
    });

    describe('determineSeverity', () => {
        test('should return medium for APIError type (status codes >= 400)', () => {
            // APIError type is registered with severity 'medium'
            const error = { message: 'Server error', statusCode: 500 };
            expect(errorHandler.determineSeverity(error)).toBe('medium');
        });

        test('should return medium for 400 status codes', () => {
            const error = { message: 'Bad request', statusCode: 400 };
            expect(errorHandler.determineSeverity(error)).toBe('medium');
        });

        test('should respect explicit severity', () => {
            const error = { message: 'Critical', severity: 'critical' };
            expect(errorHandler.determineSeverity(error)).toBe('critical');
        });
    });

    describe('safeExecute', () => {
        test('should return success with data on successful operation', async () => {
            const result = await errorHandler.safeExecute(async () => {
                return { value: 42 };
            });

            expect(result.success).toBe(true);
            expect(result.data).toEqual({ value: 42 });
        });

        test('should return error on failed operation', async () => {
            const result = await errorHandler.safeExecute(async () => {
                throw new Error('Test error');
            }, { logError: false });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Test error');
        });

        test('should handle async operations', async () => {
            const result = await errorHandler.safeExecute(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'completed';
            });

            expect(result.success).toBe(true);
            expect(result.data).toBe('completed');
        });
    });

    describe('formatResult', () => {
        test('should format success result', () => {
            const result = errorHandler.formatResult(true, { id: 1 });
            expect(result).toEqual({ success: true, data: { id: 1 } });
        });

        test('should format success without data', () => {
            const result = errorHandler.formatResult(true);
            expect(result).toEqual({ success: true });
        });

        test('should format error result with string', () => {
            const result = errorHandler.formatResult(false, null, 'Something went wrong');
            expect(result).toEqual({ success: false, error: 'Something went wrong' });
        });

        test('should format error result with Error object', () => {
            const error = new Error('Test error');
            const result = errorHandler.formatResult(false, null, error);
            expect(result).toEqual({ success: false, error: 'Test error' });
        });
    });

    describe('wrap', () => {
        test('should pass through successful function calls', async () => {
            const fn = async (x) => x * 2;
            const wrapped = errorHandler.wrap(fn, { logError: false });

            const result = await wrapped(5);
            expect(result).toBe(10);
        });

        test('should handle errors in wrapped functions', async () => {
            const fn = async () => {
                throw new Error('Wrapped error');
            };
            const wrapped = errorHandler.wrap(fn, { logError: false });

            await expect(wrapped()).rejects.toThrow('Wrapped error');
        });
    });

    describe('getMetrics', () => {
        test('should return metrics object', () => {
            const metrics = errorHandler.getMetrics();

            expect(metrics).toHaveProperty('total');
            expect(metrics).toHaveProperty('byType');
            expect(metrics).toHaveProperty('bySeverity');
            expect(metrics).toHaveProperty('recovered');
            expect(metrics).toHaveProperty('unrecovered');
        });
    });
});
