# Roadmap

This page tracks what's shipped, what's actively in progress, and where CrossCtx is headed. See the [full ROADMAP.md](../ROADMAP.md) in the repo for details.

---

## v0.1 — Foundation ✅ Released

- OpenAPI / Swagger spec scanning, multi-repo scanning, JSON + Markdown + HTML graph output, source code parsing for TypeScript/Java/C#/Python/Go, 5-strategy call-chain resolver, `--diff`, `--watch`

## v0.2 — Developer Experience ✅ Released

- Graph toolbar (confidence slider, service filter chips), `--format` flag, `crossctx init`, config file support, improved Java/C# DTO extraction, `--min-confidence`, examples directory

## v0.3 — Accuracy + Coverage ✅ Released

- gRPC and GraphQL support, improved Python/Go parsers, DB usage detection, shared library detection, monorepo discovery (`--monorepo`)

## v1.0 — Production Ready ✅ Released

- Stable JSON schema (`meta.schemaVersion`), plugin interface, `crossctx diff` subcommand, Docker image, full test suite, performance benchmarks

---

## v2.0 — Static Architecture Intelligence ✅ Released

Major relaunch. New CLI, new category.

- `crossctx scan` as primary entry point with plain-English hook summary
- Architecture insights layer — circular deps, high fan-out/fan-in, tight coupling, unresolved calls
- `crossctx insights` — CI-compatible (exits 1 on critical issues)
- `crossctx blame <ServiceName>` / `crossctx impact` — BFS blast radius analysis
- `crossctx explain <endpoint>` — clipboard LLM context builder
- `crossctx trace <endpoint>` — ASCII call-chain tree
- `crossctx graph` and `crossctx export` as explicit subcommands

---

## v2.1 — Bug Fixes ✅ Released

- Fixed `@typescript-eslint/no-unused-vars` lint error (`fileConfig` in root shorthand action)
- Version bumped to `2.1.0`

---

## v2.x — Next

- [ ] PR impact analysis GitHub Action
- [ ] VS Code extension — inline annotations
- [ ] Watch mode insights — auto re-run `insights` on file changes
- [ ] Payload extractor enrichment — cross-file DTO resolution, confidence scoring
- [ ] HTML graph polish — PNG/SVG export, depth visualization

---

## Long-Term — AI Layer

- **"Explain this codebase"** — feed scan output to an LLM for onboarding docs
- **"What breaks if I change this?"** — semantic impact analysis
- **"Where is this API called?"** — semantic call-site search
- **Anomaly detection** — flag unusual architecture patterns automatically

---

## How to Influence the Roadmap

- **Vote** on existing issues with 👍
- **Open a new issue** describing your use case
- **Submit a PR** — working code moves faster than discussion

---

← [[Getting Started]] · [[Contributing]] →
