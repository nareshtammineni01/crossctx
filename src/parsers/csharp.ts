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
  DetectedLanguage

} from "../types/index.js";
import { extractMessageEvents } from "./messaging.js";

const IGNORE = [
  "**/bin/**",
  "**/obj/**",
  "**/.git/**",
  "**/*.Test.cs",
  "**/*.Tests.cs",
  "**/*Test.cs",
  "**/*Tests.cs",
  "**/*.Designer.cs",
  "**/*.g.cs",
];

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function parseCSharpProject(
  projectPath: string,
  language: DetectedLanguage,
  serviceName: string
): Promise<CodeScanResult> {
  const csFiles = await fg(["**/*.cs"], {
    cwd: projectPath,
    ignore: IGNORE,
    absolute: true,
    onlyFiles: true,
  });

  // Also read appsettings for URL hints
  const configFiles = await fg(
    ["**/appsettings*.json", "**/appsettings*.Development.json", "**/appsettings*.Production.json"],
    { cwd: projectPath, ignore: IGNORE, absolute: true, onlyFiles: true }
  );

  const fileContents = new Map<string, string>();
  for (const file of [...csFiles, ...configFiles]) {
    try {
      fileContents.set(file, await readFile(file, "utf-8"));
    } catch { /* skip */ }
  }

  // Extract DTOs first
  const dtoMap = extractCSharpDTOs(fileContents);

  // Extract URL hints from config + code
  const serviceUrlHints = extractCSharpServiceUrlHints(fileContents);

  // Parse controllers
  const endpoints = extractCSharpEndpoints(fileContents, serviceName, dtoMap);

  // Extract message events
  const messageEvents = extractMessageEvents(fileContents, "csharp");

  // Check for OpenAPI spec
  const specFile = await findOpenApiSpec(projectPath);

  return {
    projectPath,
    language,
    serviceName,
    endpoints,
    dtos: Array.from(dtoMap.values()),
    serviceUrlHints,
    messageEvents,
    hasOpenApiSpec: !!specFile,
    specFile: specFile ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Controller / Endpoint extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractCSharpEndpoints(
  fileContents: Map<string, string>,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];

  for (const [filePath, content] of fileContents) {
    if (!isControllerFile(filePath, content)) continue;

    const controllerPrefix = extractRoutePrefix(content, filePath);
    const handlers = extractHandlers(content, filePath, serviceName, controllerPrefix, dtoMap);
    endpoints.push(...handlers);
  }

  return endpoints;
}

function isControllerFile(filePath: string, content: string): boolean {
  if (!filePath.endsWith(".cs")) return false;
  const fileName = path.basename(filePath, ".cs").toLowerCase();

  return (
    fileName.endsWith("controller") ||
    content.includes("[ApiController]") ||
    content.includes("[Controller]") ||
    (content.includes(": ControllerBase") || content.includes(": Controller"))
  );
}

function extractRoutePrefix(content: string, _filePath: string): string {
  // [Route("api/[controller]")] or [Route("api/users")]
  const routeMatch = content.match(/\[Route\s*\(\s*["']([^"']+)["']\s*\)]/);
  if (!routeMatch) return "";

  let prefix = routeMatch[1];

  // Replace [controller] token with actual controller name
  if (prefix.includes("[controller]")) {
    const className = extractClassName(content) ?? "";
    const controllerName = className.replace(/Controller$/, "").toLowerCase();
    prefix = prefix.replace("[controller]", controllerName);
  }

  return normalizePath(prefix);
}

// HTTP attribute → HTTP verb
const HTTP_ATTR_MAP: Record<string, string> = {
  HttpGet: "GET",
  HttpPost: "POST",
  HttpPut: "PUT",
  HttpDelete: "DELETE",
  HttpPatch: "PATCH",
  HttpHead: "HEAD",
  HttpOptions: "OPTIONS",
};

function extractHandlers(
  content: string,
  filePath: string,
  serviceName: string,
  controllerPrefix: string,
  dtoMap: Map<string, PayloadShape>
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];
  const lines = content.split("\n");
  const allOutboundCalls = extractCSharpOutboundCalls(content, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match [HttpGet], [HttpPost("path")], [HttpGet("{id}")]
    const attrMatch = line.match(
      /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|HttpHead|HttpOptions)\s*(?:\(\s*["']([^"']*?)["']\s*\))?]/
    );
    if (!attrMatch) continue;

    const httpMethod = HTTP_ATTR_MAP[attrMatch[1]] ?? "GET";
    const routePath = attrMatch[2] ?? "";
    const fullPath = combinePaths(controllerPrefix, routePath);

    // Find method signature
    const { methodName, returnType, paramLine, bodyStartLine } = extractCSharpMethodSignature(lines, i + 1);

    // Request body from [FromBody] param
    const requestBody = extractRequestBody(paramLine, dtoMap);

    // Response from return type
    const response = extractResponseType(returnType, dtoMap);

    // Summary from XML doc or [SwaggerOperation]
    const summary = extractSummary(lines, i);

    // Scope outbound calls to this method's body using brace-depth tracking
    const methodBodyRange = getMethodBodyLineRange(lines, bodyStartLine);
    const scopedCalls = allOutboundCalls.filter(
      c => c.line !== undefined && c.line >= methodBodyRange.start && c.line <= methodBodyRange.end
    );

    endpoints.push({
      service: serviceName,
      method: httpMethod,
      path: routePath || "/",
      fullPath,
      controllerClass: extractClassName(content),
      handlerMethod: methodName,
      summary,
      requestBody,
      response,
      sourceFile: filePath,
      line: i + 1,
      outboundCalls: scopedCalls,
    });
  }

  return endpoints;
}

function extractCSharpMethodSignature(
  lines: string[],
  startIdx: number
): { methodName: string; returnType: string; paramLine: string; bodyStartLine: number } {
  let methodName = "unknown";
  let returnType = "void";
  let paramLine = "";
  let bodyStartLine = startIdx;

  for (let i = startIdx; i < Math.min(startIdx + 8, lines.length); i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("[") || line.startsWith("//") || line.startsWith("*")) continue;

    // public async Task<ActionResult<UserDto>> CreateUser([FromBody] CreateUserDto dto)
    const sig = line.match(
      /(?:public|private|protected)?\s*(?:async\s+)?(?:Task<)?(?:ActionResult<)?([\w<>[],\s?]+?)>?\s*(\w+)\s*\(([^)]*)/
    );
    if (sig) {
      returnType = sig[1].trim();
      methodName = sig[2];
      bodyStartLine = i;

      // If the param list closes on this line, we're done
      if (line.includes(")")) {
        paramLine = sig[3];
      } else {
        // Multi-line params: collect until closing ")"
        const paramParts: string[] = [sig[3]];
        for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
          const pLine = lines[j].trim();
          paramParts.push(pLine);
          if (pLine.includes(")")) break;
        }
        paramLine = paramParts.join(" ");
      }
      break;
    }
  }

  return { methodName, returnType, paramLine, bodyStartLine };
}

function extractRequestBody(paramLine: string, dtoMap: Map<string, PayloadShape>): PayloadShape | undefined {
  // [FromBody] CreateUserDto dto
  const match = paramLine.match(/\[FromBody]\s+([\w<>?]+)\s+\w+/);
  if (!match) return undefined;

  const typeName = unwrapGeneric(match[1]);
  if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
  return { typeName, fields: [], source: "dto-class" };
}

function extractResponseType(returnType: string, dtoMap: Map<string, PayloadShape>): PayloadShape | undefined {
  if (!returnType || ["void", "IActionResult", "ActionResult"].includes(returnType)) return undefined;

  // ActionResult<UserDto> / Task<UserDto> / IEnumerable<UserDto>
  const typeName = unwrapGeneric(returnType);

  if (["string", "int", "long", "bool", "object", "void"].includes(typeName.toLowerCase())) {
    return { typeName, fields: [], source: "inferred" };
  }

  if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
  if (typeName && typeName.length > 1 && /^[A-Z]/.test(typeName)) {
    return { typeName, fields: [], source: "dto-class" };
  }
  return undefined;
}

function extractClassName(content: string): string | undefined {
  const match = content.match(/(?:public|internal)\s+(?:partial\s+)?class\s+(\w+)/);
  return match?.[1];
}

function extractSummary(lines: string[], attrLine: number): string | undefined {
  // /// <summary>Short description</summary>
  for (let i = attrLine - 1; i >= Math.max(0, attrLine - 8); i--) {
    const line = lines[i].trim();
    const summaryMatch = line.match(/\/\/\/\s*<summary>\s*(.+?)\s*(?:<\/summary>)?$/);
    if (summaryMatch) return summaryMatch[1];

    // [SwaggerOperation(Summary = "...")]
    const swaggerMatch = line.match(/\[SwaggerOperation\([^)]*Summary\s*=\s*["']([^"']+)["']/);
    if (swaggerMatch) return swaggerMatch[1];

    // // comment
    const commentMatch = line.match(/^\/\/\s+(.{3,80})$/);
    if (commentMatch && !line.startsWith("///")) return commentMatch[1];
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound HTTP call extraction (C#)
// ─────────────────────────────────────────────────────────────────────────────

function extractCSharpOutboundCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  const patterns: Array<{ regex: RegExp; pattern: string; methodGroup?: number; urlGroup: number }> = [
    // string interpolation with base URL FIRST (most specific):
    // $"{_baseUrl}/api/orders" or $"{_orderServiceUrl}/api/orders/{id}"
    { regex: /\$"\{(?:_|this\.)?(\w*(?:Url|Host|BaseUrl|Endpoint)\w*)\}([/][^"$\n]+)"/g, pattern: "interpolated", urlGroup: 1 },
    // _httpClient.SendAsync(new HttpRequestMessage(HttpMethod.Post, "url"))
    { regex: /HttpMethod\.(Get|Post|Put|Delete|Patch)\s*,\s*["']([^"'\n]+)["']/g, pattern: "HttpClient.SendAsync", methodGroup: 1, urlGroup: 2 },
    // new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/orders")
    { regex: /new\s+HttpRequestMessage\s*\(\s*HttpMethod\.\w+\s*,\s*(?:\$?")?([^",$\n)]+)/g, pattern: "HttpRequestMessage", urlGroup: 1 },
    // Refit: [Get("/api/users")] on interface methods
    { regex: /\[(?:Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']+)["']\s*\)]/g, pattern: "Refit", urlGroup: 1 },
    // RestSharp: client.GetAsync<T>(new RestRequest("/endpoint"))
    { regex: /new\s+RestRequest\s*\(\s*["']([^"']+)["']/g, pattern: "RestSharp", urlGroup: 1 },
    // IHttpClientFactory named client: _factory.CreateClient("order-service") — lowest priority, just captures service name
    { regex: /_factory\.CreateClient\s*\(\s*["']([^"']+)["']\s*\)/g, pattern: "IHttpClientFactory", urlGroup: 1 },
    // _httpClient.GetAsync($"...") — catch remaining cases not covered by interpolated pattern
    { regex: /\b\w*[Hh]ttp[Cc]lient\w*\.(Get|Post|Put|Delete|Patch)Async\s*\(\s*["']([^"',$\n)]{4,})["']/g, pattern: "HttpClient", methodGroup: 1, urlGroup: 2 },
  ];

  for (const { regex, pattern, methodGroup, urlGroup } of patterns) {
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;

    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;

      let method = "GET";
      let rawUrl = match[urlGroup]?.trim() ?? "";

      if (methodGroup !== undefined && match[methodGroup]) {
        method = match[methodGroup].toUpperCase();
      } else {
        // Infer method from surrounding context (GetAsync → GET, PostAsync → POST)
        const context = content.substring(Math.max(0, match.index - 60), match.index + 60);
        const methodInfer = context.match(/\.(Get|Post|Put|Delete|Patch)Async/);
        if (methodInfer) method = methodInfer[1].toUpperCase();
      }

      // For interpolated patterns, combine the variable and path
      if (pattern === "interpolated" && match[2]) {
        rawUrl = `\${${match[1]}}${match[2]}`;
      }

      rawUrl = rawUrl.replace(/^["'`]|["'`]$/g, "").trim();
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
// DTO extraction (C# classes, records)
// ─────────────────────────────────────────────────────────────────────────────

function extractCSharpDTOs(fileContents: Map<string, string>): Map<string, PayloadShape> {
  const dtoMap = new Map<string, PayloadShape>();

  for (const [filePath, content] of fileContents) {
    // Scan ALL .cs files, not just those matching isDTOFile heuristics
    if (!filePath.endsWith(".cs")) continue;

    const shapes = extractCSharpPayloadShapes(content);
    for (const shape of shapes) {
      // Only add to map if it has fields (avoid empty controller/service class skeletons)
      if (shape.typeName && shape.fields.length > 0) {
        dtoMap.set(shape.typeName, shape);
      }
    }
  }

  return dtoMap;
}


function extractCSharpPayloadShapes(content: string): PayloadShape[] {
  const shapes: PayloadShape[] = [];

  // C# records: public record CreateUserDto(string Email, string Name);
  // or: public record CreateUserDto { public string Email { get; init; } }
  const recordRegex = /(?:public|internal)\s+record\s+(\w+)\s*(?:\(([^)]+)\))?/g;
  let match: RegExpExecArray | null;

  while ((match = recordRegex.exec(content)) !== null) {
    const typeName = match[1];
    if (match[2]) {
      // Positional record
      const fields = parseRecordParams(match[2]);
      shapes.push({ typeName, fields, source: "dto-class" });
    } else {
      // Standard record — parse body below
      const bodyMatch = content.slice(match.index).match(/\{([^{}]+)\}/);
      if (bodyMatch) {
        const fields = parseCSharpClassBody(bodyMatch[1]);
        if (fields.length > 0) shapes.push({ typeName, fields, source: "dto-class" });
      }
    }
  }

  // C# classes
  const classRegex = /(?:public|internal)\s+(?:partial\s+)?class\s+(\w+)(?:\s*:\s*[^{]+)?\s*\{([^{}]+(?:\{[^{}]*\}[^{}]*)*)\}/gs;

  while ((match = classRegex.exec(content)) !== null) {
    const typeName = match[1];
    if (["Controller", "Service", "Repository", "Startup", "Program"].some(s => typeName.endsWith(s))) continue;

    const body = match[2];
    const fields = parseCSharpClassBody(body);
    if (fields.length > 0) {
      shapes.push({ typeName, fields, source: "dto-class" });
    }
  }

  return shapes;
}

function parseRecordParams(params: string): PayloadField[] {
  return params.split(",").map(p => {
    // string Email, int? Age
    const m = p.trim().match(/([\w?<>[]]+)\s+(\w+)/);
    if (!m) return null;
    return {
      name: m[2],
      type: simplifyCSharpType(m[1]),
      required: !m[1].endsWith("?"),
    };
  }).filter(Boolean) as PayloadField[];
}

function parseCSharpClassBody(body: string): PayloadField[] {
  const fields: PayloadField[] = [];

  // public string Email { get; set; }
  // public int? Age { get; init; } = null;
  // [Required] public string Name { get; set; } = string.Empty;
  const propRegex = /(?:\[[\w\s"'(),.]+]\s*)*public\s+([\w?<>[]]+)\s+(\w+)\s*\{\s*get/g;
  let match: RegExpExecArray | null;

  while ((match = propRegex.exec(body)) !== null) {
    const type = match[1];
    const name = match[2];

    if (["string", "int", "long", "bool", "object"].includes(name.toLowerCase())) continue;

    // Check for [Required] in preceding lines
    const preceding = body.substring(Math.max(0, match.index - 100), match.index);
    const required = preceding.includes("[Required]") || !type.endsWith("?");

    fields.push({
      name,
      type: simplifyCSharpType(type),
      required,
    });
  }

  return fields;
}

function simplifyCSharpType(type: string): string {
  const map: Record<string, string> = {
    "string": "string", "String": "string",
    "int": "integer", "Int32": "integer", "int?": "integer",
    "long": "long", "Int64": "long", "long?": "long",
    "bool": "boolean", "Boolean": "boolean", "bool?": "boolean",
    "double": "double", "Double": "double", "double?": "double",
    "decimal": "decimal", "Decimal": "decimal", "decimal?": "decimal",
    "DateTime": "datetime", "DateTime?": "datetime",
    "DateTimeOffset": "datetime", "Guid": "uuid", "Guid?": "uuid",
    "object": "object",
  };

  const clean = type.replace("?", "").trim();
  if (map[clean]) return type.endsWith("?") ? map[clean] : map[clean];

  // IEnumerable<T>, List<T>, IList<T> → T[]
  const listMatch = type.match(/(?:IEnumerable|List|IList|ICollection|HashSet)<(\w+)>/);
  if (listMatch) return `${simplifyCSharpType(listMatch[1])}[]`;

  return type.replace("?", "").trim();
}

function unwrapGeneric(type: string): string {
  const inner = type.match(/<([^<>]+)>/)?.[1];
  if (inner) return unwrapGeneric(inner.split(",")[0].trim());
  return type.replace(/\?$/, "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Service URL hints from C# config
// ─────────────────────────────────────────────────────────────────────────────

function extractCSharpServiceUrlHints(fileContents: Map<string, string>): ServiceUrlHint[] {
  const hints: ServiceUrlHint[] = [];
  const seen = new Set<string>();

  for (const [filePath, content] of fileContents) {
    const fileName = path.basename(filePath);

    if (fileName.startsWith("appsettings") && fileName.endsWith(".json")) {
      // "OrderServiceUrl": "http://order-service:8082"
      const jsonUrlRegex = /"(\w*(?:Url|Host|Endpoint|BaseUrl|Service)\w*)"\s*:\s*"([^"]+)"/gi;
      let match: RegExpExecArray | null;
      while ((match = jsonUrlRegex.exec(content)) !== null) {
        const key = match[1];
        const value = match[2];
        if (!seen.has(key)) {
          seen.add(key);
          hints.push({ key, value, sourceFile: filePath });
        }
      }
    }

    if (fileName.endsWith(".cs")) {
      // _configuration["OrderServiceUrl"] or _configuration.GetValue<string>("OrderServiceUrl")
      const configRegex = /_configuration\s*\[\s*["'](\w+(?:Url|Host|Endpoint|BaseUrl|Service)\w*)["']\s*]/g;
      let match: RegExpExecArray | null;
      while ((match = configRegex.exec(content)) !== null) {
        const key = match[1];
        if (!seen.has(key)) {
          seen.add(key);
          hints.push({ key, value: undefined, sourceFile: filePath });
        }
      }

      // Environment.GetEnvironmentVariable("ORDER_SERVICE_URL")
      const envRegex = /Environment\.GetEnvironmentVariable\s*\(\s*["']([A-Z][A-Z0-9_]*(?:URL|HOST|ENDPOINT|SERVICE)[A-Z0-9_]*)["']\s*\)/g;
      while ((match = envRegex.exec(content)) !== null) {
        const key = match[1];
        if (!seen.has(key)) {
          seen.add(key);
          hints.push({ key, value: undefined, sourceFile: filePath });
        }
      }

      // Named HttpClient: services.AddHttpClient("order-service", c => c.BaseAddress = new Uri("http://..."))
      const namedClientRegex = /AddHttpClient\s*\(\s*["']([^"']+)["'][^)]*(?:BaseAddress\s*=\s*new\s+Uri\s*\(\s*["']([^"']+)["'])?/g;
      while ((match = namedClientRegex.exec(content)) !== null) {
        const key = `HTTP_CLIENT_${match[1].toUpperCase().replace(/-/g, "_")}`;
        if (!seen.has(key)) {
          seen.add(key);
          hints.push({ key, value: match[2] ?? `http://${match[1]}`, sourceFile: filePath });
        }
      }
    }
  }

  return hints;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns {start, end} line numbers (1-based) of the method body starting at signatureLine */
function getMethodBodyLineRange(lines: string[], signatureLine: number): { start: number; end: number } {
  let depth = 0;
  let started = false;
  let startLine = signatureLine + 1;
  let endLine = signatureLine + 1;

  for (let i = signatureLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; started = true; if (depth === 1) startLine = i + 1; }
      if (ch === "}") { depth--; }
    }
    if (started && depth === 0) { endLine = i + 1; break; }
  }

  return { start: startLine, end: endLine };
}

function normalizePath(p: string): string {
  if (!p) return "";
  return p.startsWith("/") ? p : `/${p}`;
}

function combinePaths(prefix: string, route: string): string {
  const p = normalizePath(prefix);
  const r = route ? (route.startsWith("/") ? route : `/${route}`) : "";
  return `${p}${r}`.replace(/\/+/g, "/") || "/";
}

function deduplicateCalls(calls: OutboundCall[]): OutboundCall[] {
  const seen = new Set<string>();
  return calls.filter(c => {
    const key = `${c.method}:${c.rawUrl}:${c.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function findOpenApiSpec(projectPath: string): Promise<string | null> {
  const candidates = [
    "openapi.yaml", "openapi.yml", "openapi.json",
    "swagger.yaml", "swagger.yml", "swagger.json",
    "wwwroot/swagger/v1/swagger.json",
    "docs/openapi.yaml",
  ];

  for (const candidate of candidates) {
    const full = path.join(projectPath, candidate);
    try {
      const { access } = await import("fs/promises");
      await access(full);
      return full;
    } catch { /* continue */ }
  }
  return null;
}
