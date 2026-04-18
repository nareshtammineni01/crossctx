# Changelog

All notable changes to CrossCtx will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- GraphQL and gRPC detection
- Payload extractor enrichment (cross-file DTO resolution, confidence scoring)
- HTML report polish (depth visualization, language color bands, PNG/SVG export)
- Go and Ruby parser support
- Kafka/RabbitMQ message queue detection

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
