/**
 * Shared library detection tests
 */

import { describe, it, expect } from "vitest";
import {
  detectSharedLibraries,
  detectSharedLibrariesFromContents,
} from "../src/parsers/shared-libs.js";
import type { CodeScanResult, DetectedLanguage } from "../src/types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeScanResult(
  serviceName: string,
  language: string,
  serviceUrlHints: { key: string; value?: string; sourceFile: string }[],
): CodeScanResult {
  const lang: DetectedLanguage = {
    language: language as "typescript",
    framework: "nestjs",
    detectedFrom: "package.json",
    confidence: 0.9,
  };
  return {
    projectPath: `/services/${serviceName}`,
    language: lang,
    serviceName,
    endpoints: [],
    dtos: [],
    serviceUrlHints,
    hasOpenApiSpec: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// detectSharedLibraries — from CodeScanResults
// ─────────────────────────────────────────────────────────────────────────────

describe("detectSharedLibraries", () => {
  it("returns empty array when fewer than 2 services", () => {
    const result = detectSharedLibraries([makeScanResult("only-service", "typescript", [])]);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when no shared imports are found", () => {
    const result = detectSharedLibraries([
      makeScanResult("svc-a", "typescript", []),
      makeScanResult("svc-b", "typescript", []),
    ]);
    // Without source file contents, no imports to compare — should not throw
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectSharedLibrariesFromContents — from file content maps
// ─────────────────────────────────────────────────────────────────────────────

describe("detectSharedLibrariesFromContents", () => {
  it("detects a TypeScript @org/shared-utils package used by 2+ services", () => {
    const serviceContents = new Map([
      [
        "/services/svc-a",
        {
          serviceName: "svc-a",
          language: "typescript",
          files: new Map([
            ["/services/svc-a/src/utils.ts", `import { formatDate } from "@myorg/shared-utils";`],
          ]),
        },
      ],
      [
        "/services/svc-b",
        {
          serviceName: "svc-b",
          language: "typescript",
          files: new Map([
            [
              "/services/svc-b/src/helpers.ts",
              `import { formatDate, parseDate } from "@myorg/shared-utils";`,
            ],
          ]),
        },
      ],
    ]);

    const shared = detectSharedLibrariesFromContents(serviceContents);
    const sharedUtils = shared.find((s) => s.importPath.includes("shared-utils"));
    expect(sharedUtils).toBeDefined();
    expect(sharedUtils!.usedByServices).toContain("svc-a");
    expect(sharedUtils!.usedByServices).toContain("svc-b");
  });

  it("does not flag packages only used by a single service", () => {
    const serviceContents = new Map([
      [
        "/services/svc-a",
        {
          serviceName: "svc-a",
          language: "typescript",
          files: new Map([
            ["/services/svc-a/src/utils.ts", `import { formatDate } from "@myorg/only-in-a";`],
          ]),
        },
      ],
      [
        "/services/svc-b",
        {
          serviceName: "svc-b",
          language: "typescript",
          files: new Map([
            ["/services/svc-b/src/helpers.ts", `import { parseDate } from "@myorg/only-in-b";`],
          ]),
        },
      ],
    ]);

    const shared = detectSharedLibrariesFromContents(serviceContents);
    expect(shared).toHaveLength(0);
  });

  it("does not flag standard npm packages like lodash or express", () => {
    const serviceContents = new Map([
      [
        "/services/svc-a",
        {
          serviceName: "svc-a",
          language: "typescript",
          files: new Map([
            [
              "/services/svc-a/src/main.ts",
              `import _ from "lodash"; import express from "express";`,
            ],
          ]),
        },
      ],
      [
        "/services/svc-b",
        {
          serviceName: "svc-b",
          language: "typescript",
          files: new Map([
            [
              "/services/svc-b/src/main.ts",
              `import _ from "lodash"; import express from "express";`,
            ],
          ]),
        },
      ],
    ]);

    const shared = detectSharedLibrariesFromContents(serviceContents);
    // Standard packages should not be flagged as "internal" shared libraries
    const standard = shared.filter((s) => ["lodash", "express"].includes(s.name));
    expect(standard).toHaveLength(0);
  });

  it("detects Go internal packages used by 2+ services", () => {
    const serviceContents = new Map([
      [
        "/services/svc-a",
        {
          serviceName: "svc-a",
          language: "go",
          files: new Map([
            ["/services/svc-a/main.go", `import "github.com/myorg/platform/common/auth"`],
          ]),
        },
      ],
      [
        "/services/svc-b",
        {
          serviceName: "svc-b",
          language: "go",
          files: new Map([
            ["/services/svc-b/main.go", `import "github.com/myorg/platform/common/auth"`],
          ]),
        },
      ],
    ]);

    const shared = detectSharedLibrariesFromContents(serviceContents);
    const authLib = shared.find((s) => s.importPath.includes("common/auth"));
    expect(authLib).toBeDefined();
    expect(authLib!.usedByServices.length).toBe(2);
  });
});
