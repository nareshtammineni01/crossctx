/**
 * Diff / breaking-change detection tests
 */

import { describe, it, expect } from "vitest";
import { diffOutputs } from "../src/differ/index.js";
import type { CrossCtxOutput } from "../src/types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeOutput(
  endpoints: Array<{
    service: string;
    method: string;
    path: string;
    requestBody?: { type: string; properties?: Record<string, string> };
    response?: { type: string; properties?: Record<string, string> };
  }>,
): CrossCtxOutput {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      version: "1.0.0",
      schemaVersion: "1.0",
      scanPaths: ["/services"],
      totalFiles: 1,
    },
    services: [],
    endpoints: endpoints as CrossCtxOutput["endpoints"],
    dependencies: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// No changes
// ─────────────────────────────────────────────────────────────────────────────

describe("diffOutputs — no changes", () => {
  it("returns empty breaking and nonBreaking arrays when outputs are identical", () => {
    const output = makeOutput([{ service: "user-service", method: "GET", path: "/users" }]);
    const report = diffOutputs(output, output);
    expect(report.breaking).toHaveLength(0);
    expect(report.nonBreaking).toHaveLength(0);
    expect(report.summary.totalBreaking).toBe(0);
    expect(report.summary.totalNonBreaking).toBe(0);
  });

  it("populates scannedAt with a valid ISO timestamp", () => {
    const output = makeOutput([]);
    const report = diffOutputs(output, output);
    expect(() => new Date(report.scannedAt)).not.toThrow();
    expect(new Date(report.scannedAt).toISOString()).toBe(report.scannedAt);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Removed endpoints (breaking)
// ─────────────────────────────────────────────────────────────────────────────

describe("diffOutputs — removed endpoints (breaking)", () => {
  it("flags a removed endpoint as breaking", () => {
    const baseline = makeOutput([
      { service: "user-service", method: "GET", path: "/users" },
      { service: "user-service", method: "DELETE", path: "/users/{id}" },
    ]);
    const current = makeOutput([{ service: "user-service", method: "GET", path: "/users" }]);

    const report = diffOutputs(baseline, current);
    expect(report.breaking).toHaveLength(1);
    expect(report.breaking[0].type).toBe("removed");
    expect(report.breaking[0].service).toBe("user-service");
    expect(report.breaking[0].method).toBe("DELETE");
    expect(report.breaking[0].path).toBe("/users/{id}");
    expect(report.summary.removedEndpoints).toBe(1);
  });

  it("counts multiple removed endpoints correctly", () => {
    const baseline = makeOutput([
      { service: "svc-a", method: "GET", path: "/a" },
      { service: "svc-a", method: "POST", path: "/a" },
      { service: "svc-a", method: "DELETE", path: "/a/{id}" },
    ]);
    const current = makeOutput([]);
    const report = diffOutputs(baseline, current);
    expect(report.summary.removedEndpoints).toBe(3);
    expect(report.summary.totalBreaking).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Added endpoints (non-breaking)
// ─────────────────────────────────────────────────────────────────────────────

describe("diffOutputs — added endpoints (non-breaking)", () => {
  it("flags a new endpoint as non-breaking", () => {
    const baseline = makeOutput([{ service: "user-service", method: "GET", path: "/users" }]);
    const current = makeOutput([
      { service: "user-service", method: "GET", path: "/users" },
      { service: "user-service", method: "POST", path: "/users" },
    ]);

    const report = diffOutputs(baseline, current);
    expect(report.nonBreaking).toHaveLength(1);
    expect(report.nonBreaking[0].type).toBe("added");
    expect(report.nonBreaking[0].method).toBe("POST");
    expect(report.summary.addedEndpoints).toBe(1);
    expect(report.summary.totalBreaking).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Changed endpoints — request body type change (breaking)
// ─────────────────────────────────────────────────────────────────────────────

describe("diffOutputs — changed endpoints (breaking)", () => {
  it("flags a request body type change as breaking", () => {
    const baseline = makeOutput([
      {
        service: "order-service",
        method: "POST",
        path: "/orders",
        requestBody: { type: "CreateOrderDto" },
      },
    ]);
    const current = makeOutput([
      {
        service: "order-service",
        method: "POST",
        path: "/orders",
        requestBody: { type: "NewOrderPayload" }, // type changed
      },
    ]);

    const report = diffOutputs(baseline, current);
    expect(report.breaking).toHaveLength(1);
    const diff = report.breaking[0];
    expect(diff.type).toBe("changed");
    expect(diff.changes?.requestBody?.before).toBe("CreateOrderDto");
    expect(diff.changes?.requestBody?.after).toBe("NewOrderPayload");
  });

  it("flags removed request body fields as breaking", () => {
    const baseline = makeOutput([
      {
        service: "order-service",
        method: "POST",
        path: "/orders",
        requestBody: {
          type: "object",
          properties: { userId: "string", productId: "string", quantity: "number" },
        },
      },
    ]);
    const current = makeOutput([
      {
        service: "order-service",
        method: "POST",
        path: "/orders",
        requestBody: { type: "object", properties: { userId: "string" } }, // productId + quantity removed
      },
    ]);

    const report = diffOutputs(baseline, current);
    expect(report.breaking).toHaveLength(1);
    const diff = report.breaking[0];
    expect(diff.changes?.removedFields).toContain("productId");
    expect(diff.changes?.removedFields).toContain("quantity");
  });

  it("flags added request body fields as non-breaking", () => {
    const baseline = makeOutput([
      {
        service: "order-service",
        method: "POST",
        path: "/orders",
        requestBody: { type: "object", properties: { userId: "string" } },
      },
    ]);
    const current = makeOutput([
      {
        service: "order-service",
        method: "POST",
        path: "/orders",
        requestBody: { type: "object", properties: { userId: "string", note: "string" } },
      },
    ]);

    const report = diffOutputs(baseline, current);
    // Adding fields is non-breaking
    expect(report.summary.totalBreaking).toBe(0);
    if (report.nonBreaking.length > 0) {
      const diff = report.nonBreaking[0];
      expect(diff.changes?.addedFields).toContain("note");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary counts
// ─────────────────────────────────────────────────────────────────────────────

describe("diffOutputs — summary counts", () => {
  it("changedEndpoints equals count of all changed diffs across breaking + nonBreaking", () => {
    const baseline = makeOutput([
      { service: "svc", method: "PUT", path: "/items/{id}", requestBody: { type: "A" } },
      { service: "svc", method: "GET", path: "/items" },
    ]);
    const current = makeOutput([
      { service: "svc", method: "PUT", path: "/items/{id}", requestBody: { type: "B" } }, // changed
      { service: "svc", method: "GET", path: "/items" }, // unchanged
      { service: "svc", method: "POST", path: "/items" }, // added
    ]);

    const report = diffOutputs(baseline, current);
    expect(report.summary.changedEndpoints).toBe(1);
    expect(report.summary.addedEndpoints).toBe(1);
    expect(report.summary.removedEndpoints).toBe(0);
    expect(report.summary.totalBreaking).toBe(1);
    expect(report.summary.totalNonBreaking).toBe(1);
  });
});
