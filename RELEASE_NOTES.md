# Release Notes

## v0.1.0 — Initial Release

**CrossCtx** is a CLI tool that scans microservice source code and generates a cross-service API dependency map — no OpenAPI specs required.

### What's included

**Source code parsers for 4 languages / 6 frameworks**

- TypeScript — NestJS and Express controllers, `axios` / `fetch` / `HttpService` / `got` outbound calls, `class-validator` and Swagger decorator DTOs
- Java — Spring Boot `@RestController`, `RestTemplate` / `WebClient` / `FeignClient` outbound calls, POJO and record DTOs
- C# — ASP.NET Core controllers, `HttpClient` / `IHttpClientFactory` / `Refit` outbound calls, classes and positional records (including `[Required]` annotated params)
- Python — FastAPI, Django REST Framework, Flask; `httpx` / `requests` / `aiohttp` outbound calls, Pydantic `BaseModel`, DRF `Serializer`, `@dataclass`

**Call chain resolution**

Five-tier resolver maps outbound HTTP calls to their target services: named clients → hostname matching → environment variable heuristics → URL fragment matching → relative path matching. Handles Kubernetes DNS, Consul DNS, camelCase field references, and string concatenation patterns.

**Three output formats**

- `crossctx-output.json` — structured JSON, always generated, built for LLM consumption
- `crossctx-output.md` — Markdown summary, paste directly into a prompt with `--markdown`
- `crossctx-graph.html` — self-contained interactive HTML graph with `--graph`

**Interactive HTML graph features**

- Service view and controller view (toggle in header)
- Node size reflects endpoint count
- Left sidebar as a three-level tree: service → controller → endpoint
- Click any endpoint to see request body fields, response type, and call chain
- Animate call hops step-by-step with the ▶ Animate button
- Single-service projects automatically show controller view

**OpenAPI/Swagger enrichment**

Specs are scanned and merged with source-code results when present. Use `--openapi-only` to skip source parsing entirely (legacy mode).

### Example services

The repo ships with seven example microservices covering all supported languages — run them all at once to see the graph output:

```bash
npx crossctx examples/order-service examples/payment-service examples/user-service \
  examples/inventory-service examples/notification-service \
  examples/analytics-service examples/email-service \
  --graph
```

### CLI

```
crossctx [options] <paths...>

  -o, --output <file>      JSON output (default: crossctx-output.json)
  -m, --markdown [file]    Markdown output (default: crossctx-output.md)
  -g, --graph [file]       HTML graph output (default: crossctx-graph.html)
  -q, --quiet              suppress terminal output
  --openapi-only           scan OpenAPI specs only, skip source code
  -V, --version            version number
  -h, --help               help
```

### Known limitations in v0.1.0

- Go and Ruby parsers are not yet implemented
- GraphQL and gRPC are not detected
- DTO resolution is single-file only (cross-file imports are not followed)
- The HTML graph does not yet support export or depth visualization

### What's next

- v0.2 — cross-file DTO resolution, improved call chain confidence scoring
- v0.3 — GraphQL and gRPC detection
- v1.0 — Go parser, HTML graph polish
