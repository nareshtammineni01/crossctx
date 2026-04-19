# Interactive Dependency Graph

The `--graph` flag generates a single self-contained HTML file you can open in any browser — no server, no dependencies, no install.

```bash
crossctx ./services --graph
# → crossctx-graph.html

crossctx ./services --graph my-architecture.html
# → my-architecture.html
```

---

## Two View Modes

### Service View (default for multi-service scans)

Each **service** is a node. Node size reflects endpoint count. Directed edges represent detected cross-service calls. This is the high-level view — good for understanding which services depend on which.

### Controller View

Toggle with the **Services / Controllers** button in the header. Every **controller** across all services becomes its own node, color-coded by its parent service. Use this view when you need more granularity than the service level.

> **Single-service projects** automatically open in controller view — controllers are nodes, sized by endpoint count, so you can see the internal structure at a glance.

---

## The Sidebar

The left sidebar is a three-level tree:

```
▼ order-service                    [24 endpoints]
  ▶ ● OrderController               [8]
  ▶ ● OrderItemController           [6]
  ▶ ● OrderStatusController         [5]
  ▶ ● ShippingController            [5]
```

- Click a service to expand it and see its controllers
- Click a controller to expand it and see its endpoints
- Click any endpoint to open the detail panel

---

## The Detail Panel

Clicking an endpoint opens a panel on the right side of the graph showing:

- **Full path** — e.g. `POST /api/orders`
- **Request body** — field names and types extracted from the DTO/model
- **Response type** — return type annotation
- **Outbound calls** — which services and endpoints this handler calls, with confidence scores
- **Call chain tree** — the full dependency tree starting from this endpoint

---

## Call Chain Animation

For any endpoint that makes outbound calls:

1. Click the endpoint in the sidebar or on the graph
2. In the detail panel, click **▶ Animate**
3. Watch the call hops step through the graph one edge at a time — each hop highlights the edge and pauses briefly

This is useful for presentations and onboarding walkthroughs.

---

## Edge Tooltips

Hover over any edge in the graph to see:

- Source endpoint (method + path)
- Target endpoint (method + path, if resolved)
- Confidence score
- Detection strategy used (e.g. "hostname match", "env var template")

---

## Confidence Color Coding

Edges are colored by confidence score:

| Color | Score | Meaning |
|-------|-------|---------|
| Green | ≥ 0.90 | High confidence — named client or hostname match |
| Yellow | 0.70–0.89 | Medium — env var template match |
| Orange | 0.55–0.69 | Low — URL fragment or partial match |
| Gray | < 0.55 | Speculative — relative path only |

---

## Search

The search box in the header filters the graph in real time. Type a service name, controller name, or endpoint path. Non-matching nodes fade; matching nodes stay highlighted.

---

## Sharing the Graph

The generated file is fully self-contained — all CSS, JavaScript, and data are embedded inline. You can:

- Email it as an attachment
- Commit it to a repo and open via GitHub Pages
- Drop it in a shared drive or Notion page
- Host it anywhere that serves static files

No server or internet connection is needed to view it.

---

← [[What CrossCtx Does]] · [[AI Context Builder]] →
