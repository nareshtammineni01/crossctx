# CrossCtx

Generate a cross-service API dependency map from your OpenAPI/Swagger files — in one command.

## What it does

CrossCtx scans your repositories for OpenAPI specs and produces a clean JSON map of your services, their endpoints, and how they depend on each other. The output is designed to be token-efficient and directly usable in LLM prompts.

## Quick Start

```bash
npx crossctx ./service1 ./service2 ./service3
```

That's it. You get a `crossctx-output.json` with everything mapped.

## Installation

```bash
npm install -g crossctx
```

Or use directly with npx — no install needed.

## Example

Given three services with OpenAPI specs:

```bash
crossctx ./examples
```

Output:

```
╔══════════════════════════════════════════╗
║           CrossCtx Results               ║
╚══════════════════════════════════════════╝

  Services found: 3
    • user-service (3 endpoints) [3.0.3]
    • order-service (3 endpoints) [3.0.3]
    • payment-service (3 endpoints) [3.0.3]

  Total endpoints: 9

  Dependencies: 2
    order-service → user-service (description)
    order-service → payment-service (description)

  Output saved to: crossctx-output.json
```

The JSON output looks like this:

```json
{
  "meta": {
    "generatedAt": "2026-04-10T...",
    "version": "0.1.0",
    "scanPaths": ["./examples"],
    "totalFiles": 3
  },
  "services": [
    {
      "name": "user-service",
      "baseUrls": ["https://user-service.internal:8080"],
      "endpointCount": 3
    }
  ],
  "endpoints": [
    {
      "service": "user-service",
      "method": "GET",
      "path": "/users",
      "summary": "List all users"
    }
  ],
  "dependencies": [
    {
      "from": "order-service",
      "to": "user-service",
      "detectedVia": "description",
      "evidence": "Referenced URL: https://user-service.internal:8080"
    }
  ]
}
```

## CLI Options

```
Usage: crossctx [options] <paths...>

Arguments:
  paths              directories to scan for OpenAPI specs

Options:
  -o, --output       output file path (default: "crossctx-output.json")
  -q, --quiet        suppress terminal output
  -V, --version      output the version number
  -h, --help         display help
```

## Why this exists

Microservice architectures are hard to reason about. Documentation gets stale. New developers join and have no idea what calls what.

CrossCtx gives you a single source of truth — generated directly from your OpenAPI specs. No manual maintenance. No stale diagrams.

The JSON output is specifically designed for AI consumption: feed it to an LLM and it instantly understands your architecture.

## Roadmap

- **v0.2** — Markdown output, simple graph visualization
- **v1.0** — Source code parsing (AST) for Node.js, Python, Java
- **v2.0** — GraphQL, gRPC, message queue detection
- **v3.0** — CI/CD integration, breaking change detection
- **v4.0** — Interactive web UI, plugin system

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT](LICENSE)

## Support

If this tool saves you time, give it a star on GitHub.
