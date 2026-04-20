/**
 * GraphQL parser tests
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { scanGraphQLSchemas, graphqlOperationsToEndpoints } from "../src/parsers/graphql.js";

const EXAMPLES_DIR = path.resolve(__dirname, "../examples");

// ─────────────────────────────────────────────────────────────────────────────
// Schema scanning — user-service (has schema.graphql)
// ─────────────────────────────────────────────────────────────────────────────

describe("scanGraphQLSchemas — user-service", () => {
  const servicePath = path.join(EXAMPLES_DIR, "user-service");

  it("discovers and parses schema.graphql", async () => {
    const result = await scanGraphQLSchemas(servicePath);
    expect(result.operations.length).toBeGreaterThan(0);
  });

  it("extracts Query operations", async () => {
    const result = await scanGraphQLSchemas(servicePath);
    const queries = result.operations.filter((op) => op.operationType === "Query");
    expect(queries.length).toBeGreaterThan(0);
    const names = queries.map((q) => q.name);
    expect(names).toContain("getUser");
    expect(names).toContain("listUsers");
    expect(names).toContain("searchUsers");
  });

  it("extracts Mutation operations", async () => {
    const result = await scanGraphQLSchemas(servicePath);
    const mutations = result.operations.filter((op) => op.operationType === "Mutation");
    expect(mutations.length).toBeGreaterThan(0);
    const names = mutations.map((m) => m.name);
    expect(names).toContain("createUser");
    expect(names).toContain("updateUser");
    expect(names).toContain("deleteUser");
  });

  it("extracts Subscription operations", async () => {
    const result = await scanGraphQLSchemas(servicePath);
    const subs = result.operations.filter((op) => op.operationType === "Subscription");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs[0].name).toBe("userUpdated");
  });

  it("collects all object type names", async () => {
    const result = await scanGraphQLSchemas(servicePath);
    expect(result.typeNames.has("User")).toBe(true);
    expect(result.typeNames.has("UserProfile")).toBe(true);
  });

  it("returns empty results for a path without graphql files", async () => {
    const result = await scanGraphQLSchemas(path.join(EXAMPLES_DIR, "order-service"));
    expect(result.operations).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// graphqlOperationsToEndpoints conversion
// ─────────────────────────────────────────────────────────────────────────────

describe("graphqlOperationsToEndpoints", () => {
  it("converts operations to SourceEndpoints with a GRAPHQL_* method", async () => {
    const schemaResult = await scanGraphQLSchemas(path.join(EXAMPLES_DIR, "user-service"));
    const endpoints = graphqlOperationsToEndpoints(schemaResult.operations, "user-service");

    expect(endpoints.length).toBe(schemaResult.operations.length);
    for (const ep of endpoints) {
      expect(["GRAPHQL_QUERY", "GRAPHQL_MUTATION", "GRAPHQL_SUBSCRIPTION"]).toContain(ep.method);
      expect(ep.service).toBe("user-service");
      expect(ep.path).toBeTruthy();
      expect(ep.outboundCalls).toBeDefined();
    }
  });

  it("encodes Query operations as GET-like paths", async () => {
    const schemaResult = await scanGraphQLSchemas(path.join(EXAMPLES_DIR, "user-service"));
    const endpoints = graphqlOperationsToEndpoints(schemaResult.operations, "user-service");
    const getUserEp = endpoints.find((e) => e.path.includes("getUser"));
    expect(getUserEp).toBeDefined();
  });

  it("encodes Mutation operations with GRAPHQL_MUTATION method", async () => {
    const schemaResult = await scanGraphQLSchemas(path.join(EXAMPLES_DIR, "user-service"));
    const endpoints = graphqlOperationsToEndpoints(schemaResult.operations, "user-service");
    const createUser = endpoints.find((e) => e.path.includes("createUser"));
    expect(createUser).toBeDefined();
    expect(createUser!.method).toBe("GRAPHQL_MUTATION");
  });

  it("handles an empty operations array without throwing", () => {
    const endpoints = graphqlOperationsToEndpoints([], "empty-service");
    expect(endpoints).toHaveLength(0);
  });
});
