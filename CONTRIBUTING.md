# Contributing to Dynamic App Builder

Thank you for your interest in contributing to the Dynamic App Builder! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contributing Guidelines](#contributing-guidelines)
- [Code Style](#code-style)
- [Testing](#testing)
- [Security](#security)
- [Submitting Changes](#submitting-changes)

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:

- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Prerequisites

- Node.js 14.0.0 or higher
- npm or yarn
- Git
- An Anthropic API key for testing

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/yourusername/dynamic-app-builder.git
   cd dynamic-app-builder
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Run type checking**
   ```bash
   npm run type-check
   ```

5. **Run tests**
   ```bash
   npm test
   ```

6. **Start development**
   ```bash
   npm run dev
   ```

## Contributing Guidelines

### Types of Contributions

We welcome several types of contributions:

- **Bug fixes** - Fix issues in the codebase
- **Features** - Add new functionality
- **Documentation** - Improve or add documentation
- **Tests** - Add or improve test coverage
- **Performance** - Optimize existing code
- **Security** - Address security vulnerabilities

### Before Contributing

1. **Check existing issues** - Look for existing issues or feature requests
2. **Create an issue** - If none exists, create one describing your contribution
3. **Discuss approach** - Comment on the issue to discuss your approach
4. **Wait for approval** - Wait for maintainer feedback before starting work

### Development Workflow

1. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-number
   ```

2. **Make your changes**
   - Follow our code style guidelines
   - Add tests for new functionality
   - Update documentation as needed

3. **Test your changes**
   ```bash
   npm test
   npm run type-check
   npm run lint
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

5. **Push and create PR**
   ```bash
   git push origin your-branch-name
   # Create PR through GitHub interface
   ```

## Code Style

### JavaScript/TypeScript

- Use ES6+ features
- Use `const` and `let`, avoid `var`
- Use async/await over Promises when possible
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

**Example:**
```javascript
/**
 * Validates user input for code generation
 * @param {string} prompt - The user's prompt
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
async function validatePrompt(prompt, options = {}) {
    if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt must be a non-empty string');
    }
    
    return {
        valid: true,
        sanitized: prompt.trim()
    };
}
```

### File Structure

- Place utility functions in `src/utils/`
- Add tests in `tests/` directory
- Use descriptive file names
- Group related functionality together

### Error Handling

- Always handle errors gracefully
- Use try-catch blocks for async operations
- Log errors with context information
- Provide meaningful error messages to users

```javascript
try {
    const result = await apiCall();
    return result;
} catch (error) {
    logger.error('API call failed', error, {
        operation: 'generateCode',
        correlationId: request.id
    });
    throw new Error('Code generation temporarily unavailable');
}
```

### Security Best Practices

- Never log sensitive information
- Validate all user inputs
- Use parameterized queries for database operations
- Follow the principle of least privilege
- Use secure storage for sensitive data

## Testing

### Test Structure

```
tests/
├── unit/           # Unit tests
├── integration/    # Integration tests
├── fixtures/       # Test data
└── setup.js       # Test configuration
```

### Writing Tests

- Write tests for all new functionality
- Use descriptive test names
- Test both success and failure cases
- Mock external dependencies
- Aim for >80% code coverage

**Example:**
```javascript
describe('CacheManager', () => {
    beforeEach(() => {
        cacheManager.clear();
    });

    test('should store and retrieve cached results', () => {
        const key = 'test-prompt';
        const value = { code: 'console.log("test")' };
        
        cacheManager.set(key, value);
        const result = cacheManager.get(key);
        
        expect(result).toEqual(value);
    });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- tests/utils/cacheManager.test.js
```

## Security

### Reporting Security Issues

**DO NOT** create public issues for security vulnerabilities. Instead:

1. Email security details to: security@yourcompany.com
2. Include a detailed description of the vulnerability
3. Provide steps to reproduce if possible
4. Suggest a fix if you have one

### Security Guidelines

- Never commit API keys or secrets
- Use environment variables for configuration
- Validate and sanitize all inputs
- Use secure storage for sensitive data
- Keep dependencies up to date

## Submitting Changes

### Pull Request Process

1. **Update documentation** - Update README, API docs, etc.
2. **Add/update tests** - Ensure good test coverage
3. **Run the test suite** - All tests must pass
4. **Check types** - Run TypeScript type checking
5. **Update changelog** - Add entry to CHANGELOG.md
6. **Create PR** - Use the PR template

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tests pass locally
- [ ] Added new tests
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No sensitive information committed
```

### Review Process

1. **Automated checks** - CI/CD pipeline runs
2. **Maintainer review** - Code review by maintainers
3. **Address feedback** - Make requested changes
4. **Final approval** - Maintainer approves and merges

## Development Tips

### Debugging

- Use `console.log` sparingly, prefer the logger
- Use debugger statements for complex issues
- Check the application logs in `logs/` directory
- Use Chrome DevTools for renderer debugging

### Performance

- Profile code changes for performance impact
- Use the built-in performance monitoring
- Avoid blocking the main thread
- Use worker threads for heavy operations

### Architecture

- Follow the existing patterns
- Keep functions small and focused
- Use dependency injection where appropriate
- Maintain separation of concerns

## Getting Help

- **Issues** - Create GitHub issues for bugs/features
- **Discussions** - Use GitHub Discussions for questions
- **Email** - Contact maintainers directly if needed
- **Documentation** - Check existing docs first

## Recognition

Contributors will be recognized in:

- README.md contributors section
- Release notes for significant contributions
- GitHub contributor graphs
- Special recognition for security discoveries

## License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers the project.

---

Thank you for contributing to Dynamic App Builder! 🚀