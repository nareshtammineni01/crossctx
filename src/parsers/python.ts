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
  SupportedFramework,
} from "../types/index.js";
import { extractMessageEvents } from "./messaging.js";

const IGNORE = [
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/env/**",
  "**/.git/**",
  "**/migrations/**",
  "**/test_*.py",
  "**/*_test.py",
  "**/tests/**",
  "**/conftest.py",
];

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function parsePythonProject(
  projectPath: string,
  language: DetectedLanguage,
  serviceName: string,
): Promise<CodeScanResult> {
  const pyFiles = await fg(["**/*.py"], {
    cwd: projectPath,
    ignore: IGNORE,
    absolute: true,
    onlyFiles: true,
  });

  // Also read .env and config files for URL hints
  const configFiles = await fg(
    ["**/.env", "**/.env.example", "**/config.py", "**/settings.py", "**/config/*.py"],
    {
      cwd: projectPath,
      ignore: [...IGNORE, "**/test*"],
      absolute: true,
      onlyFiles: true,
      dot: true,
    },
  );

  const fileContents = new Map<string, string>();
  for (const file of [...pyFiles, ...configFiles]) {
    try {
      fileContents.set(file, await readFile(file, "utf-8"));
    } catch {
      /* skip */
    }
  }

  const framework = language.framework;

  // Extract Pydantic / serializer models first
  const dtoMap = extractPythonDTOs(fileContents, framework);

  // Extract URL hints
  const serviceUrlHints = extractPythonServiceUrlHints(fileContents);

  // Extract endpoints based on framework
  let endpoints: SourceEndpoint[] = [];
  if (framework === "fastapi") {
    endpoints = extractFastAPIEndpoints(fileContents, serviceName, dtoMap);
  } else if (framework === "django") {
    endpoints = extractDjangoEndpoints(fileContents, serviceName, dtoMap);
  } else if (framework === "flask") {
    endpoints = extractFlaskEndpoints(fileContents, serviceName, dtoMap);
  } else {
    // Try all — pick whichever finds more
    const fastapiEps = extractFastAPIEndpoints(fileContents, serviceName, dtoMap);
    const djangoEps = extractDjangoEndpoints(fileContents, serviceName, dtoMap);
    const flaskEps = extractFlaskEndpoints(fileContents, serviceName, dtoMap);
    endpoints = [fastapiEps, djangoEps, flaskEps].sort((a, b) => b.length - a.length)[0];
  }

  const specFile = await findOpenApiSpec(projectPath);

  // Extract message events
  const messageEvents = extractMessageEvents(fileContents, "python");

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
// FastAPI endpoint extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractFastAPIEndpoints(
  fileContents: Map<string, string>,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];

  // First pass: collect all router prefix declarations
  // router = APIRouter(prefix="/api/v1/orders")
  const routerPrefixes = collectRouterPrefixes(fileContents);

  for (const [filePath, content] of fileContents) {
    if (!isFastAPIFile(content)) continue;

    const fileEndpoints = extractFastAPIFileEndpoints(
      content,
      filePath,
      serviceName,
      dtoMap,
      routerPrefixes,
    );
    endpoints.push(...fileEndpoints);
  }

  return endpoints;
}

function isFastAPIFile(content: string): boolean {
  return (
    content.includes("@app.") ||
    content.includes("@router.") ||
    content.includes("APIRouter") ||
    content.includes("FastAPI") ||
    content.includes("from fastapi")
  );
}

function collectRouterPrefixes(fileContents: Map<string, string>): Map<string, string> {
  // varName → prefix  e.g. "router" → "/api/v1/orders"
  const prefixes = new Map<string, string>();

  for (const [, content] of fileContents) {
    // router = APIRouter(prefix="/orders")
    const routerRegex = /(\w+)\s*=\s*APIRouter\s*\([^)]*prefix\s*=\s*["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = routerRegex.exec(content)) !== null) {
      prefixes.set(match[1], match[2]);
    }

    // Also: app.include_router(orders_router, prefix="/orders")
    const includeRegex = /include_router\s*\(\s*(\w+)\s*,\s*prefix\s*=\s*["']([^"']+)["']/g;
    while ((match = includeRegex.exec(content)) !== null) {
      // This overrides any prefix set on the router itself
      prefixes.set(match[1], match[2]);
    }
  }

  return prefixes;
}

function extractFastAPIFileEndpoints(
  content: string,
  filePath: string,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
  routerPrefixes: Map<string, string>,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];
  const lines = content.split("\n");
  const allOutboundCalls = extractPythonOutboundCalls(content, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // @app.get("/path") or @router.get("/path", response_model=UserResponse)
    // Also @app.get("/path", tags=["users"])
    const decoratorMatch = line.match(
      /^\s*@(\w+)\.(get|post|put|delete|patch|head|options)\s*\(\s*["']([^"']+)["']/,
    );
    if (!decoratorMatch) continue;

    const routerVar = decoratorMatch[1]; // "app" or "router" or "users_router"
    const httpMethod = decoratorMatch[2].toUpperCase();
    const routePath = decoratorMatch[3];

    // Determine full path from router prefix
    const prefix = routerVar === "app" ? "" : (routerPrefixes.get(routerVar) ?? "");
    const fullPath = combinePaths(prefix, routePath);

    // Extract response_model from decorator args
    const responseModel = extractDecoratorArg(line, "response_model");

    // Find the function definition below decorator
    const { funcName, params, bodyStart, bodyEnd } = extractPythonFuncSignature(lines, i + 1);

    // Parse params for request body (Pydantic model params)
    const requestBody = extractFastAPIRequestBody(params, dtoMap);

    // Response from response_model or return type annotation
    const response =
      resolvePayload(responseModel, dtoMap) ?? extractReturnTypeAnnotation(lines, i + 1, dtoMap);

    // Summary from docstring or @router.get(..., summary="...")
    const summary =
      extractDecoratorArg(line, "summary") ?? extractPythonDocstring(lines, bodyStart);

    // Scope outbound calls to this function body
    const scopedCalls = allOutboundCalls.filter(
      (c) => c.line !== undefined && c.line > i && c.line >= bodyStart && c.line <= bodyEnd,
    );

    endpoints.push({
      service: serviceName,
      method: httpMethod,
      path: routePath,
      fullPath,
      handlerMethod: funcName,
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

function extractDecoratorArg(line: string, argName: string): string | undefined {
  // Match quoted string: response_model="Foo" or response_model='Foo'
  const quotedRegex = new RegExp(`${argName}\\s*=\\s*["']([^"']+)["']`);
  const quotedMatch = line.match(quotedRegex);
  if (quotedMatch) return quotedMatch[1];

  // Match bare identifier (class reference): response_model=RevenueReport or response_model=List[Foo]
  const identRegex = new RegExp(
    `${argName}\\s*=\\s*((?:List|Optional|Set|Dict)\\[[A-Za-z_]\\w*\\]|[A-Za-z_]\\w*)`,
  );
  return line.match(identRegex)?.[1];
}

function extractFastAPIRequestBody(
  params: string,
  dtoMap: Map<string, PayloadShape>,
): PayloadShape | undefined {
  if (!params) return undefined;

  // body: CreateOrderRequest  or  request: OrderRequest
  // Pydantic models are identified by PascalCase type hints that are not primitives
  const paramRegex = /(\w+)\s*:\s*([A-Z]\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(params)) !== null) {
    const [, paramName, typeName] = match;

    // Skip FastAPI built-in types and path/query params
    if (
      [
        "Request",
        "Response",
        "BackgroundTasks",
        "Query",
        "Header",
        "Cookie",
        "File",
        "Form",
      ].includes(typeName)
    )
      continue;
    // Path params are usually lowercase primitives
    if (["str", "int", "float", "bool", "UUID"].includes(typeName)) continue;

    // Handle FastAPI dependency injection: param: ServiceType = Depends(get_service)
    // — skip Depends-injected params as they are not request bodies
    const paramSectionRegex = new RegExp(
      `${paramName}\\s*:\\s*${typeName}[^,)]*=\\s*Depends\\s*\\(`,
    );
    if (paramSectionRegex.test(params)) continue;

    if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
    return { typeName, fields: [], source: "dto-class" };
  }

  return undefined;
}

/**
 * Collect FastAPI dependency injection service types.
 * Recognises: param: ServiceClass = Depends(get_service_func)
 * Returns all injected class names so callers can skip them from body detection.
 */
export function extractFastAPIDependencies(params: string): string[] {
  const deps: string[] = [];
  // Match: param_name: TypeName = Depends(...)
  const depRegex = /(\w+)\s*:\s*([A-Z]\w+)[^,)]*=\s*Depends\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = depRegex.exec(params)) !== null) {
    deps.push(m[2]);
  }
  return deps;
}

function extractReturnTypeAnnotation(
  lines: string[],
  startIdx: number,
  dtoMap: Map<string, PayloadShape>,
): PayloadShape | undefined {
  for (let i = startIdx; i < Math.min(startIdx + 3, lines.length); i++) {
    const line = lines[i].trim();
    // async def get_user(...) -> UserResponse:
    const match = line.match(/->\s*([A-Z]\w+(?:\[[\w[], ]+\])?)\s*:/);
    if (!match) continue;

    const rawType = match[1];
    // Unwrap Optional[X], List[X], dict[str, X]
    const typeName = unwrapPythonGeneric(rawType);
    if (!typeName || ["None", "dict", "str", "int", "bool"].includes(typeName)) continue;

    if (dtoMap.has(typeName)) return dtoMap.get(typeName)!;
    return { typeName, fields: [], source: "dto-class" };
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Django REST Framework endpoint extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractDjangoEndpoints(
  fileContents: Map<string, string>,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];

  // Collect URL patterns from urls.py files
  const urlPatterns = collectDjangoUrlPatterns(fileContents);

  for (const [filePath, content] of fileContents) {
    if (!isDjangoViewFile(content)) continue;

    const fileEndpoints = extractDjangoViewEndpoints(
      content,
      filePath,
      serviceName,
      dtoMap,
      urlPatterns,
    );
    endpoints.push(...fileEndpoints);
  }

  return endpoints;
}

function collectDjangoUrlPatterns(fileContents: Map<string, string>): Map<string, string> {
  // viewName → url prefix
  const patterns = new Map<string, string>();

  for (const [filePath, content] of fileContents) {
    if (!path.basename(filePath).includes("urls")) continue;

    // path('/api/orders/', OrderViewSet.as_view(...))
    // path('orders/', include('orders.urls'))
    const pathRegex = /path\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)(?:ViewSet|View|APIView)?\.as_view/g;
    let match: RegExpExecArray | null;
    while ((match = pathRegex.exec(content)) !== null) {
      patterns.set(match[2], `/${match[1]}`);
    }

    // path('api/emails/bulk/', send_bulk_email)  — function-based view (no .as_view)
    const pathFuncRegex = /path\s*\(\s*["']([^"']+)["']\s*,\s*([a-z_][a-zA-Z0-9_]*)\s*[,)]/g;
    while ((match = pathFuncRegex.exec(content)) !== null) {
      const funcName = match[2];
      // Skip if it looks like a class (PascalCase) — already captured above
      if (/^[A-Z]/.test(funcName)) continue;
      // Skip include(), re_path(), etc.
      if (["include", "re_path", "path"].includes(funcName)) continue;
      const urlPath = `/${match[1].replace(/\/$/, "")}`;
      patterns.set(funcName, urlPath);
    }

    // router.register(r'orders', OrderViewSet)
    const routerRegex = /router\.register\s*\(\s*r?["']([^"']+)["']\s*,\s*(\w+)/g;
    while ((match = routerRegex.exec(content)) !== null) {
      patterns.set(match[2], `/api/${match[1]}`);
    }
  }

  return patterns;
}

function isDjangoViewFile(content: string): boolean {
  return (
    content.includes("ViewSet") ||
    content.includes("APIView") ||
    content.includes("GenericAPIView") ||
    content.includes("@api_view") ||
    content.includes("from rest_framework")
  );
}

function extractDjangoViewEndpoints(
  content: string,
  filePath: string,
  serviceName: string,
  dtoMap: Map<string, PayloadShape>,
  urlPatterns: Map<string, string>,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];
  const lines = content.split("\n");
  const allOutboundCalls = extractPythonOutboundCalls(content, filePath);

  // @api_view(['GET', 'POST']) function-based views
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const apiViewMatch = line.match(/^\s*@api_view\s*\(\s*\[([^\]]+)\]/);
    if (!apiViewMatch) continue;

    const methods = apiViewMatch[1].match(/["'](\w+)["']/g)?.map((m) => m.replace(/["']/g, "")) ?? [
      "GET",
    ];
    const { funcName, bodyStart, bodyEnd } = extractPythonFuncSignature(lines, i + 1);
    const urlPrefix = urlPatterns.get(funcName) ?? `/${funcName.replace(/_/g, "-")}`;
    const summary = extractPythonDocstring(lines, bodyStart);
    const scopedCalls = allOutboundCalls.filter(
      (c) => c.line !== undefined && c.line >= bodyStart && c.line <= bodyEnd,
    );

    for (const method of methods) {
      endpoints.push({
        service: serviceName,
        method,
        path: urlPrefix,
        fullPath: urlPrefix,
        handlerMethod: funcName,
        summary,
        sourceFile: filePath,
        line: i + 1,
        outboundCalls: scopedCalls,
      });
    }
  }

  // Class-based ViewSets: list, create, retrieve, update, destroy methods
  const VIEWSET_METHOD_MAP: Record<string, string> = {
    list: "GET",
    create: "POST",
    retrieve: "GET",
    update: "PUT",
    partial_update: "PATCH",
    destroy: "DELETE",
    get: "GET",
    post: "POST",
    put: "PUT",
    delete: "DELETE",
    patch: "PATCH",
  };

  let currentClass = "";
  let currentClassPrefix = "";
  let classIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Class definition
    const classMatch = line.match(/^(\s*)class\s+(\w+)\s*\(/);
    if (classMatch) {
      currentClass = classMatch[2];
      classIndent = classMatch[1].length;
      currentClassPrefix =
        urlPatterns.get(currentClass) ??
        `/${currentClass.replace(/ViewSet|View|APIView/, "").toLowerCase()}`;
      continue;
    }

    if (!currentClass) continue;

    // Method inside class
    const methodMatch = line.match(
      /^(\s+)def\s+(list|create|retrieve|update|partial_update|destroy|get|post|put|delete|patch)\s*\(self/,
    );
    if (!methodMatch) continue;
    if (methodMatch[1].length <= classIndent) {
      currentClass = "";
      continue;
    }

    const methodName = methodMatch[2];
    const httpMethod = VIEWSET_METHOD_MAP[methodName] ?? "GET";

    // Path suffix for detail vs list actions
    const isDetail = ["retrieve", "update", "partial_update", "destroy"].includes(methodName);
    const routePath = isDetail ? `${currentClassPrefix}/{id}` : currentClassPrefix;

    const { bodyStart, bodyEnd } = extractPythonFuncSignature(lines, i + 1);

    // Request body from serializer usage
    const requestBody = extractDjangoSerializerBody(lines, bodyStart, bodyEnd, dtoMap);
    const response = extractDjangoSerializerResponse(lines, bodyStart, bodyEnd, dtoMap);
    const summary = extractPythonDocstring(lines, bodyStart);
    const scopedCalls = allOutboundCalls.filter(
      (c) => c.line !== undefined && c.line >= bodyStart && c.line <= bodyEnd,
    );

    endpoints.push({
      service: serviceName,
      method: httpMethod,
      path: routePath,
      fullPath: routePath,
      controllerClass: currentClass,
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

function extractDjangoSerializerBody(
  lines: string[],
  start: number,
  end: number,
  dtoMap: Map<string, PayloadShape>,
): PayloadShape | undefined {
  for (let i = start; i <= Math.min(end, lines.length - 1); i++) {
    // serializer = UserSerializer(data=request.data)
    const m = lines[i].match(/(\w+Serializer)\s*\(\s*data=/);
    if (m) return resolvePayload(m[1], dtoMap);
  }
  return undefined;
}

function extractDjangoSerializerResponse(
  lines: string[],
  start: number,
  end: number,
  dtoMap: Map<string, PayloadShape>,
): PayloadShape | undefined {
  for (let i = start; i <= Math.min(end, lines.length - 1); i++) {
    // serializer = UserSerializer(instance) or return Response(UserSerializer(user).data)
    const m = lines[i].match(/(\w+Serializer)\s*\([^)]*\)\.data/);
    if (m) return resolvePayload(m[1], dtoMap);
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flask endpoint extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractFlaskEndpoints(
  fileContents: Map<string, string>,
  serviceName: string,
  _dtoMap: Map<string, PayloadShape>,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];

  for (const [filePath, content] of fileContents) {
    if (!isFlaskFile(content)) continue;

    const lines = content.split("\n");
    const allOutboundCalls = extractPythonOutboundCalls(content, filePath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // @app.route('/path', methods=['GET', 'POST'])
      // @bp.route('/path')
      const routeMatch = line.match(
        /^\s*@(\w+)\.route\s*\(\s*["']([^"']+)["'](?:[^)]*methods\s*=\s*\[([^\]]+)\])?/,
      );
      if (!routeMatch) continue;

      const routePath = routeMatch[2];
      const methodsRaw = routeMatch[3];
      const methods = methodsRaw
        ? (methodsRaw.match(/["'](\w+)["']/g)?.map((m) => m.replace(/["']/g, "")) ?? ["GET"])
        : ["GET"];

      const { funcName, bodyStart, bodyEnd } = extractPythonFuncSignature(lines, i + 1);
      const summary = extractPythonDocstring(lines, bodyStart);
      const scopedCalls = allOutboundCalls.filter(
        (c) => c.line !== undefined && c.line >= bodyStart && c.line <= bodyEnd,
      );

      for (const method of methods) {
        endpoints.push({
          service: serviceName,
          method,
          path: routePath,
          fullPath: routePath,
          handlerMethod: funcName,
          summary,
          sourceFile: filePath,
          line: i + 1,
          outboundCalls: scopedCalls,
        });
      }
    }
  }

  return endpoints;
}

function isFlaskFile(content: string): boolean {
  return (
    content.includes("from flask") ||
    content.includes("import flask") ||
    content.includes("@app.route") ||
    content.includes("Blueprint")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound HTTP call extraction (Python)
// ─────────────────────────────────────────────────────────────────────────────

function extractPythonOutboundCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  const patterns: Array<{
    regex: RegExp;
    pattern: string;
    methodGroup?: number;
    urlGroup: number;
  }> = [
    // httpx.get("url") / httpx.post("url") / await client.get("url")
    {
      regex:
        /(?:httpx|client|async_client)\.(get|post|put|delete|patch|request)\s*\(\s*(?:url\s*=\s*)?f?["'`]([^"'`\n]+)["'`]/g,
      pattern: "httpx",
      methodGroup: 1,
      urlGroup: 2,
    },
    // httpx.get(url) where url is a variable — f-string version
    {
      regex: /(?:httpx|client)\.(get|post|put|delete|patch)\s*\(\s*(f["']([^"']+)["'])/g,
      pattern: "httpx-fstring",
      methodGroup: 1,
      urlGroup: 2,
    },
    // await self._client.get(f"{self.base_url}/orders")
    {
      regex: /self\._?(?:\w+_)?client\.(get|post|put|delete|patch)\s*\(\s*f?["']([^"'`\n]+)["']/g,
      pattern: "httpx-self",
      methodGroup: 1,
      urlGroup: 2,
    },
    // requests.get("url") / requests.post("url")
    {
      regex:
        /requests\.(get|post|put|delete|patch|request)\s*\(\s*(?:url\s*=\s*)?f?["']([^"'`\n]+)["'`]/g,
      pattern: "requests",
      methodGroup: 1,
      urlGroup: 2,
    },
    // requests.get(BASE_URL + "/path") or requests.post(self.base_url + "/path")
    {
      regex: /requests\.(get|post|put|delete|patch)\s*\(\s*([\w.]+\s*\+\s*["'][^"'\n]+["'])/g,
      pattern: "requests-concat",
      methodGroup: 1,
      urlGroup: 2,
    },
    // aiohttp: session.get("url") / await session.post("url")
    {
      regex:
        /(?:session|aiohttp_session)\.(get|post|put|delete|patch)\s*\(\s*f?["']([^"'`\n]+)["'`]/g,
      pattern: "aiohttp",
      methodGroup: 1,
      urlGroup: 2,
    },
    // httpx.AsyncClient().get / ClientSession
    {
      regex:
        /AsyncClient\s*\(\s*\)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*f?["']([^"'`\n]+)["'`]/g,
      pattern: "httpx-async",
      methodGroup: 1,
      urlGroup: 2,
    },
    // async with httpx.AsyncClient() as client: await client.get(...)
    // await client.get(url) / await client.post(url, json=...)
    {
      regex:
        /await\s+(?:client|self\.\w*client\w*|http_client|async_client)\.(get|post|put|delete|patch)\s*\(\s*f?["']([^"'`\n]+)["'`]/g,
      pattern: "httpx-await",
      methodGroup: 1,
      urlGroup: 2,
    },
    // httpx.AsyncClient(base_url="http://...") — capture base URL
    {
      regex: /httpx\.AsyncClient\s*\(\s*base_url\s*=\s*f?["']([^"'\n]+)["']/g,
      pattern: "httpx-base-url",
      urlGroup: 1,
    },
    // httpx.Client(base_url="http://...")
    {
      regex: /httpx\.Client\s*\(\s*base_url\s*=\s*f?["']([^"'\n]+)["']/g,
      pattern: "httpx-client-base-url",
      urlGroup: 1,
    },
    // urllib.request.urlopen("url")
    {
      regex: /urllib\.request\.urlopen\s*\(\s*["']([^"'\n]+)["']/g,
      pattern: "urllib",
      urlGroup: 1,
    },
    // f-string with base URL variable: f"{ORDER_SERVICE_URL}/api/orders"
    {
      regex:
        /f["']\{([A-Z_a-z]\w*(?:URL|HOST|BASE_URL|ENDPOINT|SERVICE_URL)\w*)\}([/][^"'\n]+)["']/g,
      pattern: "fstring-env",
      urlGroup: 1,
    },
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
      }

      // For f-string env patterns, combine variable and path
      if (pattern === "fstring-env" && match[2]) {
        rawUrl = `{${match[1]}}${match[2]}`;
      }

      // Clean up quotes
      rawUrl = rawUrl.replace(/^f?["'`]|["'`]$/g, "").trim();
      if (!rawUrl || rawUrl.length < 3) continue;

      // Reconstruct f-string templates for readability
      calls.push({
        rawUrl,
        method,
        callPattern: pattern,
        sourceFile: filePath,
        line: lineNum,
        confidence: rawUrl.startsWith("http") ? 0.9 : rawUrl.includes("{") ? 0.75 : 0.65,
      });
    }
  }

  return deduplicateCalls(calls);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pydantic model / Django Serializer extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractPythonDTOs(
  fileContents: Map<string, string>,
  framework: SupportedFramework,
): Map<string, PayloadShape> {
  const dtoMap = new Map<string, PayloadShape>();

  for (const [filePath, content] of fileContents) {
    // Scan ALL .py files, not just those matching isDTOFile heuristics
    if (!filePath.endsWith(".py")) continue;

    const shapes = extractPythonPayloadShapes(content, framework);
    for (const shape of shapes) {
      // Only add to map if it has fields (avoid empty class skeletons)
      if (shape.typeName && shape.fields.length > 0) {
        dtoMap.set(shape.typeName, shape);
      }
    }
  }

  return dtoMap;
}

function extractPythonPayloadShapes(
  content: string,
  _framework: SupportedFramework,
): PayloadShape[] {
  const shapes: PayloadShape[] = [];

  // Pydantic BaseModel (FastAPI) or dataclasses
  // class CreateOrderRequest(BaseModel):
  //     user_id: str
  //     items: List[str]
  //     total: float
  const classRegex =
    /^class\s+(\w+)\s*\(\s*(?:BaseModel|BaseSettings|pydantic\.BaseModel|Schema)\s*\)\s*:/gm;
  let match: RegExpExecArray | null;

  while ((match = classRegex.exec(content)) !== null) {
    const typeName = match[1];
    const classStart = match.index + match[0].length;
    const body = extractPythonClassBody(content, classStart);
    const fields = parsePydanticClassBody(body);
    shapes.push({ typeName, fields, source: "dto-class" });
  }

  // @dataclass
  const dataclassRegex = /@dataclass\s*\nclass\s+(\w+)\s*:/gm;
  while ((match = dataclassRegex.exec(content)) !== null) {
    const typeName = match[1];
    const classStart = match.index + match[0].length;
    const body = extractPythonClassBody(content, classStart);
    const fields = parsePydanticClassBody(body);
    shapes.push({ typeName, fields, source: "dto-class" });
  }

  // Django REST Serializers
  // class UserSerializer(serializers.ModelSerializer):
  const serializerRegex = /^class\s+(\w+Serializer)\s*\(.*?Serializer.*?\)\s*:/gm;
  while ((match = serializerRegex.exec(content)) !== null) {
    const typeName = match[1];
    const classStart = match.index + match[0].length;
    const body = extractPythonClassBody(content, classStart);
    const fields = parseDjangoSerializerBody(body);
    shapes.push({ typeName, fields, source: "dto-class" });
  }

  return shapes;
}

function extractPythonClassBody(content: string, startIdx: number): string {
  const lines = content.slice(startIdx).split("\n");
  const bodyLines: string[] = [];

  // Get base indent from first non-empty line
  let baseIndent = -1;

  for (const line of lines) {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      if (bodyLines.length > 0) bodyLines.push(line);
      continue;
    }

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (baseIndent === -1) {
      baseIndent = indent;
      bodyLines.push(line);
      continue;
    }

    // Once we hit a line at <= base indent of the class (back to module level), stop
    if (indent < baseIndent && line.trim() !== "") break;

    bodyLines.push(line);
  }

  return bodyLines.join("\n");
}

function parsePydanticClassBody(body: string): PayloadField[] {
  const fields: PayloadField[] = [];

  // field_name: type = default  or  field_name: type
  // Also: field_name: Optional[str] = None
  const fieldRegex = /^\s{4,}(\w+)\s*:\s*([\w[\], |"']+?)(?:\s*=\s*.+)?$/gm;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(body)) !== null) {
    const name = match[1];
    const typeRaw = match[2].trim();

    // Skip class-level config and dunder names
    if (name.startsWith("_") || name === "model_config" || name === "class Config") continue;
    // Skip method defs
    if (typeRaw.includes("(")) continue;

    const isOptional =
      typeRaw.startsWith("Optional") || typeRaw.endsWith("| None") || typeRaw.includes("None");
    const type = simplifyPythonType(typeRaw);

    fields.push({ name, type, required: !isOptional });
  }

  return fields;
}

function parseDjangoSerializerBody(body: string): PayloadField[] {
  const fields: PayloadField[] = [];

  // field = serializers.CharField(...)
  const fieldRegex = /^\s{4,}(\w+)\s*=\s*serializers\.(\w+Field|\w+Serializer)\s*\(([^)]*)\)/gm;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(body)) !== null) {
    const name = match[1];
    const fieldType = match[2].replace("Field", "").toLowerCase();
    const args = match[3];
    const required = !args.includes("required=False") && !args.includes("allow_null=True");

    fields.push({ name, type: fieldType || "string", required });
  }

  // Also fields = ['id', 'name', ...] from Meta class
  const metaFieldsMatch = body.match(/fields\s*=\s*\[([^\]]+)\]/);
  if (metaFieldsMatch && fields.length === 0) {
    const fieldNames =
      metaFieldsMatch[1].match(/["'](\w+)["']/g)?.map((f) => f.replace(/["']/g, "")) ?? [];
    for (const name of fieldNames) {
      if (name !== "__all__") fields.push({ name, type: "any", required: false });
    }
  }

  return fields;
}

function simplifyPythonType(type: string): string {
  const map: Record<string, string> = {
    str: "string",
    int: "integer",
    float: "float",
    bool: "boolean",
    bytes: "bytes",
    Any: "any",
    dict: "object",
    None: "null",
  };

  // Optional[str] → string, List[str] → string[], dict[str, Any] → object
  const optionalMatch = type.match(/Optional\[(.+)\]/);
  if (optionalMatch) return simplifyPythonType(optionalMatch[1]);

  const listMatch = type.match(/(?:List|list|Set|set)\[(.+)\]/);
  if (listMatch) return `${simplifyPythonType(listMatch[1])}[]`;

  const unionMatch = type.match(/Union\[(.+),\s*None\]/);
  if (unionMatch) return simplifyPythonType(unionMatch[1].split(",")[0].trim());

  // str | None (Python 3.10+ style)
  if (type.includes(" | ")) {
    const parts = type
      .split("|")
      .map((p) => p.trim())
      .filter((p) => p !== "None");
    return simplifyPythonType(parts[0]);
  }

  const base = type.trim();
  return map[base] ?? base;
}

function unwrapPythonGeneric(type: string): string {
  // Optional[UserResponse] → UserResponse, List[OrderDto] → OrderDto
  const inner = type.match(/\[(.+)\]/)?.[1];
  if (inner) return unwrapPythonGeneric(inner.split(",")[0].trim());
  return type.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Service URL hints from Python config
// ─────────────────────────────────────────────────────────────────────────────

function extractPythonServiceUrlHints(fileContents: Map<string, string>): ServiceUrlHint[] {
  const hints: ServiceUrlHint[] = [];
  const seen = new Set<string>();

  // Pass 1: .env files first — they have actual values and take priority
  for (const [filePath, content] of fileContents) {
    const fileName = path.basename(filePath);
    if (!fileName.startsWith(".env")) continue;

    const envRegex =
      /^([A-Z][A-Z0-9_]*(?:URL|HOST|ENDPOINT|BASE_URL|SERVICE_URL)[A-Z0-9_]*)\s*=\s*(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = envRegex.exec(content)) !== null) {
      const key = match[1];
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({ key, value: match[2].trim(), sourceFile: filePath });
      }
    }
  }

  // Pass 2: Python config/settings files
  for (const [filePath, content] of fileContents) {
    const fileName = path.basename(filePath);
    if (!fileName.endsWith(".py")) continue;

    let match: RegExpExecArray | null;

    // ORDER_SERVICE_URL = "http://order-service:8082"  (UPPER_CASE constants)
    const constRegex =
      /^([A-Z][A-Z0-9_]*(?:URL|HOST|ENDPOINT|BASE_URL|SERVICE)[A-Z0-9_]*)\s*=\s*(?:os\.(?:getenv|environ\.get)\s*\(\s*)?["']([^"'\n]+)["']/gm;
    while ((match = constRegex.exec(content)) !== null) {
      const key = match[1];
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({ key, value: match[2], sourceFile: filePath });
      }
    }

    // os.getenv("ORDER_SERVICE_URL") / os.environ.get("ORDER_SERVICE_URL") — key-only reference
    const osEnvRegex =
      /os\.(?:getenv|environ\.get)\s*\(\s*["']([A-Z][A-Z0-9_]*(?:URL|HOST|ENDPOINT|BASE_URL|SERVICE)[A-Z0-9_]*)["']/g;
    while ((match = osEnvRegex.exec(content)) !== null) {
      const key = match[1];
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({ key, value: undefined, sourceFile: filePath });
      }
    }

    // settings.py style: lower_case url assignments
    // order_service_url = os.getenv("ORDER_SERVICE_URL", "http://order-service:8082")
    const settingsRegex =
      /^(\w*(?:url|host|endpoint|base_url|service_url)\w*)\s*=\s*(?:os\.(?:getenv|environ\.get)\s*\(\s*["'][^"']+["']\s*,\s*)?["']([^"'\n]+)["']/gim;
    while ((match = settingsRegex.exec(content)) !== null) {
      const key = match[1].toUpperCase();
      if (!seen.has(key) && match[2].startsWith("http")) {
        seen.add(key);
        hints.push({ key, value: match[2], sourceFile: filePath });
      }
    }
  }

  return hints;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Python helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractPythonFuncSignature(
  lines: string[],
  startIdx: number,
): { funcName: string; params: string; bodyStart: number; bodyEnd: number } {
  let funcName = "unknown";
  let params = "";
  let bodyStart = startIdx;
  let bodyEnd = startIdx;

  for (let i = startIdx; i < Math.min(startIdx + 5, lines.length); i++) {
    const line = lines[i];
    const match = line.match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (match) {
      funcName = match[1];
      params = match[2];
      bodyStart = i + 1;

      // Find end of function body using indentation
      const funcIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
      bodyEnd = bodyStart;
      for (let j = bodyStart; j < lines.length; j++) {
        const bodyLine = lines[j];
        if (bodyLine.trim() === "") {
          bodyEnd = j;
          continue;
        }
        const lineIndent = bodyLine.match(/^(\s*)/)?.[1].length ?? 0;
        if (lineIndent <= funcIndent && bodyLine.trim() !== "") break;
        bodyEnd = j;
      }
      break;
    }
  }

  return { funcName, params, bodyStart, bodyEnd };
}

function extractPythonDocstring(lines: string[], bodyStart: number): string | undefined {
  if (bodyStart >= lines.length) return undefined;
  const firstLine = lines[bodyStart]?.trim();
  if (!firstLine) return undefined;

  // Single-line docstring: """Short description"""
  const singleMatch = firstLine.match(/^"""(.+?)"""|^'''(.+?)'''/);
  if (singleMatch) return (singleMatch[1] ?? singleMatch[2]).trim();

  // Multi-line: take first content line after opening triple quote
  if (firstLine.startsWith('"""') || firstLine.startsWith("'''")) {
    const content = firstLine.replace(/^"""|^'''/, "").trim();
    if (content) return content;
    const nextLine = lines[bodyStart + 1]?.trim();
    return nextLine && !nextLine.startsWith('"""') ? nextLine : undefined;
  }

  return undefined;
}

function resolvePayload(
  typeName: string | undefined,
  dtoMap: Map<string, PayloadShape>,
): PayloadShape | undefined {
  if (!typeName) return undefined;
  const clean = unwrapPythonGeneric(typeName);
  if (dtoMap.has(clean)) return dtoMap.get(clean)!;
  if (clean && /^[A-Z]/.test(clean)) return { typeName: clean, fields: [], source: "dto-class" };
  return undefined;
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

function combinePaths(prefix: string, route: string): string {
  const p = prefix ? (prefix.startsWith("/") ? prefix : `/${prefix}`) : "";
  const r = route.startsWith("/") ? route : `/${route}`;
  return `${p}${r}`.replace(/\/+/g, "/") || "/";
}

async function findOpenApiSpec(projectPath: string): Promise<string | null> {
  const candidates = [
    "openapi.yaml",
    "openapi.yml",
    "openapi.json",
    "swagger.yaml",
    "swagger.yml",
    "docs/openapi.yaml",
    "api/openapi.yaml",
    "app/openapi.yaml",
  ];
  for (const c of candidates) {
    try {
      const { access } = await import("fs/promises");
      await access(path.join(projectPath, c));
      return path.join(projectPath, c);
    } catch {
      /* continue */
    }
  }
  return null;
}
