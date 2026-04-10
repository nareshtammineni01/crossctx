# I built a CLI to help AI understand your microservices

If you've ever tried to explain your microservice architecture to an LLM, you know the pain. You end up manually typing out service names, endpoints, who calls what — and the LLM still gets confused.

I built **CrossCtx** to fix this.

## The problem

Microservice architectures are hard for humans to reason about. They're even harder for AI. Documentation goes stale. New developers join and have no idea what calls what. And when you ask an LLM to help debug a cross-service issue, you spend more time explaining the architecture than getting actual help.

## The solution

CrossCtx is a CLI that scans your OpenAPI/Swagger specs and generates a clean dependency map — in one command:

```bash
npx crossctx ./service1 ./service2 ./service3
```

It produces:

- **JSON output** — token-efficient, structured for LLM consumption
- **Markdown output** — paste directly into a prompt
- **Interactive HTML graph** — D3.js visualization you can open in any browser

## How it works

CrossCtx follows a simple pipeline:

1. **Scan** — recursively find OpenAPI/Swagger files across your repos
2. **Parse** — extract services, endpoints, request/response schemas
3. **Analyze** — detect inter-service dependencies by matching hostnames and URL references
4. **Render** — output in JSON, Markdown, or interactive HTML

No runtime dependencies. No AST parsing. No complex setup. Just point it at your service directories and go.

## Example output

Given three microservices (user, order, payment), CrossCtx finds that the order service depends on both user and payment — automatically detected from server URLs referenced in the OpenAPI specs:

```
  Services found: 3
    • user-service (3 endpoints) [3.0.3]
    • order-service (3 endpoints) [3.0.3]
    • payment-service (3 endpoints) [3.0.3]

  Dependencies: 2
    order-service → user-service
    order-service → payment-service
```

The JSON output is designed to be pasted directly into an LLM prompt. It's compact, structured, and gives the AI everything it needs to understand your architecture.

## Why I built this

I was tired of manually describing my service architecture every time I wanted AI help with cross-service debugging. I figured: the information is already in the OpenAPI specs. Why not extract it automatically?

CrossCtx started as a weekend project and turned into something I use daily. I'm open-sourcing it because I think every team working with microservices needs this.

## What's next

The current version handles OpenAPI/Swagger specs. The roadmap includes:

- Source code parsing (AST) for Express, FastAPI, Spring Boot
- GraphQL and gRPC support
- Message queue detection (Kafka, RabbitMQ)
- CI/CD integration to detect breaking changes in PRs
- GitHub Action

## Try it

```bash
npx crossctx ./your-services --markdown --graph
```

GitHub: https://github.com/nareshtammineni01/crossctx

If this saves you time, drop a star. Contributions welcome.

---

*CrossCtx is MIT licensed and works with Node.js 18+.*
