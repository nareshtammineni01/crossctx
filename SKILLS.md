# SKILLS.md — CrossCtx Contributor & AI Guide

> This file is the single source of truth for anyone (human or LLM) working on CrossCtx.
> Read this before touching any code.

---

## What Is CrossCtx?

CrossCtx is an **open-source CLI tool** that scans microservice source code and generates
cross-service API dependency maps in JSON, Markdown, and interactive HTML.

- **Primary use case:** Give developers and AI tools a complete, token-efficient picture of
  how services talk to each other — without manual documentation.
- **npm:** `crossctx` · **GitHub:** https://github.com/nareshtammineni01/crossctx
- **Current version:** 0.3.0 (released)
- **Next milestone:** v1.0 — Production Ready

---

## Tech Stack

| Layer       | Tool                          |
|-------------|-------------------------------|
| Language    | TypeScript (ESM, strict)      |
| CLI         | Commander                     |
| Bundler     | tsup                          |
| Testing     | Vitest                        |
| Linting     | ESLint + @typescript-eslint   |
| Formatting  | Prettier                      |
| Glob        | fast-glob                     |
| YAML        | js-yaml                       |
| Node        | ≥18                           |

---

## Pipeline Architecture

Every scan flows through these stages in order:

```
Scanner → Parser → Analyzer → Renderer
```

- **Scanner** (`src/scanner/`) — discovers service roots and files (including `--monorepo`)
- **Parser** (`src/parsers/`) — extracts endpoints and outbound calls per language/protocol
- **Analyzer** (`src/analyzer/`) — resolves cross-service edges (5-strategy resolver + confidence scoring)
- **Renderer** (`src/renderers/`) — outputs JSON / Markdown / HTML graph
- **CLI entry** (`src/bin/cli.ts`) — wires the pipeline, handles all flags

New features plug into this pipeline. gRPC and GraphQL flow through the same resolver as HTTP.
DB usage and shared-lib detection run as post-pass analyses after all services are scanned.

---

## Supported Languages & Protocols

| Language / Framework          | Status |
|-------------------------------|--------|
| TypeScript / NestJS / Express | ✅     |
| Java / Spring Boot            | ✅     |
| C# / ASP.NET                  | ✅     |
| Python / FastAPI / Django     | ✅     |
| Go / Gin / Chi                | ✅     |
| gRPC (`.proto` files)         | ✅     |
| GraphQL (schema files)        | ✅     |
| Message queues (Kafka, SQS…)  | ✅     |
| DB usage (SQL/Mongo/Redis…)   | ✅     |

---

## What Is Done (v0.1 – v0.3)

See ROADMAP.md for the full list. Summary:

- OpenAPI/Swagger parsing (JSON + YAML, v2 + v3)
- Source code parsing for all 5 languages above
- gRPC `.proto` parser + outbound call detection
- GraphQL schema parser + outbound call detection
- DB usage detection (`dbUsage` on `CodeScanResult`)
- Shared library detection (`sharedLibraries` on `CrossCtxOutput`)
- Monorepo discovery (`--monorepo` flag)
- Cross-service call chain resolution (confidence scoring)
- Breaking change detection (`--diff`)
- Watch mode (`--watch`)
- Interactive HTML graph with confidence slider + service filter
- `crossctx init` config scaffold
- Config file support (`.crossctxrc.json`)

---

## What Is Pending (v1.0 Goals)

These are the active priorities — work on these unless told otherwise:

1. **Stable JSON output schema** — formal versioning + migration guide
2. **Full test coverage** — all language parsers need unit tests in `tests/`
3. **90%+ extraction accuracy benchmark** — public test suite in `examples/`
4. **Performance benchmarks** — measure scan time, document in README
5. **Plugin / analyzer interface** — allow community parsers without forking
6. **`crossctx diff` subcommand** — human-readable breaking change report
7. **Docker image** — for CI use without a Node.js install
8. **Documentation site** — likely GitHub Pages from `docs/`

---

## Quality Gates — Run These After Every Change

```bash
npm run build          # must succeed (tsup, no type errors)
npm run lint           # zero ESLint errors (warnings OK if pre-existing)
npm test               # all Vitest tests green
npm run format:check   # Prettier check must pass (fix with npm run format)
```

If any of these fail, **do not proceed**. Fix the failure before continuing.

Additional checks to consider:
- `npm run lint:fix` — auto-fix lint issues before committing
- `npm run test:watch` — use during active development for fast feedback

---

## Coding Standards

- **TypeScript strict mode** — no `any`, no `@ts-ignore` without a comment explaining why
- **ESM modules** — all imports use `.js` extension (TypeScript ESM convention)
- **Clean interfaces** — each pipeline stage has a typed input/output interface; keep them stable
- **No cross-stage leakage** — Scanner doesn't parse, Parser doesn't resolve, Analyzer doesn't render
- **Additive changes** — new parsers/languages extend existing interfaces, never break them
- **Test every parser** — each new language or protocol parser needs a corresponding test fixture
- **Short outputs** — when generating CLI output, be token-efficient; output is often fed to LLMs
- **OSS-ready** — code should be readable by contributors who are new to the project

---

## File Structure (Key Paths)

```
src/
  bin/cli.ts          ← CLI entry point, pipeline wiring
  scanner/            ← file discovery, monorepo detection
  parsers/            ← one file per language/protocol
    grpc.ts           ← .proto parsing
    graphql.ts        ← GraphQL schema parsing
    db.ts             ← DB usage detection
    shared-libs.ts    ← shared library detection
  analyzer/           ← cross-service edge resolution
  renderers/          ← JSON / Markdown / HTML output
tests/                ← Vitest tests (mirror src/ structure)
examples/             ← sample multi-service repos for testing
docs/                 ← documentation site source
ROADMAP.md            ← what's done and what's next
CHANGELOG.md          ← version history
CONTRIBUTING.md       ← how to contribute
```

---

## When Asked to Do a Specific Task

1. Read this file first (you're doing that now ✓)
2. Check which pipeline stage is affected
3. Look at the relevant `src/` files — don't guess interfaces, read them
4. Make the change
5. Run the quality gates above
6. Keep the explanation short — summarize what was achieved, not every step

---

## Roadmap Priority Order

When no explicit task is given, work in this order:

1. Fix any failing quality gates
2. Add missing test coverage for existing parsers
3. Work toward v1.0 goals (listed above, in order)
4. Improve documentation

---

## What Not to Do

- Don't add new dependencies without checking if the existing stack already covers it
- Don't change the `CrossCtxOutput` or `CodeScanResult` interfaces without updating all callers
- Don't write `console.log` debug statements in `src/` — use the CLI's existing logger
- Don't skip the quality gates — they exist to protect the OSS reputation of the project
- Don't over-engineer — CrossCtx ships fast and iterates; clean and working beats clever
