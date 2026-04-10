# Contributing to CrossCtx

Thanks for your interest in contributing! Here's how to get started.

## Quick Start

1. Fork the repo
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/crossctx.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feat/your-feature`
5. Make your changes
6. Run tests: `npm test`
7. Submit a PR

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run against examples
node dist/bin/cli.js ./examples
```

Or using npx after build:

```bash
npx crossctx ./examples

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format
```

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `refactor:` code change that neither fixes a bug nor adds a feature
- `test:` adding or updating tests
- `chore:` maintenance

## Pull Requests

- Keep PRs focused and small
- Add tests for new features
- Update docs if needed
- Ensure all checks pass

## Reporting Issues

- Use GitHub Issues
- Include steps to reproduce
- Include your environment (Node version, OS)

## Code Style

- TypeScript strict mode
- ESLint + Prettier (run `npm run lint` and `npm run format`)
- Keep it simple — avoid over-engineering
