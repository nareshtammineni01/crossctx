# Roadmap

This page tracks what's shipped, what's actively in progress, and where CrossCtx is headed. See the [full ROADMAP.md](../ROADMAP.md) in the repo for details.

---

## v0.1 — Foundation ✅ Released

The working MVP. Proves the concept end-to-end.

- OpenAPI / Swagger spec scanning (JSON + YAML, OpenAPI 3.x + Swagger 2.x)
- Multi-repo scanning — pass multiple service directories in one command
- JSON output — token-efficient, LLM-friendly
- Markdown output (`--markdown`)
- Interactive HTML dependency graph (`--graph`)
- TypeScript / NestJS / Express source code parsing
- Java / Spring Boot source code parsing (RestTemplate, FeignClient)
- C# / ASP.NET source code parsing (IHttpClientFactory)
- Python / FastAPI / Django / Flask source code parsing
- Go / Gin / Chi source code parsing
- Message queue detection: Kafka, RabbitMQ, SQS, Redis pub/sub, NATS
- Cross-service call chain resolution (5-strategy resolver with confidence scoring)
- Breaking change detection (`--diff`)
- Watch mode (`--watch`) — auto-rescan on file changes
- GitHub Actions CI
- MIT License

---

## v0.2 — Developer Experience 🚧 In Progress

Focus: make the tool easier to adopt and contribute to.

- [ ] Improve graph UI — zoom, search, filter by service, toggle confidence threshold
- [ ] `--format` flag: `json | markdown | graph | all` — simplify the current flag set
- [ ] Better error messages when a project path doesn't match any known language
- [ ] `crossctx init` — scaffold a `.crossctxrc.json` config file
- [ ] Config file support — avoid repeating CLI flags on every run
- [ ] Improve DTO/payload shape extraction accuracy for Java and C#
- [ ] `--min-confidence` flag — filter low-confidence edges from output
- [ ] Published examples directory with sample multi-service repos

---

## v0.3 — Accuracy + Coverage

Focus: smarter resolver, more real-world patterns.

- [ ] gRPC support — parse `.proto` files and detect service calls
- [ ] GraphQL support — parse schema files and detect queries/mutations
- [ ] Improve Python parser: FastAPI dependency injection, `httpx` async client
- [ ] Improve Go parser: `net/http` standard library, `go-resty`, `grpc-go`
- [ ] AST-based parsing mode (opt-in) for higher accuracy on complex code
- [ ] Detect DB usage patterns — which service owns which table/collection
- [ ] Detect shared libraries / internal packages that cross service boundaries
- [ ] Support monorepo layouts — auto-discover service roots from a root directory

---

## v1.0 — Production Ready

Focus: reliability, completeness, and trust.

- [ ] Stable JSON output schema with formal versioning and migration guides
- [ ] 90%+ endpoint extraction accuracy benchmark across a public test suite
- [ ] Full test coverage across all language parsers
- [ ] Performance benchmarks published in README
- [ ] Plugin / analyzer interface — community-addable language parsers without forking
- [ ] `crossctx diff` subcommand with human-readable breaking change report
- [ ] Docker image for CI use without Node.js install
- [ ] Documentation site

---

## v1.x and Beyond — AI Layer

The long-term direction. The structured output CrossCtx produces is the foundation for LLM-powered features.

- **"Explain this codebase"** — feed `crossctx-output.json` to an LLM to generate onboarding docs
- **"What breaks if I change this?"** — impact analysis from a specific endpoint or service
- **"Where is this API called?"** — semantic search across all call chains
- **PR impact analysis** — GitHub Action that comments "this PR affects 3 services and 2 APIs"
- **Anomaly detection** — flag circular dependencies, unusually high fan-out, unresolved calls
- **VS Code extension** — inline annotations showing which services call a given endpoint

---

## How to Influence the Roadmap

- **Vote** on existing issues with 👍
- **Open a new issue** describing your use case — concrete examples are more actionable than abstract feature requests
- **Submit a PR** — working code moves faster than discussion

---

← [[Getting Started]] · [[Contributing]] →
