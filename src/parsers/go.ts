import { readFile } from "fs/promises";
import path from "path";
import fg from "fast-glob";
import type {
  CodeScanResult,
  SourceEndpoint,
  OutboundCall,
  PayloadShape,
  PayloadField,
  ServiceUrlHint,
  DetectedLanguage,
} from "../types/index.js";

const IGNORE = ["**/vendor/**", "**/.git/**", "**/*_test.go", "**/testdata/**", "**/*.pb.go"];

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function parseGoProject(
  projectPath: string,
  language: DetectedLanguage,
  serviceName: string,
): Promise<CodeScanResult> {
  const goFiles = await fg(["**/*.go"], {
    cwd: projectPath,
    ignore: IGNORE,
    absolute: true,
    onlyFiles: true,
  });

  // Read all files
  const fileContents = new Map<string, string>();
  for (const file of goFiles) {
    try {
      fileContents.set(file, await readFile(file, "utf-8"));
    } catch {
      /* skip */
    }
  }

  // Extract DTOs/structs first
  const dtoMap = extractGoStructs(fileContents);

  // Extract service URL hints from constants and environment variables
  const serviceUrlHints = extractGoServiceUrlHints(fileContents);

  // Parse endpoints from handlers
  const endpoints = extractGoEndpoints(fileContents, serviceName, dtoMap);

  // Check for OpenAPI spec (optional)
  const specFile = await findOpenApiSpec(projectPath);

  return {
    projectPath,
    language,
    serviceName,
    endpoints,
    dtos: Array.from(dtoMap.values()),
    serviceUrlHints,
    hasOpenApiSpec: !!specFile,
    specFile: specFile ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint extraction (Gin, Chi, Gorilla Mux, stdlib)
// ─────────────────────────────────────────────────────────────────────────────

function extractGoEndpoints(
  fileContents: Map<string, string>,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];

  // Build a map of router groups for prefix handling (two-pass approach)
  const routerGroupMap = buildRouterGroupMap(fileContents);

  // Build combined content for cross-file handler lookup
  const allContent = Array.from(fileContents.values()).join("\n");

  for (const [filePath, content] of fileContents) {
    if (!isHandlerFile(filePath, content)) continue;

    const fileEndpoints = extractEndpointsFromFile(
      content,
      filePath,
      serviceName,
      dtoMap,
      routerGroupMap,
      allContent,
    );
    endpoints.push(...fileEndpoints);
  }

  return endpoints;
}

function isHandlerFile(filePath: string, content: string): boolean {
  if (!filePath.endsWith(".go")) return false;

  return (
    content.includes("http.HandleFunc") ||
    content.includes("r.GET(") ||
    content.includes("r.POST(") ||
    content.includes("r.PUT(") ||
    content.includes("r.DELETE(") ||
    content.includes("r.Route(") ||
    content.includes("router.") ||
    content.includes("mux.") ||
    content.includes("Handler") ||
    content.includes("handler")
  );
}

interface RouterGroupInfo {
  variable: string;
  prefix: string;
  filePath: string;
}

/**
 * Build a map of router groups and their prefixes for path resolution.
 * Handles patterns like:
 *   v1 := r.Group("/api/v1")
 *   r.Route("/api", func(r chi.Router) { ... })
 */
function buildRouterGroupMap(fileContents: Map<string, string>): Map<string, RouterGroupInfo> {
  const groupMap = new Map<string, RouterGroupInfo>();

  for (const [filePath, content] of fileContents) {
    // Gin groups: v1 := r.Group("/api/v1") OR orders := v1.Group("/orders")
    // Match any variable := anyVar.Group("/prefix")
    const ginGroupRegex = /(\w+)\s*:=\s*(\w+)\.Group\(\s*["']([^"']+)["']\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = ginGroupRegex.exec(content)) !== null) {
      const newVar = match[1];
      const parentVar = match[2];
      const localPrefix = match[3];
      // Resolve transitive prefix: if parentVar already has a prefix, prepend it
      const parentInfo = groupMap.get(parentVar);
      const fullPrefix = parentInfo ? combinePaths(parentInfo.prefix, localPrefix) : localPrefix;
      groupMap.set(newVar, { variable: newVar, prefix: fullPrefix, filePath });
    }
  }

  return groupMap;
}

function extractEndpointsFromFile(
  content: string,
  filePath: string,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
  routerGroupMap: Map<string, RouterGroupInfo>,
  allContent: string,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];
  const allOutboundCalls = extractGoOutboundCalls(content, filePath);

  // Pattern 1: Gin routes (r.GET, r.POST, etc.)
  const ginEndpoints = extractGinEndpoints(
    content,
    filePath,
    serviceName,
    dtoMap,
    routerGroupMap,
    allOutboundCalls,
    allContent,
  );
  endpoints.push(...ginEndpoints);

  // Pattern 2: Chi routes (r.Get, r.Post, etc.)
  const chiEndpoints = extractChiEndpoints(
    content,
    filePath,
    serviceName,
    dtoMap,
    allOutboundCalls,
    allContent,
  );
  endpoints.push(...chiEndpoints);

  // Pattern 3: Gorilla Mux routes (r.HandleFunc)
  const muxEndpoints = extractMuxEndpoints(
    content,
    filePath,
    serviceName,
    dtoMap,
    allOutboundCalls,
    allContent,
  );
  endpoints.push(...muxEndpoints);

  // Pattern 4: stdlib http.HandleFunc
  const stdlibEndpoints = extractStdlibEndpoints(
    content,
    filePath,
    serviceName,
    dtoMap,
    allOutboundCalls,
    allContent,
  );
  endpoints.push(...stdlibEndpoints);

  return endpoints;
}

function extractGinEndpoints(
  content: string,
  filePath: string,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
  routerGroupMap: Map<string, RouterGroupInfo>,
  allOutboundCalls: OutboundCall[],
  allContent: string,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];
  // Match: routerVar.GET("/path", handler) or routerVar.GET("", ctrl.Method) (empty path allowed)
  const ginRouteRegex =
    /(\w+)\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s*\(\s*["']([^"']*)["']\s*,\s*([\w.]+)\s*\)/gi;

  let match: RegExpExecArray | null;
  while ((match = ginRouteRegex.exec(content)) !== null) {
    const routerVar = match[1];
    const method = match[2].toUpperCase();
    const routePath = match[3];
    // handler can be "funcName" or "ctrl.MethodName" — extract just the method name
    const handlerName = match[4].includes(".") ? match[4].split(".").pop()! : match[4];

    const lineNum = content.substring(0, match.index).split("\n").length;

    // Resolve router group prefix if applicable
    const groupInfo = routerGroupMap.get(routerVar);
    const prefix = groupInfo?.prefix ?? "";
    const fullPath = combinePaths(prefix, routePath);

    // Try to find request/response types from handler signature
    // Use allContent for cross-file handler lookup (routes in main.go, handlers in handlers/*.go)
    const { requestBody, response } = extractRequestResponseFromHandler(
      allContent,
      handlerName,
      dtoMap,
    );

    // Scope outbound calls to this handler
    const allLines = allContent.split("\n");
    const handlerBodyRange = findHandlerBodyRange(allLines, handlerName);
    const scopedCalls = allOutboundCalls.filter(
      (c) =>
        c.line !== undefined &&
        handlerBodyRange &&
        c.line >= handlerBodyRange.start &&
        c.line <= handlerBodyRange.end,
    );

    endpoints.push({
      service: serviceName,
      method,
      path: routePath,
      fullPath,
      controllerClass: undefined,
      handlerMethod: handlerName,
      summary: undefined,
      requestBody,
      response,
      sourceFile: filePath,
      line: lineNum,
      outboundCalls: scopedCalls,
    });
  }

  return endpoints;
}

function extractChiEndpoints(
  content: string,
  filePath: string,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
  allOutboundCalls: OutboundCall[],
  allContent: string,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];
  const allLines = allContent.split("\n");

  // Match patterns like: r.Get("/path", handler) or r.Post("/path", handler)
  // Chi uses lowercase method names: Get, Post, Put, Delete, Patch
  const chiRouteRegex =
    /r\.(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/gi;

  let match: RegExpExecArray | null;
  while ((match = chiRouteRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase(); // Get → GET
    const routePath = match[2];
    const handlerName = match[3];

    const lineNum = content.substring(0, match.index).split("\n").length;
    const fullPath = normalizePath(routePath);

    const { requestBody, response } = extractRequestResponseFromHandler(
      allContent,
      handlerName,
      dtoMap,
    );

    const handlerBodyRange = findHandlerBodyRange(allLines, handlerName);
    const scopedCalls = allOutboundCalls.filter(
      (c) =>
        c.line !== undefined &&
        handlerBodyRange &&
        c.line >= handlerBodyRange.start &&
        c.line <= handlerBodyRange.end,
    );

    endpoints.push({
      service: serviceName,
      method,
      path: routePath,
      fullPath,
      controllerClass: undefined,
      handlerMethod: handlerName,
      summary: undefined,
      requestBody,
      response,
      sourceFile: filePath,
      line: lineNum,
      outboundCalls: scopedCalls,
    });
  }

  // Also handle Chi Route groups: r.Route("/api", func(r chi.Router) { ... })
  const chiRouteGroupRegex =
    /r\.Route\s*\(\s*["']([^"']+)["']\s*,\s*func\s*\(\s*r\s+chi\.Router\s*\)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/gs;
  let groupMatch: RegExpExecArray | null;

  while ((groupMatch = chiRouteGroupRegex.exec(content)) !== null) {
    const groupPrefix = groupMatch[1];
    const groupBody = groupMatch[2];

    // Extract routes within the group
    const groupRouteRegex =
      /r\.(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/gi;
    let innerMatch: RegExpExecArray | null;

    while ((innerMatch = groupRouteRegex.exec(groupBody)) !== null) {
      const method = innerMatch[1].toUpperCase();
      const routePath = innerMatch[2];
      const handlerName = innerMatch[3];

      const lineNum = content.substring(0, groupMatch.index + innerMatch.index).split("\n").length;
      const fullPath = combinePaths(groupPrefix, routePath);

      const { requestBody, response } = extractRequestResponseFromHandler(
        allContent,
        handlerName,
        dtoMap,
      );

      const handlerBodyRange = findHandlerBodyRange(allLines, handlerName);
      const scopedCalls = allOutboundCalls.filter(
        (c) =>
          c.line !== undefined &&
          handlerBodyRange &&
          c.line >= handlerBodyRange.start &&
          c.line <= handlerBodyRange.end,
      );

      endpoints.push({
        service: serviceName,
        method,
        path: routePath,
        fullPath,
        controllerClass: undefined,
        handlerMethod: handlerName,
        summary: undefined,
        requestBody,
        response,
        sourceFile: filePath,
        line: lineNum,
        outboundCalls: scopedCalls,
      });
    }
  }

  return endpoints;
}

function extractMuxEndpoints(
  content: string,
  filePath: string,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
  allOutboundCalls: OutboundCall[],
  allContent: string,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];
  const allLines = allContent.split("\n");

  // Gorilla Mux pattern: r.HandleFunc("/path", handler).Methods("GET", "POST")
  // Also: router.Path("/path").HandlerFunc(handler).Methods("GET")
  const muxRegex =
    /(?:r|router)\.(?:HandleFunc|Path)\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)(?:\.Methods\s*\(\s*([^)]+)\s*\))?/gi;

  let match: RegExpExecArray | null;
  while ((match = muxRegex.exec(content)) !== null) {
    const routePath = match[1];
    const handlerName = match[2];
    const methodsStr = match[3]; // e.g., "GET", "POST" or "GET", "POST"

    const lineNum = content.substring(0, match.index).split("\n").length;
    const fullPath = normalizePath(routePath);

    // Parse methods from the Methods() clause
    const methods = methodsStr
      ? methodsStr.split(",").map((m) => m.trim().replace(/["']/g, "").toUpperCase())
      : ["GET"];

    for (const method of methods) {
      const { requestBody, response } = extractRequestResponseFromHandler(
        allContent,
        handlerName,
        dtoMap,
      );

      const handlerBodyRange = findHandlerBodyRange(allLines, handlerName);
      const scopedCalls = allOutboundCalls.filter(
        (c) =>
          c.line !== undefined &&
          handlerBodyRange &&
          c.line >= handlerBodyRange.start &&
          c.line <= handlerBodyRange.end,
      );

      endpoints.push({
        service: serviceName,
        method,
        path: routePath,
        fullPath,
        controllerClass: undefined,
        handlerMethod: handlerName,
        summary: undefined,
        requestBody,
        response,
        sourceFile: filePath,
        line: lineNum,
        outboundCalls: scopedCalls,
      });
    }
  }

  return endpoints;
}

function extractStdlibEndpoints(
  content: string,
  filePath: string,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
  allOutboundCalls: OutboundCall[],
  allContent: string,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];
  const allLines = allContent.split("\n");

  // stdlib pattern: http.HandleFunc("/path", handler)
  const stdlibRegex = /http\.HandleFunc\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/gi;

  let match: RegExpExecArray | null;
  while ((match = stdlibRegex.exec(content)) !== null) {
    const routePath = match[1];
    const handlerName = match[2];

    const lineNum = content.substring(0, match.index).split("\n").length;
    const fullPath = normalizePath(routePath);

    // stdlib http handlers typically handle all methods (POST to GET translation)
    // We'll detect from the handler body
    const { requestBody, response } = extractRequestResponseFromHandler(
      allContent,
      handlerName,
      dtoMap,
    );

    const handlerBodyRange = findHandlerBodyRange(allLines, handlerName);
    const scopedCalls = allOutboundCalls.filter(
      (c) =>
        c.line !== undefined &&
        handlerBodyRange &&
        c.line >= handlerBodyRange.start &&
        c.line <= handlerBodyRange.end,
    );

    endpoints.push({
      service: serviceName,
      method: "GET", // default for stdlib
      path: routePath,
      fullPath,
      controllerClass: undefined,
      handlerMethod: handlerName,
      summary: undefined,
      requestBody,
      response,
      sourceFile: filePath,
      line: lineNum,
      outboundCalls: scopedCalls,
    });
  }

  return endpoints;
}

/**
 * Extract request and response types from a handler signature and body.
 * Gin: func (h *OrderHandler) GetOrder(c *gin.Context) { }
 * Chi: func GetOrder(w http.ResponseWriter, r *http.Request) { }
 * Stdlib: same as Chi
 */
function extractRequestResponseFromHandler(
  content: string,
  handlerName: string,
  dtoMap: Map<string, PayloadShape>,
): { requestBody?: PayloadShape; response?: PayloadShape } {
  let requestBody: PayloadShape | undefined;
  let response: PayloadShape | undefined;

  // Find the handler function definition and body
  const handlerRegex = new RegExp(
    `func\\s+(?:\\(\\s*\\w+\\s+\\*?\\w+\\s*\\))?\\s*${handlerName}\\s*\\([^)]*\\)\\s*(?:\\([^)]*\\))?\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*?)\\}`,
    "s",
  );

  const handlerMatch = handlerRegex.exec(content);
  if (!handlerMatch) {
    return { requestBody, response };
  }

  const handlerBody = handlerMatch[1];

  // Try to detect request body patterns
  // Pattern 1: json.NewDecoder(r.Body).Decode(&req)
  const decoderRegex = /json\.NewDecoder\s*\(\s*\w+\.Body\s*\)\.Decode\s*\(\s*&(\w+)\s*\)/;
  const decoderMatch = decoderRegex.exec(handlerBody);
  if (decoderMatch) {
    const varName = decoderMatch[1];
    const typeInfo = findVariableType(handlerBody, varName);
    if (typeInfo && dtoMap.has(typeInfo)) {
      requestBody = dtoMap.get(typeInfo)!;
    } else if (typeInfo) {
      requestBody = { typeName: typeInfo, fields: [], source: "dto-class" };
    }
  }

  // Pattern 2: ctx.ShouldBindJSON(&req) or c.ShouldBindJSON(&req) (Gin — any context var name)
  const bindRegex = /\w+\.ShouldBindJSON\s*\(\s*&(\w+)\s*\)/;
  const bindMatch = bindRegex.exec(handlerBody);
  if (bindMatch) {
    const varName = bindMatch[1];
    const typeInfo = findVariableType(handlerBody, varName);
    if (typeInfo && dtoMap.has(typeInfo)) {
      requestBody = dtoMap.get(typeInfo)!;
    } else if (typeInfo) {
      requestBody = { typeName: typeInfo, fields: [], source: "dto-class" };
    }
  }

  // Pattern 3: render.Bind(r, &req) (Chi)
  const renderBindRegex = /render\.Bind\s*\(\s*\w+\s*,\s*&(\w+)\s*\)/;
  const renderBindMatch = renderBindRegex.exec(handlerBody);
  if (renderBindMatch) {
    const varName = renderBindMatch[1];
    const typeInfo = findVariableType(handlerBody, varName);
    if (typeInfo && dtoMap.has(typeInfo)) {
      requestBody = dtoMap.get(typeInfo)!;
    } else if (typeInfo) {
      requestBody = { typeName: typeInfo, fields: [], source: "dto-class" };
    }
  }

  // Try to detect response patterns
  // Pattern 1: json.NewEncoder(w).Encode(data) or json.NewEncoder(w).Encode(TypeName{})
  const encodeRegex = /json\.NewEncoder\s*\(\s*\w+\s*\)\.Encode\s*\(\s*(&?\w+(?:\{\})?)\s*\)/;
  const encodeMatch = encodeRegex.exec(handlerBody);
  if (encodeMatch) {
    let expr = encodeMatch[1].replace(/[&{}]/g, "");
    if (expr.includes(".")) expr = expr.split(".").pop()!;
    if (dtoMap.has(expr)) {
      response = dtoMap.get(expr)!;
    } else if (/^[A-Z]/.test(expr) && expr !== "TypeName") {
      response = { typeName: expr, fields: [], source: "inferred" };
    } else if (/^[a-z]/.test(expr)) {
      const typeInfo = findVariableType(handlerBody, expr);
      if (typeInfo && dtoMap.has(typeInfo)) {
        response = dtoMap.get(typeInfo)!;
      } else if (typeInfo && /^[A-Z]/.test(typeInfo)) {
        response = { typeName: typeInfo, fields: [], source: "inferred" };
      }
    }
  }

  // Pattern 2: ctx.JSON(200, data) or ctx.JSON(http.StatusOK, TypeName{}) (Gin — any context var)
  // Captures second argument: the response value
  const ginJsonRegex = /\w+\.JSON\s*\(\s*(?:\d+|http\.Status\w+)\s*,\s*(&?[\w.]+(?:\{\})?)\s*\)/;
  const ginJsonMatch = ginJsonRegex.exec(handlerBody);
  if (ginJsonMatch) {
    let expr = ginJsonMatch[1].replace(/[&{}]/g, "");
    // Strip package qualifier: models.OrderResponse → OrderResponse
    if (expr.includes(".")) expr = expr.split(".").pop()!;
    if (dtoMap.has(expr)) {
      response = dtoMap.get(expr)!;
    } else if (/^[A-Z]/.test(expr)) {
      response = { typeName: expr, fields: [], source: "inferred" };
    } else if (/^[a-z]/.test(expr)) {
      // Local variable — try to resolve its type
      const typeInfo = findVariableType(handlerBody, expr);
      if (typeInfo && dtoMap.has(typeInfo)) {
        response = dtoMap.get(typeInfo)!;
      } else if (typeInfo && /^[A-Z]/.test(typeInfo)) {
        response = { typeName: typeInfo, fields: [], source: "inferred" };
      }
    }
  }

  // Pattern 3: render.JSON(w, r, TypeName{}) (Chi)
  const renderJsonRegex = /render\.JSON\s*\(\s*\w+\s*,\s*\w+\s*,\s*(&?\w+(?:\{\})?)\s*\)/;
  const renderJsonMatch = renderJsonRegex.exec(handlerBody);
  if (renderJsonMatch) {
    const expr = renderJsonMatch[1].replace(/[&{}]/g, "");
    if (dtoMap.has(expr)) {
      response = dtoMap.get(expr)!;
    } else if (/^[A-Z]/.test(expr)) {
      response = { typeName: expr, fields: [], source: "inferred" };
    }
  }

  return { requestBody, response };
}

/**
 * Find the type of a variable by looking backwards from its usage.
 * Matches patterns like:
 *   var req CreateUserRequest
 *   req := CreateUserRequest{}
 *   var req *CreateUserRequest = &CreateUserRequest{}
 */
function findVariableType(body: string, varName: string): string | null {
  // Pattern 1: var req TypeName  or  var req pkg.TypeName
  // Capture optional package qualifier: models.CreateOrderRequest → CreateOrderRequest
  const varRegex = new RegExp(`var\\s+${varName}\\s+(\\*?(?:\\w+\\.)?\\w+)`, "i");
  let match = varRegex.exec(body);
  if (match) {
    const full = match[1].replace(/^\*/, "");
    // Strip package prefix: models.CreateOrderRequest → CreateOrderRequest
    return full.includes(".") ? full.split(".").pop()! : full;
  }

  // Pattern 2: req := TypeName{}  or  req := pkg.TypeName{}
  const assignRegex = new RegExp(`${varName}\\s*:=\\s*(\\*?(?:\\w+\\.)?\\w+)\\s*\\{`, "i");
  match = assignRegex.exec(body);
  if (match) {
    const full = match[1].replace(/^\*/, "");
    return full.includes(".") ? full.split(".").pop()! : full;
  }

  return null;
}

/**
 * Find the body line range of a handler function.
 */
function findHandlerBodyRange(
  lines: string[],
  handlerName: string,
): { start: number; end: number } | null {
  let funcStart = -1;

  // Find the function definition line
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`func`) && lines[i].includes(handlerName)) {
      funcStart = i;
      break;
    }
  }

  if (funcStart === -1) return null;

  // Find opening and closing braces
  let depth = 0;
  let bodyStart = -1;
  let bodyEnd = -1;

  for (let i = funcStart; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        if (bodyStart === -1) bodyStart = i + 1;
      }
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          bodyEnd = i + 1;
          break;
        }
      }
    }
    if (bodyEnd !== -1) break;
  }

  if (bodyStart === -1 || bodyEnd === -1) return null;
  return { start: bodyStart, end: bodyEnd };
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound HTTP call extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractGoOutboundCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  const patterns: Array<{ regex: RegExp; pattern: string; methodIndex: number; urlIndex: number }> =
    [
      // http.Get("url"), http.Post("url", ...), etc.
      {
        regex: /http\.(Get|Post|Put|Delete|Patch|Head)\s*\(\s*["']([^"']+)["']/gi,
        pattern: "http",
        methodIndex: 1,
        urlIndex: 2,
      },
      // client.Get("url"), client.Post("url", ...), etc.
      {
        regex:
          /client\.(Get|Post|Put|Delete|Patch|Head)\s*\(\s*(?:context\.Context.*?,\s*)?["']([^"']+)["']/gi,
        pattern: "http.Client",
        methodIndex: 1,
        urlIndex: 2,
      },
      // http.NewRequest("GET", "url", ...)
      {
        regex: /http\.NewRequest\s*\(\s*["']([A-Z]+)["']\s*,\s*["']([^"']+)["']/gi,
        pattern: "http.Request",
        methodIndex: 1,
        urlIndex: 2,
      },
      // Variable concatenation: serviceURL + "/api/orders"
      {
        regex:
          /(?:http|client)\.(Get|Post|Put|Delete)\s*\(\s*([A-Za-z_]\w*\s*\+\s*["'][^"']+["'])/gi,
        pattern: "http",
        methodIndex: 1,
        urlIndex: 2,
      },
    ];

  for (const { regex, pattern, methodIndex, urlIndex } of patterns) {
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;

    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      const method = (match[methodIndex] ?? "GET").toUpperCase();
      let rawUrl = match[urlIndex] ?? "";

      rawUrl = rawUrl.replace(/^["']|["']$/g, "").trim();
      if (!rawUrl || rawUrl.length < 2) continue;

      calls.push({
        rawUrl,
        method,
        callPattern: pattern,
        sourceFile: filePath,
        line: lineNum,
        confidence: rawUrl.startsWith("http") ? 0.9 : 0.7,
      });
    }
  }

  return deduplicateCalls(calls);
}

// ─────────────────────────────────────────────────────────────────────────────
// Struct/DTO extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractGoStructs(fileContents: Map<string, string>): Map<string, PayloadShape> {
  const dtoMap = new Map<string, PayloadShape>();

  for (const [filePath, content] of fileContents) {
    if (!isStructFile(filePath, content)) continue;

    const shapes = extractGoPayloadShapes(content);
    for (const shape of shapes) {
      if (shape.typeName) dtoMap.set(shape.typeName, shape);
    }
  }

  return dtoMap;
}

function isStructFile(filePath: string, content: string): boolean {
  if (!filePath.endsWith(".go")) return false;

  return (
    content.includes("type ") &&
    (content.includes("struct {") || content.includes("Request") || content.includes("Response"))
  );
}

function extractGoPayloadShapes(content: string): PayloadShape[] {
  const shapes: PayloadShape[] = [];

  // Match: type TypeName struct { ... }
  const structRegex = /type\s+(\w+)\s+struct\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = structRegex.exec(content)) !== null) {
    const typeName = match[1];
    const structBody = match[2];

    const fields = parseGoStructBody(structBody);
    if (fields.length > 0) {
      shapes.push({ typeName, fields, source: "dto-class" });
    }
  }

  return shapes;
}

function parseGoStructBody(body: string): PayloadField[] {
  const fields: PayloadField[] = [];

  // Go struct field pattern:
  // FieldName string `json:"fieldName"`
  // FieldName string `json:"fieldName,omitempty"`
  // FieldName *string `json:"fieldName"`
  // FieldName []string `json:"fieldName"`
  const fieldRegex = /(\w+)\s+([\w[\]*]+)\s+`json:"([^"]+)"`/g;

  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(body)) !== null) {
    const fieldName = match[1];
    const goType = match[2];
    const jsonTag = match[3];

    // Extract the actual field name from json tag (before comma)
    const tagName = jsonTag.split(",")[0];
    const isOptional = jsonTag.includes("omitempty");

    fields.push({
      name: tagName || fieldName,
      type: simplifyGoType(goType),
      required: !isOptional && !goType.startsWith("*"),
    });
  }

  return fields;
}

function simplifyGoType(goType: string): string {
  const map: Record<string, string> = {
    string: "string",
    int: "integer",
    int32: "integer",
    int64: "long",
    float64: "double",
    bool: "boolean",
    "time.Time": "datetime",
  };

  // Strip pointer: *string → string
  const base = goType.replace(/^\*/, "").replace(/\[\]/, "");

  // Check mapped types
  if (map[base]) {
    const isArray = goType.includes("[]");
    const result = map[base];
    return isArray ? `${result}[]` : result;
  }

  // If it's a custom type, check if it looks like a DTO (capitalized)
  if (/^[A-Z]/.test(base)) {
    const isArray = goType.includes("[]");
    return isArray ? `${base}[]` : base;
  }

  return goType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service URL hints from constants and environment variables
// ─────────────────────────────────────────────────────────────────────────────

function extractGoServiceUrlHints(fileContents: Map<string, string>): ServiceUrlHint[] {
  const hints: ServiceUrlHint[] = [];
  const seen = new Set<string>();

  for (const [filePath, content] of fileContents) {
    // Constants: const orderServiceURL = "http://order-service:8082"
    const constRegex = /const\s+(\w*(?:URL|HOST|ENDPOINT|SERVICE)\w*)\s*=\s*["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;

    while ((match = constRegex.exec(content)) !== null) {
      const key = match[1].toUpperCase();
      const value = match[2];

      if (!seen.has(key)) {
        seen.add(key);
        hints.push({ key, value, sourceFile: filePath });
      }
    }

    // Environment variables: os.Getenv("ORDER_SERVICE_URL")
    const envRegex = /os\.Getenv\s*\(\s*["']([^"']+)["']\s*\)/gi;
    while ((match = envRegex.exec(content)) !== null) {
      const key = match[1];
      if (!seen.has(key) && /URL|HOST|ENDPOINT|SERVICE/.test(key)) {
        seen.add(key);
        hints.push({ key, value: undefined, sourceFile: filePath });
      }
    }

    // Variable assignments with URLs
    const varUrlRegex = /var\s+(\w*(?:URL|HOST|ENDPOINT|SERVICE)\w*)\s*=\s*["']([^"']+)["']/gi;
    while ((match = varUrlRegex.exec(content)) !== null) {
      const key = match[1].toUpperCase();
      const value = match[2];

      if (!seen.has(key)) {
        seen.add(key);
        hints.push({ key, value, sourceFile: filePath });
      }
    }
  }

  return hints;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

function combinePaths(prefix: string, route: string): string {
  const p = normalizePath(prefix);
  const r = normalizePath(route);
  return `${p}${r}`.replace(/\/+/g, "/") || "/";
}

function deduplicateCalls(calls: OutboundCall[]): OutboundCall[] {
  const seen = new Set<string>();
  return calls.filter((c) => {
    const key = `${c.method}:${c.rawUrl}:${c.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function findOpenApiSpec(projectPath: string): Promise<string | null> {
  const candidates = [
    "openapi.yaml",
    "openapi.yml",
    "swagger.yaml",
    "swagger.yml",
    "docs/openapi.yaml",
    "api/openapi.yaml",
  ];

  for (const candidate of candidates) {
    const full = path.join(projectPath, candidate);
    try {
      const { access } = await import("fs/promises");
      await access(full);
      return full;
    } catch {
      /* continue */
    }
  }
  return null;
}
