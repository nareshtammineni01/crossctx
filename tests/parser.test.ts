import { describe, it, expect } from "vitest";
import path from "path";
import { parseSpec } from "../src/parser/index.js";

const EXAMPLES_DIR = path.resolve(__dirname, "../examples");

describe("parseSpec", () => {
  describe("service extraction", () => {
    it("should extract service name from spec title", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml"));
      expect(result.service.name).toBe("user-service");
    });

    it("should extract spec version", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml"));
      expect(result.service.specVersion).toBe("3.0.3");
    });

    it("should extract server URLs", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml"));
      expect(result.service.baseUrls).toContain("https://user-service.internal:8080");
    });

    it("should count endpoints correctly", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml"));
      expect(result.service.endpointCount).toBe(3);
    });
  });

  describe("endpoint extraction", () => {
    it("should extract all endpoints with correct methods", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml"));
      const methods = result.endpoints.map((e) => `${e.method} ${e.path}`);

      expect(methods).toContain("GET /users");
      expect(methods).toContain("POST /users");
      expect(methods).toContain("GET /users/{id}");
    });

    it("should extract endpoint summaries", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml"));
      const getUsers = result.endpoints.find((e) => e.method === "GET" && e.path === "/users");

      expect(getUsers?.summary).toBe("List all users");
    });

    it("should assign service name to all endpoints", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml"));

      for (const endpoint of result.endpoints) {
        expect(endpoint.service).toBe("user-service");
      }
    });

    it("should extract request body schemas", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml"));
      const postUsers = result.endpoints.find((e) => e.method === "POST" && e.path === "/users");

      expect(postUsers?.requestBody).toBeDefined();
      expect(postUsers?.requestBody?.type).toBe("object");
      expect(postUsers?.requestBody?.properties).toHaveProperty("name");
      expect(postUsers?.requestBody?.properties).toHaveProperty("email");
    });

    it("should extract response schemas", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "user-service/openapi.yaml"));
      const getUsers = result.endpoints.find((e) => e.method === "GET" && e.path === "/users");

      expect(getUsers?.response).toBeDefined();
      expect(getUsers?.response?.type).toBe("array");
    });
  });

  describe("URL extraction", () => {
    it("should extract server URLs", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "order-service/openapi.yaml"));
      expect(result.serverUrls).toContain("https://order-service.internal:8082");
    });

    it("should extract referenced URLs from descriptions", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "order-service/openapi.yaml"));

      expect(result.referencedUrls.some((u) => u.includes("user-service"))).toBe(true);
      expect(result.referencedUrls.some((u) => u.includes("payment-service"))).toBe(true);
    });
  });

  describe("payment service (more endpoints)", () => {
    it("should parse all payment endpoints", async () => {
      const result = await parseSpec(path.join(EXAMPLES_DIR, "payment-service/openapi.yaml"));

      expect(result.endpoints).toHaveLength(3);
      const paths = result.endpoints.map((e) => `${e.method} ${e.path}`);
      expect(paths).toContain("POST /payments");
      expect(paths).toContain("GET /payments/{id}");
      expect(paths).toContain("POST /payments/{id}/refund");
    });
  });
});
