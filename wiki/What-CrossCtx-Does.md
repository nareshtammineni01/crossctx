# What CrossCtx Does

CrossCtx is a CLI tool that scans microservice directories and produces a live, accurate dependency map in one command. It follows a four-phase pipeline: detect → parse → resolve → render.

---

## The Four-Phase Pipeline

### Phase 1 — Detect

CrossCtx reads well-known config files (`package.json`, `pom.xml`, `go.mod`, `.csproj`, `requirements.txt`) to identify the language and framework of each project directory, along with a confidence score.

```
→ user-service (typescript/nestjs, confidence: 98%)
→ order-service (java/spring-boot, confidence: 97%)
→ inventory-service (python/fastapi, confidence: 95%)
→ notification-service (typescript/express, confidence: 92%)
```

Supported: TypeScript (NestJS, Express), Java (Spring Boot), C# (ASP.NET Core), Python (FastAPI, Django REST, Flask), Go (Gin, Chi).

### Phase 2 — Parse

Each detected language has a dedicated parser that reads the source code and extracts:

- **Endpoints** — HTTP method, path, controller prefix
- **Request body shapes** — field names and types from DTOs, Pydantic models, Java POJOs
- **Response types** — return type annotations and declarations
- **Outbound HTTP calls** — `axios.get()`, `RestTemplate.getForObject()`, `httpx.post()`, etc.
- **Service URL hints** — environment variables and constants that contain hostnames

No OpenAPI spec is required. The parsers work directly from source code.

### Phase 3 — Resolve

The resolver builds a **ServiceRegistry** — a set of lookup tables mapping hostnames, environment variable names, named clients, and URL path fragments to service names. It then resolves every outbound call using five strategies, in order of confidence:

| Strategy | Confidence | Example |
|----------|-----------|---------|
| Named client / FeignClient | 0.95 | `feign://order-service/api/orders` |
| Hostname from URL | 0.95 | `http://order-service:3000/api/orders` |
| Env var template string | 0.85 | `` `${this.orderServiceUrl}/api/orders` `` |
| URL fragment match | 0.60 | `/api/orders` → `order-service` |
| Relative path match | 0.55 | `/orders` matches known endpoint |

The output is a set of **call chains** — full dependency trees with confidence-scored edges, plus a flat `edges[]` list for graph rendering.

### Phase 4 — Render

Three output formats are generated from the resolved data:

| Format | Flag | File |
|--------|------|------|
| JSON | (always) | `crossctx-output.json` |
| Markdown | `--markdown` | `crossctx-output.md` |
| HTML graph | `--graph` | `crossctx-graph.html` |

---

## Example Run

```bash
crossctx ./user-service ./order-service ./inventory-service ./notification-service --graph
```

```
CrossCtx v0.2.0

[1/4] Detecting languages and scanning source code...
→ user-service (typescript/nestjs, confidence: 98%)
→ order-service (java/spring-boot, confidence: 97%)
→ inventory-service (python/fastapi, confidence: 95%)
→ notification-service (typescript/express, confidence: 92%)
Found 4 service(s), 36 endpoint(s)

[2/4] Scanning for OpenAPI/Swagger specs... Found 2 spec(s)
[3/4] Resolving call chains... Found 11 call chain(s)
[4/4] Building output...

Graph saved to: crossctx-graph.html
```

---

## Two Pipelines, One Output

CrossCtx actually runs two pipelines in sequence and merges their results:

**Pipeline A — Source Code**
Detector → Language Parser → Service Registry → Resolver → Call Chains

**Pipeline B — OpenAPI (if specs exist)**
Scanner → Parser → Analyzer → Hostname cross-reference matching

OpenAPI specs, when present, enrich the source-code data with clean, authoritative metadata. When they don't exist, the source-code pipeline stands on its own.

---

## What the Output Contains

A complete `CrossCtxOutput` includes:

- A list of all detected services with their language/framework
- Every endpoint — method, path, request body fields, response type
- Every outbound call — target service, target endpoint (when resolved), confidence score
- Full call chains — both tree structures and flat edge lists
- Message queue events (Kafka, RabbitMQ, SQS, Redis pub/sub, NATS) — when detected

See [[Output Formats]] for the full schema and examples.

---

← [[The Problem CrossCtx Solves]] · [[Interactive Dependency Graph]] →
