# CrossCtx JSON Schema Migration Guide

CrossCtx emits a stable JSON schema starting with **v1.0**. The `meta.schemaVersion`
field in every output file tells you which version of the schema you are reading.

## Versioning policy

- **Patch versions** (1.0.x): bug fixes only — no shape changes.
- **Minor versions** (1.x.0): additive changes only — new optional fields, new enum values.
  Existing consumers are unaffected.
- **Major versions** (2.x.x): breaking shape changes. A migration guide section is added
  here for each major bump.

Check `meta.schemaVersion` before processing output programmatically:

```ts
import crossctxOutput from "./crossctx-output.json";

if (crossctxOutput.meta.schemaVersion !== "1.0") {
  throw new Error(`Unsupported schema version: ${crossctxOutput.meta.schemaVersion}`);
}
```

---

## Schema 1.0 (current) — released with crossctx v1.0.0

### New fields vs. pre-1.0 snapshots

| Field | Type | Notes |
|---|---|---|
| `meta.schemaVersion` | `string` | Always `"1.0"` in this release. **Required** for versioned consumers. |
| `meta.version` | `string` | crossctx tool version (semver). |
| `codeScanResults[].dbUsage` | `DbUsage[]` | Database tables/collections per service (added in v0.3). |
| `sharedLibraries` | `SharedLibrary[]` | Internal packages that cross service boundaries (added in v0.3). |
| `callChains` | `CallChain[]` | Full call-chain tree + edge list (added in v0.2). |

### Breaking changes vs. pre-release snapshots

Pre-1.0 output files did not include `meta.schemaVersion`. If you have tooling
that reads old output files, add a fallback:

```ts
const schemaVersion = output.meta.schemaVersion ?? "0.x";
```

---

## Future: Schema 2.0

No breaking changes are planned. This section will be populated when a 2.0 schema
is drafted.
