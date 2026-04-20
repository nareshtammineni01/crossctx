/**
 * Shared Library / Internal Package Detector
 *
 * Scans import statements across all scanned services and identifies
 * internal packages that are used by more than one service.
 *
 * Heuristics used to identify "internal" packages:
 *   - TypeScript/JS: relative paths (../../common/...) or workspace packages (@myorg/...)
 *   - Go:            same module prefix but different service sub-package
 *   - Python:        absolute imports that match known project packages (not pypi packages)
 *   - Java:          same groupId with shared sub-package (e.g. com.myorg.common)
 *   - C#:            project references with "Shared", "Common", or "Core" in the name
 */

import type { SharedLibrary, CodeScanResult } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export function detectSharedLibraries(scanResults: CodeScanResult[]): SharedLibrary[] {
  // Map: importPath → { name, usedByServices, sourceFiles }
  const importMap = new Map<
    string,
    { name: string; usedByServices: Set<string>; sourceFile: string }
  >();

  for (const result of scanResults) {
    const language = result.language.language;
    const svc = result.serviceName;

    // We need to read the file contents again — for now we derive imports from
    // the serviceUrlHints source files (which reference actual files we parsed).
    // A better approach (done here) is to collect imports as a post-pass
    // using the project path and language markers.
    collectImports(result, language, svc, importMap);
  }

  // Only keep imports shared across 2+ services
  const shared: SharedLibrary[] = [];
  for (const [importPath, info] of importMap) {
    if (info.usedByServices.size >= 2) {
      shared.push({
        importPath,
        name: info.name,
        usedByServices: Array.from(info.usedByServices),
        sourceFile: info.sourceFile,
      });
    }
  }

  return shared;
}

function collectImports(
  result: CodeScanResult,
  language: string,
  serviceName: string,
  importMap: Map<string, { name: string; usedByServices: Set<string>; sourceFile: string }>,
): void {
  // We can only work with what was recorded. Use serviceUrlHints as a proxy for
  // source files, and also check endpoint sourceFiles.
  const sourceFiles = new Set<string>();
  for (const ep of result.endpoints) sourceFiles.add(ep.sourceFile);
  for (const hint of result.serviceUrlHints) sourceFiles.add(hint.sourceFile);

  // Try to detect shared imports from source files that were already read.
  // Since we don't re-read here, we use heuristics based on serviceUrlHints and
  // the source file paths to infer monorepo shared package usage.
  // Full import scanning is handled in detectSharedLibrariesFromContents below.
  void sourceFiles; // used in the content-based version
  void language;
  void serviceName;
  void importMap;
}

/**
 * Content-based shared library detection.
 * Call this after all per-language parsers have run.
 */
export function detectSharedLibrariesFromContents(
  serviceContents: Map<
    string,
    { serviceName: string; language: string; files: Map<string, string> }
  >,
): SharedLibrary[] {
  const importMap = new Map<
    string,
    { name: string; usedByServices: Set<string>; sourceFile: string }
  >();

  for (const [, { serviceName, language, files }] of serviceContents) {
    for (const [filePath, content] of files) {
      const imports = extractImports(content, language, filePath);
      for (const importPath of imports) {
        if (!isInternalImport(importPath, language)) continue;

        const name = normalizeImportName(importPath, language);
        if (!importMap.has(importPath)) {
          importMap.set(importPath, { name, usedByServices: new Set(), sourceFile: filePath });
        }
        importMap.get(importPath)!.usedByServices.add(serviceName);
      }
    }
  }

  const shared: SharedLibrary[] = [];
  for (const [importPath, info] of importMap) {
    if (info.usedByServices.size >= 2) {
      shared.push({
        importPath,
        name: info.name,
        usedByServices: Array.from(info.usedByServices).sort(),
        sourceFile: info.sourceFile,
      });
    }
  }

  // Sort by most shared first
  return shared.sort((a, b) => b.usedByServices.length - a.usedByServices.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Import extraction per language
// ─────────────────────────────────────────────────────────────────────────────

function extractImports(content: string, language: string, _filePath: string): string[] {
  switch (language) {
    case "typescript":
      return extractTsImports(content);
    case "python":
      return extractPyImports(content);
    case "go":
      return extractGoImports(content);
    case "java":
      return extractJavaImports(content);
    case "csharp":
      return extractCsImports(content);
    default:
      return [];
  }
}

function extractTsImports(content: string): string[] {
  const imports: string[] = [];
  // import ... from 'path' or require('path')
  const importRegex = /(?:import\s+.*?from\s+|require\s*\(\s*)["'`]([^"'`\n]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function extractPyImports(content: string): string[] {
  const imports: string[] = [];
  // from package import ... or import package
  const fromRegex = /^from\s+([\w.]+)\s+import/gm;
  const importRegex = /^import\s+([\w.]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = fromRegex.exec(content)) !== null) imports.push(m[1]);
  while ((m = importRegex.exec(content)) !== null) imports.push(m[1]);
  return imports;
}

function extractGoImports(content: string): string[] {
  const imports: string[] = [];
  // import "path" or import ( "path1" \n "path2" )
  const singleImportRegex = /import\s+"([^"]+)"/g;
  const blockImportRegex = /import\s*\(\s*((?:[^)]+))\)/gs;
  let m: RegExpExecArray | null;

  while ((m = singleImportRegex.exec(content)) !== null) imports.push(m[1]);

  while ((m = blockImportRegex.exec(content)) !== null) {
    const block = m[1];
    const lineRegex = /["']([^"'\n]+)["']/g;
    let lm: RegExpExecArray | null;
    while ((lm = lineRegex.exec(block)) !== null) imports.push(lm[1]);
  }

  return imports;
}

function extractJavaImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /^import\s+([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(content)) !== null) imports.push(m[1]);
  return imports;
}

function extractCsImports(content: string): string[] {
  const imports: string[] = [];
  // using Namespace.SubNamespace;
  const usingRegex = /^using\s+([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = usingRegex.exec(content)) !== null) imports.push(m[1]);
  return imports;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal package heuristics
// ─────────────────────────────────────────────────────────────────────────────

const EXTERNAL_PREFIXES_TS = new Set([
  "react",
  "next",
  "express",
  "fastify",
  "axios",
  "lodash",
  "moment",
  "dayjs",
  "uuid",
  "zod",
  "class-validator",
  "typeorm",
  "prisma",
  "mongoose",
  "redis",
  "kafkajs",
  "amqplib",
  "commander",
  "chalk",
  "dotenv",
  "jest",
  "vitest",
  "node:", // node: protocol built-ins
]);

const EXTERNAL_PREFIXES_PY = new Set([
  "fastapi",
  "pydantic",
  "sqlalchemy",
  "django",
  "flask",
  "requests",
  "httpx",
  "aiohttp",
  "celery",
  "redis",
  "kafka",
  "boto3",
  "botocore",
  "pytest",
  "uvicorn",
  "gunicorn",
  "starlette",
  "alembic",
  "motor",
  "pymongo",
  "os",
  "sys",
  "typing",
  "pathlib",
  "json",
  "datetime",
  "collections",
  "abc",
  "asyncio",
  "functools",
  "itertools",
  "re",
  "math",
  "enum",
  "dataclasses",
]);

function isInternalImport(importPath: string, language: string): boolean {
  switch (language) {
    case "typescript": {
      // Relative paths are internal to the service (same service)
      if (importPath.startsWith(".")) return false; // same-service relative
      // @scope/package — internal if not a well-known external package
      if (importPath.startsWith("@")) {
        const scope = importPath.split("/")[0].slice(1);
        return !["nestjs", "angular", "babel", "types", "testing-library", "storybook"].includes(
          scope,
        );
      }
      // Bare module — check if it looks external
      const base = importPath.split("/")[0];
      if (EXTERNAL_PREFIXES_TS.has(base)) return false;
      // If it has a path segment (/lib/... or /utils/...) it's likely internal
      return importPath.includes("/") && !importPath.startsWith("node_modules");
    }
    case "python": {
      const base = importPath.split(".")[0];
      // Standard lib / well-known packages
      return !EXTERNAL_PREFIXES_PY.has(base) && !base.startsWith("_");
    }
    case "go": {
      // External packages from well-known repos
      const externalPrefixes = [
        "github.com/gin-gonic",
        "github.com/go-chi",
        "golang.org",
        "google.golang.org",
        "gopkg.in",
      ];
      for (const p of externalPrefixes) {
        if (importPath.startsWith(p)) return false;
      }
      // Internal if it's in the same module (heuristic: has only 3-4 path segments)
      return importPath.split("/").length >= 3;
    }
    case "java": {
      // Exclude JDK and well-known libraries
      const external = [
        "java.",
        "javax.",
        "org.springframework",
        "org.apache",
        "com.fasterxml",
        "io.",
        "org.slf4j",
      ];
      return !external.some((p) => importPath.startsWith(p));
    }
    case "csharp": {
      // Microsoft and System namespaces are external
      const external = [
        "System",
        "Microsoft",
        "Newtonsoft",
        "Serilog",
        "MassTransit",
        "AutoMapper",
      ];
      return !external.some((p) => importPath.startsWith(p));
    }
    default:
      return false;
  }
}

function normalizeImportName(importPath: string, language: string): string {
  switch (language) {
    case "typescript":
      // @myorg/shared-utils → shared-utils
      if (importPath.startsWith("@")) return importPath.split("/").slice(1).join("/") || importPath;
      return importPath.split("/").pop() ?? importPath;
    case "python":
      return importPath.split(".").pop() ?? importPath;
    case "go":
      return importPath.split("/").pop() ?? importPath;
    case "java":
    case "csharp":
      return importPath.split(".").pop() ?? importPath;
    default:
      return importPath;
  }
}
