# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Security Features

This application implements multiple layers of security:

### Code Execution Security
- **Sandboxed Execution**: All generated code runs in isolated environments
- **Resource Limits**: CPU, memory, and timeout constraints prevent resource exhaustion
- **No eval()**: Uses Function constructor with sanitized scope
- **CSP Enforcement**: Content Security Policy in all execution contexts

### Input Validation & IPC Security
- **Schema-based Validation**: All IPC handlers validate inputs against defined schemas
- **CSRF Protection**: Cross-Site Request Forgery tokens protect sensitive operations
- **Rate Limiting**: Multiple rate limiters prevent abuse:
  - Code generation: 20 requests/minute
  - Database writes: 100 requests/minute
  - Password attempts: 5 attempts/5 minutes
- **SQL Injection Prevention**: Safe query builders for all database operations
- API prompts are length-limited and validated
- Package names are filtered against a blocklist
- Path traversal attempts are detected and blocked

### API Security
- API keys stored using Electron's safeStorage API (encrypted)
- Rate limiting on API calls
- Automatic retry with exponential backoff

### Password Protection (Optional)
- **App Lock**: Optional password protection for the entire application
- **PBKDF2 Hashing**: 100,000 iterations with SHA-512
- **Session Timeout**: Configurable auto-lock after inactivity (1 min to 1 hour)
- **Timing-safe Comparison**: Prevents timing attacks on password verification
- **Brute Force Protection**: Rate limiting on password attempts

### Database Security
- **Encrypted Backups**: AES-256-GCM encryption for database backups
- **Password-protected Backups**: Optional password encryption layer
- **Checksum Verification**: SHA-256 checksums for backup integrity
- **SQLCipher Support**: Database encryption at rest (configurable)

## Reporting a Vulnerability

If you discover a security vulnerability, please follow these steps:

1. **DO NOT** create a public GitHub issue
2. Email security details to: [security@yourcompany.com]
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide updates every 72 hours.

## Security Best Practices

### For Users

1. **API Key Management**
   - Never share your API key
   - Store API keys in secure files with restricted permissions
   - Rotate API keys regularly
   - Use environment variables for API keys in production

2. **Code Review**
   - Always review generated code before execution
   - Be cautious with code that requests network access
   - Avoid executing code that accesses sensitive files

3. **Updates**
   - Keep the application updated to the latest version
   - Run `npm audit` regularly to check for vulnerabilities
   - Update dependencies promptly

### For Developers

1. **Secure Coding**
   ```javascript
   // NEVER do this
   eval(userInput);
   
   // Use this instead
   const func = new Function('sanitizedScope', code);
   func.call(null, limitedScope);
   ```

2. **Input Validation**
   ```javascript
   // Always validate IPC inputs
   ipcMain.handle('api-call', async (event, input) => {
       if (!validateInput(input)) {
           throw new Error('Invalid input');
       }
       // Process validated input
   });
   ```

3. **Sensitive Data**
   - Never log sensitive information
   - Use electron's safeStorage for encryption
   - Clear sensitive data from memory after use

## Security Checklist

Security implementation status:

- [x] Enable renderer process sandbox
- [x] Implement API key encryption (safeStorage)
- [x] Add rate limiting to all endpoints
- [x] Enable CSP headers
- [x] Schema-based input validation on IPC handlers
- [x] CSRF token protection for sensitive operations
- [x] SQL injection prevention via query builders
- [x] Password protection with PBKDF2 hashing
- [x] Session timeout/auto-lock
- [x] Encrypted database backups
- [ ] Run security audit: `npm audit` (recommended regularly)
- [ ] Test with limited user permissions
- [ ] Review all external package dependencies
- [ ] Add monitoring and alerting for security events

## Known Security Considerations

1. **Electron Security**
   - Renderer sandbox should be enabled in production
   - Context isolation must remain enabled
   - Node integration should stay disabled

2. **Code Generation**
   - AI-generated code may contain vulnerabilities
   - Always validate and test generated code
   - Use the built-in security scanner before execution

3. **Network Security**
   - API calls are made over HTTPS
   - No sensitive data in URL parameters
   - Request/response logging excludes sensitive fields

## Security Headers

The application enforces these security headers:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
```

## Dependency Security

Regular dependency audits are performed:

```bash
# Check for vulnerabilities
npm audit

# Auto-fix when possible
npm audit fix

# Update dependencies
npm update
```

## Contact

For security concerns, contact: [security@yourcompany.com]

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who help improve our application's security.