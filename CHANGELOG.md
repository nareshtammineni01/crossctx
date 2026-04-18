# Changelog

All notable changes to CrossCtx will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Controller view toggle in graph for multi-service projects
- Go and Ruby parser support
- Kafka/RabbitMQ message queue detection

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
