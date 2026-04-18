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

const IGNORE = [
  "**/target/**",
  "**/.gradle/**",
  "**/build/**",
  "**/.git/**",
  "**/*Test.java",
  "**/*Tests.java",
  "**/*Spec.java",
];

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function parseJavaProject(
  projectPath: string,
  language: DetectedLanguage,
  serviceName: string
): Promise<CodeScanResult> {
  const javaFiles = await fg(["**/*.java"], {
    cwd: projectPath,
    ignore: IGNORE,
    absolute: true,
    onlyFiles: true,
  });

  // Also check for Kotlin files (Spring Boot projects often mix)
  const kotlinFiles = await fg(["**/*.kt"], {
    cwd: projectPath,
    ignore: IGNORE,
    absolute: true,
    onlyFiles: true,
  });

  const allFiles = [...javaFiles, ...kotlinFiles];

  // Read all files
  const fileContents = new Map<string, string>();
  for (const file of allFiles) {
    try {
      fileContents.set(file, await readFile(file, "utf-8"));
    } catch { /* skip */ }
  }

  // Also read properties/yaml config for base URLs
  const configFiles = await fg(
    ["**/application.properties", "**/application.yml", "**/application.yaml", "**/bootstrap.yml"],
    { cwd: projectPath, ignore: IGNORE, absolute: true, onlyFiles: true }
  );
  for (const file of configFiles) {
    try {
      fileContents.set(file, await readFile(file, "utf-8"));
    } catch { /* skip */ }
  }

  // Extract DTOs first
  const dtoMap = extractJavaDTOs(fileContents);

  // Extract service URL hints
  const serviceUrlHints = extractJavaServiceUrlHints(fileContents);

  // Parse controllers
  const endpoints = extractJavaEndpoints(fileContents, serviceName, dtoMap);

  // Check for OpenAPI spec
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
// Controller / Endpoint extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractJavaEndpoints(
  fileContents: Map<string, string>,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];

  for (const [filePath, content] of fileContents) {
    if (!isControllerFile(filePath, content)) continue;

    const controllerPrefix = extractControllerPrefix(content);
    const handlers = extractHandlers(content, filePath, serviceName, controllerPrefix, dtoMap);
    endpoints.push(...handlers);
  }

  return endpoints;
}

function isControllerFile(filePath: string, content: string): boolean {
  if (!filePath.endsWith(".java") && !filePath.endsWith(".kt")) return false;

  return (
    content.includes("@RestController") ||
    content.includes("@Controller") ||
    content.includes("@RequestMapping") ||
    path.basename(filePath).includes("Controller") ||
    path.basename(filePath).includes("Resource") // JAX-RS style
  );
}

function extractControllerPrefix(content: string): string {
  // Walk line-by-line tracking brace depth.
  // @RequestMapping is only valid as a class-level annotation at brace depth 0 or 1.
  const lines = content.split("\n");
  let braceDepth = 0;
  let classFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track when we enter the class body
    if (!classFound && /^(?:public\s+)?(?:abstract\s+)?class\s+\w+/.test(trimmed)) {
      classFound = true;
    }

    // Count braces
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }

    // @RequestMapping at class level = depth 1 (inside class, not inside method)
    if (classFound && braceDepth <= 1 && trimmed.startsWith("@RequestMapping")) {
      const m = trimmed.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
      if (m) return normalizePath(m[1]);
    }

    // Once we're inside a method body (depth >= 2), stop looking
    if (classFound && braceDepth >= 2) break;
  }
  return "";
}

// HTTP method annotations → HTTP verb
const METHOD_ANNOTATION_MAP: Record<string, string> = {
  GetMapping: "GET",
  PostMapping: "POST",
  PutMapping: "PUT",
  DeleteMapping: "DELETE",
  PatchMapping: "PATCH",
  RequestMapping: "GET", // default, will be overridden if method= present
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
  const allOutboundCalls = extractJavaOutboundCalls(content, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match @GetMapping, @PostMapping, @PutMapping, @DeleteMapping, @PatchMapping
    const mappingMatch = line.match(
      /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\(([^)]*)\))?/
    );
    if (!mappingMatch) continue;

    const annotation = mappingMatch[1];
    const annotationArgs = mappingMatch[2] ?? "";

    // Determine HTTP method
    let httpMethod = METHOD_ANNOTATION_MAP[annotation] ?? "GET";

    // For @RequestMapping, check method= argument
    if (annotation === "RequestMapping") {
      const methodMatch = annotationArgs.match(/method\s*=\s*RequestMethod\.(\w+)/);
      if (methodMatch) httpMethod = methodMatch[1].toUpperCase();
    }

    // Extract path
    let routePath = "";
    const pathMatch =
      annotationArgs.match(/(?:value\s*=\s*)?["']([^"']+)["']/) ??
      annotationArgs.match(/path\s*=\s*["']([^"']+)["']/);
    if (pathMatch) routePath = pathMatch[1];

    const fullPath = combinePaths(controllerPrefix, routePath);

    // Find method signature below annotation
    const { methodName, returnType, paramLine, bodyStartLine } = extractJavaMethodSignature(lines, i + 1);

    // Request body from @RequestBody param
    const requestBody = extractRequestBodyFromParams(paramLine, dtoMap);

    // Response from return type
    const response = extractResponseFromReturnType(returnType, dtoMap);

    // Summary from Swagger/Javadoc
    const summary = extractSummary(lines, i);

    // Scope outbound calls to this exact method body using brace tracking
    const methodBodyRange = getMethodBodyLineRange(lines, bodyStartLine);
    const scopedCalls = allOutboundCalls.filter(
      (c) => c.line !== undefined && c.line >= methodBodyRange.start && c.line <= methodBodyRange.end
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

function extractJavaMethodSignature(
  lines: string[],
  startIdx: number
): { methodName: string; returnType: string; paramLine: string; bodyStartLine: number } {
  let methodName = "unknown";
  let returnType = "void";
  let paramLine = "";
  let bodyStartLine = startIdx;

  for (let i = startIdx; i < Math.min(startIdx + 8, lines.length); i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("@") || line.startsWith("//") || line.startsWith("*")) continue;

    // public ResponseEntity<UserDto> createUser(@RequestBody CreateUserDto dto) {
    const sig = line.match(
      /(?:public|protected|private)?\s*(?:static\s+)?(?:@\w+\s+)*([\w<>\[\],\s]+?)\s+(\w+)\s*\(([^)]*)/
    );
    if (sig) {
      returnType = sig[1].trim();
      methodName = sig[2];
      paramLine = sig[3];
      bodyStartLine = i;
      break;
    }
  }

  return { methodName, returnType, paramLine, bodyStartLine };
}

function extractRequestBodyFromParams(paramLine: string, dtoMap: Map<string, PayloadShape>): PayloadShape | undefined {
  // @RequestBody CreateUserDto createUserDto
  const match = paramLine.match(/@RequestBody\s+(?:final\s+)?(\w+(?:<[^>]+>)?)\s+\w+/);
  if (!match) return undefined;

  const typeName = unwrapGeneric(match[1]);
  if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
  return { typeName, fields: [], source: "dto-class" };
}

function extractResponseFromReturnType(returnType: string, dtoMap: Map<string, PayloadShape>): PayloadShape | undefined {
  if (!returnType || returnType === "void" || returnType === "Void") return undefined;

  // ResponseEntity<UserDto> → UserDto
  // List<OrderDto> → OrderDto
  const typeName = unwrapGeneric(returnType);

  // Skip primitive-ish types
  if (["String", "Integer", "Long", "Boolean", "void", "Object"].includes(typeName)) {
    return { typeName, fields: [], source: "inferred" };
  }

  if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
  if (typeName && typeName.length > 1 && /^[A-Z]/.test(typeName)) {
    return { typeName, fields: [], source: "dto-class" };
  }
  return undefined;
}

function unwrapGeneric(type: string): string {
  // ResponseEntity<UserDto> → UserDto, List<OrderDto> → OrderDto
  const inner = type.match(/<([^<>]+)>/)?.[1];
  if (inner) return unwrapGeneric(inner.split(",")[0].trim());
  return type.replace(/\[\]$/, "").trim();
}

function extractClassName(content: string): string | undefined {
  const match = content.match(/(?:public\s+)?class\s+(\w+)/);
  return match?.[1];
}

function extractSummary(lines: string[], annotationLine: number): string | undefined {
  // Look for @Operation(summary = "...") from SpringDoc / Swagger
  for (let i = annotationLine - 1; i >= Math.max(0, annotationLine - 6); i--) {
    const line = lines[i];
    const opMatch = line.match(/@Operation\s*\([^)]*summary\s*=\s*["']([^"']+)["']/);
    if (opMatch) return opMatch[1];

    const apiOpMatch = line.match(/@ApiOperation\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
    if (apiOpMatch) return apiOpMatch[1];

    // Javadoc: * Short description
    const jdMatch = line.match(/^\s*\*\s+([^@][^*].{3,80})$/);
    if (jdMatch) return jdMatch[1].trim();
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound HTTP call extraction (Java)
// ─────────────────────────────────────────────────────────────────────────────

function extractJavaOutboundCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];
  const lines = content.split("\n");

  const patterns: Array<{ regex: RegExp; pattern: string }> = [
    // RestTemplate: restTemplate.getForEntity("url", ...)  / restTemplate.postForEntity("url", ...)
    { regex: /\brestTemplate\.(get|post|put|delete|exchange|postFor|getFor)\w*\s*\(\s*["'`]([^"'`\n]+)["'`]/gi, pattern: "RestTemplate" },
    // RestTemplate with variable: restTemplate.getForEntity(serviceUrl + "/path", ...)
    { regex: /\brestTemplate\.(get|post|put|delete|exchange|postFor|getFor)\w*\s*\(\s*([\w.]+\s*\+\s*["'][^"'\n]+["'])/gi, pattern: "RestTemplate" },
    // WebClient: webClient.get().uri("url") / .post().uri(...)
    { regex: /\.(get|post|put|delete|patch)\s*\(\s*\)\s*\.uri\s*\(\s*["'`]([^"'`\n]+)["'`]/gi, pattern: "WebClient" },
    // WebClient with variable uri
    { regex: /\.uri\s*\(\s*([\w.]+\s*(?:\+|\.concat)\s*["'][^"'\n]*["']|["'][^"'\n]+["'])/gi, pattern: "WebClient" },
    // HttpClient: httpClient.send(HttpRequest.newBuilder().uri(URI.create("url")))
    { regex: /URI\.create\s*\(\s*["'`]([^"'`\n]+)["'`]/gi, pattern: "HttpClient" },
    // FeignClient: detected via @FeignClient annotation — handled in extractFeignClients
    // Spring RestClient (Spring 6.1+)
    { regex: /restClient\.(get|post|put|delete|patch)\s*\(\s*\)\s*\.uri\s*\(\s*["'`]([^"'`\n]+)["'`]/gi, pattern: "RestClient" },
  ];

  for (const { regex, pattern } of patterns) {
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      const methodOrUrl = match[2] ?? match[1];
      let method = "GET";
      let rawUrl = methodOrUrl;

      // For RestTemplate/WebClient patterns the first group is the HTTP verb
      const verbMatch = match[1]?.toLowerCase();
      if (verbMatch && ["get", "post", "put", "delete", "patch"].includes(verbMatch)) {
        method = verbMatch.toUpperCase();
        rawUrl = match[2] ?? rawUrl;
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

  // FeignClient interfaces — these define outbound calls declaratively
  const feignCalls = extractFeignClientCalls(content, filePath);
  calls.push(...feignCalls);

  return deduplicateCalls(calls);
}

function extractFeignClientCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // @FeignClient(name = "order-service", url = "${order.service.url}")
  const feignMatch = content.match(
    /@FeignClient\s*\(\s*(?:name\s*=\s*)?["']([^"']+)["'][^)]*(?:url\s*=\s*["']([^"']+)["'])?/
  );
  if (!feignMatch) return calls;

  const targetService = feignMatch[1]; // e.g. "order-service"
  const baseUrl = feignMatch[2]; // e.g. "${order.service.url}"

  // Find all method mappings in the Feign interface
  const lines = content.split("\n");
  const METHOD_MAP: Record<string, string> = {
    GetMapping: "GET", PostMapping: "POST", PutMapping: "PUT",
    DeleteMapping: "DELETE", PatchMapping: "PATCH",
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mappingMatch = line.match(
      /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["']([^"']*)["']/
    );
    if (!mappingMatch) continue;

    const httpMethod = METHOD_MAP[mappingMatch[1]] ?? "GET";
    const routePath = mappingMatch[2];
    const rawUrl = baseUrl ? `${baseUrl}${routePath}` : `feign://${targetService}${routePath}`;

    calls.push({
      rawUrl,
      resolvedService: targetService,
      resolvedPath: routePath,
      method: httpMethod,
      callPattern: "FeignClient",
      sourceFile: filePath,
      line: i + 1,
      confidence: 0.95,
    });
  }

  return calls;
}

// ─────────────────────────────────────────────────────────────────────────────
// DTO extraction (Java POJOs, Lombok, Records)
// ─────────────────────────────────────────────────────────────────────────────

function extractJavaDTOs(fileContents: Map<string, string>): Map<string, PayloadShape> {
  const dtoMap = new Map<string, PayloadShape>();

  for (const [filePath, content] of fileContents) {
    if (!isDTOFile(filePath, content)) continue;

    const shapes = extractJavaPayloadShapes(content);
    for (const shape of shapes) {
      if (shape.typeName) dtoMap.set(shape.typeName, shape);
    }
  }

  return dtoMap;
}

function isDTOFile(filePath: string, content: string): boolean {
  if (!filePath.endsWith(".java") && !filePath.endsWith(".kt")) return false;
  const fileName = path.basename(filePath, path.extname(filePath)).toLowerCase();

  return (
    fileName.includes("dto") ||
    fileName.includes("request") ||
    fileName.includes("response") ||
    fileName.includes("model") ||
    fileName.includes("entity") ||
    fileName.includes("record") ||
    content.includes("@Data") || // Lombok
    content.includes("@Value") || // Lombok immutable
    content.includes("@Builder") || // Lombok
    content.includes("@JsonProperty") || // Jackson
    content.includes("@Schema") || // SpringDoc
    content.includes("@ApiModel") // Swagger 2
  );
}

function extractJavaPayloadShapes(content: string): PayloadShape[] {
  const shapes: PayloadShape[] = [];

  // Java records: public record CreateUserDto(String email, String name) {}
  const recordRegex = /(?:public\s+)?record\s+(\w+)\s*\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = recordRegex.exec(content)) !== null) {
    const typeName = match[1];
    const params = match[2];
    const fields = parseRecordParams(params);
    shapes.push({ typeName, fields, source: "dto-class" });
  }

  // Java classes (DTOs, entities)
  const classRegex = /(?:public\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[^{]+)?\s*\{([^{}]+(?:\{[^{}]*\}[^{}]*)*)\}/gs;

  while ((match = classRegex.exec(content)) !== null) {
    const typeName = match[1];
    if (["Application", "Configuration", "Controller", "Service", "Repository"].some(s => typeName.endsWith(s))) continue;

    const body = match[2];
    const fields = parseJavaClassBody(body);
    if (fields.length > 0) {
      shapes.push({ typeName, fields, source: "dto-class" });
    }
  }

  // Kotlin data classes: data class CreateUserDto(val email: String, val name: String)
  const kotlinDataClassRegex = /data\s+class\s+(\w+)\s*\(([^)]+)\)/g;
  while ((match = kotlinDataClassRegex.exec(content)) !== null) {
    const typeName = match[1];
    const fields = parseKotlinDataClassParams(match[2]);
    shapes.push({ typeName, fields, source: "dto-class" });
  }

  return shapes;
}

function parseRecordParams(params: string): PayloadField[] {
  return params.split(",").map(p => {
    const parts = p.trim().split(/\s+/);
    const type = parts.slice(0, -1).join(" ").replace(/@\w+\s*/g, "");
    const name = parts[parts.length - 1] ?? "unknown";
    return { name: name.trim(), type: simplifyJavaType(type.trim()), required: true };
  }).filter(f => f.name && f.type);
}

function parseJavaClassBody(body: string): PayloadField[] {
  const fields: PayloadField[] = [];
  // private String email; / private final Long id; / protected Integer count;
  const fieldRegex = /(?:@\w+(?:\([^)]*\))?\s*)*(?:private|protected|public)\s+(?:final\s+)?(?:static\s+)?(\w[\w<>,\s]*?)\s+(\w+)\s*[;=]/g;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(body)) !== null) {
    const type = match[1].trim();
    const name = match[2].trim();

    // Skip common non-DTO fields
    if (["serialVersionUID", "log", "logger", "LOGGER"].includes(name)) continue;
    if (type.includes("(") || ["void", "class"].includes(type)) continue;

    fields.push({
      name,
      type: simplifyJavaType(type),
      required: false, // can't always tell from Java class alone
    });
  }

  return fields;
}

function parseKotlinDataClassParams(params: string): PayloadField[] {
  return params.split(",").map(p => {
    // val email: String, var name: String? = null
    const m = p.trim().match(/(?:val|var)\s+(\w+)\s*:\s*([\w?<>]+)/);
    if (!m) return null;
    return {
      name: m[1],
      type: simplifyJavaType(m[2].replace("?", "")),
      required: !m[2].includes("?"),
    };
  }).filter(Boolean) as PayloadField[];
}

function simplifyJavaType(type: string): string {
  const map: Record<string, string> = {
    "String": "string", "Integer": "integer", "int": "integer",
    "Long": "long", "long": "long", "Boolean": "boolean", "boolean": "boolean",
    "Double": "double", "double": "double", "Float": "float", "float": "float",
    "BigDecimal": "decimal", "LocalDate": "date", "LocalDateTime": "datetime",
    "ZonedDateTime": "datetime", "UUID": "uuid", "Object": "object",
  };

  const base = type.replace(/\[\]$/, "").replace(/<[^>]+>/, "").trim();
  const mapped = map[base];
  if (mapped) return type.includes("[]") || type.match(/<[^>]*>/) ? `${mapped}[]` : mapped;

  // List<X> → X[], Set<X> → X[]
  const listMatch = type.match(/(?:List|Set|Collection)<(\w+)>/);
  if (listMatch) return `${simplifyJavaType(listMatch[1])}[]`;

  return type.replace(/<[^>]+>/, "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Service URL hints from Java config / properties
// ─────────────────────────────────────────────────────────────────────────────

function extractJavaServiceUrlHints(fileContents: Map<string, string>): ServiceUrlHint[] {
  const hints: ServiceUrlHint[] = [];
  const seen = new Set<string>();

  for (const [filePath, content] of fileContents) {
    const fileName = path.basename(filePath);

    if (fileName.endsWith(".properties")) {
      // order.service.url=http://order-service:8082
      const propRegex = /^([a-z][a-z0-9.-]*(?:url|host|endpoint|base-url|service)[a-z0-9.-]*)\s*=\s*(.+)$/gim;
      let match: RegExpExecArray | null;
      while ((match = propRegex.exec(content)) !== null) {
        const key = match[1].toUpperCase().replace(/\./g, "_");
        if (!seen.has(key)) {
          seen.add(key);
          hints.push({ key, value: match[2].trim(), sourceFile: filePath });
        }
      }
    }

    if (fileName.endsWith(".yml") || fileName.endsWith(".yaml")) {
      // url: http://order-service:8082 or base-url: ...
      const yamlRegex = /(?:url|host|endpoint|base-url|base_url)\s*:\s*(.+)/gi;
      let match: RegExpExecArray | null;
      while ((match = yamlRegex.exec(content)) !== null) {
        const value = match[1].trim();
        if (value.startsWith("http") && !seen.has(value)) {
          seen.add(value);
          hints.push({ key: `YAML_URL_${hints.length}`, value, sourceFile: filePath });
        }
      }
    }

    // @Value("${order.service.url}") annotations in Java files
    if (fileName.endsWith(".java") || fileName.endsWith(".kt")) {
      const valueAnnotationRegex = /@Value\s*\(\s*"\$\{([^}]+)\}"\s*\)/g;
      let match: RegExpExecArray | null;
      while ((match = valueAnnotationRegex.exec(content)) !== null) {
        const key = match[1].toUpperCase().replace(/\./g, "_");
        if (!seen.has(key) && /URL|HOST|ENDPOINT|SERVICE/.test(key)) {
          seen.add(key);
          hints.push({ key, value: undefined, sourceFile: filePath });
        }
      }

      // @FeignClient(name = "order-service") — the name IS the service
      const feignNameRegex = /@FeignClient\s*\(\s*(?:name\s*=\s*)?["']([^"']+)["']/g;
      while ((match = feignNameRegex.exec(content)) !== null) {
        const key = `FEIGN_${match[1].toUpperCase().replace(/-/g, "_")}`;
        if (!seen.has(key)) {
          seen.add(key);
          hints.push({ key, value: `feign://${match[1]}`, sourceFile: filePath });
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
  const r = normalizePath(route);
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
    "src/main/resources/openapi.yaml", "src/main/resources/openapi.yml",
    "src/main/resources/static/openapi.yaml", "src/main/resources/api-docs.yaml",
    "openapi.yaml", "openapi.yml", "swagger.yaml", "swagger.yml",
    "docs/openapi.yaml", "api/openapi.yaml",
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
