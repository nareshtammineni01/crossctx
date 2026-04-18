# I built a CLI that maps your microservice architecture from source code

If you've ever tried to explain your microservice architecture to an LLM, you know the pain. You end up manually typing out service names, endpoints, who calls what — and the LLM still gets confused halfway through.

I built **CrossCtx** to fix this. And v0.2 is a much bigger leap than I expected.

## The original problem

Microservice architectures are hard for humans to reason about. They're even harder for AI. Documentation goes stale. New developers join and have no idea what calls what. And when you ask an LLM to help debug a cross-service issue, you spend more time explaining the architecture than getting actual help.

The v0.1 answer was: scan your OpenAPI specs and build a dependency map. It worked, but it had a fundamental weakness — most teams don't keep their OpenAPI specs up to date, or don't have them at all.

## v0.2: read the source code directly

The new version doesn't need OpenAPI specs. It reads your actual controllers.

```bash
npx crossctx ./order-service ./payment-service ./user-service ./inventory-service -g deps.html
```

```
  [1/4] Detecting languages and scanning source code...
  → order-service (java/spring-boot, confidence: 97%)
  → payment-service (csharp/aspnet, confidence: 97%)
  → user-service (python/fastapi, confidence: 95%)
  → inventory-service (java/spring-boot, confidence: 97%)
  Found 4 service(s), 48 endpoint(s)

  [3/4] Resolving call chains...
  Found 12 call chain(s)
```

Point it at project folders. It figures out the language and framework automatically, parses the controllers and routes, detects every outbound HTTP call, resolves which service it's calling, and builds the full dependency chain.

## Language support

CrossCtx now handles four languages across six frameworks:

- **TypeScript** — NestJS decorators (`@Controller`, `@Get`, `@Body`), outbound detection via axios/fetch/HttpService
- **Java** — Spring Boot annotations (`@RestController`, `@GetMapping`), FeignClient interfaces, RestTemplate/WebClient
- **C#** — ASP.NET Core attributes (`[ApiController]`, `[HttpGet]`), IHttpClientFactory, Refit, RestSharp
- **Python** — FastAPI routers, Django REST ViewSets and `@api_view`, Flask routes, httpx/requests/aiohttp

For each endpoint it extracts the HTTP method, path, request body type with field names, and response type. For each outbound call it resolves the target service using a four-tier strategy: hostname matching → environment variable name heuristics → URL fragment matching → endpoint path matching.

## The graph got a lot better

The v0.1 graph was a basic D3.js force layout. v0.2 completely replaces it.

The new graph is a three-panel layout built on Cytoscape.js:

**Left sidebar** — a three-level tree: service → controller → endpoint. You can search across everything. Each controller group is collapsible with its own color and endpoint count.

**Center graph** — adaptive based on what you're looking at:
- Multiple services → nodes are services, edges are detected call chains, node size reflects endpoint count
- Single service → nodes are controllers, so instead of one lonely bubble you see the full internal structure of the service

**Right panel** — slides in when you click anything. Shows the full endpoint path, request body fields with types, response type, and the complete call chain tree you can click through.

## What I learned building it

**Regex over AST is a practical tradeoff.** I went back and forth on this. A full AST parser would be more accurate but adds massive complexity and language-specific dependencies. Regex with brace-depth tracking gets you 90% of the way there for standard patterns, which covers 90% of real codebases.

**Brace-depth scoping was the hardest part.** The first version of the Java parser was attributing outbound calls to the wrong methods — it would find a `RestTemplate.getForEntity()` call and assign it to the first `@GetMapping` handler in the file. The fix was tracking `{` and `}` characters to find the exact line range of each method body, then filtering calls to that range. Same problem appeared in C#.

**Python's `.env` files and fast-glob don't mix by default.** `fast-glob` ignores dotfiles unless you pass `dot: true`. Cost me 30 minutes.

**URL resolution across languages needs a unified strategy.** JS uses `${VAR}/path`, Python f-strings use `{VAR}/path`, and Python string concat uses `VAR + "/path"`. The resolver now handles all three. Getting this right is what makes the call chain detection actually work.

## Try it

```bash
npx crossctx ./your-services --graph
```

Open the generated HTML. No server, no signup, no config.

The repo includes example services in all four languages if you want to see it working before pointing it at your own code:

```bash
git clone https://github.com/nareshtammineni01/crossctx
cd crossctx
npm install && npm run build
node dist/bin/cli.js examples/inventory-service examples/notification-service \
  examples/analytics-service examples/email-service --graph
```

## What's next

The main thing missing is a **controller view toggle** for multi-service projects — a button that switches the graph from service nodes to controller nodes across all services, color-coded by service. That would give you the full topology in one view instead of having to drill into each service separately.

After that: Go and Ruby support, Kafka/RabbitMQ message queue detection, and a GitHub Action so the graph regenerates on every PR.

---

GitHub: https://github.com/nareshtammineni01/crossctx

MIT licensed. Node.js 18+. Contributions welcome.
