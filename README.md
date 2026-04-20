# CrossCtx

**Find hidden service dependencies instantly.**

```bash
npx crossctx scan
```

```
  🔍 CrossCtx Results
  ─────────────────────────────────────────────

  ✔ 3 services detected
  ✔ 24 endpoints mapped
  ✔ 11 cross-service calls found

  Top dependencies:
    - order-service → payment-service
    - order-service → user-service
    - payment-service → user-service

  ⚠️  High fan-out:
    - order-service calls 3 services

  Next steps:
    crossctx graph        # open interactive dependency graph
    crossctx insights     # full architecture analysis
    crossctx blame <svc>  # impact analysis for a service
    crossctx export       # save JSON / Markdown
```

No config. No instrumentation. No agents running in your cluster.  
CrossCtx reads your source code directly and tells you how your services actually connect.

---

## Why CrossCtx?

Microservices are hard to reason about.

- *"What calls this API?"*
- *"If I change this, what breaks?"*
- *"How are these services actually connected?"*

Docs are outdated. Diagrams lie. Tribal knowledge doesn't scale.

**CrossCtx reads your code and tells you the truth.**

---

## Installation

```bash
npm install -g crossctx
```

Or run without installing:

```bash
npx crossctx scan ./services
```

---

## Commands

### `crossctx scan` — the starting point

```bash
crossctx scan ./order-service ./payment-service ./user-service
```

Auto-detects languages, maps endpoints and cross-service calls, and shows a plain-English summary. Supports TypeScript, Java, Python, Go, C#, gRPC, and GraphQL — no config needed.

Use `crossctx init` to set up a `.crossctxrc.json` so you never have to repeat paths:

```bash
crossctx init      # creates .crossctxrc.json
crossctx scan      # reads paths from config
```

---

### `crossctx graph` — visualize the dependency map

```bash
crossctx graph ./order-service ./payment-service ./user-service
```

Generates a self-contained interactive HTML file. Open in any browser — no server needed.

[![CrossCtx graph UI showing services, confidence-colored edges, and endpoint detail panel](docs/graph-ui.png)](https://nareshtammineni01.github.io/crossctx/crossctx-graph.html)

**Graph features:**
- Services view and Controllers view
- Min-confidence slider — filter noisy edges in real-time
- Service filter chips — isolate one service and its connections
- Endpoint detail panel — request/response shapes, full call chain tree
- Call chain animation — step through hops one by one

Or use a previously saved scan output to skip rescanning:

```bash
crossctx graph --input crossctx-output.json
```

---

### `crossctx insights` — architecture analysis

```bash
crossctx insights ./services
```

Runs a full analysis pass and surfaces:

```
  ⚡ Architecture Insights
  ─────────────────────────────────────────────

  ✖  Circular dependency: order-service ↔ payment-service
     These services form a dependency cycle...

  ⚠️  High fan-out: order-service calls 4 services
     Consider introducing an orchestrator or API gateway...

  ⚠️  High-risk service: auth-service is called by 6 services
     An outage here has wide blast radius...

  ℹ️  12 outbound calls could not be mapped
     Add service URL hints or include all service dirs in scan...
```

Exits with code 1 if critical issues (circular dependencies) are found — useful in CI.

---

### `crossctx blame` / `crossctx impact` — impact analysis

```bash
crossctx blame PaymentService
# or
crossctx impact PaymentService
```

```
  💥 Blast radius: PaymentService
  ─────────────────────────────────────────────

  If PaymentService goes down:

  Direct callers (2):
    ✖ order-service will break
    ✖ checkout-service will break

  Transitively affected (1):
    ~ api-gateway (indirect)

  Total impact: 3 service(s) affected
```

Great for on-call prep, incident response, and change review.

---

### `crossctx trace` — visualise a call chain

```bash
crossctx trace /api/orders
```

```
  🔎 Trace: POST /api/orders

  order-service
    → payment-service (POST /api/charge)
      → stripe-adapter (POST /v1/charges)
    → inventory-service (PUT /api/stock/:id)
```

See exactly what happens — service by service — when an endpoint is called.

---

### `crossctx explain` — LLM context builder

```bash
crossctx explain /api/orders
```

Generates a ready-to-paste context block for ChatGPT or any LLM — including the endpoint's call chain, request/response schema, and which services it touches. Copies to clipboard automatically.

```
  Copied to clipboard ✅

  Endpoint: order-service — POST /api/orders
  Calls:    payment-service, inventory-service
```

---

### `crossctx export` — save output files

```bash
crossctx export --format all       # JSON + Markdown
crossctx export --format markdown  # Markdown only
crossctx export --format json      # JSON only
```

Or export from a saved scan:

```bash
crossctx export --input crossctx-output.json --format all
```

---

### `crossctx diff` — breaking change detection

```bash
crossctx diff baseline.json crossctx-output.json
```

Compares two scans and reports added, removed, and changed endpoints. Exits with code 1 on breaking changes — designed for CI gating.

```bash
# In CI: save baseline on main, compare on PRs
crossctx scan ./services --output baseline.json
crossctx diff baseline.json crossctx-output.json
```

---

## Real Use Cases

**Debug faster** — "Why is this endpoint failing?" → see every downstream service it calls in seconds.

**Change safely** — "What breaks if I modify this?" → `crossctx impact <ServiceName>` before you merge.

**Onboard faster** — "How does this system work?" → run `crossctx scan` + `crossctx graph` on day one.

**Supercharge AI tools** — paste `crossctx explain /api/orders` output directly into ChatGPT for architecture-aware debugging.

---

## Language & Protocol Support

| Language | Frameworks | Inbound | Outbound | DTOs |
|---|---|---|---|---|
| TypeScript | NestJS, Express | ✅ | axios, fetch, HttpService, got | class-validator, Swagger decorators |
| Java | Spring Boot | ✅ | RestTemplate, WebClient, FeignClient | POJO classes, records |
| C# | ASP.NET Core | ✅ | HttpClient, IHttpClientFactory, Refit | classes, positional records |
| Python | FastAPI, Django REST, Flask | ✅ | httpx, requests, aiohttp | Pydantic, DRF Serializer |
| Go | Gin, Chi | ✅ | net/http, go-resty | structs |
| gRPC | Any language | ✅ | .proto file parsing | message types |
| GraphQL | Any language | ✅ | schema parsing | type definitions |

OpenAPI/Swagger specs are also scanned when present and used to enrich the output.

---

## Config File

```bash
crossctx init   # scaffolds .crossctxrc.json
```

```json
{
  "paths": ["./order-service", "./payment-service", "./user-service"],
  "output": "crossctx-output.json"
}
```

Once configured, all commands pick up paths automatically — no arguments needed.

---

## Examples

The repo ships with eight example microservices covering all supported languages:

```bash
cd examples
crossctx scan
```

```
crossctx graph
crossctx insights
crossctx blame analytics-service
```

---

## Performance

Designed to be fast enough for CI (benchmarked on M2 MacBook Pro, Node.js 20):

| Corpus | Services | Files | Wall time |
|---|---|---|---|
| 8 mixed-language services | 8 | ~120 | ~2 s |
| 10 TypeScript/NestJS services | 10 | 160 | ~3 s |
| 50 TypeScript/NestJS services | 50 | 800 | ~12 s |

---

## How it works

CrossCtx follows a four-phase pipeline — **detect → parse → resolve → render**:

**Detect** — identifies language and framework for each project folder from marker files (`package.json`, `pom.xml`, `go.mod`, etc.) with confidence scores.

**Parse** — extracts controllers, endpoints, HTTP methods, paths, request/response shapes, and outbound calls directly from source code. No OpenAPI spec required.

**Resolve** — maps outbound calls to target services using a five-tier strategy: named clients (FeignClient, IHttpClientFactory) → hostname matching → environment variable heuristics → URL fragment matching → path matching.

**Render** — produces the hook summary, insights, JSON, Markdown, and the interactive HTML graph.

---

## Plugin Interface

Add support for custom languages or frameworks via the community plugin interface:

```json
{
  "paths": ["./my-service"],
  "plugins": ["crossctx-plugin-ruby"]
}
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the plugin API.

---

## CI Integration

```yaml
# .github/workflows/crossctx.yml
- name: Check for breaking API changes
  run: |
    crossctx scan ./services --output current.json
    crossctx diff baseline.json current.json
```

A [Docker image](docs/docker-ci.md) and a [GitHub Action](action.yml) are available for zero-install CI use.

---

## Roadmap

- **v0.3** ✅ — gRPC, GraphQL, DB usage detection, shared library detection, monorepo discovery
- **v1.0** ✅ — stable JSON schema, plugin interface, `diff` subcommand, Docker, benchmarks
- **v2.0** ✅ — `scan`, `graph`, `insights`, `blame`, `explain`, `export` subcommands; architecture insights layer
- **v2.x** — PR impact analysis GitHub Action, VS Code extension, watch mode insights

See [ROADMAP.md](ROADMAP.md) for the full plan.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
