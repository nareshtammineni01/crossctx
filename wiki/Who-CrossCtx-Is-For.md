# Who CrossCtx Is For

CrossCtx is built for teams and individuals who work with microservice architectures — whether as developers, architects, or on-call engineers.

---

## Backend Engineers

**The scenario:** You're tasked with changing the `POST /api/orders` endpoint to make a previously optional field required. Before you can estimate the impact, you need to know which services call this endpoint.

Without CrossCtx, you search the codebase, grep for the endpoint path, check which services have HTTP clients pointing at `order-service`, and try to piece together the full blast radius. With multiple services and a mixture of languages, this takes an hour or more.

With CrossCtx, you run one command and get a complete list of callers with their endpoint paths and payload shapes — in under a minute.

**Common uses:**
- Impact analysis before breaking changes
- Debugging cross-service failures ("which service is causing this 500?")
- Understanding an unfamiliar service's dependencies before modifying it

---

## Platform / DevOps Engineers

**The scenario:** You maintain the infrastructure for 20+ microservices. When an incident occurs, you need to trace the call path from the user-facing API down to the failing database call — across services you didn't write.

CrossCtx produces an always-current architecture map that complements your observability stack. Unlike runtime traffic analysis tools (Jaeger, Datadog APM), it works locally before deployment and shows you payload shapes, not just trace spans.

**Common uses:**
- On-call preparation — understand the architecture before the alert fires
- Dependency audits — find services with high fan-out or circular dependencies
- Incident post-mortems — reconstruct the call chain from static analysis

---

## Engineering Managers and Tech Leads

**The scenario:** You're onboarding three new engineers. Your architecture has grown to 15 services across four languages, and the last architecture diagram was drawn 18 months ago.

CrossCtx generates a current, interactive dependency map that new hires can explore on day one — without asking senior engineers to explain the whole architecture from memory.

**Common uses:**
- Onboarding documentation that doesn't go stale
- Architecture reviews and planning sessions
- Communicating architecture to non-technical stakeholders (share the HTML file)

---

## AI-Assisted Developers

**The scenario:** You want to ask Claude or ChatGPT to help you debug a cross-service issue or generate client code for a service you don't own. But first you have to assemble the context — copying endpoints, DTOs, and call relationships from multiple codebases.

CrossCtx assembles that context for you in one command. The `--markdown` output is designed to be pasted directly into an LLM prompt.

**Common uses:**
- "Debug this cross-service failure" prompts with full architecture context
- "Generate a TypeScript client for this service" with complete endpoint definitions
- "Review this architecture for circular dependencies" with the full call graph

See [[AI Context Builder]] for example prompts and tips.

---

## Open Source Contributors

CrossCtx itself welcomes contributors. If you work with a language or framework not yet supported (Ruby on Rails, Rust, PHP/Laravel), you can add a parser following the documented extension points.

See [[Contributing]] for how to get started.

---

## Not a Good Fit For

- **Runtime observability** — CrossCtx is a static analysis tool. It doesn't observe actual traffic, latency, or error rates. Use Datadog, Jaeger, or Grafana for that.
- **Simple single-service apps** — if you have one service, CrossCtx still works but the controller view is probably all you need.
- **Teams without source code access** — CrossCtx scans directories, so you need the code locally or in a CI environment.

---

← [[Output Formats]] · [[How CrossCtx Differs From Existing Tools]] →
