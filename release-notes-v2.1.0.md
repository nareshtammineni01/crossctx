## What's Changed

### Bug Fix
- **Lint clean** — removed unused `fileConfig` variable assignment in the root shorthand command action (`src/bin/cli.ts`), resolving `@typescript-eslint/no-unused-vars` ESLint error. `loadConfig()` is still called so config loading is unaffected; the return value was simply not used since `runScan` reads config internally.

### Documentation
- **CHANGELOG** — added missing `[2.0.0]` entry documenting all v2.0 features; added `[2.1.0]` entry for this fix.
- **ROADMAP** — added v2.0 ✅ and v2.1 ✅ sections; added v2.x backlog (PR impact action, VS Code extension, watch mode insights, payload enrichment, graph polish).
- **Wiki** — updated `Home`, `Roadmap`, `Getting-Started`, and `What-CrossCtx-Does` pages to reflect v2.x command structure (`crossctx scan`, `crossctx graph`, `crossctx insights`, `crossctx blame`, `crossctx explain`, `crossctx export`).

---

## Upgrading from v2.0.0

Drop-in replacement — no API or CLI changes. Pull and rebuild:

```bash
npm install -g crossctx@2.1.0
```

---

## Full Changelog

[v2.0.0...v2.1.0](https://github.com/nareshtammineni01/crossctx/compare/v2.0.0...v2.1.0)
