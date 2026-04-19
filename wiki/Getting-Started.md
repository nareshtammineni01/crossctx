# Getting Started

This guide walks through installing CrossCtx, running your first scan, and understanding the output.

---

## Requirements

- **Node.js 18+** (check with `node --version`)
- One or more microservice directories on your local machine

---

## Installation

### Global install (recommended)

```bash
npm install -g crossctx
crossctx --version
```

### Without installing (npx)

```bash
npx crossctx ./service1 ./service2
```

npx downloads and runs CrossCtx on demand — useful for CI pipelines or trying it out before committing to a global install.

---

## Your First Scan

Point CrossCtx at one or more service directories:

```bash
crossctx ./user-service ./order-service ./payment-service
```

You'll see output like:

```
CrossCtx v0.2.0

[1/4] Detecting languages and scanning source code...
→ user-service (typescript/nestjs, confidence: 98%)
→ order-service (java/spring-boot, confidence: 97%)
→ payment-service (csharp/aspnet, confidence: 97%)
Found 3 service(s), 22 endpoint(s)

[2/4] Scanning for OpenAPI/Swagger specs... Found 1 spec(s)
[3/4] Resolving call chains... Found 5 call chain(s)
[4/4] Building output...

JSON output: crossctx-output.json
```

Two files are created in your current working directory:
- `crossctx-output.json` — full structured output
- `crossctx-output.md` — human-readable summary (if `--markdown` was passed)

---

## Generate the Interactive Graph

```bash
crossctx ./user-service ./order-service ./payment-service --graph
```

This adds:
- `crossctx-graph.html` — open in any browser

```bash
open crossctx-graph.html     # macOS
xdg-open crossctx-graph.html # Linux
start crossctx-graph.html    # Windows
```

---

## Generate All Outputs at Once

```bash
crossctx ./user-service ./order-service ./payment-service --markdown --graph
```

---

## Try It with the Example Services

The repo ships with seven example microservices covering all supported languages:

```bash
# Clone the repo
git clone https://github.com/your-org/crossctx.git
cd crossctx

# Install and build
npm install && npm run build

# Run against the examples
node dist/bin/cli.js \
  examples/order-service \
  examples/payment-service \
  examples/user-service \
  examples/inventory-service \
  examples/notification-service \
  examples/analytics-service \
  examples/email-service \
  --graph

open crossctx-graph.html
```

| Example Service | Language | Framework |
|----------------|----------|-----------|
| `order-service` | — | OpenAPI spec only |
| `payment-service` | — | OpenAPI spec only |
| `user-service` | — | OpenAPI spec only |
| `inventory-service` | Java | Spring Boot |
| `notification-service` | C# | ASP.NET Core |
| `analytics-service` | Python | FastAPI |
| `email-service` | Python | Django REST |

---

## Understanding the Output

### Reading the JSON

The JSON output has two top-level sections:

- `codeScanResults` — one entry per service, containing all endpoints and outbound calls
- `callChains` — resolved dependency trees starting from each entry-point endpoint

Open `crossctx-output.json` in any JSON viewer, or paste it into an LLM prompt.

### Reading the Graph

When the HTML graph opens:

1. **Service nodes** — sized by endpoint count. Hover to see the service name and endpoint count.
2. **Edges** — directed arrows showing call direction. Hover for the source and target endpoints plus confidence score.
3. **Sidebar** — expand services → controllers → endpoints. Click an endpoint to see its detail panel.
4. **Detail panel** — shows request/response shapes and outbound calls for the selected endpoint.

See [[Interactive Dependency Graph]] for the full guide.

---

## Common Workflows

### Before making a breaking change

```bash
# Generate a baseline before your change
crossctx ./services -o baseline.json

# Make your change...

# Check for breaking changes after
crossctx ./services --diff baseline.json
```

### Feeding context to an LLM

```bash
crossctx ./services --markdown
# Paste crossctx-output.md into Claude, ChatGPT, etc.
```

### Watching for changes

```bash
crossctx ./services --watch --graph
# Re-scans automatically when source files change
```

### CI pipeline (fail on breaking changes)

```yaml
# GitHub Actions example
- run: npx crossctx ./services --diff baseline.json
```

---

## Troubleshooting

**"No services detected"** — CrossCtx expects one service per directory argument. Make sure each path points to a service root (where `package.json`, `pom.xml`, etc. lives), not a parent directory.

**"Low confidence scores"** — If confidence is below 0.60, CrossCtx may have fallen back to generic language detection. Check that the language marker file (`package.json`, `pom.xml`, etc.) is in the directory root.

**"No call chains found"** — The resolver couldn't match outbound calls to target services. This happens when service URLs are loaded from external config (e.g. a remote config server) rather than env vars or hardcoded strings in the source. Check the `serviceUrlHints` in the JSON output to see what URL patterns were detected.

---

← [[How CrossCtx Differs From Existing Tools]] · [[Roadmap]] →
