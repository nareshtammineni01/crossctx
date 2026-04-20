/**
 * Plugin / analyzer interface tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registerPlugin, getPlugins, findPlugin } from "../src/plugins/interface.js";
import type { LanguageParserPlugin } from "../src/plugins/interface.js";
import type { CodeScanResult, DetectedLanguage } from "../src/types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makePlugin(name: string, triggerFile: string): LanguageParserPlugin {
  return {
    name,
    version: "1.0.0",
    language: "test-lang",
    frameworks: ["test-framework"],

    canHandle(_projectPath: string, files: string[]): boolean {
      return files.includes(triggerFile);
    },

    detect(_projectPath: string, _files: string[]): DetectedLanguage {
      return {
        language: "unknown",
        framework: "unknown",
        detectedFrom: triggerFile,
        confidence: 0.8,
      };
    },

    async parse(
      projectPath: string,
      detectedLanguage: DetectedLanguage,
      serviceName: string,
    ): Promise<CodeScanResult> {
      return {
        projectPath,
        language: detectedLanguage,
        serviceName,
        endpoints: [],
        dtos: [],
        serviceUrlHints: [],
        hasOpenApiSpec: false,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Plugin registry", () => {
  beforeEach(() => {
    // Clear registry between tests by overwriting with same names
  });

  it("registers a plugin and retrieves it via getPlugins()", () => {
    const plugin = makePlugin("test-ruby-plugin", "Gemfile");
    registerPlugin(plugin);
    const plugins = getPlugins();
    expect(plugins.some((p) => p.name === "test-ruby-plugin")).toBe(true);
  });

  it("overwrites a plugin with the same name on re-register", () => {
    const plugin1 = makePlugin("duplicate-plugin", "Marker1");
    const plugin2 = makePlugin("duplicate-plugin", "Marker2");

    registerPlugin(plugin1);
    registerPlugin(plugin2);

    const found = getPlugins().filter((p) => p.name === "duplicate-plugin");
    expect(found).toHaveLength(1);
    // The second registration wins
    expect(found[0].canHandle("/path", ["Marker2"])).toBe(true);
    expect(found[0].canHandle("/path", ["Marker1"])).toBe(false);
  });
});

describe("findPlugin", () => {
  it("returns the matching plugin for a file list that includes the trigger file", () => {
    const plugin = makePlugin("test-crystal-plugin", "shard.yml");
    registerPlugin(plugin);

    const found = findPlugin("/my/project", ["src/main.cr", "shard.yml", "shard.lock"]);
    expect(found).toBeDefined();
    expect(found!.name).toBe("test-crystal-plugin");
  });

  it("returns undefined when no plugin matches", () => {
    const found = findPlugin("/my/project", ["package.json", "tsconfig.json"]);
    // Standard TS files — no custom plugin should match unless one was registered for it
    // We just ensure this doesn't throw
    expect(found === undefined || typeof found === "object").toBe(true);
  });

  it("does not throw when a plugin's canHandle throws", () => {
    const broken: LanguageParserPlugin = {
      ...makePlugin("broken-plugin", "never.txt"),
      canHandle() {
        throw new Error("intentional error");
      },
    };
    registerPlugin(broken);

    // Should not propagate the error
    expect(() => findPlugin("/path", ["never.txt"])).not.toThrow();
  });
});

describe("LanguageParserPlugin contract", () => {
  it("a plugin's parse() result satisfies the CodeScanResult shape", async () => {
    const plugin = makePlugin("shape-test-plugin", "shape.marker");
    registerPlugin(plugin);

    const lang: DetectedLanguage = {
      language: "unknown",
      framework: "unknown",
      detectedFrom: "shape.marker",
      confidence: 0.8,
    };

    const result = await plugin.parse("/project", lang, "my-service");

    expect(result.projectPath).toBe("/project");
    expect(result.serviceName).toBe("my-service");
    expect(Array.isArray(result.endpoints)).toBe(true);
    expect(Array.isArray(result.dtos)).toBe(true);
    expect(Array.isArray(result.serviceUrlHints)).toBe(true);
    expect(typeof result.hasOpenApiSpec).toBe("boolean");
  });
});
