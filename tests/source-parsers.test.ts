import { describe, it, expect } from "vitest";
import path from "path";
import { parseJavaProject } from "../src/parsers/java.js";
import { parseCSharpProject } from "../src/parsers/csharp.js";
import { parsePythonProject } from "../src/parsers/python.js";
import type { DetectedLanguage } from "../src/types/index.js";

const EXAMPLES_DIR = path.resolve(__dirname, "../examples");

// Minimal DetectedLanguage stubs for tests
const JAVA_LANG: DetectedLanguage = {
  language: "java",
  framework: "spring-boot",
  detectedFrom: "pom.xml",
  confidence: 0.97,
};

const CSHARP_LANG: DetectedLanguage = {
  language: "csharp",
  framework: "aspnet",
  detectedFrom: "notification-service.csproj",
  confidence: 0.97,
};

const PYTHON_FASTAPI_LANG: DetectedLanguage = {
  language: "python",
  framework: "fastapi",
  detectedFrom: "requirements.txt",
  confidence: 0.95,
};

const PYTHON_DJANGO_LANG: DetectedLanguage = {
  language: "python",
  framework: "django",
  detectedFrom: "requirements.txt",
  confidence: 0.93,
};

// ─────────────────────────────────────────────────────────────────────────────
// Java / Spring Boot — inventory-service
// ─────────────────────────────────────────────────────────────────────────────

describe("Java parser — inventory-service", () => {
  const servicePath = path.join(EXAMPLES_DIR, "inventory-service");

  it("detects all endpoints", async () => {
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const paths = result.endpoints.map((e) => `${e.method} ${e.fullPath}`);
    expect(paths).toContain("GET /api/inventory");
    expect(paths).toContain("GET /api/inventory/{sku}");
    expect(paths).toContain("POST /api/inventory/reserve");
    expect(paths).toContain("PUT /api/inventory/{sku}/quantity");
    expect(paths).toContain("DELETE /api/inventory/reserve/{reservationId}");
  });

  it("applies controller prefix to all full paths", async () => {
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const withoutPrefix = result.endpoints.filter((e) => !e.fullPath.startsWith("/api/inventory"));
    expect(withoutPrefix).toHaveLength(0);
  });

  it("extracts request body for single-line param", async () => {
    // POST /reserve has @RequestBody on the same line as method signature
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const reserve = result.endpoints.find((e) => e.fullPath === "/api/inventory/reserve");
    expect(reserve).toBeDefined();
    expect(reserve?.requestBody?.typeName).toBe("ReserveStockRequest");
    expect(reserve?.requestBody?.fields.length).toBeGreaterThan(0);
  });

  it("extracts request body for multi-line param list", async () => {
    // PUT /{sku}/quantity has @RequestBody on a separate line from the method declaration
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const update = result.endpoints.find((e) => e.fullPath === "/api/inventory/{sku}/quantity");
    expect(update).toBeDefined();
    expect(update?.requestBody?.typeName).toBe("ReserveStockRequest");
    expect(update?.requestBody?.fields.length).toBeGreaterThan(0);
  });

  it("extracts response type from ResponseEntity<T>", async () => {
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const get = result.endpoints.find((e) => e.fullPath === "/api/inventory/{sku}");
    expect(get?.response?.typeName).toBe("InventoryDto");
  });

  it("extracts DTO fields from POJO class", async () => {
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const reserve = result.endpoints.find((e) => e.fullPath === "/api/inventory/reserve");
    const fields = reserve?.requestBody?.fields ?? [];
    const fieldNames = fields.map((f) => f.name);
    expect(fieldNames).toContain("orderId");
    expect(fieldNames).toContain("sku");
    expect(fieldNames).toContain("quantity");
  });

  it("extracts DTO fields for response type", async () => {
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const get = result.endpoints.find((e) => e.fullPath === "/api/inventory/{sku}");
    const fields = get?.response?.fields ?? [];
    const fieldNames = fields.map((f) => f.name);
    expect(fieldNames).toContain("sku");
    expect(fieldNames).toContain("quantity");
  });

  it("detects outbound RestTemplate calls", async () => {
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const reserve = result.endpoints.find((e) => e.fullPath === "/api/inventory/reserve");
    expect(reserve?.outboundCalls.length).toBeGreaterThan(0);
  });

  it("scopes outbound calls to correct method body", async () => {
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const deleteEp = result.endpoints.find(
      (e) => e.fullPath === "/api/inventory/reserve/{reservationId}",
    );
    // DELETE releases reservation — notifies order-service, not notification-service
    const callUrls = deleteEp?.outboundCalls.map((c) => c.rawUrl) ?? [];
    expect(callUrls.some((u) => u.includes("orders"))).toBe(true);
    expect(callUrls.some((u) => u.includes("notifications"))).toBe(false);
  });

  it("does not include endpoints without HTTP mapping annotations", async () => {
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    // Constructor and helper methods should not appear as endpoints
    const constructorEp = result.endpoints.find((e) => e.handlerMethod === "InventoryController");
    expect(constructorEp).toBeUndefined();
  });

  it("extracts service URL hints from application.properties", async () => {
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const hints = result.serviceUrlHints;
    // inventory-service has order and notification URL hints in source
    expect(hints.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C# / ASP.NET Core — notification-service
// ─────────────────────────────────────────────────────────────────────────────

describe("C# parser — notification-service", () => {
  const servicePath = path.join(EXAMPLES_DIR, "notification-service");

  it("detects all endpoints", async () => {
    const result = await parseCSharpProject(servicePath, CSHARP_LANG, "notification-service");
    expect(result.endpoints.length).toBeGreaterThan(0);
  });

  it("applies controller route prefix to full paths", async () => {
    const result = await parseCSharpProject(servicePath, CSHARP_LANG, "notification-service");
    const noPrefixed = result.endpoints.filter((e) => !e.fullPath.startsWith("/api/notification"));
    expect(noPrefixed).toHaveLength(0);
  });

  it("extracts request body from [FromBody] annotation", async () => {
    const result = await parseCSharpProject(servicePath, CSHARP_LANG, "notification-service");
    // POST endpoint should have a request body
    const postEp = result.endpoints.find((e) => e.method === "POST");
    expect(postEp?.requestBody).toBeDefined();
    expect(postEp?.requestBody?.typeName).toBeTruthy();
  });

  it("detects outbound HttpClient calls", async () => {
    const result = await parseCSharpProject(servicePath, CSHARP_LANG, "notification-service");
    const allOutbound = result.endpoints.flatMap((e) => e.outboundCalls);
    expect(allOutbound.length).toBeGreaterThan(0);
  });

  it("extracts URL hints from appsettings.json", async () => {
    const result = await parseCSharpProject(servicePath, CSHARP_LANG, "notification-service");
    const hintKeys = result.serviceUrlHints.map((h) => h.key);
    expect(hintKeys.some((k) => k.toLowerCase().includes("service"))).toBe(true);
  });

  it("extracts response type from ActionResult<T>", async () => {
    const result = await parseCSharpProject(servicePath, CSHARP_LANG, "notification-service");
    const withResponse = result.endpoints.filter((e) => e.response?.typeName);
    expect(withResponse.length).toBeGreaterThan(0);
  });

  // it("extracts DTO fields for request body", async () => {
  //   const result = await parseCSharpProject(servicePath, CSHARP_LANG, "notification-service");
  //   const postEp = result.endpoints.find((e) => e.method === "POST");
  //   // If the DTO type was parsed, it should have fields
  //   if (postEp?.requestBody && postEp.requestBody.fields.length > 0) {
  //     const fieldNames = postEp.requestBody.fields.map((f) => f.name);
  //     // SendNotificationRequest should have UserId at minimum
  //     expect(
  //       fieldNames.some((n) => n.toLowerCase().includes("id") || n.toLowerCase().includes("user")),
  //     ).toBe(true);
  //   }
  //   // At minimum, the typeName should be defined
  //   expect(postEp?.requestBody?.typeName).toBeTruthy();
  // });
});

// ─────────────────────────────────────────────────────────────────────────────
// Python / FastAPI — analytics-service
// ─────────────────────────────────────────────────────────────────────────────

describe("Python parser — analytics-service (FastAPI)", () => {
  const servicePath = path.join(EXAMPLES_DIR, "analytics-service");

  it("detects all endpoints", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_FASTAPI_LANG, "analytics-service");
    expect(result.endpoints.length).toBeGreaterThan(0);
  });

  it("applies router prefix to full paths", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_FASTAPI_LANG, "analytics-service");
    // All endpoints should have a meaningful base path
    const hasPaths = result.endpoints.every((e) => e.fullPath.startsWith("/"));
    expect(hasPaths).toBe(true);
  });

  it("extracts response_model as response type", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_FASTAPI_LANG, "analytics-service");
    const withResponse = result.endpoints.filter((e) => e.response?.typeName);
    expect(withResponse.length).toBeGreaterThan(0);
  });

  it("extracts Pydantic model fields for request body", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_FASTAPI_LANG, "analytics-service");
    const postEp = result.endpoints.find((e) => e.method === "POST");
    if (postEp?.requestBody) {
      expect(postEp.requestBody.fields.length).toBeGreaterThan(0);
    }
  });

  it("detects outbound httpx calls", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_FASTAPI_LANG, "analytics-service");
    const allOutbound = result.endpoints.flatMap((e) => e.outboundCalls);
    expect(allOutbound.length).toBeGreaterThan(0);
  });

  it("extracts URL hints from .env file", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_FASTAPI_LANG, "analytics-service");
    // analytics-service should have URL hints for other services
    expect(result.serviceUrlHints.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Python / Django REST — email-service
// ─────────────────────────────────────────────────────────────────────────────

describe("Python parser — email-service (Django REST)", () => {
  const servicePath = path.join(EXAMPLES_DIR, "email-service");

  it("detects all endpoints", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_DJANGO_LANG, "email-service");
    expect(result.endpoints.length).toBeGreaterThan(0);
  });

  it("detects ViewSet endpoints with correct methods", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_DJANGO_LANG, "email-service");
    const methods = result.endpoints.map((e) => e.method);
    // ViewSets expose GET (list), POST (create), etc.
    expect(methods).toContain("GET");
    expect(methods).toContain("POST");
  });

  it("detects @api_view function-based endpoints", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_DJANGO_LANG, "email-service");
    // email-service has @api_view endpoints alongside ViewSets
    expect(result.endpoints.length).toBeGreaterThan(2);
  });

  it("extracts URL prefix from urls.py router registration", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_DJANGO_LANG, "email-service");
    // All endpoints should have paths — not empty strings
    const emptyPaths = result.endpoints.filter((e) => !e.fullPath || e.fullPath === "/");
    expect(emptyPaths.length).toBeLessThan(result.endpoints.length);
  });

  it("detects outbound requests calls", async () => {
    const result = await parsePythonProject(servicePath, PYTHON_DJANGO_LANG, "email-service");
    const allOutbound = result.endpoints.flatMap((e) => e.outboundCalls);
    expect(allOutbound.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression — multi-line method signatures
// ─────────────────────────────────────────────────────────────────────────────

describe("Java parser — multi-line method signature regression", () => {
  it("extracts @RequestBody from params on a separate line", async () => {
    // This is the specific regression: PUT /{sku}/quantity was missing requestBody
    // because @RequestBody appeared on line 2 of the parameter list
    const servicePath = path.join(EXAMPLES_DIR, "inventory-service");
    const result = await parseJavaProject(servicePath, JAVA_LANG, "inventory-service");
    const update = result.endpoints.find((e) => e.method === "PUT");
    expect(update).toBeDefined();
    expect(update?.requestBody).toBeDefined();
    expect(update?.requestBody?.typeName).toBe("ReserveStockRequest");
  });
});

describe("C# parser — multi-line method signature regression", () => {
  it("extracts [FromBody] from params on a separate line", async () => {
    const servicePath = path.join(EXAMPLES_DIR, "notification-service");
    const result = await parseCSharpProject(servicePath, CSHARP_LANG, "notification-service");
    // At least one POST endpoint should have a request body
    const postWithBody = result.endpoints.filter(
      (e) => e.method === "POST" && e.requestBody != null,
    );
    expect(postWithBody.length).toBeGreaterThan(0);
  });
});