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
crossctx scan ./user-service ./order-service ./payment-service
```

You'll see output like:

```
  🔍 CrossCtx Results
  ─────────────────────────────────────────────

  ✔ 3 services detected
  ✔ 22 endpoints mapped
  ✔ 8 cross-service calls found

  Top dependencies:
    - order-service → payment-service
    - order-service → user-service

  ⚠️  High fan-out:
    - order-service calls 3 services

  Next steps:
    crossctx graph        # open interactive dependency graph
    crossctx insights     # full architecture analysis
    crossctx blame <svc>  # impact analysis for a service
    crossctx export       # save JSON / Markdown
```

One file is written by default:
- `crossctx-output.json` — full structured output, LLM-optimized

---

## Generate the Interactive Graph

```bash
crossctx graph ./user-service ./order-service ./payment-service
```

This creates:
- `crossctx-graph.html` — open in any browser

```bash
open crossctx-graph.html     # macOS
xdg-open crossctx-graph.html # Linux
start crossctx-graph.html    # Windows
```

Or reuse a previous scan result to skip rescanning:

```bash
crossctx graph --input crossctx-output.json
```

---

## Save JSON / Markdown Output

```bash
crossctx export --format all   # JSON + Markdown
crossctx export --format json
crossctx export --format markdown
```

---

## Try It with the Example Services

The repo ships with eight example microservices covering all supported languages:

```bash
# Clone the repo
git clone https://github.com/nareshtammineni01/crossctx.git
cd crossctx/examples

# Install and build
npm install && npm run build

# Run scan (paths are in .crossctxrc.json — no args needed)
crossctx scan
crossctx graph
crossctx insights
crossctx blame analytics-service
```

| Example Service | Language | Framework |
|----------------|----------|-----------|
| `order-service` | TypeScript | NestJS |
| `payment-service` | TypeScript | NestJS |
| `user-service` | TypeScript | NestJS |
| `inventory-service` | Java | Spring Boot |
| `notification-service` | Python | FastAPI |
| `analytics-service` | Python | FastAPI |
| `email-service` | Go | Gin |
| `go-order-service` | Go | Gin |

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
# Save baseline before your change
crossctx scan ./services --output baseline.json

# Make your change...

# Detect breaking changes
crossctx diff baseline.json crossctx-output.json
```

### Architecture health check

```bash
crossctx insights ./services
# Exits 1 if circular dependencies found — great for CI
```

### Blast radius analysis

```bash
crossctx blame PaymentService
# Shows what breaks if PaymentService goes down
```

### Feed context to an LLM

```bash
crossctx explain /api/orders
# Copies clipboard-ready context block to your clipboard
```

### CI pipeline (fail on breaking changes)

```yaml
# GitHub Actions example
- run: |
    crossctx scan ./services --output current.json
    crossctx diff baseline.json current.json
```

---

## Troubleshooting

**"No services detected"** — CrossCtx expects one service per directory argument. Make sure each path points to a service root (where `package.json`, `pom.xml`, etc. lives), not a parent directory.

**"Low confidence scores"** — If confidence is below 0.60, CrossCtx may have fallen back to generic language detection. Check that the language marker file (`package.json`, `pom.xml`, etc.) is in the directory root.

**"No call chains found"** — The resolver couldn't match outbound calls to target services. This happens when service URLs are loaded from external config (e.g. a remote config server) rather than env vars or hardcoded strings in the source. Check the `serviceUrlHints` in the JSON output to see what URL patterns were detected.

---

← [[How CrossCtx Differs From Existing Tools]] · [[Roadmap]] →
