# The Problem CrossCtx Solves

Modern microservice architectures grow faster than their documentation.

A new developer joining a team with 10+ services spends their first two weeks just figuring out what calls what. An incident happens at 2am and the on-call engineer has to trace a chain of HTTP calls across five services in their head. A team wants to ask their AI assistant to help debug a cross-service bug — but first has to spend 20 minutes manually pasting context.

> **"Understanding a large microservice codebase is broken. No tool generates a live, accurate picture of your architecture from source code — without requiring you to maintain specs, diagrams, or wikis by hand."**

---

## Why Existing Approaches Fall Short

### Manual Architecture Diagrams

Tools like Miro, Lucidchart, and draw.io produce beautiful diagrams — but they're frozen the moment you save them. The next time a team adds a new service call, the diagram is already wrong. Keeping diagrams in sync with code requires dedicated effort that most teams deprioritize once a deadline looms.

### OpenAPI / Swagger Specs

Specs are valuable when they exist and are kept up to date. In practice:
- Many outbound HTTP calls are never documented in any spec
- Specs describe a service's own endpoints, not what it calls
- Teams often have 2–3 services with specs and 10+ without

### Service Meshes (Istio, Linkerd, Consul)

Runtime traffic analysis tools observe actual network calls — but only in deployed environments. They don't work locally, don't show payload shapes, and can't answer "what would happen if I change this endpoint?" before the change ships.

### Reading the Code Manually

For small teams with 3–5 services and deep familiarity with the codebase, reading the code is fine. At 10+ services, with multiple contributors and a growing call graph, it doesn't scale. New hires, on-call engineers covering unfamiliar services, and anyone debugging cross-service issues all pay a steep ramp-up cost.

---

## The Three Pain Points CrossCtx Targets

**1. Onboarding**
New developers need a mental model of the architecture before they can be productive. Without tooling, this means reading dozens of service codebases, asking senior engineers, and hoping the README is current. CrossCtx produces a single interactive map they can explore on day one.

**2. Incident Response**
When something breaks at 2am, the on-call engineer needs to trace a call chain fast. Manually following HTTP calls across five service codebases under pressure is slow and error-prone. An always-current dependency graph makes it possible to trace the path from symptom to root cause in seconds.

**3. LLM-Assisted Development**
AI assistants are most useful when they have full context. For cross-service bugs, a developer typically spends more time assembling context to paste into ChatGPT or Claude than getting the actual answer. CrossCtx generates a structured, token-efficient context block that can be pasted directly into any LLM — covering services, endpoints, payload shapes, and call chains in one shot.

---

## What CrossCtx Does Instead

CrossCtx solves all three by scanning your actual source code:

- No spec maintenance required — it reads controllers, decorators, and HTTP clients directly
- No deployed environment needed — runs locally against any directory
- No configuration — language and framework are detected automatically
- Always current — re-run it any time to get an up-to-date picture

The output is a single-file interactive graph, a JSON file for programmatic use, and a Markdown summary optimized for LLM consumption.

---

← [[Home]] · [[What CrossCtx Does]] →
