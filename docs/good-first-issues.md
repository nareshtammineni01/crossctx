# Good First Issues

Copy these directly into GitHub Issues. Each one is scoped, self-contained, and comes with enough context that a new contributor can get started without asking questions.

Label each with: `good first issue`, `help wanted`, and the relevant language/area label.

---

## Issue 1 — Add Ruby on Rails parser (language parser)

**Title:** `feat: add Ruby on Rails source code parser`

**Labels:** `good first issue`, `help wanted`, `new-parser`

**Body:**

CrossCtx currently parses TypeScript, Java, C#, Python, and Go. Ruby on Rails is widely used for microservices and would be a natural addition.

**What needs to be done:**

1. Create `src/parsers/ruby.ts` exporting:
   ```typescript
   export async function parseRubyProject(
     projectPath: string,
     language: DetectedLanguage,
     serviceName: string
   ): Promise<CodeScanResult>
   ```

2. Extract route definitions from `config/routes.rb` and controller files (`app/controllers/**/*.rb`):
   - `get '/users/:id', to: 'users#show'`
   - `resources :orders`
   - `namespace :api { resources :payments }`

3. Detect outbound HTTP calls using common Ruby HTTP clients:
   - `Net::HTTP`
   - `Faraday`
   - `HTTParty`
   - `RestClient`

4. Add detection logic to `src/detector/index.ts`:
   - Check for `Gemfile` with Rails → Ruby/Rails (confidence 0.97)
   - Check for `Gemfile` (any) → Ruby/unknown (confidence 0.80)

5. Wire up in `src/bin/cli.ts` — add `else if (lang.language === "ruby")` branch

6. Add tests in `tests/` following the pattern in `tests/scanner.test.ts`

**Reference:** See `src/parsers/typescript.ts` for a well-commented example of how a parser is structured. The [ARCHITECTURE.md](../ARCHITECTURE.md) section "Adding a New Language Parser" has a step-by-step guide.

**Estimated effort:** Medium (2–4 hours for someone familiar with Ruby)

---

## Issue 2 — Improve HTML graph: add service filter (UI)

**Title:** `feat: add service filter panel to HTML graph output`

**Labels:** `good first issue`, `help wanted`, `renderer`

**Body:**

The `--graph` output generates an interactive HTML file with a force-directed service dependency graph. Currently the graph shows all services and all edges at once, which gets hard to read for repos with 10+ services.

**What needs to be done:**

Add a collapsible filter panel to the right side of the graph (or a toolbar at the top) that lets users:
- Show / hide individual services by checking/unchecking a list
- Toggle edges below a confidence threshold (a slider from 0.0 to 1.0)

**Where to make the change:**

All graph rendering is in `src/renderer/graph.ts`. The HTML, CSS, and JS are all generated as a single self-contained string — no separate files. The current graph uses [vis.js](https://visjs.github.io/vis-network/docs/network/) for rendering.

**Acceptance criteria:**
- Filter panel is visible and functional in the generated HTML
- Filtering is client-side only (no server needed)
- The generated file remains a single self-contained `.html` file

**Estimated effort:** Small–Medium (2–3 hours for someone comfortable with vanilla JS/CSS)

---

## Issue 3 — Add `--min-confidence` CLI flag

**Title:** `feat: add --min-confidence flag to filter low-confidence edges`

**Labels:** `good first issue`, `help wanted`, `cli`

**Body:**

CrossCtx's resolver assigns a confidence score (0–1) to each resolved outbound call. Low-confidence resolutions (e.g. 0.55) can clutter the graph and JSON output with speculative edges. A `--min-confidence` flag would let users filter these out.

**What needs to be done:**

1. Add the flag to the CLI in `src/bin/cli.ts`:
   ```
   --min-confidence <number>   filter out call edges below this confidence (0-1, default: 0)
   ```

2. After call chains are built (`buildAllCallChains`), filter the `edges[]` on each `CallChain` to only include edges where `edge.confidence >= minConfidence`.

3. Also filter `OutboundCall[]` on each `SourceEndpoint` in `codeScanResults` — set `resolvedService` to `undefined` for calls that fall below the threshold.

4. Add a test in `tests/` that verifies edges are correctly filtered at a given threshold.

**Where to look:** `src/bin/cli.ts` for CLI flag wiring, `src/resolver/index.ts` for where edges are built, `src/types/index.ts` for `CallChainEdge.confidence`.

**Estimated effort:** Small (1–2 hours)

---

## Issue 4 — Add `crossctx init` command to generate a config file

**Title:** `feat: add crossctx init command to scaffold .crossctxrc.json`

**Labels:** `good first issue`, `help wanted`, `cli`, `dx`

**Body:**

Right now users have to remember and re-type all their CLI flags every time:
```
crossctx ./user-service ./order-service ./notification-service --graph --markdown -o output.json
```

A `crossctx init` command would let them run this once and store preferences in `.crossctxrc.json` at the project root.

**What needs to be done:**

1. Add a new `init` subcommand to `src/bin/cli.ts`:
   ```
   crossctx init
   ```

2. The command should interactively ask (using `readline` from Node stdlib):
   - "Which directories should be scanned? (space-separated)"
   - "Default output file? (default: crossctx-output.json)"
   - "Generate Markdown output by default? (y/n)"
   - "Generate HTML graph by default? (y/n)"

3. Write the answers to `.crossctxrc.json` in the current working directory.

4. Update the main `scan` command to read from `.crossctxrc.json` as defaults (CLI flags should still override).

5. Document the config file format in the README.

**Acceptance criteria:**
- `crossctx init` creates a valid `.crossctxrc.json`
- Running `crossctx` without arguments (but with a `.crossctxrc.json`) uses the stored paths
- CLI flags still override config file values

**Estimated effort:** Medium (2–3 hours)

---

## Issue 5 — Add test fixtures for Java/Spring Boot parser

**Title:** `test: add fixture-based tests for Java/Spring Boot parser`

**Labels:** `good first issue`, `help wanted`, `testing`, `java`

**Body:**

The TypeScript parser has solid test coverage in `tests/parser.test.ts`. The Java parser (`src/parsers/java.ts`) currently has no dedicated tests — this makes it risky to modify.

**What needs to be done:**

1. Create a test fixture directory: `tests/fixtures/java-spring-boot/` with minimal but realistic Java files:

   ```
   tests/fixtures/java-spring-boot/
   ├── pom.xml                          (minimal Spring Boot pom)
   ├── src/main/java/
   │   ├── UserController.java          (REST controller with @GetMapping, @PostMapping)
   │   ├── OrderServiceClient.java      (RestTemplate outbound calls)
   │   └── UserDto.java                 (DTO class)
   ```

2. Create `tests/java-parser.test.ts` with tests covering:
   - Endpoint extraction from `@RestController` + `@GetMapping` / `@PostMapping`
   - Controller prefix from `@RequestMapping` on the class
   - Outbound call detection via `RestTemplate.getForObject()`
   - FeignClient detection
   - DTO extraction from `@Data` / field declarations

3. Follow the existing test style in `tests/scanner.test.ts` and `tests/parser.test.ts`.

**Why this matters:** The Java parser handles Spring Boot — one of the most common enterprise microservice frameworks. Without tests, improvements risk regressions.

**Estimated effort:** Small–Medium (2–3 hours; Java knowledge helpful but not required since you're writing fixture files, not a real app)
