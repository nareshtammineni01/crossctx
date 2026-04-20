/**
 * gRPC parser tests
 */

import { describe, it, expect } from "vitest";
import path from "path";
import {
  scanProtoFiles,
  grpcServicesToEndpoints,
  extractGrpcOutboundCalls,
} from "../src/parsers/grpc.js";

const EXAMPLES_DIR = path.resolve(__dirname, "../examples");

// ─────────────────────────────────────────────────────────────────────────────
// .proto file scanning
// ─────────────────────────────────────────────────────────────────────────────

describe("scanProtoFiles — go-order-service", () => {
  const servicePath = path.join(EXAMPLES_DIR, "go-order-service");

  it("discovers the order.proto file", async () => {
    const result = await scanProtoFiles(servicePath);
    expect(result.services.length).toBeGreaterThan(0);
  });

  it("parses OrderService with expected RPC methods", async () => {
    const result = await scanProtoFiles(servicePath);
    const orderSvc = result.services.find((s) => s.name === "OrderService");
    expect(orderSvc).toBeDefined();
    const rpcNames = orderSvc!.rpcs.map((r) => r.name);
    expect(rpcNames).toContain("CreateOrder");
    expect(rpcNames).toContain("GetOrder");
    expect(rpcNames).toContain("ListOrders");
    expect(rpcNames).toContain("UpdateOrder");
    expect(rpcNames).toContain("DeleteOrder");
  });

  it("detects streaming RPCs", async () => {
    const result = await scanProtoFiles(servicePath);
    const orderSvc = result.services.find((s) => s.name === "OrderService");
    expect(orderSvc).toBeDefined();
    const watchOrder = orderSvc!.rpcs.find((r) => r.name === "WatchOrder");
    expect(watchOrder).toBeDefined();
    // WatchOrder is server-streaming
    expect(watchOrder!.serverStreaming).toBe(true);
  });

  it("parses request and response message types", async () => {
    const result = await scanProtoFiles(servicePath);
    const orderSvc = result.services.find((s) => s.name === "OrderService");
    expect(orderSvc).toBeDefined();
    const createRpc = orderSvc!.rpcs.find((r) => r.name === "CreateOrder");
    expect(createRpc!.requestType).toBe("CreateOrderRequest");
    expect(createRpc!.responseType).toBe("OrderResponse");
  });

  it("returns empty services for a path without proto files", async () => {
    const result = await scanProtoFiles(path.join(EXAMPLES_DIR, "user-service"));
    expect(result.services).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// grpcServicesToEndpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("grpcServicesToEndpoints", () => {
  it("converts each RPC into a GRPC endpoint", async () => {
    const { services } = await scanProtoFiles(path.join(EXAMPLES_DIR, "go-order-service"));
    const endpoints = grpcServicesToEndpoints(services, "go-order-service");

    expect(endpoints.length).toBe(6); // 5 unary + 1 streaming from order.proto
    for (const ep of endpoints) {
      expect(ep.method).toBe("GRPC");
      expect(ep.service).toBe("go-order-service");
      expect(ep.path).toBeTruthy();
      expect(ep.fullPath).toBeTruthy();
    }
  });

  it("encodes streaming RPCs with (stream) in the path", async () => {
    const { services } = await scanProtoFiles(path.join(EXAMPLES_DIR, "go-order-service"));
    const endpoints = grpcServicesToEndpoints(services, "go-order-service");
    const watchEp = endpoints.find((e) => e.path.includes("WatchOrder"));
    expect(watchEp).toBeDefined();
    // streaming endpoints should have a note in the summary or path
    expect(watchEp!.summary).toMatch(/stream/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractGrpcOutboundCalls — Go client stubs
// ─────────────────────────────────────────────────────────────────────────────

describe("extractGrpcOutboundCalls — Go", () => {
  it("detects grpc.Dial calls in Go source files", async () => {
    const servicePath = path.join(EXAMPLES_DIR, "go-order-service");
    const grpcClientPath = path.join(servicePath, "handlers/grpc_client.go");

    const { readFile } = await import("fs/promises");
    const content = await readFile(grpcClientPath, "utf-8");

    // Signature: extractGrpcOutboundCalls(content: string, filePath: string, language)
    const calls = extractGrpcOutboundCalls(content, grpcClientPath, "go");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("extracted call has GRPC method and grpc:// rawUrl", async () => {
    const servicePath = path.join(EXAMPLES_DIR, "go-order-service");
    const grpcClientPath = path.join(servicePath, "handlers/grpc_client.go");

    const { readFile } = await import("fs/promises");
    const content = await readFile(grpcClientPath, "utf-8");

    const calls = extractGrpcOutboundCalls(content, grpcClientPath, "go");
    expect(calls[0].method).toBe("GRPC");
    expect(calls[0].rawUrl).toMatch(/^grpc:\/\//);
  });
});
