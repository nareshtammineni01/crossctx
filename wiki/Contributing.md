# Contributing

Thanks for your interest in contributing to CrossCtx! This page covers everything you need to get started — from fixing a typo to adding a full language parser.

---

## Quick Start

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/crossctx.git
cd crossctx

# 2. Install dependencies
npm install

# 3. Create a branch
git checkout -b feat/your-feature

# 4. Make your changes

# 5. Run tests
npm test

# 6. Submit a pull request
```

---

## Development Commands

```bash
npm run build     # compile TypeScript to dist/
npm test          # run all tests (Vitest)
npm run lint      # ESLint
npm run format    # Prettier

# Run against example services after building
node dist/bin/cli.js examples/inventory-service examples/notification-service --graph
```

---

## Project Structure

```
src/
├── bin/cli.ts          # CLI entry point — argument parsing and orchestration
├── detector/           # Language/framework detection
├── parsers/            # One file per language (typescript.ts, java.ts, etc.)
├── scanner/            # OpenAPI spec file discovery
├── parser/             # OpenAPI spec parsing
├── analyzer/           # Cross-service dependency analysis (OpenAPI pipeline)
├── resolver/           # Call chain resolution (source-code pipeline)
├── renderer/           # Output renderers: JSON, Markdown, HTML graph
├── differ/             # Breaking change detection
└── types/              # Shared TypeScript type definitions

tests/
├── scanner.test.ts     # OpenAPI scanner tests
├── parser.test.ts      # TypeScript parser tests
└── fixtures/           # Test fixture files
```

See [[Architecture Overview]] for a deep dive into how the pipelines work.

---

## What to Work On

Check the [GitHub Issues](https://github.com/your-org/crossctx/issues) page for:

- `good first issue` — well-scoped, self-contained, with clear acceptance criteria
- `help wanted` — issues the core team wants community help on
- `new-parser` — adding a new language parser

See the [Good First Issues doc](../docs/good-first-issues.md) for five pre-written issues with step-by-step instructions.

---

## Adding a New Language Parser

This is the most impactful type of contribution. Here's the complete process:

### Step 1 — Create the parser

Create `src/parsers/yourlang.ts` exporting a single function:

```typescript
import type { CodeScanResult, DetectedLanguage } from "../types/index.js";

export async function parseYourLangProject(
  projectPath: string,
  language: DetectedLanguage,
  serviceName: string
): Promise<CodeScanResult> {
  // 1. Glob source files
  // 2. Extract inbound endpoints (routes, controllers)
  // 3. Extract outbound HTTP calls
  // 4. Extract DTOs / payload shapes
  // 5. Extract service URL hints (env vars, config constants)

  return {
    projectPath,
    language,
    serviceName,
    endpoints,
    dtos,
    serviceUrlHints,
    hasOpenApiSpec: false,
  };
}
```

See `src/parsers/typescript.ts` for a well-commented reference implementation.

### Step 2 — Add language detection

In `src/detector/index.ts`, add a `checkYourLang()` function and insert it into the `detectLanguage()` priority list:

```typescript
async function checkYourLang(dir: string): Promise<DetectedLanguage | null> {
  const gemfile = path.join(dir, "Gemfile");
  if (!existsSync(gemfile)) return null;
  const content = readFileSync(gemfile, "utf-8");
  if (content.includes("rails")) {
    return { language: "ruby", framework: "rails", confidence: 0.97 };
  }
  return { language: "ruby", framework: "unknown", confidence: 0.80 };
}
```

### Step 3 — Wire up in the CLI

In `src/bin/cli.ts`, find the language dispatch block and add a branch:

```typescript
} else if (lang.language === "ruby") {
  const { parseRubyProject } = await import("../parsers/ruby.js");
  result = await parseRubyProject(dir, lang, serviceName);
}
```

### Step 4 — Add tests

Create `tests/your-lang-parser.test.ts` with fixture-based tests following the pattern in `tests/parser.test.ts`.

---

## Commit Convention

CrossCtx follows [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature or parser |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `refactor:` | Code change that neither fixes a bug nor adds a feature |
| `test:` | Adding or updating tests |
| `chore:` | Build, CI, dependency updates |

**Examples:**
```
feat: add Ruby on Rails parser
fix: resolve FeignClient URLs with query parameters
docs: update architecture diagram for v0.2 resolver
test: add fixture-based tests for Java Spring Boot parser
```

---

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Add tests for new functionality
- Update the relevant wiki page or README section if behavior changes
- Make sure `npm test`, `npm run lint`, and `npm run build` all pass
- Reference the issue number in the PR description: `Closes #42`

---

## Reporting Bugs

Open a GitHub Issue with:

1. **Steps to reproduce** — the exact command you ran and the service directory structure
2. **Expected behavior** — what you thought would happen
3. **Actual behavior** — what actually happened (include the full terminal output)
4. **Environment** — Node.js version (`node --version`), OS, CrossCtx version (`crossctx --version`)

---

## Code Style

- TypeScript strict mode enabled
- ESLint + Prettier — run `npm run lint` and `npm run format` before submitting
- Prefer `async/await` over raw Promises
- Keep parsers simple — regex over AST unless accuracy requires otherwise

---

## Architecture Overview

For contributors adding parsers, resolvers, or output formats, the [[Architecture Overview]] wiki page covers the full internal pipeline with data flow examples and extension points.

---

← [[Roadmap]] · [[Home]] →
