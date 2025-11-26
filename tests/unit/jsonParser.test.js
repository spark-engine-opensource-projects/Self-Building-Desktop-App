const jsonParser = require('../../src/utils/jsonParser');

describe('JSON Parser', () => {
    describe('parseAIResponse', () => {
        test('should parse valid JSON response', async () => {
            const validJson = JSON.stringify({
                packages: ['lodash'],
                code: 'console.log("hello");',
                description: 'A simple hello world'
            });

            const result = await jsonParser.parseAIResponse(validJson);
            expect(result.success).toBe(true);
            expect(result.data.packages).toEqual(['lodash']);
            expect(result.data.code).toBe('console.log("hello");');
        });

        test('should handle JSON with markdown code blocks', async () => {
            const markdownWrapped = '```json\n{"packages":[],"code":"test","description":"test"}\n```';
            const result = await jsonParser.parseAIResponse(markdownWrapped);
            expect(result.success).toBe(true);
        });

        test('should handle JSON with surrounding text', async () => {
            const withText = 'Here is the code:\n{"packages":[],"code":"test","description":"test"}\nEnd of response';
            const result = await jsonParser.parseAIResponse(withText);
            expect(result.success).toBe(true);
        });

        test('should return error for invalid JSON', async () => {
            const invalidJson = '{invalid json content';
            const result = await jsonParser.parseAIResponse(invalidJson);
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        test('should return error for empty input', async () => {
            const result = await jsonParser.parseAIResponse('');
            expect(result.success).toBe(false);
        });

        test('should handle escaped newlines in strings', async () => {
            const withNewlines = '{"packages":[],"code":"line1\\nline2","description":"test"}';
            const result = await jsonParser.parseAIResponse(withNewlines);
            expect(result.success).toBe(true);
            expect(result.data.code).toContain('line1');
        });
    });

    describe('extractJSON', () => {
        test('should extract JSON object from text', () => {
            const text = 'Some prefix {"packages":[],"code":"test","description":"test"} some suffix';
            const extracted = jsonParser.extractJSON(text);
            expect(extracted).not.toBeNull();
            expect(JSON.parse(extracted)).toHaveProperty('code');
        });

        test('should handle nested objects', () => {
            const text = '{"packages":[],"code":"test","description":"test","nested":{"inner":"value"}}';
            const extracted = jsonParser.extractJSON(text);
            expect(JSON.parse(extracted)).toHaveProperty('nested');
        });

        test('should return null for text without JSON', () => {
            const text = 'No JSON here at all';
            const extracted = jsonParser.extractJSON(text);
            expect(extracted).toBeNull();
        });
    });

    describe('validateSchema', () => {
        test('should validate required fields', () => {
            const valid = { packages: [], code: 'test', description: 'test' };
            const result = jsonParser.validateSchema(valid);
            expect(result.valid).toBe(true);
        });

        test('should reject missing code field', () => {
            const invalid = { packages: [], description: 'test' };
            const result = jsonParser.validateSchema(invalid);
            expect(result.valid).toBe(false);
        });

        test('should reject non-array packages', () => {
            const invalid = { packages: 'not-array', code: 'test', description: 'test' };
            const result = jsonParser.validateSchema(invalid);
            expect(result.valid).toBe(false);
        });
    });
});
