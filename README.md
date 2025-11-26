# Dynamic App Builder

An AI-powered Electron desktop application that generates and executes interactive web components using Claude (Anthropic's AI).

## Features

- **AI Code Generation** - Generate complete UI components from natural language prompts
- **Secure Execution** - Sandboxed code execution with resource limits
- **Smart Caching** - Similarity-based caching for faster responses
- **Dynamic Database** - AI-powered SQLite database creation and management
- **Data Visualization** - Built-in charts, graphs, and data analysis tools
- **TypeScript Support** - Full TypeScript definitions and compilation
- **Production Ready** - Comprehensive logging, monitoring, and error recovery

## Quick Start

```bash
# Install dependencies
npm install

# Start the application
npm start

# Run in development mode
npm run dev
```

## Prerequisites

- Node.js 14.0.0 or higher
- npm 6.0.0 or higher
- Anthropic API key ([Get one here](https://console.anthropic.com/))

## Usage

1. Launch the application with `npm start`
2. Enter your Anthropic API key
3. Describe what you want to build in natural language
4. Review and execute the generated code

### Example Prompts

- "Create a todo list with add/remove functionality"
- "Build a calculator with modern UI"
- "Make an interactive dashboard with charts"

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the application |
| `npm run dev` | Development mode with DevTools |
| `npm run build` | Build for production |
| `npm test` | Run test suite |
| `npm run test:coverage` | Run tests with coverage |
| `npm run type-check` | TypeScript type checking |

## Documentation

Detailed documentation is available in the `/docs` directory:

- [API Documentation](docs/API_DOCUMENTATION.md)
- [Contributing Guide](docs/CONTRIBUTING.md)
- [Error Handling](docs/ERROR_HANDLING.md)
- [Security Guide](docs/SECURITY.md)
- [Security Audit](docs/SECURITY_AUDIT.md)

## Project Structure

```
src/
├── main.js              # Main Electron process
├── preload.js           # Secure IPC bridge
├── config/              # Configuration files
├── handlers/            # IPC handlers
├── modules/             # Feature modules
├── renderer/            # UI components
├── types/               # TypeScript definitions
└── utils/               # Core utilities
```

## Security

This application implements comprehensive security measures:

- Sandboxed code execution
- Input validation and sanitization
- Content Security Policy enforcement
- Secure API key storage
- XSS and SQL injection prevention

See [SECURITY.md](docs/SECURITY.md) for details.

## Contributing

Please read [CONTRIBUTING.md](docs/CONTRIBUTING.md) for contribution guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Powered by [Claude AI](https://www.anthropic.com/)
