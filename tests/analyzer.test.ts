import { describe, it, expect } from "vitest";
import path from "path";
import { parseSpec } from "../src/parser/index.js";
import { analyzeDependencies } from "../src/analyzer/index.js";
import type { ParsedSpec } from "../src/types/index.js";

const EXAMPLES_DIR = path.resolve(__dirname, "../examples");

describe("analyzeDependencies", () => {
  let parsedSpecs: ParsedSpec[];

  beforeAll(async () => {
    parsedSpecs = await Promise.all([
      parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml")),
      parseSpec(path.join(EXAMPLES_DIR, "order-service/openapi.yaml")),
      parseSpec(path.join(EXAMPLES_DIR, "payment-service/openapi.yaml")),
    ]);
  });

  it("should detect order-service depends on user-service", () => {
    const deps = analyzeDependencies(parsedSpecs);
    const orderToUser = deps.find((d) => d.from === "order-service" && d.to === "user-service");

    expect(orderToUser).toBeDefined();
    expect(orderToUser?.evidence).toContain("user-service");
  });

  it("should detect order-service depends on payment-service", () => {
    const deps = analyzeDependencies(parsedSpecs);
    const orderToPayment = deps.find(
      (d) => d.from === "order-service" && d.to === "payment-service",
    );

    expect(orderToPayment).toBeDefined();
    expect(orderToPayment?.evidence).toContain("payment-service");
  });

  it("should not create self-dependencies", () => {
    const deps = analyzeDependencies(parsedSpecs);

    for (const dep of deps) {
      expect(dep.from).not.toBe(dep.to);
    }
  });

  it("should not create duplicate dependencies", () => {
    const deps = analyzeDependencies(parsedSpecs);
    const keys = deps.map((d) => `${d.from}->${d.to}`);
    const unique = new Set(keys);

    expect(keys.length).toBe(unique.size);
  });

  it("should return empty array when no dependencies exist", () => {
    // Single service has no dependencies
    const deps = analyzeDependencies([parsedSpecs[0]]);
    expect(deps).toHaveLength(0);
  });

  it("should include detection method in results", () => {
    const deps = analyzeDependencies(parsedSpecs);

    for (const dep of deps) {
      expect(["server-url", "schema-ref", "description"]).toContain(dep.detectedVia);
      expect(dep.evidence).toBeTruthy();
    }
  });
});
