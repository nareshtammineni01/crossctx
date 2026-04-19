# Architecture Overview

CrossCtx is a two-pipeline CLI tool. This page explains the internal architecture — useful for contributors adding language parsers, resolution strategies, or output renderers.

---

## High-Level Overview

```
Input: one or more project directories (one per microservice)

┌─────────────────────────────────────────────────────────────────────┐
│  Pipeline A — Source Code                                           │
│                                                                     │
│  Detector → Language Parser → Service Registry → Resolver          │
│  (detect     (extract          (build cross-     (build call        │
│   lang/fw)    endpoints,        service lookup    chains)           │
│               DTOs, URL hints)  tables)                             │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Pipeline B — OpenAPI (runs in sequence, enriches output)          │
│                                                                     │
│  Scanner → Parser → Analyzer → (merged into output)                │
│  (find      (parse   (hostname                                      │
│   specs)     specs)   cross-ref matching)                           │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
                          ┌────────────┐
                          │  Renderer  │   JSON / Markdown / HTML graph
                          └────────────┘
                                 │
                          ┌────────────┐
                          │   Differ   │   Breaking change detection
                          └────────────┘
```

The two pipelines run sequentially and their results are merged into a single `CrossCtxOutput` object before rendering.

---

## Module Breakdown

### `src/detector/`

Identifies the language and framework of a project directory by reading well-known config files.

**Priority order (highest confidence first):**

| Check | Language / Framework | Confidence |
|-------|---------------------|-----------|
| `package.json` with `@nestjs/core` | TypeScript / NestJS | 0.98 |
| `package.json` with `express` | TypeScript / Express | 0.92 |
| `package.json` (any) | TypeScript / unknown | 0.70 |
| `go.mod` with gin/chi | Go / Gin or Chi | 0.95 |
| `pom.xml` with `spring-boot` | Java / Spring Boot | 0.97 |
| `pom.xml` (any) | Java / unknown | 0.80 |
| `.csproj` | C# / ASP.NET | 0.97 |
| `requirements.txt` with FastAPI/Django/Flask | Python | 0.95 |
| `main.py` / `app.py` exists | Python / unknown | 0.60 |

**Extension point:** To add a new language, add a `checkYourLang()` function and insert it into the priority list in `detectLanguage()`.

---

### `src/parsers/`

Each parser is a standalone module with a single exported `parse*Project()` function. It receives a directory path, detected language, and service name, and returns a `CodeScanResult`.

| File | Languages / Frameworks |
|------|----------------------|
| `typescript.ts` | NestJS, Express |
| `java.ts` | Spring Boot |
| `csharp.ts` | ASP.NET Core |
| `python.ts` | FastAPI, Django REST, Flask |
| `go.ts` | Gin, Chi |
| `messaging.ts` | Kafka, RabbitMQ, SQS, Redis, NATS (all languages) |

**What each parser extracts:**
- `endpoints[]` — `SourceEndpoint` with method, path, controller name, request/response types, and `outboundCalls[]`
- `dtos[]` — payload shape definitions
- `serviceUrlHints[]` — env var names or constants that contain service hostnames
- `messageEvents[]` — Kafka/RabbitMQ producer and consumer events

**Extension point:** Create `src/parsers/yourlang.ts` exporting `parseYourLangProject(path, lang, name): Promise<CodeScanResult>`, then wire it up in `src/bin/cli.ts`.

---

### `src/resolver/`

The most complex module. Builds a `ServiceRegistry` and resolves every `OutboundCall` to a specific target service and endpoint, then walks full call chains.

**ServiceRegistry — four lookup tables:**

| Table | Key | Example |
|-------|-----|---------|
| `byHostname` | hostname:port | `"order-service:3000"` → `"order-service"` |
| `byEnvKey` | env var name | `"ORDER_SERVICE_URL"` → `"order-service"` |
| `byNamedClient` | client name | `"orderService"` → `"order-service"` |
| `byUrlFragment` | URL path segment | `"orders"` → `"order-service"` |

**Resolution strategies (tried in order):**

1. **Named client / FeignClient / LoadBalancer** (confidence 0.95) — `feign://order-service/api`, `lb://order-service`
2. **Hostname from URL** (0.95) — parse URL, look up hostname, handle Kubernetes (`*.svc.cluster.local`) and Consul (`*.service.consul`) DNS
3. **Env var template string** (0.85) — extract var name from `` `${this.orderServiceUrl}/api` ``
4. **URL fragment matching** (0.60) — if URL contains `/orders`, match to the service for that fragment
5. **Relative path** (0.55) — scan all known services for a matching endpoint path

**Call chain walking:** For each entry-point endpoint, the resolver recursively walks the dependency tree (max depth 20, cycle detection via visited set) and builds a `CallChain` with both a tree structure and a flat `edges[]` list.

---

### `src/renderer/`

Three output formats:

| File | Format | Description |
|------|--------|-------------|
| `index.ts` | JSON | Full `CrossCtxOutput`, machine-readable |
| `markdown.ts` | Markdown | Human-readable summary for LLM prompts |
| `graph.ts` | HTML | Self-contained interactive force-directed graph |

**Extension point:** Create `src/renderer/yourformat.ts` and add a corresponding CLI flag in `src/bin/cli.ts`.

---

### `src/scanner/` and `src/parser/`

The legacy OpenAPI pipeline:

- **Scanner** finds spec files (`openapi.json`, `swagger.yaml`, etc.) using `fast-glob`
- **Parser** reads each spec, handles OpenAPI 3.x and Swagger 2.x, extracts services, endpoints, and server URLs

---

### `src/analyzer/`

Detects inter-service dependencies from OpenAPI specs via hostname cross-referencing:

1. Build a `hostname → service name` map from all specs' `servers` arrays
2. For each service, check if its referenced URLs match another service's hostname

This is spec-level analysis only. Code-level call tracing is handled by the Resolver.

---

### `src/differ/`

Compares two `CrossCtxOutput` JSON files and classifies changes:

**Breaking:** Removed endpoints, removed required request fields, changed request/response types → exit code 1 in CI

**Non-breaking:** Added endpoints, added optional fields

---

### `src/types/`

Single source of truth for all TypeScript interfaces. Key distinction:

- `SourceEndpoint`, `OutboundCall`, `CodeScanResult` — source-code pipeline (rich, with payload shapes)
- `Endpoint`, `Service`, `Dependency` — legacy OpenAPI pipeline (simpler)
- `CrossCtxOutput` — unified output combining both pipelines

---

## Concrete Data Flow Example

Given three services: `user-service`, `order-service`, `notification-service`:

```
crossctx ./user-service ./order-service ./notification-service --graph
```

1. **Detector** identifies each as TypeScript/NestJS (reads `package.json`)
2. **TypeScript parser** scans each service, extracts controllers and outbound `HttpService.get()` / `axios.post()` calls
3. **ServiceRegistry** is built: `byHostname["user-service:3000"] = "user-service"`, `byEnvKey["USER_SERVICE_URL"] = "user-service"`, etc.
4. **Resolver** walks `order-service`'s outbound calls — finds `` `${this.userServiceUrl}/api/users/${id}` `` → resolves to `user-service:GET /api/users/{id}` (confidence 0.85, env var template)
5. **Call chains** built: `order-service:POST /api/orders → user-service:GET /api/users/{id}`
6. **OpenAPI scanner** finds any `openapi.yaml` files and enriches output
7. **Renderer** writes `crossctx-output.json` and `crossctx-graph.html`

---

## Key Design Decisions

**Why regex parsing instead of AST?**
The MVP avoids AST parsing to stay fast, dependency-light, and easy to extend. Regex-based extraction works well for the structured patterns frameworks enforce (decorators, route annotations). The trade-off is some false positives on unusual code patterns. AST-based parsing is planned as an opt-in flag in v0.3.

**Why token-efficient JSON output?**
The output format is designed to pass directly to LLMs. A full 10-service architecture fits in 8,000–12,000 tokens — well within any modern context window.

**Why two pipelines?**
OpenAPI specs give clean, authoritative endpoint metadata. Source code scanning gives call relationships that specs don't capture. Running both and merging gives the most complete picture.

**Why confidence scores?**
Resolution is inherently heuristic. Confidence scores let consumers filter speculative edges for cleaner graphs while retaining them in the full JSON for deeper analysis.

---

← [[Contributing]] · [[Home]] →
