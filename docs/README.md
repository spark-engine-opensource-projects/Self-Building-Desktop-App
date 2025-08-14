# Dynamic App Builder

An AI-powered Electron desktop application that generates and executes interactive web components using Claude (Anthropic's AI).

## Features

- 🤖 **AI Code Generation** - Generate complete UI components from natural language prompts
- 🔒 **Secure Execution** - Sandboxed code execution with resource limits
- ⚡ **Smart Caching** - Similarity-based caching for faster responses
- 🛡️ **Enhanced Security** - No eval(), CSP enforcement, input validation
- 📊 **Production Ready** - Comprehensive logging, monitoring, and error recovery
- 🎨 **Real-time UI Generation** - Build dashboards, forms, calculators instantly
- 🌙 **Dark Mode** - Toggle between light and dark themes
- 🔧 **TypeScript Support** - Full TypeScript definitions and compilation
- 🧪 **Testing Framework** - Jest test suite with mocked Electron environment
- 💾 **Encrypted Storage** - Secure API key storage with Electron safeStorage
- ⚡ **Circuit Breaker** - Fault tolerance with automatic failure recovery
- 📈 **Performance Monitoring** - Real-time metrics collection and analysis
- 🔄 **Request Interceptors** - Advanced request/response handling
- 📅 **Auto Scheduler** - Background cleanup and maintenance tasks
- 🗄️ **Dynamic Database** - AI-powered SQLite database creation and management
- 📊 **Data Visualization** - Built-in charts, graphs, and data analysis tools
- 🔍 **Visual Query Builder** - No-SQL-knowledge-required database queries
- 📈 **Database Analytics** - Automatic statistics and insights generation

## Prerequisites

- Node.js 14.0.0 or higher
- npm or yarn
- Anthropic API key (get from [Anthropic Console](https://console.anthropic.com/))

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd Self-Building-Desktop-App

# Install dependencies
npm install

# Start the application
npm start
```

## Development

```bash
# Run in development mode with DevTools
npm run dev

# Build for production
npm run build

# Rebuild native modules
npm run rebuild

# TypeScript compilation
npm run compile

# Watch TypeScript files
npm run watch

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type checking
npm run type-check
```

## Configuration

The application can be configured via `src/config/default.json`:

- **Execution limits** - Memory, timeout, concurrent executions
- **Security settings** - Package blocking, prompt validation
- **AI parameters** - Model, temperature, token limits
- **Caching** - TTL, similarity thresholds

## Usage

1. **Launch the application**
   ```bash
   npm start
   ```

2. **Configure API Key**
   - Enter your Anthropic API key in the UI
   - Or load from a text file

3. **Generate Components**
   - Describe what you want to build in natural language
   - Examples:
     - "Create a todo list with add/remove functionality"
     - "Build a calculator with modern UI"
     - "Make an interactive dashboard with charts"

4. **Execute Code**
   - Review the generated code
   - Click Execute to run in sandboxed environment
   - See results in real-time

5. **Database Management**
   - Click the "🗄️ Database" button to access database features
   - Use AI Schema Generator to create databases from natural language:
     - "Create a blog system with users, posts, and comments"
     - "Build an inventory system for a retail store"
   - Manage data through the visual interface
   - Create charts and visualizations from your data

6. **Advanced Features**
   - Use the Visual Query Builder for complex database queries
   - Export databases as JSON for backup or sharing
   - Generate code that works with your database structure
   - View automatic statistics and insights

## Architecture

```
src/
├── main.js              # Main Electron process
├── preload.js           # Secure IPC bridge
├── renderer/            # UI components
│   ├── index.html
│   ├── renderer.js
│   └── styles.css
├── utils/               # Core utilities
│   ├── logger.js        # Winston logging
│   ├── securitySandbox.js # Code sandboxing
│   ├── cacheManager.js  # Smart caching
│   ├── circuitBreaker.js # Fault tolerance
│   ├── ipcValidator.js  # Input validation
│   ├── secureStorage.js # Encrypted storage
│   ├── performanceMonitor.js # Metrics tracking
│   ├── requestInterceptor.js # Request handling
│   ├── scheduler.js     # Background tasks
│   ├── envConfig.js     # Environment config
│   └── secureDOMExecutor.js # Safe DOM operations
└── config/
    └── default.json     # Default settings
```

## Security Features

- **Sandboxed Execution** - Code runs in isolated environments
- **Resource Limits** - CPU, memory, and timeout constraints
- **Package Filtering** - Blocks dangerous Node.js modules
- **Input Validation** - All user inputs sanitized
- **CSP Enforcement** - Content Security Policy in all contexts
- **No eval()** - Uses Function constructor with sanitized scope

## API Integration

The application uses the Anthropic Claude API for code generation:
- Model: Claude 3.5 Sonnet
- Configurable temperature and token limits
- Automatic retry with exponential backoff
- Smart prompt enhancement for better results

## Monitoring

Built-in monitoring includes:
- System resource tracking (CPU, memory, disk)
- Execution statistics and success rates
- Session history and persistence
- Cache performance metrics
- Security event logging

## Troubleshooting

### Application won't start
- Check Node.js version: `node --version` (must be >= 14.0.0)
- Rebuild native modules: `npm run rebuild`
- Check logs in `logs/` directory

### Code generation fails
- Verify API key is valid
- Check internet connection
- Review error messages for specific issues
- Try simpler prompts

### Execution errors
- Check browser console for DOM errors
- Review security sandbox logs
- Ensure code doesn't use blocked APIs

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Security

For security concerns, please see [SECURITY.md](SECURITY.md).

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Powered by [Claude AI](https://www.anthropic.com/)
- Logging by [Winston](https://github.com/winstonjs/winston)
- System monitoring via [systeminformation](https://github.com/sebhildebrandt/systeminformation)