# CrossCtx Wiki

> **AI-powered cross-service dependency mapping for microservices**
> `npm install -g crossctx` · Open Source · MIT License

CrossCtx scans your microservice source code — no OpenAPI spec required, no config, no agents — and generates an interactive dependency graph, structured JSON output, and a Markdown context block you can paste directly into any LLM.

---

## Wiki Pages

| Page | Description |
|------|-------------|
| [[The Problem CrossCtx Solves]] | Why static docs and manual diagrams don't scale |
| [[What CrossCtx Does]] | The four-phase pipeline and what it produces |
| [[Interactive Dependency Graph]] | Guide to the HTML graph — filters, animations, tooltips |
| [[AI Context Builder]] | Using crossctx output with LLMs |
| [[Language and Framework Support]] | TypeScript, Java, C#, Python, Go — what's parsed |
| [[Output Formats]] | JSON, Markdown, and HTML graph reference |
| [[Who CrossCtx Is For]] | Use cases and personas |
| [[How CrossCtx Differs From Existing Tools]] | Comparison with Swagger UI, service meshes, and diagram tools |
| [[Getting Started]] | Install, run, and understand your first scan |
| [[Roadmap]] | What's done, in progress, and coming next |
| [[Contributing]] | How to add a parser, fix bugs, and submit PRs |

---

## Quick Start

```bash
# Install globally
npm install -g crossctx

# Or run without installing
npx crossctx ./user-service ./order-service ./payment-service --graph
```

You get three output files with no configuration:

- `crossctx-output.json` — full structured data, LLM-optimized
- `crossctx-output.md` — human-readable summary
- `crossctx-graph.html` — interactive force-directed graph (open in any browser)

---

## At a Glance

```
$ crossctx ./user-service ./order-service ./inventory-service --graph

CrossCtx v0.2.0

[1/4] Detecting languages and scanning source code...
→ user-service (typescript/nestjs, confidence: 98%)
→ order-service (java/spring-boot, confidence: 97%)
→ inventory-service (python/fastapi, confidence: 95%)
Found 3 service(s), 28 endpoint(s)

[2/4] Scanning for OpenAPI/Swagger specs... Found 1 spec(s)
[3/4] Resolving call chains... Found 6 call chain(s)
[4/4] Building output...

Graph saved to: crossctx-graph.html
```

---

## License

MIT · [GitHub Repository](https://github.com/your-org/crossctx)
