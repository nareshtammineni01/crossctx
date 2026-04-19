# How CrossCtx Differs From Existing Tools

CrossCtx occupies a specific niche: **static analysis of microservice source code to produce an architecture map**. Here's how it compares to the tools you might already be using.

---

## vs. Swagger UI / OpenAPI Viewers

**Swagger UI** renders a single service's API documentation from an OpenAPI spec. It's excellent for exploring endpoints and testing individual calls.

**CrossCtx is different because:**
- It works across multiple services simultaneously
- It doesn't require an OpenAPI spec — it reads source code directly
- It shows cross-service call relationships, not just endpoint definitions
- It traces call chains across service boundaries

If your team maintains OpenAPI specs, CrossCtx will use them to enrich its output. But it doesn't require them.

---

## vs. Service Meshes (Istio, Linkerd, Consul)

**Service meshes** observe actual network traffic between services at runtime. Istio's Kiali, for example, produces a live service graph based on real requests.

| | CrossCtx | Service Mesh |
|--|----------|-------------|
| Works locally (pre-deploy) | ✅ | ❌ |
| Requires Kubernetes | ❌ | Usually |
| Shows payload shapes | ✅ | ❌ |
| Based on actual traffic | ❌ | ✅ |
| Zero infrastructure setup | ✅ | ❌ |

CrossCtx and service meshes are complementary. Use CrossCtx for local development, architecture review, and LLM context. Use a service mesh for production observability.

---

## vs. APM / Distributed Tracing (Datadog, Jaeger, Zipkin)

**APM tools** capture request traces across services as they happen — you can see latency, errors, and the exact path a specific request took.

**CrossCtx is different because:**
- It runs before deployment — no instrumentation required
- It analyzes all code paths, not just paths taken by observed requests
- It shows payload shapes and endpoint definitions, not latency/error metrics
- It produces an architecture overview, not per-request traces

---

## vs. Architecture Diagramming Tools (Miro, Lucidchart, draw.io)

**Diagramming tools** produce beautiful, shareable architecture visuals — but they require someone to draw and maintain them by hand.

| | CrossCtx | Diagram Tools |
|--|----------|--------------|
| Generated from source code | ✅ | ❌ |
| Always up to date | ✅ (re-run it) | ❌ (manual upkeep) |
| Interactive (click, filter, search) | ✅ | Varies |
| Shows endpoint-level detail | ✅ | ❌ |
| Good for presentations | Functional | ✅ |

CrossCtx trades visual polish for accuracy and currency. The HTML graph is functional and interactive, not presentation-grade. For stakeholder decks, you'd still want a curated diagram tool.

---

## vs. GitHub Copilot / AI Code Assistants

**AI code assistants** help you write and understand code — but they don't have access to your full multi-service architecture unless you give it to them.

CrossCtx gives you the context block to paste into any LLM. It doesn't compete with AI assistants — it feeds them.

---

## vs. Custom Scripts / grep

Many teams already have some version of "grep for the endpoint path and see what calls it." CrossCtx formalizes and extends that approach:

- Multi-language (not just grepping your TypeScript)
- Confidence-scored resolution (not just string matching)
- Call chain walking (not just direct callers)
- Interactive graph output (not just terminal output)
- Payload shape extraction (not just call detection)

---

## Summary

| Capability | CrossCtx | Swagger UI | Service Mesh | APM | Diagram Tool |
|-----------|----------|-----------|--------------|-----|-------------|
| Multi-service dependency map | ✅ | ❌ | ✅ | ✅ | ✅ |
| Works from source code | ✅ | ✅ | ❌ | ❌ | ❌ |
| No spec required | ✅ | ❌ | ✅ | ✅ | ✅ |
| Works locally pre-deploy | ✅ | ✅ | ❌ | ❌ | ✅ |
| Payload shape extraction | ✅ | ✅ | ❌ | ❌ | ❌ |
| LLM-optimized output | ✅ | ❌ | ❌ | ❌ | ❌ |
| Runtime traffic data | ❌ | ❌ | ✅ | ✅ | ❌ |
| Zero infrastructure | ✅ | ✅ | ❌ | ❌ | ✅ |

---

← [[Who CrossCtx Is For]] · [[Getting Started]] →
