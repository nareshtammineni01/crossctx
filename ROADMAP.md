# CrossCtx Roadmap

This document tracks what's been built, what's actively in progress, and where the project is headed. Feedback and contributions are welcome at any stage — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## v0.1 — Foundation ✅ Released

The working MVP. Proves the concept end-to-end.

- [x] OpenAPI / Swagger spec scanning (JSON + YAML, OpenAPI 3.x + Swagger 2.x)
- [x] Multi-repo scanning (pass multiple service directories in one command)
- [x] JSON output — token-efficient, LLM-friendly format
- [x] Markdown output (`--markdown`)
- [x] Interactive HTML dependency graph (`--graph`)
- [x] Hostname-based dependency detection from OpenAPI specs
- [x] TypeScript / NestJS / Express source code parsing
- [x] Java / Spring Boot source code parsing (RestTemplate, FeignClient)
- [x] C# / ASP.NET source code parsing (IHttpClientFactory)
- [x] Python / FastAPI / Django / Flask source code parsing
- [x] Go / Gin / Chi source code parsing
- [x] Message queue detection: Kafka, RabbitMQ, SQS, Redis pub/sub, NATS
- [x] Cross-service call chain resolution (5-strategy resolver with confidence scoring)
- [x] Call chain tree + edge graph output
- [x] Breaking change detection (`--diff`)
- [x] Watch mode (`--watch`) — auto-rescan on file changes
- [x] GitHub Actions CI
- [x] MIT License

---

## v0.2 — Developer Experience ✅ Complete

Focus: make the tool easier to adopt and contribute to.

- [x] Improve graph UI — confidence threshold slider + service filter chips (real-time, no rescan)
- [x] `--format` flag: `json` | `markdown` | `graph` | `all` (simplifies the current flag set; old `--markdown`/`--graph` remain as aliases)
- [x] Better error messages when a project path doesn't match any known language
- [x] `crossctx init` — scaffold a `.crossctxrc.json` config file for pinning paths and options
- [x] Config file support (`.crossctxrc.json` / `crossctx.config.json`) — avoid repeating CLI flags
- [x] Improve DTO/payload shape extraction accuracy for Java and C#
- [x] Add `--min-confidence <0-1>` flag to filter low-confidence edges from output
- [x] Published examples directory with sample multi-service repos for testing

---

## v0.3 — Accuracy + Coverage ✅ Complete

Focus: make the resolver smarter and cover more real-world patterns.

- [x] gRPC support — parse `.proto` files and detect service calls
- [x] GraphQL support — parse schema files and detect queries/mutations
- [x] Improve Python parser: FastAPI dependency injection, `httpx` async client
- [x] Improve Go parser: `net/http` standard library, `go-resty`, `grpc-go`
- [x] AST-based parsing mode (opt-in via `--ast` flag) for higher accuracy on complex code
- [x] Detect DB usage patterns — which service owns which table/collection
- [x] Detect shared libraries / internal packages that cross service boundaries
- [x] Support monorepo layouts (auto-discover service roots from a root directory)

---

## v1.0 — Production Ready ✅ Released

Focus: reliability, completeness, and trust.

- [x] Stable JSON output schema with formal versioning + migration guides (`docs/schema-migration.md`)
- [x] 90%+ endpoint extraction accuracy benchmark across a public test suite
- [x] Full test coverage across all language parsers (Go, gRPC, GraphQL, DB, shared-libs, differ, plugins)
- [x] Performance benchmarks published in README ("50 services, 800 files → ~12 seconds")
- [x] Plugin / analyzer interface — `LanguageParserPlugin`, dynamic loading via `plugins` in config
- [x] `crossctx diff` subcommand with human-readable breaking change report (`--format human|json`)
- [x] Docker image for CI use without Node.js install (`Dockerfile` + `docs/docker-ci.md`)
- [ ] Documentation site (tracked as v1.1 work)

---

## v2.0 — Static Architecture Intelligence ✅ Released

Major relaunch. New CLI design, new positioning, architecture insights layer.

- [x] Redesigned CLI — `crossctx scan` as primary entry point with plain-English hook summary
- [x] Architecture insights layer (`src/analyzer/insights.ts`) — circular deps, high fan-out, fan-in, tight coupling, unresolved calls, isolated services
- [x] `crossctx insights` subcommand — exits code 1 on critical issues (CI-compatible)
- [x] `crossctx blame <ServiceName>` / `crossctx impact` — BFS blast radius analysis
- [x] `crossctx explain <endpoint>` — clipboard-ready LLM context builder
- [x] `crossctx trace <endpoint>` — ASCII call-chain tree visualizer
- [x] `crossctx graph` and `crossctx export` as explicit subcommands with `--input` support
- [x] README rewritten with "Find hidden service dependencies instantly" positioning

---

## v2.1 — Bug Fixes ✅ Released

Lint clean, stable v2.0 CLI.

- [x] Fixed unused `fileConfig` variable lint error in root shorthand command action
- [x] Version bumped to `2.1.0`

---

## v2.x — Next

- [ ] PR impact analysis GitHub Action — comments "this PR affects N services and M APIs"
- [ ] VS Code extension — inline annotations showing which services call a given endpoint
- [ ] Watch mode insights — re-run `insights` automatically on file changes
- [ ] Payload extractor enrichment — cross-file DTO resolution, confidence scoring
- [ ] HTML graph polish — depth visualization, language color bands, PNG/SVG export

---

## v1.x and Beyond — AI Layer

This is the long-term direction. The structured output CrossCtx produces is the foundation for LLM-powered features.

- [ ] **"Explain this codebase"** — feed `crossctx-output.json` to an LLM to generate onboarding docs
- [ ] **"What breaks if I change this?"** — impact analysis from a specific endpoint or service
- [ ] **"Where is this API called?"** — semantic search across all call chains
- [ ] **PR impact analysis** — GitHub Action that comments "this PR affects 3 services and 2 APIs"
- [ ] **Anomaly detection** — flag services with unusually high fan-out, circular dependencies, or unresolved calls
- [ ] **VS Code extension** — inline annotations showing which services call a given endpoint

---

## Not on the Roadmap (Yet)

These are intentionally deferred to keep scope tight:

- SaaS / hosted version
- Real-time / streaming analysis
- Runtime traffic analysis (as opposed to static code analysis)
- Support for languages beyond TypeScript, Java, C#, Python, Go

If you want to see any of these, open an issue and start a discussion — community signal shapes priorities.

---

## How to Influence the Roadmap

- **Vote** on existing issues with 👍
- **Open a new issue** describing your use case — concrete examples are more actionable than feature requests in the abstract
- **Submit a PR** — working code moves faster than discussion
