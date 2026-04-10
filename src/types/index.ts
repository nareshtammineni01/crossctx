/**
 * Core types for CrossCtx
 * Designed to be token-efficient and LLM-friendly
 */

/** Represents a single API endpoint */
export interface Endpoint {
  /** Service this endpoint belongs to */
  service: string;
  /** HTTP method (GET, POST, PUT, DELETE, etc.) */
  method: string;
  /** URL path (e.g., /users/{id}) */
  path: string;
  /** Short summary from OpenAPI spec */
  summary?: string;
  /** Request body schema (simplified) */
  requestBody?: SchemaInfo;
  /** Response schema (simplified, primary success response) */
  response?: SchemaInfo;
}

/** Simplified schema representation */
export interface SchemaInfo {
  type: string;
  properties?: Record<string, string>;
}

/** Represents a discovered service */
export interface Service {
  /** Service name (derived from folder or spec info.title) */
  name: string;
  /** Base URL(s) from servers field */
  baseUrls: string[];
  /** Path to the OpenAPI spec file */
  specFile: string;
  /** OpenAPI version (2.0, 3.0.x, 3.1.x) */
  specVersion: string;
  /** Number of endpoints */
  endpointCount: number;
}

/** Represents a dependency between two services */
export interface Dependency {
  /** Source service (the one making the call) */
  from: string;
  /** Target service (the one being called) */
  to: string;
  /** How the dependency was detected */
  detectedVia: "server-url" | "schema-ref" | "description";
  /** Evidence for the dependency */
  evidence: string;
}

/** Complete CrossCtx output */
export interface CrossCtxOutput {
  /** Metadata about the scan */
  meta: {
    generatedAt: string;
    version: string;
    scanPaths: string[];
    totalFiles: number;
  };
  /** Discovered services */
  services: Service[];
  /** All endpoints across services */
  endpoints: Endpoint[];
  /** Inter-service dependencies */
  dependencies: Dependency[];
}

/** Internal: result of scanning for OpenAPI files */
export interface ScanResult {
  filePath: string;
  relativePath: string;
}

/** Internal: result of parsing a single OpenAPI spec */
export interface ParsedSpec {
  service: Service;
  endpoints: Endpoint[];
  /** Raw server URLs for dependency analysis */
  serverUrls: string[];
  /** URLs/domains referenced in descriptions or schemas */
  referencedUrls: string[];
}
