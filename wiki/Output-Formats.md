# Output Formats

CrossCtx generates up to three output files from a single scan. JSON is always produced; Markdown and HTML are opt-in.

---

## JSON (`crossctx-output.json`)

Always generated. The full structured output — designed to be machine-readable and LLM-friendly.

```bash
crossctx ./services                        # outputs crossctx-output.json
crossctx ./services -o my-output.json     # custom filename
```

### Schema Overview

```json
{
  "codeScanResults": [
    {
      "serviceName": "order-service",
      "language": {
        "language": "java",
        "framework": "spring-boot",
        "confidence": 0.97
      },
      "endpoints": [
        {
          "method": "POST",
          "path": "/api/orders",
          "controllerName": "OrderController",
          "requestBody": {
            "typeName": "CreateOrderRequest",
            "fields": [
              { "name": "userId",  "type": "String",           "required": true },
              { "name": "items",   "type": "List<OrderItem>",  "required": true },
              { "name": "coupon",  "type": "String",           "required": false }
            ]
          },
          "responseType": "OrderResponse",
          "outboundCalls": [
            {
              "url": "${userServiceUrl}/api/users/${userId}",
              "method": "GET",
              "resolvedService": "user-service",
              "resolvedEndpoint": "GET /api/users/{id}",
              "confidence": 0.85,
              "detectionStrategy": "env-var-template"
            }
          ]
        }
      ],
      "dtos": [...],
      "serviceUrlHints": [
        { "envKey": "USER_SERVICE_URL", "resolvedService": "user-service" }
      ]
    }
  ],
  "callChains": [
    {
      "rootService": "order-service",
      "rootEndpoint": "POST /api/orders",
      "tree": { ... },
      "edges": [
        {
          "from": "order-service:POST /api/orders",
          "to": "user-service:GET /api/users/{id}",
          "confidence": 0.85
        }
      ]
    }
  ],
  "openApiResults": [ ... ],
  "dependencies": [ ... ]
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `codeScanResults` | One entry per scanned service directory |
| `codeScanResults[].endpoints` | All detected inbound endpoints |
| `endpoints[].outboundCalls` | HTTP calls made from this endpoint handler |
| `outboundCalls[].confidence` | Resolution confidence score (0–1) |
| `outboundCalls[].detectionStrategy` | How the call was resolved |
| `callChains` | Full dependency trees from every entry-point endpoint |
| `callChains[].edges` | Flat list of edges for graph rendering |

---

## Markdown (`crossctx-output.md`)

Human-readable summary. Best for pasting into LLM prompts, Notion, Confluence, or README files.

```bash
crossctx ./services --markdown                       # outputs crossctx-output.md
crossctx ./services --markdown my-architecture.md   # custom filename
crossctx ./services -m                               # shorthand
```

### Example Output

```markdown
# CrossCtx Output

## Services

| Service | Language | Framework | Endpoints |
|---------|----------|-----------|-----------|
| order-service | java | spring-boot | 12 |
| user-service | typescript | nestjs | 8 |
| payment-service | csharp | aspnet | 6 |

## Endpoints

### order-service

**POST /api/orders**
- Request: `CreateOrderRequest` (userId: String, items: List<OrderItem>)
- Calls: `user-service GET /api/users/{id}` (confidence: 0.85)

...

## Dependencies

order-service → user-service (source-code, 3 calls)
order-service → payment-service (source-code, 1 call)
notification-service → order-service (source-code, 2 calls)
```

---

## HTML Graph (`crossctx-graph.html`)

An interactive, self-contained force-directed dependency graph. Open in any browser — no server or internet connection required.

```bash
crossctx ./services --graph                         # outputs crossctx-graph.html
crossctx ./services --graph my-architecture.html   # custom filename
crossctx ./services -g                              # shorthand
```

See [[Interactive Dependency Graph]] for a full guide to using the graph.

---

## Generating All Formats at Once

```bash
crossctx ./services --markdown --graph
```

This produces all three outputs in one pass — `crossctx-output.json`, `crossctx-output.md`, and `crossctx-graph.html`.

---

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
  --openapi-only           only scan OpenAPI/Swagger specs, skip source code
  -V, --version            output the version number
  -h, --help               display help
```

---

## Breaking Change Detection (`--diff`)

Compare two JSON outputs to detect breaking API changes:

```bash
crossctx ./services -o current.json
crossctx ./services --diff baseline.json
```

Breaking changes (removed endpoints, removed required fields, changed types) cause a non-zero exit code — useful in CI pipelines.

---

← [[Language and Framework Support]] · [[Who CrossCtx Is For]] →
