import { readFile } from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import type { ParsedSpec, Endpoint, Service, SchemaInfo } from "../types/index.js";

/**
 * Parse a single OpenAPI/Swagger spec file
 */
export async function parseSpec(filePath: string): Promise<ParsedSpec> {
  const content = await readFile(filePath, "utf-8");
  const spec = parseFileContent(filePath, content);

  const serviceName = deriveServiceName(filePath, spec);
  const specVersion = deriveSpecVersion(spec);
  const serverUrls = extractServerUrls(spec);
  const endpoints = extractEndpoints(spec, serviceName);
  const referencedUrls = extractReferencedUrls(spec);

  const service: Service = {
    name: serviceName,
    baseUrls: serverUrls,
    specFile: filePath,
    specVersion,
    endpointCount: endpoints.length,
  };

  return {
    service,
    endpoints,
    serverUrls,
    referencedUrls,
  };
}

/** Parse file content based on extension */
function parseFileContent(filePath: string, content: string): Record<string, unknown> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".json") {
    return JSON.parse(content) as Record<string, unknown>;
  }

  // YAML
  return yaml.load(content) as Record<string, unknown>;
}

/** Derive service name from spec title or folder name */
function deriveServiceName(filePath: string, spec: Record<string, unknown>): string {
  const info = spec.info as Record<string, unknown> | undefined;
  if (info?.title && typeof info.title === "string") {
    return slugify(info.title);
  }
  const dir = path.dirname(filePath);
  return path.basename(dir);
}

/** Get OpenAPI/Swagger version */
function deriveSpecVersion(spec: Record<string, unknown>): string {
  if (typeof spec.openapi === "string") return spec.openapi;
  if (typeof spec.swagger === "string") return spec.swagger;
  return "unknown";
}

/** Extract server URLs from the spec */
function extractServerUrls(spec: Record<string, unknown>): string[] {
  const urls: string[] = [];

  // OpenAPI 3.x: servers array
  if (Array.isArray(spec.servers)) {
    for (const server of spec.servers) {
      if (server?.url && typeof server.url === "string") {
        urls.push(server.url);
      }
    }
  }

  // Swagger 2.x: host + basePath
  if (typeof spec.host === "string") {
    const scheme =
      Array.isArray(spec.schemes) && spec.schemes.length > 0 ? spec.schemes[0] : "https";
    const basePath = typeof spec.basePath === "string" ? spec.basePath : "";
    urls.push(`${scheme}://${spec.host}${basePath}`);
  }

  return urls;
}

/** Extract all endpoints from the spec */
function extractEndpoints(spec: Record<string, unknown>, serviceName: string): Endpoint[] {
  const endpoints: Endpoint[] = [];
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;

  if (!paths) return endpoints;

  const httpMethods = ["get", "post", "put", "delete", "patch", "head", "options"];

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;

    for (const method of httpMethods) {
      const operation = pathItem[method] as Record<string, unknown> | undefined;
      if (!operation) continue;

      const endpoint: Endpoint = {
        service: serviceName,
        method: method.toUpperCase(),
        path: pathStr,
        summary: typeof operation.summary === "string" ? operation.summary : undefined,
      };

      const requestBody = extractRequestBodySchema(operation);
      if (requestBody) endpoint.requestBody = requestBody;

      const response = extractResponseSchema(operation);
      if (response) endpoint.response = response;

      endpoints.push(endpoint);
    }
  }

  return endpoints;
}

/** Extract simplified request body schema */
function extractRequestBodySchema(operation: Record<string, unknown>): SchemaInfo | undefined {
  const requestBody = operation.requestBody as Record<string, unknown> | undefined;
  if (!requestBody) return undefined;

  const content = requestBody.content as Record<string, unknown> | undefined;
  if (!content) return undefined;

  const jsonContent = content["application/json"] as Record<string, unknown> | undefined;
  if (!jsonContent?.schema) return undefined;

  return simplifySchema(jsonContent.schema as Record<string, unknown>);
}

/** Extract simplified response schema (first 2xx response) */
function extractResponseSchema(operation: Record<string, unknown>): SchemaInfo | undefined {
  const responses = operation.responses as Record<string, unknown> | undefined;
  if (!responses) return undefined;

  for (const code of ["200", "201", "202", "204"]) {
    const response = responses[code] as Record<string, unknown> | undefined;
    if (!response) continue;

    // OpenAPI 3.x
    const content = response.content as Record<string, unknown> | undefined;
    if (content) {
      const jsonContent = content["application/json"] as Record<string, unknown> | undefined;
      if (jsonContent?.schema) {
        return simplifySchema(jsonContent.schema as Record<string, unknown>);
      }
    }

    // Swagger 2.x
    if (response.schema) {
      return simplifySchema(response.schema as Record<string, unknown>);
    }
  }

  return undefined;
}

/** Simplify a JSON schema to just type + top-level property names */
function simplifySchema(schema: Record<string, unknown>): SchemaInfo {
  const type = (typeof schema.type === "string" ? schema.type : "object") as string;
  const result: SchemaInfo = { type };

  if (schema.properties && typeof schema.properties === "object") {
    const props: Record<string, string> = {};
    for (const [key, value] of Object.entries(schema.properties as Record<string, unknown>)) {
      const prop = value as Record<string, unknown>;
      props[key] = typeof prop.type === "string" ? prop.type : "object";
    }
    result.properties = props;
  }

  if (type === "array" && schema.items && typeof schema.items === "object") {
    const items = schema.items as Record<string, unknown>;
    if (items.properties && typeof items.properties === "object") {
      const props: Record<string, string> = {};
      for (const [key, value] of Object.entries(items.properties as Record<string, unknown>)) {
        const prop = value as Record<string, unknown>;
        props[key] = typeof prop.type === "string" ? prop.type : "object";
      }
      result.properties = props;
    }
  }

  return result;
}

/** Extract URLs referenced in descriptions and other text fields */
function extractReferencedUrls(spec: Record<string, unknown>): string[] {
  const urls = new Set<string>();
  const urlRegex = /https?:\/\/[^\s"'<>)}\]]+/g;

  function walk(obj: unknown): void {
    if (typeof obj === "string") {
      const matches = obj.match(urlRegex);
      if (matches) {
        for (const match of matches) urls.add(match);
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
    } else if (obj && typeof obj === "object") {
      for (const value of Object.values(obj)) walk(value);
    }
  }

  walk(spec);
  return Array.from(urls);
}

/** Convert a string to a URL-friendly slug */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
