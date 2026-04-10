import { describe, it, expect } from "vitest";
import path from "path";
import { scanForSpecs } from "../src/scanner/index.js";

const EXAMPLES_DIR = path.resolve(__dirname, "../examples");

describe("scanForSpecs", () => {
  it("should find all OpenAPI specs in examples directory", async () => {
    const results = await scanForSpecs([EXAMPLES_DIR]);

    expect(results).toHaveLength(3);

    const filePaths = results.map((r) => r.filePath);
    expect(filePaths.some((f) => f.includes("user-service"))).toBe(true);
    expect(filePaths.some((f) => f.includes("order-service"))).toBe(true);
    expect(filePaths.some((f) => f.includes("payment-service"))).toBe(true);
  });

  it("should return relative paths", async () => {
    const results = await scanForSpecs([EXAMPLES_DIR]);

    for (const result of results) {
      expect(result.relativePath).not.toContain(EXAMPLES_DIR);
      expect(result.relativePath).toMatch(/openapi\.yaml$/);
    }
  });

  it("should return empty array for directory with no specs", async () => {
    const results = await scanForSpecs([path.resolve(__dirname)]);
    expect(results).toHaveLength(0);
  });

  it("should handle multiple scan paths", async () => {
    const userDir = path.resolve(EXAMPLES_DIR, "user-service");
    const orderDir = path.resolve(EXAMPLES_DIR, "order-service");

    const results = await scanForSpecs([userDir, orderDir]);
    expect(results).toHaveLength(2);
  });

  it("should handle non-existent directory gracefully", async () => {
    const results = await scanForSpecs(["/non/existent/path"]);
    expect(results).toHaveLength(0);
  });
});
