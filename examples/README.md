# CrossCtx Examples

This directory contains sample microservice projects you can use to try out CrossCtx.

## What's here

| Directory | Language / Framework | Description |
|-----------|---------------------|-------------|
| `user-service/` | OpenAPI spec | User management service (REST) |
| `order-service/` | OpenAPI spec | Order processing service (REST) |
| `go-order-service/` | Go / Gin + Chi | Order service written in Go |
| `payment-service/` | OpenAPI spec | Payment processing service |
| `inventory-service/` | OpenAPI spec | Inventory management service |
| `analytics-service/` | OpenAPI spec | Analytics/reporting service |
| `notification-service/` | OpenAPI spec | Notification dispatch service |
| `email-service/` | OpenAPI spec | Email delivery service |

---

## Quick start

### Option 1 — Scan with the config file (recommended)

A `.crossctxrc.json` is included in this directory. From the `examples/` folder:

```bash
cd examples
crossctx
```

This uses the config file to scan all services and generate JSON + HTML graph output.

### Option 2 — Pass paths directly

```bash
crossctx examples/user-service examples/order-service examples/payment-service
```

### Option 3 — Just the Go service (source code scan)

```bash
crossctx examples/go-order-service --format graph
```

---

## Output files

After running CrossCtx you'll find:

- `crossctx-output.json` — full dependency map (LLM-friendly JSON)
- `crossctx-graph.html` — interactive HTML graph (open in any browser)
- `crossctx-output.md` — human-readable Markdown summary

---

## Trying the config file

The included `.crossctxrc.json` demonstrates all config options:

```json
{
  "paths": ["./user-service", "./order-service", "./payment-service", "..."],
  "output": "crossctx-output.json",
  "format": "all",
  "minConfidence": 0
}
```

Run `crossctx init` in any directory to scaffold a fresh config for your own project.

---

## Adding your own services

Copy any of these directories as a starting point, or point CrossCtx at your own microservice repos:

```bash
crossctx ../my-service-a ../my-service-b ../my-service-c --format all
```

CrossCtx auto-detects TypeScript, Java, C#, Python, and Go — no config required.
