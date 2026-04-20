# Using CrossCtx in CI with Docker

CrossCtx ships a Docker image so you can run it in any CI environment without
installing Node.js.

---

## Build locally

```bash
git clone https://github.com/nareshtammineni01/crossctx.git
cd crossctx
docker build -t crossctx .
```

## Run against local services

```bash
# Single service
docker run --rm \
  -v "$(pwd):/workspace" \
  crossctx /workspace/my-service

# Multiple services, save output to host
docker run --rm \
  -v "$(pwd):/workspace" \
  crossctx \
    /workspace/user-service \
    /workspace/order-service \
    /workspace/payment-service \
    --output /workspace/crossctx-output.json \
    --format all
```

## Pull from GHCR (once published)

```bash
docker pull ghcr.io/nareshtammineni01/crossctx:latest
docker run --rm -v "$(pwd):/workspace" \
  ghcr.io/nareshtammineni01/crossctx:latest \
  /workspace/services --monorepo
```

---

## GitHub Actions

### Basic usage

```yaml
# .github/workflows/crossctx.yml
name: API dependency map

on: [push, pull_request]

jobs:
  crossctx:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run crossctx
        run: |
          docker run --rm \
            -v "${{ github.workspace }}:/workspace" \
            ghcr.io/nareshtammineni01/crossctx:latest \
              /workspace/services \
              --monorepo \
              --output /workspace/crossctx-output.json

      - name: Upload dependency map
        uses: actions/upload-artifact@v4
        with:
          name: crossctx-output
          path: crossctx-output.json
```

### Breaking change detection on PRs

```yaml
name: API breaking change check

on:
  pull_request:
    branches: [main]

jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # need full history for baseline

      # Generate baseline from main branch
      - name: Checkout main
        run: git stash && git checkout origin/main

      - name: Generate baseline
        run: |
          docker run --rm -v "${{ github.workspace }}:/workspace" \
            ghcr.io/nareshtammineni01/crossctx:latest \
              /workspace/services --monorepo \
              --output /workspace/baseline.json

      - name: Restore PR branch
        run: git checkout -

      - name: Generate current
        run: |
          docker run --rm -v "${{ github.workspace }}:/workspace" \
            ghcr.io/nareshtammineni01/crossctx:latest \
              /workspace/services --monorepo \
              --output /workspace/current.json

      # Diff using the crossctx diff subcommand
      - name: Check for breaking changes
        run: |
          docker run --rm -v "${{ github.workspace }}:/workspace" \
            ghcr.io/nareshtammineni01/crossctx:latest \
              diff /workspace/baseline.json /workspace/current.json
        # Exits non-zero if breaking changes are found — fails the job
```

---

## docker-compose (local dev)

```yaml
# docker-compose.crossctx.yml
version: "3.8"
services:
  crossctx:
    build: .
    volumes:
      - .:/workspace
    command: ["/workspace/services", "--monorepo", "--format", "all"]
```

```bash
docker compose -f docker-compose.crossctx.yml run --rm crossctx
```

---

## Environment variables inside the container

| Variable | Effect |
|---|---|
| `NO_COLOR=1` | Disable ANSI colour output |
| `CROSSCTX_OUTPUT` | Convenience alias — set output path via env instead of `--output` (if you fork the CLI) |

## Image tags

| Tag | Description |
|---|---|
| `latest` | Latest stable release |
| `1.0.0`, `1.0`, `1` | Pinned version tags |
| `main` | Nightly from the main branch (may be unstable) |
