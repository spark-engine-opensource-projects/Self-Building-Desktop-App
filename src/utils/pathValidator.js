const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');

/**
 * Path Validator to prevent directory traversal attacks
 * Ensures all file operations stay within allowed boundaries
 */
class PathValidator {
    constructor() {
        // Define safe base directories
        this.safePaths = new Map();
        this.initializeSafePaths();
    }

    /**
     * Initialize allowed base directories
     */
    initializeSafePaths() {
        const { app } = require('electron');
        
        // Set up safe paths based on app directories
        if (app) {
            this.safePaths.set('userData', app.getPath('userData'));
            this.safePaths.set('temp', app.getPath('temp'));
            this.safePaths.set('logs', app.getPath('logs'));
            this.safePaths.set('documents', app.getPath('documents'));
        }
        
        // Fallback paths for testing
        this.safePaths.set('project', path.resolve(process.cwd()));
        this.safePaths.set('data', path.join(process.cwd(), 'data'));
        this.safePaths.set('sessions', path.join(process.cwd(), 'sessions'));
        this.safePaths.set('cache', path.join(process.cwd(), 'cache'));
    }

    /**
     * Validate and resolve a file path
     * @param {string} filePath - The path to validate
     * @param {string} baseType - The base directory type
     * @returns {string} - The validated absolute path
     */
    validatePath(filePath, baseType = 'project') {
        if (!filePath || typeof filePath !== 'string') {
            throw new Error('Invalid path provided');
        }

        // Check for null bytes FIRST (before any resolution)
        if (filePath.indexOf('\0') !== -1) {
            logger.logSecurityEvent('path_traversal_null_byte', {
                path: filePath,
                baseType
            });
            throw new Error('Path contains null bytes');
        }

        // Reject absolute paths immediately (they bypass the base directory)
        // Also check for Windows-style absolute paths (C:\, D:\, etc.)
        if (path.isAbsolute(filePath) || /^[a-zA-Z]:[\\\/]/.test(filePath)) {
            logger.logSecurityEvent('path_traversal_absolute', {
                path: filePath,
                baseType
            });
            throw new Error('Path traversal detected: absolute paths not allowed');
        }

        // Check for suspicious patterns on ORIGINAL path (before resolution)
        if (this.containsSuspiciousPatterns(filePath)) {
            logger.logSecurityEvent('suspicious_path_pattern', {
                path: filePath,
                baseType
            });
            throw new Error('Suspicious path traversal pattern detected');
        }

        // Check for Windows reserved names in basename
        const basename = path.basename(filePath).toLowerCase().split('.')[0];
        if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(basename)) {
            logger.logSecurityEvent('suspicious_path_pattern', {
                path: filePath,
                reason: 'Windows reserved name',
                baseType
            });
            throw new Error('Suspicious path pattern detected');
        }

        // Get the base directory
        const baseDir = this.safePaths.get(baseType);
        if (!baseDir) {
            throw new Error(`Unknown base directory type: ${baseType}`);
        }

        // Resolve the full path
        const resolvedPath = path.resolve(baseDir, filePath);
        const normalizedPath = path.normalize(resolvedPath);

        // Check for path traversal attempts
        if (!this.isPathSafe(normalizedPath, baseDir)) {
            logger.logSecurityEvent('path_traversal_attempt', {
                path: filePath,
                resolvedPath: normalizedPath,
                baseDir,
                baseType
            });
            throw new Error('Path traversal detected');
        }

        return normalizedPath;
    }

    /**
     * Check if a path is within the allowed base directory
     */
    isPathSafe(resolvedPath, baseDir) {
        // Normalize both paths for comparison
        const normalizedResolved = path.normalize(resolvedPath);
        const normalizedBase = path.normalize(baseDir);

        // Check if the resolved path starts with the base directory
        const relative = path.relative(normalizedBase, normalizedResolved);
        
        // If the relative path starts with '..', it's outside the base directory
        return !relative.startsWith('..') && !path.isAbsolute(relative);
    }

    /**
     * Check for suspicious patterns in the path
     */
    containsSuspiciousPatterns(pathStr) {
        const suspiciousPatterns = [
            /\.\.[\\/]/,           // Parent directory traversal
            /\.\.$/,               // Ends with parent directory
            /^~/,                  // Home directory expansion
            /\$\{.*\}/,            // Variable expansion ${VAR}
            /\$\(.*\)/,            // Command substitution $(cmd)
            /`[^`]*`/,             // Backtick command substitution
            /\$[A-Za-z_]/,         // Variable like $HOME
            /%.*%/,                // Windows variable expansion
            /[\x00-\x1f\x7f]/,     // Control characters
            /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, // Windows reserved names
            /[;&|]/,               // Shell command separators
            /^\/\//,               // UNC paths //server/share
            /^\\\\|^\\\//,         // Windows UNC \\server
            /[\u2024\u2025\u2026]/, // Unicode dots (one-dot, two-dot, ellipsis)
            /[\u202e\u202d\u200f\u200e]/, // Unicode direction overrides
            /[\uff0f\uff3c]/,      // Fullwidth solidus and backslash
        ];

        return suspiciousPatterns.some(pattern => pattern.test(pathStr));
    }

    /**
     * Create a safe directory path
     */
    async createSafeDirectory(dirPath, baseType = 'project', options = {}) {
        const safePath = this.validatePath(dirPath, baseType);
        
        try {
            await fs.mkdir(safePath, { 
                recursive: true,
                mode: options.mode || 0o755 
            });
            
            logger.debug('Safe directory created', {
                path: safePath,
                baseType
            });
            
            return safePath;
        } catch (error) {
            logger.error('Failed to create safe directory', error, {
                path: dirPath,
                safePath,
                baseType
            });
            throw error;
        }
    }

    /**
     * Safe file read operation
     */
    async safeReadFile(filePath, baseType = 'project', options = {}) {
        const safePath = this.validatePath(filePath, baseType);
        
        try {
            // Check if file exists
            const stats = await fs.stat(safePath);
            
            // Verify it's a file, not a directory
            if (!stats.isFile()) {
                throw new Error('Path is not a file');
            }
            
            // Check file size to prevent reading huge files
            const maxSize = options.maxSize || 10 * 1024 * 1024; // 10MB default
            if (stats.size > maxSize) {
                throw new Error(`File size exceeds maximum allowed (${maxSize} bytes)`);
            }
            
            return await fs.readFile(safePath, options.encoding || 'utf8');
        } catch (error) {
            logger.error('Failed to read file safely', error, {
                path: filePath,
                safePath,
                baseType
            });
            throw error;
        }
    }

    /**
     * Safe file write operation
     */
    async safeWriteFile(filePath, data, baseType = 'project', options = {}) {
        const safePath = this.validatePath(filePath, baseType);
        
        try {
            // Ensure parent directory exists
            const parentDir = path.dirname(safePath);
            await fs.mkdir(parentDir, { recursive: true });
            
            // Write with safe permissions
            await fs.writeFile(safePath, data, {
                encoding: options.encoding || 'utf8',
                mode: options.mode || 0o644,
                flag: options.flag || 'w'
            });
            
            logger.debug('File written safely', {
                path: safePath,
                baseType,
                size: data.length
            });
            
            return safePath;
        } catch (error) {
            logger.error('Failed to write file safely', error, {
                path: filePath,
                safePath,
                baseType
            });
            throw error;
        }
    }

    /**
     * Safe file deletion
     */
    async safeDeleteFile(filePath, baseType = 'project') {
        const safePath = this.validatePath(filePath, baseType);
        
        try {
            // Check if file exists
            const stats = await fs.stat(safePath);
            
            if (stats.isDirectory()) {
                throw new Error('Cannot delete directory using deleteFile');
            }
            
            await fs.unlink(safePath);
            
            logger.debug('File deleted safely', {
                path: safePath,
                baseType
            });
            
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return false; // File doesn't exist
            }
            
            logger.error('Failed to delete file safely', error, {
                path: filePath,
                safePath,
                baseType
            });
            throw error;
        }
    }

    /**
     * Safe directory deletion
     */
    async safeDeleteDirectory(dirPath, baseType = 'project') {
        // Check for empty path (which would be the base directory)
        if (!dirPath || dirPath === '' || dirPath === '.' || dirPath === './') {
            throw new Error('Cannot delete base directory');
        }

        const safePath = this.validatePath(dirPath, baseType);

        // Prevent deletion of base directories
        for (const [, basePath] of this.safePaths) {
            if (safePath === basePath) {
                throw new Error('Cannot delete base directory');
            }
        }
        
        try {
            await fs.rm(safePath, { recursive: true, force: true });
            
            logger.debug('Directory deleted safely', {
                path: safePath,
                baseType
            });
            
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return false; // Directory doesn't exist
            }
            
            logger.error('Failed to delete directory safely', error, {
                path: dirPath,
                safePath,
                baseType
            });
            throw error;
        }
    }

    /**
     * List directory contents safely
     */
    async safeListDirectory(dirPath, baseType = 'project') {
        const safePath = this.validatePath(dirPath, baseType);
        
        try {
            const entries = await fs.readdir(safePath, { withFileTypes: true });
            
            return entries.map(entry => ({
                name: entry.name,
                isDirectory: entry.isDirectory(),
                isFile: entry.isFile(),
                path: path.join(safePath, entry.name)
            }));
        } catch (error) {
            logger.error('Failed to list directory safely', error, {
                path: dirPath,
                safePath,
                baseType
            });
            throw error;
        }
    }

    /**
     * Check if a path exists safely
     */
    async safePathExists(filePath, baseType = 'project') {
        try {
            const safePath = this.validatePath(filePath, baseType);
            await fs.access(safePath);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get file stats safely
     */
    async safeGetStats(filePath, baseType = 'project') {
        const safePath = this.validatePath(filePath, baseType);
        
        try {
            const stats = await fs.stat(safePath);
            return {
                size: stats.size,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                created: stats.birthtime,
                modified: stats.mtime,
                accessed: stats.atime
            };
        } catch (error) {
            logger.error('Failed to get file stats safely', error, {
                path: filePath,
                safePath,
                baseType
            });
            throw error;
        }
    }

    /**
     * Add a new safe base directory
     */
    addSafePath(name, basePath) {
        const normalizedPath = path.normalize(path.resolve(basePath));
        this.safePaths.set(name, normalizedPath);
        
        logger.info('Added safe path', {
            name,
            path: normalizedPath
        });
    }

    /**
     * Get all configured safe paths
     */
    getSafePaths() {
        return Object.fromEntries(this.safePaths);
    }
}

// Export singleton instance
module.exports = new PathValidator();