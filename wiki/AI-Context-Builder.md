# AI Context Builder

One of CrossCtx's primary design goals is LLM-optimized output. The JSON and Markdown outputs are structured so you can paste them directly into any AI assistant — Claude, ChatGPT, Gemini, Copilot — and immediately ask architecture-level questions without spending time assembling context.

---

## The Problem with Manual Context

Asking an LLM to help debug a cross-service issue typically looks like this:

1. Open the first service's README
2. Copy-paste the relevant controller
3. Open the second service
4. Copy-paste the client code
5. Try to remember what the DTO looks like
6. Paste everything in and explain the relationship

That's 10–20 minutes of assembly before you get any help. And the pasted context is usually incomplete — missing the full call chain, or the payload shape, or the dependent service's endpoint signature.

---

## The CrossCtx Approach

Run one command and get a single context block covering your entire architecture:

```bash
crossctx ./user-service ./order-service ./payment-service --markdown
```

The resulting `crossctx-output.md` contains:

- All services with their detected language and framework
- Every endpoint — method, path, request fields, response type
- Every resolved cross-service call with its confidence score
- Full call chain trees starting from each entry point

Paste the whole file (or the relevant sections) into your LLM prompt.

---

## Example Prompts That Work Well

Once you've pasted the CrossCtx output, you can ask:

**Debugging**
> "The `/api/checkout` endpoint is returning a 500. Based on the call chain, which downstream services could be the source of the error?"

**Impact analysis**
> "I'm changing the `POST /api/users` request body to make `phone` required. Which services call this endpoint and will be affected?"

**Onboarding**
> "Explain the flow for placing an order from the user-facing API through to the payment and inventory services."

**Code generation**
> "Generate a TypeScript client for the `order-service` API based on these endpoint definitions."

**Architecture review**
> "Are there any circular dependencies in this call graph? Which service has the highest fan-out?"

---

## JSON Format for Programmatic Use

The JSON output (`crossctx-output.json`) is designed for programmatic consumption — feeding into scripts, CI pipelines, or custom LLM tooling:

```json
{
  "codeScanResults": [
    {
      "serviceName": "order-service",
      "language": { "language": "java", "framework": "spring-boot" },
      "endpoints": [
        {
          "method": "POST",
          "path": "/api/orders",
          "requestBody": {
            "typeName": "CreateOrderRequest",
            "fields": [
              { "name": "userId", "type": "String" },
              { "name": "items", "type": "List<OrderItem>" }
            ]
          },
          "outboundCalls": [
            {
              "url": "${userServiceUrl}/api/users/${userId}",
              "method": "GET",
              "resolvedService": "user-service",
              "resolvedEndpoint": "GET /api/users/{id}",
              "confidence": 0.85
            }
          ]
        }
      ]
    }
  ],
  "callChains": [
    {
      "rootService": "order-service",
      "rootEndpoint": "POST /api/orders",
      "edges": [
        {
          "from": "order-service:POST /api/orders",
          "to": "user-service:GET /api/users/{id}",
          "confidence": 0.85
        }
      ]
    }
  ]
}
```

---

## Token Efficiency

The output is deliberately compact. A typical 10-service architecture with 100 endpoints fits comfortably in 8,000–12,000 tokens — well within the context window of all major LLMs.

Fields are omitted when empty (no `outboundCalls` key if there are none), and DTOs are de-duplicated across endpoints.

---

## Tips for Best Results

- **Use the full JSON** for complex multi-service questions — it has more structure than Markdown
- **Use the Markdown** for quick questions or when pasting into chat interfaces
- **Include only the relevant services** if token budget is tight — CrossCtx only scans the directories you specify
- **Regenerate before asking** — the output is only as current as the last scan

---

← [[Interactive Dependency Graph]] · [[Language and Framework Support]] →
