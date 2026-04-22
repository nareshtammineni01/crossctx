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
import { extractMessageEvents } from "./messaging.js";
import { annotateConditionals } from "./conditional.js";

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
  serviceName: string,
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
    } catch {
      /* skip */
    }
  }

  // Also read properties/yaml config for base URLs.
  // Glob covers the base file AND all Spring profile variants
  // (application-prod.yml, application-staging.properties, bootstrap-local.yml, etc.)
  const configFiles = await fg(
    [
      "**/application.properties",
      "**/application-*.properties",
      "**/application.yml",
      "**/application-*.yml",
      "**/application.yaml",
      "**/application-*.yaml",
      "**/bootstrap.yml",
      "**/bootstrap-*.yml",
    ],
    { cwd: projectPath, ignore: IGNORE, absolute: true, onlyFiles: true },
  );
  for (const file of configFiles) {
    try {
      fileContents.set(file, await readFile(file, "utf-8"));
    } catch {
      /* skip */
    }
  }

  // Extract DTOs first
  const dtoMap = extractJavaDTOs(fileContents);

  // Extract service URL hints
  const serviceUrlHints = extractJavaServiceUrlHints(fileContents);

  // Parse controllers
  const endpoints = extractJavaEndpoints(fileContents, serviceName, dtoMap);

  // Extract message events
  const messageEvents = extractMessageEvents(fileContents, "java");

  // Check for OpenAPI spec
  const specFile = await findOpenApiSpec(projectPath);

  // ── Service-layer outbound call scan ────────────────────────────────────────
  // Controllers only call service classes directly — the actual HTTP calls to
  // external APIs (e.g. Anthropic, OpenAI) live in @Service/@Component classes.
  // We scan those files too, resolve any variable-based URLs via getter-chain →
  // YAML config lookup, then attach the discovered calls to all controller
  // endpoints so they appear in the dependency graph.
  const serviceLayerCalls = extractServiceLayerOutboundCalls(fileContents);
  if (serviceLayerCalls.length > 0) {
    if (endpoints.length > 0) {
      // Attach to every controller endpoint (best-effort — we don't know which
      // specific endpoint ultimately triggers which service method at static-
      // analysis time).
      for (const ep of endpoints) {
        ep.outboundCalls = deduplicateCalls([...ep.outboundCalls, ...serviceLayerCalls]);
      }
    } else {
      // No controllers found (pure service module) — synthesise a placeholder
      // endpoint so the outbound calls still appear in the graph.
      endpoints.push({
        service: serviceName,
        method: "INTERNAL",
        path: "/_service",
        fullPath: "/_service",
        outboundCalls: serviceLayerCalls,
        sourceFile: projectPath,
      });
    }
  }

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

function extractJavaEndpoints(
  fileContents: Map<string, string>,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
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
  // @RequestMapping can appear either:
  //   (a) before the class declaration at brace depth 0 (most common — class-level annotation)
  //   (b) at depth 1 inside the class body but before any method (rare)
  // Stop searching once we're inside a method body (depth >= 2).
  const lines = content.split("\n");
  let braceDepth = 0;
  let classFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // @RequestMapping at depth 0 = class-level annotation (before the class { opens)
    // @RequestMapping at depth 1 = still class-level (after class { but before any method)
    if (braceDepth <= 1 && trimmed.startsWith("@RequestMapping")) {
      const m = trimmed.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
      if (m) return normalizePath(m[1]);
    }

    // Track when we enter the class body
    if (!classFound && /^(?:public\s+)?(?:abstract\s+)?class\s+\w+/.test(trimmed)) {
      classFound = true;
    }

    // Count braces
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
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
  dtoMap: Map<string, PayloadShape>,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];
  const lines = content.split("\n");
  const allOutboundCalls = extractJavaOutboundCalls(content, filePath);
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track brace depth so we can skip class-level @RequestMapping (depth 0)
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }

    // Match @GetMapping, @PostMapping, @PutMapping, @DeleteMapping, @PatchMapping
    const mappingMatch = line.match(
      /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\(([^)]*)\))?/,
    );
    if (!mappingMatch) continue;

    // Skip @RequestMapping at depth 0 — it's the class-level prefix, not a handler
    if (mappingMatch[1] === "RequestMapping" && braceDepth === 0) continue;

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
    const { methodName, returnType, paramLine, bodyStartLine } = extractJavaMethodSignature(
      lines,
      i + 1,
    );

    // Request body from @RequestBody param
    const requestBody = extractRequestBodyFromParams(paramLine, dtoMap);

    // Response from return type
    const response = extractResponseFromReturnType(returnType, dtoMap);

    // Summary from Swagger/Javadoc
    const summary = extractSummary(lines, i);

    // Scope outbound calls to this exact method body using brace tracking
    const methodBodyRange = getMethodBodyLineRange(lines, bodyStartLine);
    const scopedCalls = allOutboundCalls.filter(
      (c) =>
        c.line !== undefined && c.line >= methodBodyRange.start && c.line <= methodBodyRange.end,
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
  startIdx: number,
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
      /(?:public|protected|private)?\s*(?:static\s+)?(?:@\w+\s+)*([\w<>[\],\s]+?)\s+(\w+)\s*\(([^)]*)/,
    );
    if (sig) {
      returnType = sig[1].trim();
      methodName = sig[2];
      bodyStartLine = i;

      // If the param list closes on this line, we're done
      if (line.includes(")")) {
        paramLine = sig[3];
      } else {
        // Multi-line params: collect until closing ")" — look up to 12 more lines
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

function extractRequestBodyFromParams(
  paramLine: string,
  dtoMap: Map<string, PayloadShape>,
): PayloadShape | undefined {
  // @RequestBody CreateUserDto createUserDto
  const match = paramLine.match(/@RequestBody\s+(?:final\s+)?(\w+(?:<[^>]+>)?)\s+\w+/);
  if (!match) return undefined;

  const typeName = unwrapGeneric(match[1]);
  if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
  return { typeName, fields: [], source: "dto-class" };
}

function extractResponseFromReturnType(
  returnType: string,
  dtoMap: Map<string, PayloadShape>,
): PayloadShape | undefined {
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
  const patterns: Array<{ regex: RegExp; pattern: string }> = [
    // RestTemplate: restTemplate.getForEntity("url", ...)  / restTemplate.postForEntity("url", ...)
    {
      regex:
        /\brestTemplate\.(get|post|put|delete|exchange|postFor|getFor)\w*\s*\(\s*["'`]([^"'`\n]+)["'`]/gi,
      pattern: "RestTemplate",
    },
    // RestTemplate with variable: restTemplate.getForEntity(serviceUrl + "/path", ...)
    {
      regex:
        /\brestTemplate\.(get|post|put|delete|exchange|postFor|getFor)\w*\s*\(\s*([\w.]+\s*\+\s*["'][^"'\n]+["'])/gi,
      pattern: "RestTemplate",
    },
    // WebClient: webClient.get().uri("url") / .post().uri(...)
    {
      regex: /\.(get|post|put|delete|patch)\s*\(\s*\)\s*\.uri\s*\(\s*["'`]([^"'`\n]+)["'`]/gi,
      pattern: "WebClient",
    },
    // WebClient with variable uri
    {
      regex: /\.uri\s*\(\s*([\w.]+\s*(?:\+|\.concat)\s*["'][^"'\n]*["']|["'][^"'\n]+["'])/gi,
      pattern: "WebClient",
    },
    // HttpClient: httpClient.send(HttpRequest.newBuilder().uri(URI.create("url")))
    { regex: /URI\.create\s*\(\s*["'`]([^"'`\n]+)["'`]/gi, pattern: "HttpClient" },
    // FeignClient: detected via @FeignClient annotation — handled in extractFeignClients
    // Spring RestClient (Spring 6.1+)
    {
      regex:
        /restClient\.(get|post|put|delete|patch)\s*\(\s*\)\s*\.uri\s*\(\s*["'`]([^"'`\n]+)["'`]/gi,
      pattern: "RestClient",
    },
    // OkHttp: new Request.Builder().url("https://...").build()
    {
      regex: /new\s+Request\.Builder\s*\(\s*\)\s*\.url\s*\(\s*["'`]([^"'`\n]+)["'`]/gi,
      pattern: "OkHttp",
    },
    // OkHttp: .url(variableName) — URL stored in a variable (most common pattern)
    {
      regex: /\.url\s*\(\s*([\w.]+(?:Url|URL|Uri|URI|Endpoint|endpoint|apiUrl|url))\s*\)/gi,
      pattern: "OkHttp",
    },
    // Apache HttpClient 5: new HttpPost("url") / new HttpGet("url")
    {
      regex: /new\s+Http(?:Post|Get|Put|Delete|Patch)\s*\(\s*["'`]([^"'`\n]+)["'`]/gi,
      pattern: "ApacheHttpClient",
    },
    // Apache HttpClient with variable: new HttpPost(someUrl)
    {
      regex: /new\s+Http(?:Post|Get|Put|Delete|Patch)\s*\(\s*([\w.]+(?:Url|URL|Uri|URI|Endpoint|endpoint))\s*\)/gi,
      pattern: "ApacheHttpClient",
    },
    // WebClient.create("url") — shorthand factory
    {
      regex: /WebClient\.create\s*\(\s*["'`]([^"'`\n]+)["'`]/gi,
      pattern: "WebClient",
    },
    // WebClient.builder().baseUrl("url") — captured so service-layer resolver can use it
    {
      regex: /WebClient\.builder\s*\(\s*\)(?:\.[^;]+)?\.baseUrl\s*\(\s*["'`]([^"'`\n]+)["'`]/gi,
      pattern: "WebClient-base",
    },
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

  const deduped = deduplicateCalls(calls);
  annotateConditionals(deduped, content);
  return deduped;
}

function extractFeignClientCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // @FeignClient(name = "order-service", url = "${order.service.url}")
  const feignMatch = content.match(
    /@FeignClient\s*\(\s*(?:name\s*=\s*)?["']([^"']+)["'][^)]*(?:url\s*=\s*["']([^"']+)["'])?/,
  );
  if (!feignMatch) return calls;

  const targetService = feignMatch[1]; // e.g. "order-service"
  const baseUrl = feignMatch[2]; // e.g. "${order.service.url}"

  // Find all method mappings in the Feign interface
  const lines = content.split("\n");
  const METHOD_MAP: Record<string, string> = {
    GetMapping: "GET",
    PostMapping: "POST",
    PutMapping: "PUT",
    DeleteMapping: "DELETE",
    PatchMapping: "PATCH",
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mappingMatch = line.match(
      /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["']([^"']*)["']/,
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
    // Scan ALL .java/.kt files, not just those matching isDTOFile heuristics
    if (!filePath.endsWith(".java") && !filePath.endsWith(".kt")) continue;

    const shapes = extractJavaPayloadShapes(content);
    for (const shape of shapes) {
      // Only add to map if it has fields (avoid empty controller/service class skeletons)
      if (shape.typeName && shape.fields.length > 0) {
        dtoMap.set(shape.typeName, shape);
      }
    }
  }

  return dtoMap;
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

  // Java classes (DTOs, entities) — use brace-depth scanner for proper nested generic handling
  const classRegex =
    /(?:public\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[^{]+)?\s*\{/g;

  while ((match = classRegex.exec(content)) !== null) {
    const typeName = match[1];
    if (
      ["Application", "Configuration", "Controller", "Service", "Repository"].some((s) =>
        typeName.endsWith(s),
      )
    )
      continue;

    // Extract class body using brace-depth tracking to handle nested generics
    const bodyStart = match.index + match[0].length;
    const body = extractJavaClassBodyByBraceDepth(content, bodyStart);
    if (body !== null) {
      const fields = parseJavaClassBody(body);
      if (fields.length > 0) {
        shapes.push({ typeName, fields, source: "dto-class" });
      }
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

function extractJavaClassBodyByBraceDepth(content: string, startIdx: number): string | null {
  let depth = 1; // we're already inside the opening brace
  let endIdx = startIdx;

  for (let i = startIdx; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  if (depth !== 0) return null; // unmatched braces
  return content.substring(startIdx, endIdx);
}

function parseRecordParams(params: string): PayloadField[] {
  return params
    .split(",")
    .map((p) => {
      const parts = p.trim().split(/\s+/);
      const type = parts
        .slice(0, -1)
        .join(" ")
        .replace(/@\w+\s*/g, "");
      const name = parts[parts.length - 1] ?? "unknown";
      return { name: name.trim(), type: simplifyJavaType(type.trim()), required: true };
    })
    .filter((f) => f.name && f.type);
}

function parseJavaClassBody(body: string): PayloadField[] {
  const fields: PayloadField[] = [];

  // Split body into per-field sections by scanning for field declarations
  // private String email; / private final Long id; / @NotNull private String name;
  // Also handles @JsonProperty("snake_case") overrides and @NotNull/@NotBlank required markers
  const fieldRegex =
    /((?:@[\w.]+(?:\s*\([^)]*\))?\s*)*)(?:private|protected|public)\s+(?:final\s+)?(?:static\s+)?(\w[\w<>,.\s]*?)\s+(\w+)\s*(?:=[^;]*)?;/g;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(body)) !== null) {
    const annotations = match[1] ?? "";
    const type = match[2].trim();
    const rawName = match[3].trim();

    // Skip common non-DTO fields
    if (["serialVersionUID", "log", "logger", "LOGGER", "mapper", "mapper"].includes(rawName))
      continue;
    if (type.includes("(") || ["void", "class", "static"].includes(type)) continue;
    // Skip method references that got picked up (e.g. "final Predicate<T>")
    if (/^[a-z]/.test(type)) {
      const primitives = ["int", "long", "double", "float", "boolean", "char", "byte", "short"];
      if (!primitives.includes(type.replace(/\[\]$/, "").split("<")[0])) continue;
    }

    // Check for @JsonProperty("name") override
    const jsonPropMatch = annotations.match(/@JsonProperty\s*\(\s*["']([^"']+)["']\s*\)/);
    const name = jsonPropMatch ? jsonPropMatch[1] : rawName;

    // required = true if @NotNull, @NotBlank, @NotEmpty, or @NonNull present
    const required =
      /@NotNull|@NotBlank|@NotEmpty|@NonNull/.test(annotations) ||
      /@Column\s*\([^)]*nullable\s*=\s*false/.test(annotations);

    fields.push({
      name,
      type: simplifyJavaType(type),
      required,
    });
  }

  return fields;
}

function parseKotlinDataClassParams(params: string): PayloadField[] {
  return params
    .split(",")
    .map((p) => {
      // val email: String, var name: String? = null
      const m = p.trim().match(/(?:val|var)\s+(\w+)\s*:\s*([\w?<>]+)/);
      if (!m) return null;
      return {
        name: m[1],
        type: simplifyJavaType(m[2].replace("?", "")),
        required: !m[2].includes("?"),
      };
    })
    .filter(Boolean) as PayloadField[];
}

function simplifyJavaType(type: string): string {
  const map: Record<string, string> = {
    String: "string",
    Integer: "integer",
    int: "integer",
    Long: "long",
    long: "long",
    Boolean: "boolean",
    boolean: "boolean",
    Double: "double",
    double: "double",
    Float: "float",
    float: "float",
    BigDecimal: "decimal",
    LocalDate: "date",
    LocalDateTime: "datetime",
    ZonedDateTime: "datetime",
    UUID: "uuid",
    Object: "object",
  };

  const base = type
    .replace(/\[\]$/, "")
    .replace(/<[^>]+>/, "")
    .trim();
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
      const propRegex =
        /^([a-z][a-z0-9.-]*(?:url|host|endpoint|base-url|service)[a-z0-9.-]*)\s*=\s*(.+)$/gim;
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
      // url: http://order-service:8082 or base-url: / api-url: / api_url: ...
      const yamlRegex =
        /(?:url|host|endpoint|base-url|base_url|api-url|api_url|api-endpoint|service-url|service_url)\s*:\s*(.+)/gi;
      let match: RegExpExecArray | null;
      while ((match = yamlRegex.exec(content)) !== null) {
        const value = match[1].trim();
        // Strip environment variable wrappers like ${ANTHROPIC_API_KEY:https://...}
        const cleaned = value.replace(/^\$\{[^:}]+:([^}]*)\}$/, "$1").trim();
        const urlVal = cleaned.startsWith("http") ? cleaned : value;
        if (urlVal.startsWith("http") && !seen.has(urlVal)) {
          seen.add(urlVal);
          hints.push({ key: `YAML_URL_${hints.length}`, value: urlVal, sourceFile: filePath });
        }
      }
    }

    // @Value("${order.service.url}") annotations in Java files
    if (fileName.endsWith(".java") || fileName.endsWith(".kt")) {
      let match: RegExpExecArray | null;

      // ── @Value-injected String fields: track fieldName → property key → URL ──
      // Pattern: @Value("${anthropic.api.url}") private String apiUrl;
      // This lets the outbound-call resolver map "apiUrl" → actual URL
      const valueFieldRegex =
        /@Value\s*\(\s*"\$\{([^}]+)\}"\s*\)\s*(?:(?:private|protected|public)\s+)?(?:final\s+)?String\s+(\w+)/g;
      while ((match = valueFieldRegex.exec(content)) !== null) {
        const propKey = match[1]; // "anthropic.api.url"
        const fieldName = match[2]; // "apiUrl"
        const keyFromField = fieldName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();

        // Resolve property key → actual URL from config files
        const resolvedValue = lookupPropertyInConfigFiles(propKey, fileContents);

        if (!seen.has(keyFromField)) {
          seen.add(keyFromField);
          hints.push({ key: keyFromField, value: resolvedValue, sourceFile: filePath });
        }
        const propKeyUpper = propKey.toUpperCase().replace(/[.-]/g, "_");
        if (!seen.has(propKeyUpper)) {
          seen.add(propKeyUpper);
          hints.push({ key: propKeyUpper, value: resolvedValue, sourceFile: filePath });
        }
      }

      // ── Legacy @Value annotation (no field capture needed, keyword filter) ──
      const valueAnnotationRegex = /@Value\s*\(\s*"\$\{([^}]+)\}"\s*\)/g;
      while ((match = valueAnnotationRegex.exec(content)) !== null) {
        const key = match[1].toUpperCase().replace(/\./g, "_");
        if (!seen.has(key) && /URL|HOST|ENDPOINT|SERVICE/.test(key)) {
          seen.add(key);
          hints.push({ key, value: undefined, sourceFile: filePath });
        }
      }

      // ── Spring 6 @HttpExchange interfaces ──────────────────────────────────
      // @HttpExchange("https://api.anthropic.com")
      // public interface AnthropicClient {
      //   @PostExchange("/v1/messages") Response chat(...);
      // }
      const httpExchangeRegex =
        /@(?:Http|Get|Post|Put|Delete|Patch)Exchange\s*\(\s*["']([^"'\n]+)["']/g;
      while ((match = httpExchangeRegex.exec(content)) !== null) {
        const url = match[1];
        if (url.startsWith("http") && !seen.has(url)) {
          seen.add(url);
          hints.push({ key: `HTTP_EXCHANGE_${hints.length}`, value: url, sourceFile: filePath });
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
function getMethodBodyLineRange(
  lines: string[],
  signatureLine: number,
): { start: number; end: number } {
  let depth = 0;
  let started = false;
  let startLine = signatureLine + 1;
  let endLine = signatureLine + 1;

  for (let i = signatureLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        started = true;
        if (depth === 1) startLine = i + 1;
      }
      if (ch === "}") {
        depth--;
      }
    }
    if (started && depth === 0) {
      endLine = i + 1;
      break;
    }
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
  return calls.filter((c) => {
    const key = `${c.method}:${c.rawUrl}:${c.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Config property lookup helper
// Resolves a dotted property key (e.g. "anthropic.api.url") to its string value
// by searching across all YAML/properties config files in memory.
// ─────────────────────────────────────────────────────────────────────────────

function lookupPropertyInConfigFiles(
  propertyKey: string,
  fileContents: Map<string, string>,
): string | undefined {
  for (const [filePath, content] of fileContents) {
    const isYaml = filePath.endsWith(".yml") || filePath.endsWith(".yaml");
    const isProps = filePath.endsWith(".properties");
    if (!isYaml && !isProps) continue;

    if (isProps) {
      // Flat key: anthropic.api.url=https://...
      const propRegex = new RegExp(
        `^${propertyKey.replace(/\./g, "\\.")}\\s*=\\s*(https?://[^\\s]+)`,
        "im",
      );
      const m = content.match(propRegex);
      if (m) return m[1].trim();
    } else {
      // YAML: multi-level — use parent + last segment approach
      const parts = propertyKey.split(".");
      const lastPart = parts[parts.length - 1]; // "url"
      const parentPart = parts[parts.length - 2]; // "api" or "anthropic"

      if (parentPart) {
        const yamlPattern = new RegExp(
          `(?:${parentPart})[\\s\\S]{0,200}?(?:${lastPart})\\s*:\\s*(https?://[^\\s\\n]+)`,
          "im",
        );
        const m = content.match(yamlPattern);
        if (m) return m[1].trim();
      }
      // Also try flat YAML: anthropic.api.url: https://... (Spring flat format)
      const flatYamlPattern = new RegExp(
        `["']?${propertyKey.replace(/\./g, "\\.")}["']?\\s*:\\s*(https?://[^\\s\\n]+)`,
        "im",
      );
      const fm = content.match(flatYamlPattern);
      if (fm) return fm[1].trim();
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service-layer outbound call extraction
// Scans @Service/@Component/@Repository classes (not just controllers) for
// outbound HTTP calls, then tries to resolve bare variable URLs via the
// Spring getter-chain → YAML config pattern common in Spring Boot apps.
// ─────────────────────────────────────────────────────────────────────────────

function isServiceFile(_filePath: string, content: string): boolean {
  return (
    content.includes("@Service") ||
    content.includes("@Component") ||
    content.includes("@Repository") ||
    content.includes("@Bean")
  );
}

/**
 * For a bare variable rawUrl like "apiUrl", look backwards in the file for its
 * assignment expression:
 *   String apiUrl = hoaProperties.getApi().getAnthropic().getApiUrl();
 *
 * Extract the getter-chain segment names (e.g. ["api","anthropic","apiurl"]),
 * then search the YAML config files for a URL value whose surrounding YAML
 * block contains one of those segment names.  Returns the resolved HTTP URL or
 * undefined if nothing matched.
 */
function resolveVariableUrlViaGetterChain(
  varName: string,
  content: string,
  fileContents: Map<string, string>,
): string | undefined {
  // Match: (String|var|final String) varName = <anything up to semicolon>
  const assignPattern = new RegExp(
    `(?:String|var|final\\s+String)\\s+${varName}\\s*=\\s*([^;\\n]+)`,
    "i",
  );
  const assignMatch = content.match(assignPattern);
  if (!assignMatch) return undefined;

  const expr = assignMatch[1];

  // Extract getter method names from the chain, e.g.
  // "hoaProperties.getApi().getAnthropic().getApiUrl()"
  //   → ["api", "anthropic", "apiurl"]
  const getterNames: string[] = [];
  const getterRegex = /\.get([A-Za-z]+)\s*\(\)/g;
  let m: RegExpExecArray | null;
  while ((m = getterRegex.exec(expr)) !== null) {
    getterNames.push(m[1].toLowerCase());
  }

  if (getterNames.length === 0) return undefined;

  // Strip terminal getter that just means "get the URL value" — it carries no
  // domain information (e.g. "apiUrl", "url", "apiEndpoint").
  const urlAccessors = new Set(["apiurl", "url", "apiendpoint", "endpoint", "baseurl", "apikey"]);
  const domainGetters = getterNames.filter((g) => !urlAccessors.has(g));

  // For each YAML/properties config file, look for a URL value in a section
  // whose key contains one of the domain getter names.
  // Iterate domain getters in REVERSE order so the most specific getter
  // (e.g. "openai", "anthropic") is tried before generic ones (e.g. "api").
  const orderedGetters = [...domainGetters].reverse();

  for (const [filePath, fileContent] of fileContents) {
    if (!filePath.endsWith(".yml") && !filePath.endsWith(".yaml") && !filePath.endsWith(".properties"))
      continue;

    for (const getter of orderedGetters) {
      // Build a pattern that matches the getter name (or a kebab-case variant)
      // followed within ~5 lines by a line that contains an http URL.
      // e.g.  anthropic:
      //         api-url: https://api.anthropic.com/v1/messages
      const kebab = getter.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
      const sectionPattern = new RegExp(
        `(?:${getter}|${kebab})[\\s\\S]{0,200}?(?:api-url|api_url|url|endpoint|base-url|base_url)\\s*[=:]\\s*(https?://[^\\s\\n]+)`,
        "im",
      );
      const yamlMatch = fileContent.match(sectionPattern);
      if (yamlMatch) {
        return yamlMatch[1].trim();
      }
    }
  }

  return undefined;
}

/**
 * Try to resolve a bare variable name to an actual HTTP URL by checking:
 *  1. Spring getter-chain pattern: String x = config.getGroup().getSub().getApiUrl()
 *  2. @Value-injected field: @Value("${x.y.url}") private String x
 *  3. Direct string assignment: String x = "https://..."; or private String x = "https://...";
 */
function resolveJavaVariableUrl(
  varName: string,
  content: string,
  fileContents: Map<string, string>,
): string | undefined {
  // Strategy 1: getter chain (already implemented separately — call it first)
  const fromGetterChain = resolveVariableUrlViaGetterChain(varName, content, fileContents);
  if (fromGetterChain) return fromGetterChain;

  // Strategy 2: @Value annotation on a field with the same name
  const valueRegex = new RegExp(
    `@Value\\s*\\(\\s*"\\$\\{([^}]+)\\}"\\s*\\)\\s*(?:(?:private|protected|public)\\s+)?(?:final\\s+)?String\\s+${varName}\\b`,
    "i",
  );
  const valueMatch = content.match(valueRegex);
  if (valueMatch) {
    const propKey = valueMatch[1];
    const resolved = lookupPropertyInConfigFiles(propKey, fileContents);
    if (resolved) return resolved;
  }

  // Strategy 3: direct string literal assignment in same class
  // private String apiUrl = "https://api.anthropic.com/v1/messages";
  // or constructor param: this.apiUrl = "https://..."
  const directAssign = new RegExp(
    `(?:String\\s+${varName}\\s*=|this\\.${varName}\\s*=)\\s*["']([^"'\\n]+)["']`,
    "i",
  );
  const directMatch = content.match(directAssign);
  if (directMatch && directMatch[1].startsWith("http")) return directMatch[1].trim();

  return undefined;
}

/**
 * Scans all @Service/@Component/@Repository Java files for outbound HTTP calls.
 * Resolves bare variable URLs using getter-chain, @Value annotation, and direct
 * assignment strategies so the external API map can identify them correctly.
 */
function extractServiceLayerOutboundCalls(fileContents: Map<string, string>): OutboundCall[] {
  const allCalls: OutboundCall[] = [];

  for (const [filePath, content] of fileContents) {
    if (!filePath.endsWith(".java") && !filePath.endsWith(".kt")) continue;
    if (isControllerFile(filePath, content)) continue; // already handled in main pass
    if (!isServiceFile(filePath, content)) continue;

    const rawCalls = extractJavaOutboundCalls(content, filePath);
    if (rawCalls.length === 0) continue;

    // For each call, try to resolve bare variable URLs
    const resolved = rawCalls.map((call) => {
      if (call.rawUrl.startsWith("http")) return call; // already a concrete URL

      const isBareVar =
        /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(call.rawUrl) && !call.rawUrl.includes(".");
      if (!isBareVar) return call;

      const resolvedUrl = resolveJavaVariableUrl(call.rawUrl, content, fileContents);
      if (resolvedUrl) {
        return {
          ...call,
          rawUrl: resolvedUrl,
          confidence: Math.max(call.confidence, 0.85),
        };
      }
      return call;
    });

    allCalls.push(...resolved);
  }

  return deduplicateCalls(allCalls);
}

async function findOpenApiSpec(projectPath: string): Promise<string | null> {
  const candidates = [
    "src/main/resources/openapi.yaml",
    "src/main/resources/openapi.yml",
    "src/main/resources/static/openapi.yaml",
    "src/main/resources/api-docs.yaml",
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
