# CrossCtx

Generate a cross-service API dependency map from your microservice source code — in one command.

CrossCtx scans your project folders directly, detects the language and framework automatically, extracts controllers, endpoints, request/response payload shapes, and maps how services call each other. The output is a self-contained interactive HTML graph plus JSON and Markdown for LLM consumption.

## Quick Start

```bash
npx crossctx ./service1 ./service2 ./service3
```

You get `crossctx-output.json`, `crossctx-output.md`, and `crossctx-graph.html` — no config required.

## Installation

```bash
npm install -g crossctx
```

Or use directly with npx — no install needed.

## What it does

CrossCtx follows a four-phase pipeline:

1. **Detect** — identifies the language and framework for each project folder (TypeScript/NestJS, Java/Spring Boot, C#/ASP.NET, Python/FastAPI, Django, Flask)
2. **Parse** — extracts controllers, endpoints, HTTP method, path, request body type, response type, and outbound HTTP calls by reading source code directly — no OpenAPI spec required
3. **Resolve** — maps outbound calls to their target services using a five-tier strategy: named clients (FeignClient, IHttpClientFactory, Spring Cloud LoadBalancer) → hostname matching → environment variable heuristics → URL fragment matching → relative path matching. Handles Kubernetes DNS (`service.namespace.svc.cluster.local`), Consul DNS (`service.service.consul`), camelCase field references, and string concatenation patterns across all four languages
4. **Render** — produces JSON, Markdown, and a self-contained interactive HTML graph

## Language Support

| Language | Frameworks | Inbound | Outbound | DTOs |
|---|---|---|---|---|
| TypeScript | NestJS, Express | ✅ | axios, fetch, HttpService, got | class-validator, Swagger decorators |
| Java | Spring Boot | ✅ | RestTemplate, WebClient, FeignClient | POJO classes, records, Kotlin data classes |
| C# | ASP.NET Core | ✅ | HttpClient, IHttpClientFactory, Refit, RestSharp | classes, positional records |
| Python | FastAPI, Django REST, Flask | ✅ | httpx, requests, aiohttp | Pydantic BaseModel, DRF Serializer, dataclass |

OpenAPI/Swagger specs are also scanned when present and used to enrich the output.

## Example

```bash
crossctx ./order-service ./payment-service ./user-service ./inventory-service -g deps.html
```

```
  CrossCtx v0.2.0

  [1/4] Detecting languages and scanning source code...
  → order-service (java/spring-boot, confidence: 97%)
  → payment-service (csharp/aspnet, confidence: 97%)
  → user-service (python/fastapi, confidence: 95%)
  → inventory-service (java/spring-boot, confidence: 97%)
  Found 4 service(s), 48 endpoint(s)

  [2/4] Scanning for OpenAPI/Swagger specs...
  Found 2 OpenAPI spec(s)

  [3/4] Resolving call chains...
  Found 12 call chain(s)

  [4/4] Building output...
  Graph saved to: deps.html
```

## Interactive HTML Graph

The `--graph` output is a single self-contained HTML file — open it in any browser, no server needed.

**Multi-service projects** default to service view — services are graph nodes, edges are detected cross-service calls, node size reflects endpoint count. A **Services / Controllers** toggle in the header switches to controller view, where every controller across all services becomes its own node, color-coded by its parent service. Both views show the same edges derived from call chain data.

**Single-service projects** automatically show controllers as nodes — each controller becomes its own bubble, sized by endpoint count, so you can see the internal structure at a glance.

**Call chain animation** — click any endpoint that makes outbound calls, then hit **▶ Animate** in the detail panel to watch the call hops step through the graph one edge at a time.

The left sidebar organizes everything as a three-level tree:

```
▼ order-service                    [24]
  ▶ ● OrderController               [8]
  ▶ ● OrderItemController           [6]
  ▶ ● OrderStatusController         [5]
  ▶ ● ShippingController            [5]
```

Expand a controller to see its endpoints. Click any endpoint to open the detail panel on the right, which shows the full path, request body fields, response type, and call chain tree.

## Output Formats

### JSON (`-o`)

Always generated. Structured for LLM consumption:

```json
{
  "codeScanResults": [
    {
      "serviceName": "order-service",
      "language": { "language": "java", "framework": "spring-boot" },
      "endpoints": [
        {
          "method": "POST",
          "path": "/api/orders",
          "requestBody": { "typeName": "CreateOrderRequest", "fields": [...] },
          "outboundCalls": [...]
        }
      ]
    }
  ],
  "callChains": [...]
}
```

### Markdown (`--markdown`)

LLM-optimized summary — paste directly into a prompt:

```bash
crossctx ./services --markdown
```

### Interactive Graph (`--graph`)

```bash
crossctx ./services --graph
crossctx ./services --graph custom-name.html
```

### All formats at once

```bash
crossctx ./services --markdown --graph
```

## CLI Reference

```
Usage: crossctx [options] <paths...>

Arguments:
  paths                    project directories to scan (one per microservice)

Options:
  -o, --output <file>      JSON output file (default: "crossctx-output.json")
  -m, --markdown [file]    generate Markdown output (default: "crossctx-output.md")
  -g, --graph [file]       generate interactive HTML graph (default: "crossctx-graph.html")
  -q, --quiet              suppress terminal output
  --openapi-only           only scan OpenAPI/Swagger specs, skip source code (legacy mode)
  -V, --version            output the version number
  -h, --help               display help
```

## Examples directory

The repo ships with seven example microservices covering all supported languages:

| Service | Language | Framework |
|---|---|---|
| `examples/order-service` | — | OpenAPI spec only |
| `examples/payment-service` | — | OpenAPI spec only |
| `examples/user-service` | — | OpenAPI spec only |
| `examples/inventory-service` | Java | Spring Boot |
| `examples/notification-service` | C# | ASP.NET Core |
| `examples/analytics-service` | Python | FastAPI |
| `examples/email-service` | Python | Django REST |

Run all seven at once:

```bash
crossctx examples/order-service examples/payment-service examples/user-service \
  examples/inventory-service examples/notification-service \
  examples/analytics-service examples/email-service \
  --graph
```

## Why this exists

Microservice architectures are hard to reason about. Documentation goes stale. New developers spend their first weeks just figuring out what calls what. And when you ask an LLM to help debug a cross-service issue, you spend more time explaining the architecture than getting actual help.

CrossCtx generates a single source of truth from the source code itself — controllers, endpoints, payload shapes, and call chains — so both humans and AI can understand your architecture instantly.

## Roadmap

- **v0.3** — GraphQL and gRPC detection, payload enrichment (cross-file DTO resolution)
- **v1.0** — Go and Ruby parser support, HTML report polish (depth visualization, export)
- **v2.0** — Kafka/RabbitMQ message queue mapping, async call chains
- **v3.0** — CI/CD integration, breaking change detection in PRs
- **v4.0** — GitHub Action, web UI

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT](LICENSE)
