# Demo GIF Recording Script

This document describes what to record for the README demo GIF. The goal is a 20–30 second clip that shows the full value proposition in one continuous flow: drop in your services, get a dependency map.

**Recommended tools:** [Vhs](https://github.com/charmbracelet/vhs) (terminal GIF recorder, produces clean results) or [Asciinema](https://asciinema.org/) + convert to GIF. For a graphical GIF showing the HTML graph, use [Kap](https://getkap.co/) (macOS) or [Peek](https://github.com/phw/peek) (Linux).

---

## What to record

A two-part GIF works best:

### Part 1 — Terminal (15 seconds)

Show the scan running against a realistic example. Use the `examples/` directory or a small set of demo repos.

**Suggested terminal commands to record:**

```bash
# Clear the screen for a clean start
clear

# Run crossctx against 3 example services
crossctx ./examples/user-service ./examples/order-service ./examples/notification-service --graph --markdown

# The output should show:
#   CrossCtx v0.2.0
#
#   [1/4] Detecting languages and scanning source code...
#   → user-service (typescript/nestjs, confidence: 98%)
#   → order-service (java/spring-boot, confidence: 97%)
#   → notification-service (typescript/express, confidence: 92%)
#   Found 3 service(s), 24 endpoint(s)
#
#   [2/4] Scanning for OpenAPI/Swagger specs...
#   Found 2 OpenAPI spec(s)
#
#   [3/4] Resolving call chains...
#   Found 8 call chain(s)
#
#   [4/4] Building output...
#
#   ╔══════════════════════════════════════════╗
#   ║           CrossCtx Results               ║
#   ╚══════════════════════════════════════════╝
#
#     Services found: 3
#       • user-service (12 endpoints) [3.0.1]
#       • order-service (8 endpoints) [3.0.0]
#       • notification-service (4 endpoints) [2.0]
#
#     Dependencies: 5
#       order-service → user-service (source-code)
#       notification-service → order-service (source-code)
#       ...
#
#   JSON output: crossctx-output.json
```

**Tips for clean terminal recording:**
- Set your terminal to a dark theme (Dracula or One Dark look great in GIFs)
- Use a font size of 14–16px
- Set terminal width to 100 columns, height to 30 rows
- Type at normal speed — don't rush

---

### Part 2 — HTML Graph (10 seconds)

After the terminal recording, cut to a screen recording of `crossctx-graph.html` opening in a browser.

**What to show:**
1. Open `crossctx-graph.html` in Chrome/Firefox
2. Let the force-directed graph settle for 1–2 seconds
3. Hover over one of the edges to show the tooltip (endpoint + confidence)
4. Optionally: drag one of the service nodes to show it's interactive

**Tips:**
- Zoom the browser to 90% so the full graph is visible
- If there's a filter panel, briefly show it
- Dark mode browser DevTools or OS-level dark mode makes it look polished

---

## Example services to use for the recording

If you don't have real microservices handy, create a minimal set of fixtures in `examples/`:

```
examples/
├── user-service/           (TypeScript / NestJS)
│   ├── package.json
│   └── src/
│       └── users.controller.ts
│           // @Controller('users')
│           // @Get(':id') getUser() { ... }
│           // @Post() createUser() { ... }
│
├── order-service/          (TypeScript / NestJS, calls user-service)
│   ├── package.json
│   └── src/
│       └── orders.controller.ts
│           // POST /orders → calls GET user-service/users/:id
│
└── notification-service/   (TypeScript / Express, calls order-service)
    ├── package.json
    └── src/
        └── notifications.ts
            // calls order-service/orders/:id on order creation
```

This gives a clean 3-node, 2-edge graph that's easy to see in the GIF.

---

## Where to put the GIF

1. Record and export as `.gif` (keep under 5MB — use 10fps if needed to reduce size)
2. Save as `docs/demo.gif`
3. Add to `README.md` right after the tagline / badges, before the "Install" section:

```markdown
## Demo

![CrossCtx scanning three microservices and generating an interactive dependency graph](docs/demo.gif)
```

**Alternative:** Host on GitHub directly — drag-drop the GIF into the README editor on GitHub.com and it'll give you a CDN URL. This keeps repo size down.
