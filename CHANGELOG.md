# Changelog

All notable changes to CrossCtx will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-04-10

### Added

- Markdown output (`--markdown` flag) — LLM-optimized summary with endpoints table and schemas
- Interactive HTML dependency graph (`--graph` flag) — D3.js visualization with drag, zoom, and hover
- Unit tests for scanner, parser, analyzer, and renderer (Vitest)
- `vitest.config.ts` for test configuration

### Changed

- CLI now supports multiple output formats simultaneously
- Updated README with new output format documentation

## [0.1.0] - 2026-04-10

### Added

- Initial MVP release
- Recursive scanning for OpenAPI/Swagger files (.json, .yaml, .yml)
- OpenAPI 3.x and Swagger 2.x spec parsing
- Service discovery with endpoint extraction
- Basic dependency detection via server URL hostname matching
- JSON output (LLM-friendly, token-efficient)
- CLI interface with configurable output path
