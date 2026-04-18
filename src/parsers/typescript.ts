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
  MessageEvent,
} from "../types/index.js";
import { extractMessageEvents } from "./messaging.js";

const IGNORE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/*.spec.ts", "**/*.test.ts", "**/*.d.ts"];

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function parseTypeScriptProject(
  projectPath: string,
  language: DetectedLanguage,
  serviceName: string
): Promise<CodeScanResult> {
  // 1. Discover all source files
  const sourceFiles = await fg(["**/*.ts", "**/*.js"], {
    cwd: projectPath,
    ignore: IGNORE,
    absolute: true,
    onlyFiles: true,
  });

  // 2. Read all file contents upfront (we need cross-file DTO resolution)
  const fileContents = new Map<string, string>();
  for (const file of sourceFiles) {
    try {
      fileContents.set(file, await readFile(file, "utf-8"));
    } catch {
      /* skip unreadable files */
    }
  }

  // 3. Extract DTOs from all files first (needed to resolve payload shapes)
  const dtoMap = extractDTOsFromAllFiles(fileContents, projectPath);

  // 4. Extract service URL hints (env vars, constants)
  const serviceUrlHints = extractServiceUrlHints(fileContents, projectPath);

  // 5. Parse controllers + services
  const endpoints = extractEndpoints(fileContents, projectPath, serviceName, dtoMap, language.framework);

  // 6. Check for OpenAPI spec
  const specFile = await findOpenApiSpec(projectPath);

  // 7. Extract message events
  const messageEvents = extractMessageEvents(fileContents, "typescript");

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

function extractEndpoints(
  fileContents: Map<string, string>,
  projectPath: string,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
  framework: string
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];

  for (const [filePath, content] of fileContents) {
    if (!isControllerFile(filePath, content, framework)) continue;

    const controllerPrefix = extractControllerPrefix(content, framework);
    const handlers = extractHandlers(content, filePath, serviceName, controllerPrefix, dtoMap, framework);
    endpoints.push(...handlers);
  }

  return endpoints;
}

function isControllerFile(filePath: string, content: string, framework: string): boolean {
  const fileName = path.basename(filePath).toLowerCase();

  // NestJS: @Controller decorator or file named *.controller.ts
  if (framework === "nestjs") {
    return (
      fileName.includes("controller") ||
      content.includes("@Controller(") ||
      content.includes("@Controller()")
    );
  }

  // Express: look for router.get/post/put/delete or app.get/post
  if (framework === "express") {
    return (
      /\brouter\.(get|post|put|delete|patch)\s*\(/.test(content) ||
      /\bapp\.(get|post|put|delete|patch)\s*\(/.test(content) ||
      fileName.includes("route") ||
      fileName.includes("router") ||
      fileName.includes("controller")
    );
  }

  // Generic: any file with controller/route in name or content
  return (
    fileName.includes("controller") ||
    fileName.includes("route") ||
    content.includes("@Controller") ||
    /router\.(get|post|put|delete|patch)/.test(content)
  );
}

function extractControllerPrefix(content: string, framework: string): string {
  if (framework === "nestjs" || content.includes("@Controller")) {
    // @Controller('users') or @Controller("/users")
    const match = content.match(/@Controller\s*\(\s*['"`]([^'"`]*?)['"`]\s*\)/);
    if (match) return normalizePathPrefix(match[1]);
  }
  return "";
}

function extractHandlers(
  content: string,
  filePath: string,
  serviceName: string,
  controllerPrefix: string,
  dtoMap: Map<string, PayloadShape>,
  framework: string
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];
  const lines = content.split("\n");

  // Extract outbound calls from the full file (service calls happen in handlers)
  const allOutboundCalls = extractOutboundCalls(content, filePath);

  if (framework === "nestjs" || content.includes("@Controller")) {
    // NestJS-style: look for @Get, @Post, @Put, @Delete, @Patch decorators
    const METHOD_DECORATORS = ["Get", "Post", "Put", "Delete", "Patch", "Head", "Options"];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const httpMethod of METHOD_DECORATORS) {
        const decoratorRegex = new RegExp(`@${httpMethod}\\s*\\(\\s*(?:['"\`]([^'"\`]*?)['"\`])?\\s*\\)`);
        const match = line.match(decoratorRegex);
        if (!match) continue;

        const routePath = match[1] ?? "";
        const fullPath = combinePaths(controllerPrefix, routePath);

        // Look ahead for the handler method name and body
        const { methodName, body, bodyStartLine } = extractMethodBody(lines, i + 1);

        // Find request/response types from method signature
        const requestBody = extractRequestBodyFromSignature(lines, i, dtoMap);
        const response = extractResponseFromDecorators(lines, i, dtoMap);

        // Scope outbound calls to those found in this method's body
        const scopedCalls = allOutboundCalls.filter(
          (c) => c.line !== undefined && c.line >= bodyStartLine && c.line <= bodyStartLine + body.split("\n").length
        );

        endpoints.push({
          service: serviceName,
          method: httpMethod.toUpperCase(),
          path: normalizePathPrefix(routePath) || "/",
          fullPath,
          controllerClass: extractClassName(content),
          handlerMethod: methodName,
          summary: extractSummaryFromJsDoc(lines, i),
          requestBody,
          response,
          sourceFile: filePath,
          line: i + 1,
          outboundCalls: scopedCalls,
        });
      }
    }
  }

  if (framework === "express" || (!endpoints.length && content.includes("router."))) {
    // Express-style: router.get('/path', handler) or app.post('/path', handler)
    const expressMethodRegex = /(?:router|app)\.(get|post|put|delete|patch|head)\s*\(\s*['"`]([^'"`]+?)['"`]/g;
    let match: RegExpExecArray | null;

    while ((match = expressMethodRegex.exec(content)) !== null) {
      const httpMethod = match[1].toUpperCase();
      const routePath = match[2];
      const fullPath = combinePaths(controllerPrefix, routePath);
      const lineNum = content.substring(0, match.index).split("\n").length;

      endpoints.push({
        service: serviceName,
        method: httpMethod,
        path: routePath,
        fullPath,
        summary: undefined,
        requestBody: undefined,
        response: undefined,
        sourceFile: filePath,
        line: lineNum,
        outboundCalls: allOutboundCalls.filter(
          (c) => c.line !== undefined && c.line >= lineNum && c.line <= lineNum + 20
        ),
      });
    }
  }

  return endpoints;
}

function extractMethodBody(
  lines: string[],
  startIdx: number
): { methodName: string; body: string; bodyStartLine: number } {
  // Find the method signature line (next non-decorator, non-empty line)
  let methodName = "unknown";
  let bodyStartLine = startIdx;

  for (let i = startIdx; i < Math.min(startIdx + 5, lines.length); i++) {
    const line = lines[i].trim();
    if (line.startsWith("@") || line === "") continue;

    const methodMatch = line.match(/(?:async\s+)?(\w+)\s*\(/);
    if (methodMatch) {
      methodName = methodMatch[1];
      bodyStartLine = i;
      break;
    }
  }

  // Extract body (simple brace matching)
  let depth = 0;
  let inBody = false;
  const bodyLines: string[] = [];

  for (let i = bodyStartLine; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === "{") { depth++; inBody = true; }
      if (char === "}") depth--;
    }
    if (inBody) bodyLines.push(line);
    if (inBody && depth === 0) break;
  }

  return { methodName, body: bodyLines.join("\n"), bodyStartLine };
}

function extractRequestBodyFromSignature(
  lines: string[],
  decoratorLine: number,
  dtoMap: Map<string, PayloadShape>
): PayloadShape | undefined {
  // Look for @Body() paramName: DtoType in the next few lines
  for (let i = decoratorLine; i < Math.min(decoratorLine + 10, lines.length); i++) {
    const line = lines[i];
    // @Body() createUserDto: CreateUserDto
    const bodyMatch = line.match(/@Body\s*\(\s*\)\s*\w+\s*:\s*(\w+)/);
    if (bodyMatch) {
      const typeName = bodyMatch[1];
      if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
      // Return a placeholder if we know the type name
      return { typeName, fields: [], source: "dto-class" };
    }

    // @Body('field') param: type — just the field
    const bodyFieldMatch = line.match(/@Body\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (bodyFieldMatch) {
      return {
        fields: [{ name: bodyFieldMatch[1], type: "any", required: true }],
        source: "inferred",
      };
    }
  }
  return undefined;
}

function extractResponseFromDecorators(
  lines: string[],
  decoratorLine: number,
  dtoMap: Map<string, PayloadShape>
): PayloadShape | undefined {
  for (let i = decoratorLine; i < Math.min(decoratorLine + 8, lines.length); i++) {
    const line = lines[i];

    // 1. Check for @ApiResponse({ type: UserDto }) decorator
    const apiResponseMatch = line.match(/@ApiResponse\s*\(\s*\{\s*type\s*:\s*(\w+)/);
    if (apiResponseMatch) {
      const typeName = apiResponseMatch[1];
      if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
      if (typeName !== "void" && typeName !== "any") {
        return { typeName, fields: [], source: "dto-class" };
      }
    }

    // 2. Match async method return type: async methodName(): Promise<UserDto>
    const promiseReturnMatch = line.match(/\)\s*:\s*Promise<(\w+)(?:\[\])?\s*>\s*[{]/);
    if (promiseReturnMatch) {
      const typeName = promiseReturnMatch[1];
      if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
      if (typeName !== "void" && typeName !== "any") {
        return { typeName, fields: [], source: "dto-class" };
      }
    }

    // 3. Match sync method return type: methodName(): UserDto {
    const syncReturnMatch = line.match(/\)\s*:\s*(\w+)\s*\{/);
    if (syncReturnMatch) {
      const typeName = syncReturnMatch[1];
      if (typeName === "void" || typeName === "any") continue;
      if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
      return { typeName, fields: [], source: "dto-class" };
    }

    // 4. Legacy inline Promise<UserDto> (may be on same line as decorator)
    const inlinePromiseMatch = line.match(/Promise\s*<\s*(\w+)(?:\[\])?\s*>/);
    if (inlinePromiseMatch) {
      const typeName = inlinePromiseMatch[1];
      if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
      if (typeName !== "void" && typeName !== "any") {
        return { typeName, fields: [], source: "dto-class" };
      }
    }
  }
  return undefined;
}

function extractClassName(content: string): string | undefined {
  const match = content.match(/class\s+(\w+)/);
  return match ? match[1] : undefined;
}

function extractSummaryFromJsDoc(lines: string[], decoratorLine: number): string | undefined {
  // Look backwards from decorator for JSDoc comment
  for (let i = decoratorLine - 1; i >= Math.max(0, decoratorLine - 5); i--) {
    const line = lines[i].trim();
    if (line.startsWith("* ") && !line.startsWith("* @")) {
      return line.replace(/^\*\s*/, "").trim();
    }
    if (line.startsWith("//")) {
      return line.replace(/^\/\/\s*/, "").trim();
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound HTTP call extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractOutboundCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];
  const lines = content.split("\n");

  // Patterns to detect outbound HTTP calls
  const patterns: Array<{ regex: RegExp; pattern: string; methodGroup: number; urlGroup: number }> = [
    // axios.get('url'), axios.post('url'), this.http.get('url')
    { regex: /(?:axios|this\.http(?:Client)?|http)\.(get|post|put|delete|patch)\s*\(\s*([`'"](.*?)[`'"]|\$\{[^}]+\}[^,)]*)/g, pattern: "axios", methodGroup: 1, urlGroup: 2 },
    // this.httpService.get/post (NestJS HttpService)
    { regex: /this\.\w+(?:Service|Client|Http)?\.(get|post|put|delete|patch)\s*\(\s*([`'"](.*?)[`'"|\$\{])/g, pattern: "HttpService", methodGroup: 1, urlGroup: 2 },
    // fetch('url', { method: 'POST' })
    { regex: /\bfetch\s*\(\s*([`'"](.*?)[`'"]|\$\{[^}]+\}[^,)]*)/g, pattern: "fetch", methodGroup: 0, urlGroup: 1 },
    // new HttpClient().get / .post (Angular-style)
    { regex: /this\.\w*[Hh]ttp\w*\.(get|post|put|delete|patch)<[^>]*>\s*\(\s*`?([^`'",$)]+)/g, pattern: "HttpClient", methodGroup: 1, urlGroup: 2 },
    // got.get, got.post
    { regex: /\bgot\.(get|post|put|delete|patch)\s*\(\s*([`'"](.*?)[`'"])/g, pattern: "got", methodGroup: 1, urlGroup: 2 },
    // request({ url: ..., method: ... })
    { regex: /\brequest\s*\(\s*\{[^}]*url\s*:\s*([`'"](.*?)[`'"|\$\{])/g, pattern: "request", methodGroup: 0, urlGroup: 1 },
  ];

  for (const { regex, pattern, methodGroup, urlGroup } of patterns) {
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;

    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      const rawUrl = match[urlGroup]?.replace(/^['"`]|['"`]$/g, "") ?? match[urlGroup] ?? "";
      const method = (match[methodGroup] ?? "GET").toUpperCase();

      if (!rawUrl || rawUrl.length < 3) continue;
      // Skip internal calls (same-service, relative paths without template variables)
      if (rawUrl.startsWith("/") && !rawUrl.includes("${")) {
        // Could still be useful — keep but mark as potentially internal
      }

      calls.push({
        rawUrl,
        method,
        callPattern: pattern,
        sourceFile: filePath,
        line: lineNum,
        confidence: rawUrl.includes("${") ? 0.7 : 0.9, // template strings are less certain
      });
    }
  }

  return deduplicateCalls(calls);
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
// DTO / Interface / Class extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractDTOsFromAllFiles(
  fileContents: Map<string, string>,
  projectPath: string
): Map<string, PayloadShape> {
  const dtoMap = new Map<string, PayloadShape>();

  for (const [filePath, content] of fileContents) {
    if (!isDTOFile(filePath, content)) continue;

    const shapes = extractPayloadShapes(content);
    for (const shape of shapes) {
      if (shape.typeName) {
        dtoMap.set(shape.typeName, shape);
      }
    }
  }

  return dtoMap;
}

function isDTOFile(filePath: string, content: string): boolean {
  const fileName = path.basename(filePath).toLowerCase();
  return (
    fileName.includes("dto") ||
    fileName.includes("model") ||
    fileName.includes("interface") ||
    fileName.includes("entity") ||
    fileName.includes("schema") ||
    content.includes("@IsString()") || // class-validator
    content.includes("@ApiProperty") || // Swagger decorators
    /export\s+(class|interface)\s+\w+(?:Dto|Request|Response|Model|Entity)/.test(content)
  );
}

function extractPayloadShapes(content: string): PayloadShape[] {
  const shapes: PayloadShape[] = [];

  // Extract TypeScript interfaces
  const interfaceRegex = /export\s+interface\s+(\w+)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = interfaceRegex.exec(content)) !== null) {
    const typeName = match[1];
    const body = match[2];
    const fields = parseInterfaceBody(body);
    shapes.push({ typeName, fields, source: "interface" });
  }

  // Extract TypeScript classes (DTOs)
  const classRegex = /export\s+class\s+(\w+)\s*(?:extends\s+\w+\s*)?\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;

  while ((match = classRegex.exec(content)) !== null) {
    const typeName = match[1];
    const body = match[2];
    const fields = parseClassBody(body);
    if (fields.length > 0) {
      shapes.push({ typeName, fields, source: "dto-class" });
    }
  }

  // Extract type aliases with object shapes
  const typeAliasRegex = /export\s+type\s+(\w+)\s*=\s*\{([^}]+)\}/g;

  while ((match = typeAliasRegex.exec(content)) !== null) {
    const typeName = match[1];
    const body = match[2];
    const fields = parseInterfaceBody(body);
    shapes.push({ typeName, fields, source: "interface" });
  }

  return shapes;
}

function parseInterfaceBody(body: string): PayloadField[] {
  const fields: PayloadField[] = [];
  // field?: string; or field: string;
  const fieldRegex = /(\w+)(\??):\s*([^;,\n]+)/g;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(body)) !== null) {
    const name = match[1];
    const optional = match[2] === "?";
    const type = match[3].trim().replace(/;$/, "");

    if (["constructor", "private", "public", "protected", "readonly", "static"].includes(name)) continue;

    fields.push({
      name,
      type: simplifyType(type),
      required: !optional,
    });
  }

  return fields;
}

function parseClassBody(body: string): PayloadField[] {
  const fields: PayloadField[] = [];

  // Matches: @ApiProperty() fieldName: string = 'default';
  // Or: fieldName: string;
  const fieldRegex = /(?:@\w+[^)]*\)\s*)*(?:readonly\s+)?(\w+)(\??):\s*([^;=\n]+)/g;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(body)) !== null) {
    const name = match[1];
    const optional = match[2] === "?";
    const type = match[3].trim();

    // Skip constructor parameters and method names
    if (["constructor", "super", "return", "private", "public", "protected"].includes(name)) continue;
    if (type.includes("(")) continue; // method signature

    fields.push({
      name,
      type: simplifyType(type),
      required: !optional,
    });
  }

  return fields;
}

function simplifyType(type: string): string {
  // Simplify complex types for readability
  return type
    .replace(/\s*\|.*$/, "") // remove union types (keep first)
    .replace(/\[\]$/, "[]")
    .replace(/Array<(.+)>/, "$1[]")
    .replace(/Record<[^>]+>/, "object")
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Service URL hints (env vars, constants)
// ─────────────────────────────────────────────────────────────────────────────

function extractServiceUrlHints(
  fileContents: Map<string, string>,
  projectPath: string
): ServiceUrlHint[] {
  const hints: ServiceUrlHint[] = [];
  const seen = new Set<string>();

  for (const [filePath, content] of fileContents) {
    // .env files
    if (path.basename(filePath).startsWith(".env")) {
      const envRegex = /^([A-Z][A-Z0-9_]*(?:URL|HOST|ENDPOINT|BASE_URL|SERVICE)[A-Z0-9_]*)\s*=\s*(.+)$/gm;
      let match: RegExpExecArray | null;
      while ((match = envRegex.exec(content)) !== null) {
        const key = match[1];
        if (!seen.has(key)) {
          seen.add(key);
          hints.push({ key, value: match[2].trim(), sourceFile: filePath });
        }
      }
    }

    // TypeScript/JS constants: const MS2_URL = 'http://...' or process.env.MS2_URL
    const constRegex = /(?:const|let|var)\s+([A-Z][A-Z0-9_]*(?:URL|HOST|ENDPOINT|BASE|SERVICE)[A-Z0-9_]*)\s*=\s*['"`]([^'"`]+)['"`]/g;
    let match: RegExpExecArray | null;
    while ((match = constRegex.exec(content)) !== null) {
      const key = match[1];
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({ key, value: match[2], sourceFile: filePath });
      }
    }

    // process.env references
    const processEnvRegex = /process\.env\.([A-Z][A-Z0-9_]*(?:URL|HOST|ENDPOINT|BASE|SERVICE)[A-Z0-9_]*)/g;
    while ((match = processEnvRegex.exec(content)) !== null) {
      const key = match[1];
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({ key, value: undefined, sourceFile: filePath });
      }
    }

    // NestJS ConfigService: configService.get('MS2_URL')
    const configRegex = /configService\.get\s*\(\s*['"`]([A-Z][A-Z0-9_]*(?:URL|HOST|ENDPOINT|BASE|SERVICE)[A-Z0-9_]*)['"`]/g;
    while ((match = configRegex.exec(content)) !== null) {
      const key = match[1];
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({ key, value: undefined, sourceFile: filePath });
      }
    }

    // HTTP client base URLs in service constructors
    // e.g. private readonly baseUrl = 'http://order-service:3000'
    const baseUrlRegex = /baseUrl\s*(?::|=)\s*(?:process\.env\.\w+\s*\??\??\s*)?['"`](https?:\/\/[^'"`]+)['"`]/g;
    while ((match = baseUrlRegex.exec(content)) !== null) {
      const key = `BASE_URL_${path.basename(filePath, ".ts").toUpperCase()}`;
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        hints.push({ key, value: match[1], sourceFile: filePath });
      }
    }
  }

  return hints;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizePathPrefix(prefix: string): string {
  if (!prefix) return "";
  return prefix.startsWith("/") ? prefix : `/${prefix}`;
}

function combinePaths(prefix: string, routePath: string): string {
  const p = normalizePathPrefix(prefix);
  const r = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return `${p}${r}`.replace(/\/+/g, "/") || "/";
}

async function findOpenApiSpec(projectPath: string): Promise<string | null> {
  const candidates = [
    "openapi.yaml",
    "openapi.yml",
    "openapi.json",
    "swagger.yaml",
    "swagger.yml",
    "swagger.json",
    "api-docs.yaml",
    "api-docs.json",
    "src/openapi.yaml",
    "docs/openapi.yaml",
  ];

  for (const candidate of candidates) {
    const full = path.join(projectPath, candidate);
    try {
      const { access } = await import("fs/promises");
      await access(full);
      return full;
    } catch {
      // continue
    }
  }
  return null;
}
