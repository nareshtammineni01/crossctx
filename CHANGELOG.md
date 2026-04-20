# Changelog

All notable changes to CrossCtx will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Payload extractor enrichment (cross-file DTO resolution, confidence scoring)
- HTML report polish (depth visualization, language color bands, PNG/SVG export)
- Formal JSON schema versioning

---

## [0.3.0] - 2026-04-19

Accuracy + coverage release. gRPC, GraphQL, DB ownership, shared libraries, monorepo discovery, improved Python/Go parsers.

### Added

**gRPC support (`src/parsers/grpc.ts`)**
- Parses `.proto` files — extracts service definitions, RPC methods, and message types
- gRPC endpoints represented as `GRPC /package.ServiceName/MethodName` in the dependency map
- Outbound gRPC call detection for all languages:
  - Go: `grpc.Dial` / `grpc.NewClient` + stub method calls
  - TypeScript: `getService<T>()`, `@grpc/grpc-js` client constructors
  - Python: `grpc.insecure_channel` / `grpc.secure_channel` + `_pb2_grpc.XxxStub`
  - Java: `ManagedChannelBuilder.forAddress/forTarget` + `XxxGrpc.newBlockingStub`
  - C#: `GrpcChannel.ForAddress` + `new XxxService.XxxClient`

**GraphQL support (`src/parsers/graphql.ts`)**
- Parses `.graphql` / `.gql` schema files — extracts Query, Mutation, and Subscription operations
- Also detects `gql\`...\`` template literals in TypeScript/JS files
- GraphQL operations represented as `GRAPHQL_QUERY /graphql/operationName` endpoints
- Outbound GraphQL call detection:
  - TypeScript: Apollo Client (`client.query`, `client.mutate`), `graphql-request`, urql
  - Python: `gql` library, `requests.post` to a `/graphql` endpoint
  - Go: `machinebox/graphql` `graphql.NewClient`, `genqlient`
  - Java: Spring GraphQL `HttpGraphQlClient.builder`

**DB usage detection (`src/parsers/db.ts`)**
- Detects which tables, collections, and cache namespaces each service owns/uses
- SQL: TypeORM `@Entity`, Prisma `model`, Sequelize `define`, knex, raw SQL (`SELECT FROM`, `INSERT INTO`, `UPDATE`, `DELETE FROM`)
- MongoDB: Mongoose `mongoose.model`, `db.collection`, `motor`/`pymongo` dict-access, Spring `@Document`
- Redis: key-prefix patterns across all languages
- DynamoDB: `TableName` key in AWS SDK calls across all languages
- Elasticsearch: `index` key in client calls
- Results available as `dbUsage` on each `CodeScanResult`

**Shared internal library detection (`src/parsers/shared-libs.ts`)**
- Scans imports across all scanned services and flags packages used by 2+ services
- Covers TypeScript workspace packages (`@myorg/...`), Go sub-packages, Python project imports, Java groupId packages, C# namespace references
- Smart external-package exclusion lists per language (won't flag `react`, `axios`, `sqlalchemy`, etc.)
- Results available as `sharedLibraries` on `CrossCtxOutput`

**Monorepo layout support (`src/scanner/monorepo.ts`)**
- `--monorepo` flag: given a root directory, auto-discovers service sub-directories
- Detects service roots by looking for language marker files (`package.json`, `go.mod`, `pom.xml`, `*.csproj`, `requirements.txt`, etc.) up to 3 levels deep
- Skips non-service directories: `node_modules`, `vendor`, `dist`, `.git`, `__pycache__`, etc.
- Smart workspace-root exclusion: monorepo `package.json` with `"workspaces"` is not treated as a service
- Deduplication: avoids registering both a parent and child directory as separate services

### Improved

**Python parser (`src/parsers/python.ts`)**
- FastAPI dependency injection: `Depends(...)` parameters are now correctly excluded from request body detection
- `httpx` async client coverage: `await client.get(...)`, `await client.post(...)`, `httpx.AsyncClient(base_url=...)`, `httpx.Client(base_url=...)`

**Go parser (`src/parsers/go.ts`)**
- `go-resty` support: `.R().Get(url)`, `.R().Post(url)`, named resty client chains
- `http.NewRequestWithContext` detection
- `grpc.Dial` / `grpc.NewClient` targets added as `serviceUrlHints` for resolver pickup
- gRPC stub call detection integrated inline

### Changed
- `CrossCtxOutput` now includes optional `sharedLibraries: SharedLibrary[]`
- `CodeScanResult` now includes optional `dbUsage: DbUsage[]`
- New types: `DbUsage`, `SharedLibrary` in `src/types/index.ts`

---

## [0.2.2] - 2026-04-19

Developer experience improvements: config file, unified format flag, better errors, graph filter UI, and DTO accuracy improvements.

### Added

**`crossctx init` command**
- Scaffolds a `.crossctxrc.json` config file in the current directory with sensible defaults
- Prevents accidental overwrite if config already exists
- Prints a quick-start message after creation

**Config file support (`.crossctxrc.json` / `crossctx.config.json`)**
- CLI reads config from the current working directory before applying CLI flags
- CLI flags always take precedence over config file values
- Supports all options: `paths`, `output`, `format`, `markdown`, `graph`, `quiet`, `openapiOnly`, `minConfidence`
- `paths` in config enables running `crossctx` with no arguments

**`--format` flag**
- New unified `-f, --format <format>` flag: `json`, `markdown`, `graph`, or `all`
- Comma-separated values supported: `--format markdown,graph`
- `--markdown` and `--graph` remain as deprecated aliases for backwards compatibility

**`--min-confidence` flag**
- Filters call chain edges below the given confidence threshold (0–1)
- Applied before JSON output, markdown, and graph rendering
- Prints a summary of how many edges were filtered

**Graph UI — toolbar with real-time filters**
- Confidence threshold slider (0–100%) — hides edges below threshold in real-time without re-running the scan
- Service filter chips — click to isolate specific services in the graph
- Reset button — restores all elements to visible state
- Both filters compose: e.g. show only edges ≥ 70% confidence between two specific services

### Improved

**Better error messages for unrecognized projects**
- When a directory doesn't match any known language, now prints exactly which marker files were looked for and what to do next (add a marker file, use `--openapi-only`, or run `crossctx init`)
- "Path not found" error now includes a hint to check spelling or config file

**Java DTO extraction**
- `@JsonProperty("name")` annotations now override the field name in output
- `@NotNull`, `@NotBlank`, `@NotEmpty`, `@NonNull` annotations now set `required: true`
- `@Column(nullable = false)` also sets `required: true`
- Field regex improved to correctly handle multi-line annotations before field declarations

**C# DTO extraction**
- Class body extraction now uses brace-depth tracking instead of a greedy regex — correctly handles nested generic types in property declarations
- `[JsonPropertyName("snake_case")]` annotations now override property names in output
- C# 11 `required` keyword on properties now sets `required: true`
- `[Required]` data annotation now correctly sets `required: true`
- Non-nullable value types (int, bool, etc.) now default to `required: true`

### Other

**Examples directory**
- Added `examples/README.md` with quick-start instructions and directory overview
- Added `examples/.crossctxrc.json` config demonstrating all services and config options

---

## [0.2.1] - 2026-04-18

Resolver hardening and graph interaction improvements.

### Added

**URL resolver — five-tier resolution strategy**
- Strategy 0: Named client matching — covers Java `@FeignClient(name=...)`, Spring Cloud `lb://service-name`, C# `IHttpClientFactory.CreateClient("name")`
- Kubernetes DNS resolution: `order-service.default.svc.cluster.local` → `order-service`
- Consul DNS resolution: `order-service.service.consul` → `order-service`
- `HTTP_CLIENT_*` prefix convention for named C# HTTP clients
- camelCase field concat pattern: `orderServiceUrl + "/api/..."` (Java/C# field references without env annotation) now resolved via Strategy 2
- `byEnvKey` now stores both original key, uppercased, and `UPPER_SNAKE_CASE` forms (`UserServiceUrl` → `USER_SERVICE_URL`) so lookups match regardless of hint casing

**Controller view toggle in graph (multi-service)**
- New **Services / Controllers** toggle in header bar — switches between service-level and controller-level graph views without page reload
- Controller view shows every controller across all services as a Cytoscape node, color-coded by parent service
- Edges in controller view are derived from call chain data and connect the exact controllers involved in each cross-service call
- Services with no controller data fall back to a single service node in controller view
- Toggle is hidden in single-service mode (which always shows controller nodes)

**Call chain animation**
- **▶ Animate** button added to the Call Chain section in the detail panel
- `animateChainHops()` steps through each call hop in sequence with a flash animation on the graph edge
- `highlightChain()` updated to work in both service view and controller view — matches nodes by `serviceId` field for controller nodes

### Fixed

**Java parser**
- `extractControllerPrefix` now detects `@RequestMapping` before the class declaration (`braceDepth === 0`) — previously required `classFound = true`, which caused the annotation to be missed since it always appears on the line above `public class`. Fixes missing controller prefix in `fullPath` (e.g. `/{sku}` instead of `/api/inventory/{sku}`)
- `extractHandlers` now skips `@RequestMapping` at `braceDepth === 0` to prevent the class-level annotation from being treated as a handler endpoint, which caused doubled paths like `/api/inventory/api/inventory`

**Python parser**
- `extractDecoratorArg` now matches bare class-name identifiers in addition to quoted strings — `response_model=RevenueReport` was silently returning `undefined` because the regex only matched `response_model="..."`. Fixes missing response type on all FastAPI `response_model=ClassName` decorators

**URL resolver**
- Edge deduplication in `walkChain` now keeps the **highest-confidence** edge for each `from→toService` pair instead of first-seen — prevents a low-confidence fragment match from blocking a higher-confidence named-client match processed later
- Hostname registry bug: URL hints from service A pointing to service B no longer map the hostname to service A. Unscanned services now correctly yield no hostname entry (instead of mapping to the hint owner)
- Fragment table now indexes by `fullPath` (with controller prefix) rather than `path` alone — `notification-service` now correctly registers `notification` as a fragment from `/api/notification/...` endpoints
- `guessServiceFromEnvKey` now matches dehyphenated service names: `notificationserviceurl` finds `notification-service`

---

## [0.2.0] - 2026-04-17

This release replaces the OpenAPI-only pipeline with a full source code scanner. CrossCtx now reads your actual controllers and service files rather than relying on spec files being present.

### Added

**Language detection**
- Auto-detects TypeScript/NestJS, TypeScript/Express, Java/Spring Boot, C#/ASP.NET Core, Python/FastAPI, Python/Django, Python/Flask from project marker files (`package.json`, `pom.xml`, `.csproj`, `requirements.txt`) with confidence scores

**Source code parsers**
- TypeScript/NestJS — `@Controller`, `@Get/@Post/@Put/@Delete/@Patch`, `@Body()` param types, return type annotations, axios/fetch/HttpService outbound call detection
- Java/Spring Boot — `@RestController`, `@RequestMapping`, `@GetMapping` etc., FeignClient declarative interfaces (0.95 confidence), RestTemplate/WebClient outbound calls, POJO/record/Kotlin data class DTO extraction, `application.properties` and `application.yml` URL hint reading
- C#/ASP.NET — `[ApiController]`, `[Route]`, `[HttpGet]` etc., IHttpClientFactory/HttpClient/Refit/RestSharp outbound detection, class and positional record DTOs, `appsettings.json` ServiceUrls section reading
- Python/FastAPI — `APIRouter` prefix collection (two-pass), `@router.get/post` etc., `response_model` extraction, Pydantic BaseModel request body resolution from type-hinted parameters
- Python/Django REST — ViewSet method mapping (list/create/retrieve/update/destroy), `@api_view` function-based views, `urls.py` router.register and path() pattern collection including direct function references
- Python/Flask — `@app.route/@bp.route` with `methods=[]`

**URL resolver**
- Four-tier resolution: hostname lookup → environment variable key heuristics → URL fragment matching → endpoint path matching
- Handles JS/TS template literals (`${ORDER_SERVICE_URL}/api/...`), Python f-strings (`{ORDER_SERVICE_URL}/api/...`), and string concatenation (`ORDER_SERVICE_URL + "/api/..."`)
- Reads `.env`, `application.properties`, `appsettings.json` for actual URL values

**Call chain walker**
- Builds deep call chain trees: `ServiceA:POST /orders → ServiceB:GET /users/{id} → [leaf]`
- Cycle detection with `MAX_DEPTH=20`
- Flat edge list for graph rendering

**New types**
- `DetectedLanguage`, `SupportedLanguage`, `SupportedFramework`
- `SourceEndpoint`, `OutboundCall`, `PayloadShape`, `PayloadField`, `ServiceUrlHint`
- `CallChain`, `CallChainNode`, `CallChainEdge`, `CodeScanResult`

**Interactive HTML graph — full rewrite**
- Three-panel layout: left sidebar, center Cytoscape.js graph, right detail panel
- Left sidebar: three-level tree — service → controller group → endpoint, each with color dot, endpoint count badge, expand/collapse
- Single-service mode: graph shows controllers as nodes (sized by endpoint count) instead of one lonely service node
- Multi-service mode: graph shows services as nodes with directed edges for detected calls
- Right panel: endpoint path, request body fields, response type, call chain tree with clickable nodes
- Search across service names, controller names, paths, and summaries
- Stats bar: services / controllers / endpoints / call chains / dependencies

**CLI**
- `--openapi-only` flag to skip source scanning and use legacy OpenAPI-only mode
- Four-step progress output: `[1/4] Detecting... [2/4] OpenAPI... [3/4] Chains... [4/4] Output...`
- Version bumped to 0.2.0

**Example microservices**
- `examples/inventory-service` — Spring Boot with 6 endpoints, DTOs, RestTemplate outbound calls
- `examples/notification-service` — ASP.NET Core with 5 endpoints, IHttpClientFactory outbound calls
- `examples/analytics-service` — FastAPI with 5 endpoints, 4 Pydantic models, httpx async calls
- `examples/email-service` — Django REST with 6 endpoints (ViewSet + @api_view), DRF serializers, requests calls

### Changed
- `CrossCtxOutput` extended with optional `codeScanResults` and `callChains` fields — fully backward compatible
- Graph renderer now uses Cytoscape.js instead of D3.js for better layout and interaction
- Sidebar tree now has three levels (service → controller → endpoint) instead of two

### Fixed
- Java `@RequestMapping` prefix extraction now uses brace-depth tracking to avoid matching class-level annotations inside method bodies (prevented path doubling like `/api/orders/api/orders`)
- Java/C# method body scoping — outbound calls are now attributed to the exact method they appear in, not the first handler in the file
- C# duplicate outbound call detection — interpolated strings are matched first (most specific pattern) before plain HttpClient patterns
- Python `.env` files now loaded with `dot: true` so fast-glob finds dotfiles
- Python URL hint extraction is two-pass: `.env` files first (actual values), Python source files second (prevents `os.getenv` key references from shadowing `.env` values)
- Python f-string and string concat URL patterns now resolved correctly in the call chain resolver

---

## [0.1.0] - 2026-04-10

### Added
- Initial MVP release
- Recursive scanning for OpenAPI/Swagger files (.json, .yaml, .yml)
- OpenAPI 3.x and Swagger 2.x spec parsing
- Service discovery with endpoint extraction
- Basic dependency detection via server URL hostname matching
- JSON output (LLM-friendly, token-efficient)
- Markdown output (`--markdown`) — LLM-optimized summary with endpoints table and schemas
- Interactive HTML dependency graph (`--graph`) — D3.js visualization
- CLI interface with configurable output path
- Unit tests for scanner, parser, analyzer, and renderer (Vitest)
