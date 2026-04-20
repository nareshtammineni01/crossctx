# ──────────────────────────────────────────────────────────────────────────────
# CrossCtx Docker image
#
# Provides a zero-dependency way to run crossctx in CI without a local Node.js
# installation.
#
# Usage:
#   docker build -t crossctx .
#   docker run --rm -v "$(pwd):/workspace" crossctx /workspace/svc-a /workspace/svc-b
#
# GitHub Actions (see docs/docker-ci.md for a full example):
#   - name: Run crossctx
#     uses: docker://ghcr.io/nareshtammineni01/crossctx:latest
#     with:
#       args: --format json --output /workspace/crossctx-output.json /workspace/services
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Copy manifests first for better layer caching
COPY package*.json tsconfig*.json tsup.config.ts ./

# Install all dependencies (including devDependencies for the build)
RUN npm ci --quiet

# Copy source
COPY src/ ./src/

# Build the distributable
RUN npm run build

# Prune devDependencies so the runtime image only gets production deps
RUN npm prune --production

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="crossctx" \
      org.opencontainers.image.description="Cross-service API dependency mapper" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.source="https://github.com/nareshtammineni01/crossctx" \
      org.opencontainers.image.licenses="MIT"

# Create a non-root user for safer CI execution
RUN addgroup -S crossctx && adduser -S crossctx -G crossctx

WORKDIR /app

# Copy only what is needed at runtime
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./package.json

# Make the CLI globally available inside the container
RUN ln -s /app/dist/bin/cli.js /usr/local/bin/crossctx && \
    chmod +x /app/dist/bin/cli.js

USER crossctx

# The default working directory for volume-mounted service code
WORKDIR /workspace

ENTRYPOINT ["crossctx"]
CMD ["--help"]
