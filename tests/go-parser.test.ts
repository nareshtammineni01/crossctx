/**
 * Go parser tests — go-order-service example
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { parseGoProject } from "../src/parsers/go.js";
import type { DetectedLanguage } from "../src/types/index.js";

const EXAMPLES_DIR = path.resolve(__dirname, "../examples");

const GO_LANG: DetectedLanguage = {
  language: "go",
  framework: "gin",
  detectedFrom: "go.mod",
  confidence: 0.96,
};

describe("Go parser — go-order-service", () => {
  const servicePath = path.join(EXAMPLES_DIR, "go-order-service");

  it("returns a valid CodeScanResult shape", async () => {
    const result = await parseGoProject(servicePath, GO_LANG, "go-order-service");
    expect(result).toBeDefined();
    expect(result.serviceName).toBe("go-order-service");
    expect(result.language.language).toBe("go");
    expect(Array.isArray(result.endpoints)).toBe(true);
    expect(Array.isArray(result.dtos)).toBe(true);
    expect(Array.isArray(result.serviceUrlHints)).toBe(true);
  });

  it("detects HTTP endpoints from Gin handler functions", async () => {
    const result = await parseGoProject(servicePath, GO_LANG, "go-order-service");
    expect(result.endpoints.length).toBeGreaterThan(0);
  });

  it("endpoint method is a known HTTP verb or gRPC/GraphQL pseudo-method", async () => {
    const result = await parseGoProject(servicePath, GO_LANG, "go-order-service");
    const validMethods = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
      "GRPC",
      "GRAPHQL_QUERY",
      "GRAPHQL_MUTATION",
      "GRAPHQL_SUBSCRIPTION",
    ];
    for (const ep of result.endpoints) {
      expect(validMethods).toContain(ep.method);
    }
  });

  it("all endpoints have a non-empty fullPath", async () => {
    const result = await parseGoProject(servicePath, GO_LANG, "go-order-service");
    for (const ep of result.endpoints) {
      expect(ep.fullPath).toBeTruthy();
      expect(ep.fullPath.startsWith("/")).toBe(true);
    }
  });

  it("detects outbound calls (HTTP or gRPC) to other services", async () => {
    const result = await parseGoProject(servicePath, GO_LANG, "go-order-service");
    // gRPC outbound calls are always scoped correctly (detected from grpc.Dial in the same file)
    // HTTP outbound calls may be scoped per-handler; check both endpoints and gRPC hints
    const allOutbound = result.endpoints.flatMap((e) => e.outboundCalls);
    const grpcHints = result.serviceUrlHints.filter((h) => h.value?.startsWith("grpc://"));
    // At least gRPC outbound calls to inventory-service should be found
    expect(allOutbound.length + grpcHints.length).toBeGreaterThan(0);
  });

  it("detects PRODUCT_SERVICE_URL environment variable hint", async () => {
    const result = await parseGoProject(servicePath, GO_LANG, "go-order-service");
    const hint = result.serviceUrlHints.find((h) => h.key.includes("PRODUCT_SERVICE_URL"));
    expect(hint).toBeDefined();
  });

  it("parses gRPC endpoints from .proto file", async () => {
    const result = await parseGoProject(servicePath, GO_LANG, "go-order-service");
    // The go-order-service has order.proto with OrderService RPCs
    const grpcEps = result.endpoints.filter((e) => e.method === "GRPC");
    expect(grpcEps.length).toBeGreaterThan(0);
  });

  it("gRPC endpoints include the service method name in the path", async () => {
    const result = await parseGoProject(servicePath, GO_LANG, "go-order-service");
    const grpcEps = result.endpoints.filter((e) => e.method === "GRPC");
    // Should include methods from OrderService: CreateOrder, GetOrder, etc.
    const paths = grpcEps.map((e) => e.path);
    expect(paths.some((p) => p.includes("CreateOrder") || p.includes("GetOrder"))).toBe(true);
  });
});
