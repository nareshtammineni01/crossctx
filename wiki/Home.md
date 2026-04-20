# CrossCtx Wiki

> **Find hidden service dependencies instantly.**
> `npm install -g crossctx` · Open Source · MIT License · v2.1.0

CrossCtx scans your microservice source code — no OpenAPI spec required, no config, no agents running in your cluster — and generates an interactive dependency graph, architecture insights, blast-radius analysis, and LLM-ready context blocks.

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
npx crossctx scan ./user-service ./order-service ./payment-service
```

```
  🔍 CrossCtx Results
  ─────────────────────────────────────────────

  ✔ 3 services detected
  ✔ 22 endpoints mapped
  ✔ 8 cross-service calls found

  Top dependencies:
    - order-service → payment-service
    - order-service → user-service

  ⚠️  High fan-out:
    - order-service calls 3 services

  Next steps:
    crossctx graph        # open interactive dependency graph
    crossctx insights     # full architecture analysis
    crossctx blame <svc>  # impact analysis for a service
    crossctx export       # save JSON / Markdown
```

---

## At a Glance

| Command | What it does |
|---------|-------------|
| `crossctx scan` | Detect services, map endpoints, show plain-English summary |
| `crossctx graph` | Generate interactive HTML dependency graph |
| `crossctx insights` | Architecture analysis — circular deps, fan-out, hot services |
| `crossctx blame <svc>` | Blast radius: what breaks if this service goes down |
| `crossctx explain <endpoint>` | Clipboard-ready LLM context block for any endpoint |
| `crossctx trace <endpoint>` | ASCII call-chain tree |
| `crossctx export` | Save JSON / Markdown output files |
| `crossctx diff` | Compare two scans for breaking changes (CI-compatible) |

---

## License

MIT · [GitHub Repository](https://github.com/nareshtammineni01/crossctx)
