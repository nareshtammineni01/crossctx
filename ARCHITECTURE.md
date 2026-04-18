# CrossCtx Architecture

CrossCtx is a two-pipeline CLI tool that generates cross-service API dependency maps from source code and OpenAPI specs. This document explains how it works internally — useful for contributors adding new language parsers, output renderers, or resolution strategies.

---

## High-Level Overview

```
Input: one or more project directories (one per microservice)

┌─────────────────────────────────────────────────────────────────────┐
│  Pipeline A — Source Code                                           │
│                                                                     │
│  Detector  →  Language Parser  →  Service Registry  →  Resolver   │
│  (detect      (extract             (build cross-      (build call  │
│   lang/fw)     endpoints,           service lookup     chains)     │
│                DTOs, URL hints)     tables)                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Pipeline B — OpenAPI (runs in parallel, enriches output)          │
│                                                                     │
│  Scanner  →  Parser  →  Analyzer  →  (merged into output below)   │
│  (find        (parse     (hostname                                  │
│   spec         specs)     cross-ref                                │
│   files)                  matching)                                │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
                          ┌────────────┐
                          │  Renderer  │  JSON / Markdown / HTML graph
                          └────────────┘
                                 │
                          ┌────────────┐
                          │   Differ   │  Breaking change detection (--diff)
                          └────────────┘
```

The two pipelines run sequentially (source code first, then OpenAPI) and their results are merged into a single `CrossCtxOutput` object before rendering.

---

## Module Breakdown

### `src/detector/`

**Purpose:** Identify the language and framework of a project directory before parsing begins.

**How it works:** Tries a prioritized list of marker-file checks. Each check reads a well-known config file (`package.json`, `pom.xml`, `go.mod`, `.csproj`, `requirements.txt`) and returns a `DetectedLanguage` with a confidence score (0–1).

**Priority order (highest confidence first):**
1. `package.json` with `@nestjs/core` → TypeScript / NestJS (0.98)
2. `package.json` with `express` → TypeScript / Express (0.92)
3. `package.json` (any) → TypeScript / unknown (0.70)
4. `go.mod` with gin/chi → Go / Gin or Chi (0.95)
5. `pom.xml` with `spring-boot` → Java / Spring Boot (0.97)
6. `pom.xml` (any) → Java / unknown (0.80)
7. `.csproj` → C# / ASP.NET (0.97)
8. `requirements.txt` / `pyproject.toml` with FastAPI/Django/Flask → Python (0.95)
9. `main.py` / `app.py` exists → Python / unknown (0.60)

**Key types:** `DetectedLanguage`, `SupportedLanguage`, `SupportedFramework`

**Extension point:** To add a new language, add a new `check*()` function and insert it into the priority list in `detectLanguage()`.

---

### `src/parsers/`

**Purpose:** Extract structured data from source files for a specific language/framework combination. Each parser is a standalone module with a single exported `parse*Project()` function.

**Current parsers:**

| File | Languages / Frameworks | What it extracts |
|------|----------------------|-----------------|
| `typescript.ts` | NestJS, Express | Controllers, decorators (`@Get`, `@Post`, `@Controller`), `HttpService`/`axios`/`fetch` outbound calls, DTOs, env vars |
| `java.ts` | Spring Boot | `@RestController`, `@RequestMapping`, `@GetMapping`, RestTemplate, Feign clients, `@KafkaListener`, `@RabbitListener` |
| `csharp.ts` | ASP.NET | `[ApiController]`, `[Route]`, `IHttpClientFactory`, `HttpClient`, `[HttpGet]` / `[HttpPost]` attributes |
| `python.ts` | FastAPI, Django, Flask | `@app.route`, `@router.*`, `requests.get/post`, `httpx.AsyncClient` |
| `go.ts` | Gin, Chi | `router.GET/POST`, `http.Get/Post`, `gin.Context` handlers |
| `messaging.ts` | All languages | Kafka producers/consumers, RabbitMQ, SQS, Redis pub/sub, NATS |

**Output per parser:** `CodeScanResult` — contains `endpoints[]`, `dtos[]`, `serviceUrlHints[]`, `messageEvents[]`.

**How endpoint extraction works (TypeScript parser as example):**
1. Glob all `.ts` / `.js` files (ignoring `node_modules`, `dist`, test files)
2. Read all file contents into memory (cross-file DTO resolution needs this)
3. Extract DTOs: scan for `class` definitions and `interface` shapes with fields
4. Extract service URL hints: look for env vars, constants, and config fields that contain hostnames
5. Parse controllers: regex-match `@Controller`, `@Get`, `@Post`, etc. — build `SourceEndpoint[]` with `outboundCalls[]` embedded per handler

**Key types:** `CodeScanResult`, `SourceEndpoint`, `OutboundCall`, `PayloadShape`, `MessageEvent`

**Extension point:** To add a new language parser, create `src/parsers/yourlang.ts` exporting `parseYourLangProject(projectPath, language, serviceName): Promise<CodeScanResult>`, then wire it up in the `cli.ts` language dispatch block.

---

### `src/scanner/` and `src/parser/`

**Purpose:** The legacy OpenAPI pipeline. Separate from the source-code pipeline.

- **Scanner** (`scanner/index.ts`): Uses `fast-glob` to find all `openapi.json`, `swagger.yaml`, `*.openapi.yml`, etc. under the scanned directories.
- **Parser** (`parser/index.ts`): Reads each spec file, handles both OpenAPI 3.x and Swagger 2.x, extracts services, endpoints, server URLs, and referenced URLs.

**Key types:** `ScanResult`, `ParsedSpec`, `Service`, `Endpoint`

---

### `src/analyzer/`

**Purpose:** Detect inter-service dependencies from parsed OpenAPI specs using hostname cross-referencing.

**Strategy:**
1. Build a `hostname → service name` map from all specs' `servers` arrays
2. For each service, check if its referenced URLs (extracted from descriptions and other text fields) match another service's hostname
3. Also check if a spec's own server URL contains another service's name as a substring

**Output:** `Dependency[]` — each with `from`, `to`, `detectedVia`, and `evidence` fields.

**Limitation:** This is OpenAPI-level analysis only. For actual code-level call tracing, the Resolver does the heavy lifting.

---

### `src/resolver/`

**Purpose:** The most complex module. Builds a cross-service `ServiceRegistry` and resolves every `OutboundCall` to a specific target service and endpoint, then walks full call chains.

**ServiceRegistry** — four lookup tables built from all `CodeScanResult[]`:

| Table | Key | Value | Example |
|-------|-----|-------|---------|
| `byName` | service name | `CodeScanResult` | `"order-service"` |
| `byHostname` | hostname | service name | `"order-service:3000"` → `"order-service"` |
| `byEnvKey` | env var name | service name | `"ORDER_SERVICE_URL"` → `"order-service"` |
| `byNamedClient` | client name | service name | `"orderService"` → `"order-service"` |
| `byUrlFragment` | URL path segment | service name | `"orders"` → `"order-service"` |

**Resolution strategies** (tried in order, highest confidence first):

1. **Named client / FeignClient / LoadBalancer** (0.95) — `feign://order-service/api/orders`, `lb://order-service`, `CreateClient("order-service")`
2. **Hostname from URL** (0.95) — parse the URL, look up the hostname in the registry, handle Kubernetes DNS (`*.svc.cluster.local`) and Consul DNS (`*.service.consul`)
3. **Template string env var** (0.85) — extract variable name from `` `${this.orderServiceUrl}/api/orders` `` or `${ORDER_SERVICE_URL}/api/orders`
4. **URL fragment matching** (0.60) — if the URL contains a known path segment like `/orders`, match to the service registered for that fragment
5. **Named client partial match** (0.55) — if `"orderService"` appears anywhere in the URL
6. **Relative path** (0.55) — if the URL is a relative path like `/api/orders`, scan all known services for a matching endpoint

**Call chain walking** (`buildAllCallChains`): For each endpoint that makes outbound calls, the resolver recursively walks the dependency tree (up to depth 20, cycle detection via visited set) and builds a `CallChain` with both a tree structure and a flat `edges[]` list for graph rendering.

---

### `src/renderer/`

Three output formats:

| File | Format | Description |
|------|--------|-------------|
| `index.ts` | JSON | Full `CrossCtxOutput` — machine-readable, LLM-friendly |
| `markdown.ts` | Markdown | Human-readable summary: services table, endpoint list, dependency map |
| `graph.ts` | HTML | Interactive D3/vis.js force-directed graph — services as nodes, call edges as arrows, colored by confidence |

**Extension point:** To add a new output format, create `src/renderer/yourformat.ts` and add a corresponding CLI flag in `cli.ts`.

---

### `src/differ/`

**Purpose:** Compare two `CrossCtxOutput` JSON files and classify changes as breaking or non-breaking.

**Breaking changes:**
- Removed endpoints
- Removed request body fields
- Changed request body or response type

**Non-breaking changes:**
- Added endpoints
- Added request body fields

**CLI usage:** `crossctx scan ./services --diff baseline.json` — exits with code 1 if breaking changes are detected (useful in CI).

---

### `src/types/`

Single source of truth for all TypeScript interfaces. Notable distinction:

- **`SourceEndpoint` / `OutboundCall` / `CodeScanResult`** — source-code pipeline types (rich, with line numbers and payload shapes)
- **`Endpoint` / `Service` / `Dependency`** — legacy OpenAPI pipeline types (simpler, for backwards compatibility)
- **`CrossCtxOutput`** — the unified output type combining both pipelines

---

## Data Flow (Concrete Example)

Given three microservices: `user-service`, `order-service`, `notification-service`:

```
crossctx ./user-service ./order-service ./notification-service --graph
```

1. **Detector** identifies each as TypeScript/NestJS (reads `package.json`)
2. **TypeScript parser** scans each service, finds controllers, extracts endpoints and outbound `HttpService.get()` / `axios.post()` calls
3. **ServiceRegistry** is built: `byHostname["user-service:3000"] = "user-service"`, `byEnvKey["USER_SERVICE_URL"] = "user-service"`, etc.
4. **Resolver** walks `order-service`'s outbound calls — finds `${this.userServiceUrl}/api/users/${id}` → resolves to `user-service:GET /api/users/{id}` (confidence 0.85 via env var match)
5. **Call chains** are built: `order-service:POST /api/orders → user-service:GET /api/users/{id}`, etc.
6. **OpenAPI scanner** finds any `openapi.yaml` files and enriches the output with additional metadata
7. **Renderer** writes `crossctx-output.json` and `crossctx-graph.html`

---

## Adding a New Language Parser

1. Create `src/parsers/yourlang.ts`:

```typescript
import type { CodeScanResult, DetectedLanguage } from "../types/index.js";

export async function parseYourLangProject(
  projectPath: string,
  language: DetectedLanguage,
  serviceName: string
): Promise<CodeScanResult> {
  // 1. Glob source files
  // 2. Extract endpoints (routes, handlers)
  // 3. Extract outbound calls (HTTP clients)
  // 4. Extract DTOs / payload shapes
  // 5. Extract service URL hints (env vars, config constants)
  return {
    projectPath,
    language,
    serviceName,
    endpoints,
    dtos,
    serviceUrlHints,
    hasOpenApiSpec: false,
  };
}
```

2. Add detection logic in `src/detector/index.ts` (new `check*()` function + entry in `detectLanguage()` priority list)

3. Wire up in `src/bin/cli.ts` — add an `else if (lang.language === "yourlang")` branch

4. Add tests in `tests/` following the existing pattern in `scanner.test.ts` / `parser.test.ts`

---

## Key Design Decisions

**Why regex parsing instead of AST?** The MVP deliberately avoids AST parsing to keep the tool fast, dependency-light, and easy to extend. Regex-based extraction works well for the structured patterns frameworks enforce (decorators, route annotations). The trade-off is some false positives/negatives on unusual code patterns.

**Why token-efficient JSON output?** The output format is designed to be passed directly to LLMs. Services, endpoints, and call chains are represented compactly so a full microservice architecture fits in a single context window.

**Why two pipelines?** OpenAPI specs give clean, authoritative endpoint metadata. Source code scanning gives call relationships that specs don't capture. Running both and merging the results gives the most complete picture.

**Why confidence scores on `OutboundCall`?** Resolution is inherently heuristic — a confidence score lets consumers filter out low-confidence edges for cleaner graphs while retaining them in the full JSON for analysis.
