import { describe, it, expect } from "vitest";
import path from "path";
import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { parseSpec } from "../src/parser/index.js";
import { analyzeDependencies } from "../src/analyzer/index.js";
import { buildOutput, saveOutput, printSummary } from "../src/renderer/index.js";
import type { ParsedSpec } from "../src/types/index.js";

const EXAMPLES_DIR = path.resolve(__dirname, "../examples");
const TEST_OUTPUT = path.resolve(__dirname, "../test-output.json");

describe("renderer", () => {
  let parsedSpecs: ParsedSpec[];

  beforeAll(async () => {
    parsedSpecs = await Promise.all([
      parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml")),
      parseSpec(path.join(EXAMPLES_DIR, "order-service/openapi.yaml")),
      parseSpec(path.join(EXAMPLES_DIR, "payment-service/openapi.yaml")),
    ]);
  });

  afterAll(async () => {
    if (existsSync(TEST_OUTPUT)) {
      await unlink(TEST_OUTPUT);
    }
  });

  describe("buildOutput", () => {
    it("should include all services", () => {
      const deps = analyzeDependencies(parsedSpecs);
      const output = buildOutput(parsedSpecs, deps, ["./examples"], 3);

      expect(output.services).toHaveLength(3);
    });

    it("should include all endpoints across services", () => {
      const deps = analyzeDependencies(parsedSpecs);
      const output = buildOutput(parsedSpecs, deps, ["./examples"], 3);

      expect(output.endpoints.length).toBeGreaterThan(0);
      const services = new Set(output.endpoints.map((e) => e.service));
      expect(services.size).toBe(3);
    });

    it("should include meta information", () => {
      const deps = analyzeDependencies(parsedSpecs);
      const output = buildOutput(parsedSpecs, deps, ["./examples"], 3);

      expect(output.meta.version).toBe("0.1.0");
      expect(output.meta.totalFiles).toBe(3);
      expect(output.meta.scanPaths).toContain(path.resolve("./examples"));
      expect(output.meta.generatedAt).toBeTruthy();
    });

    it("should include dependencies", () => {
      const deps = analyzeDependencies(parsedSpecs);
      const output = buildOutput(parsedSpecs, deps, ["./examples"], 3);

      expect(output.dependencies.length).toBeGreaterThan(0);
    });
  });

  describe("saveOutput", () => {
    it("should write valid JSON to file", async () => {
      const deps = analyzeDependencies(parsedSpecs);
      const output = buildOutput(parsedSpecs, deps, ["./examples"], 3);

      await saveOutput(output, TEST_OUTPUT);
      expect(existsSync(TEST_OUTPUT)).toBe(true);
    });
  });

  describe("printSummary", () => {
    it("should include service count", () => {
      const deps = analyzeDependencies(parsedSpecs);
      const output = buildOutput(parsedSpecs, deps, ["./examples"], 3);
      const summary = printSummary(output);

      expect(summary).toContain("Services found: 3");
    });

    it("should include dependency arrows", () => {
      const deps = analyzeDependencies(parsedSpecs);
      const output = buildOutput(parsedSpecs, deps, ["./examples"], 3);
      const summary = printSummary(output);

      expect(summary).toContain("→");
      expect(summary).toContain("order-service");
    });

    it("should include CrossCtx header", () => {
      const deps = analyzeDependencies(parsedSpecs);
      const output = buildOutput(parsedSpecs, deps, ["./examples"], 3);
      const summary = printSummary(output);

      expect(summary).toContain("CrossCtx Results");
    });
  });
});
