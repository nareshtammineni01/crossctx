/**
 * Core types for CrossCtx
 * Designed to be token-efficient and LLM-friendly
 */

// ─────────────────────────────────────────────
// LANGUAGE & FRAMEWORK DETECTION
// ─────────────────────────────────────────────

export type SupportedLanguage = "typescript" | "java" | "csharp" | "python" | "go" | "unknown";

// ─────────────────────────────────────────────────────────────────────────────
// DB USAGE (v0.3)
// ─────────────────────────────────────────────────────────────────────────────

/** A database table, collection, or index referenced by a service */
export interface DbUsage {
  /** Table / collection / index name */
  name: string;
  /** Database technology inferred from context */
  dbType: "sql" | "mongodb" | "redis" | "dynamodb" | "elasticsearch" | "unknown";
  /** How the reference was detected */
  accessPattern: "orm-model" | "raw-query" | "collection" | "cache-key" | "inferred";
  sourceFile: string;
  line?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED LIBRARIES (v0.3)
// ─────────────────────────────────────────────────────────────────────────────

/** An internal package/module shared across service boundaries */
export interface SharedLibrary {
  /** Import path / module name as it appears in source */
  importPath: string;
  /** Normalized library name */
  name: string;
  /** Services that import this library */
  usedByServices: string[];
  sourceFile: string;
}
export type SupportedFramework =
  | "nestjs"
  | "express"
  | "spring-boot"
  | "aspnet"
  | "fastapi"
  | "django"
  | "flask"
  | "gin"
  | "chi"
  | "unknown";

export interface DetectedLanguage {
  language: SupportedLanguage;
  framework: SupportedFramework;
  /** Evidence file that triggered this detection (e.g. package.json, pom.xml) */
  detectedFrom: string;
  /** Confidence 0-1 */
  confidence: number;
}

// ─────────────────────────────────────────────
// PAYLOAD / SCHEMA SHAPES (from source code)
// ─────────────────────────────────────────────

export interface PayloadField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface PayloadShape {
  /** DTO/class/interface name, if available */
  typeName?: string;
  fields: PayloadField[];
  /** How the shape was derived */
  source: "dto-class" | "interface" | "openapi" | "pydantic" | "inferred";
}

// ─────────────────────────────────────────────
// ENDPOINTS & OUTBOUND CALLS (from source code)
// ─────────────────────────────────────────────

export interface SourceEndpoint {
  /** Parent service name */
  service: string;
  /** HTTP method */
  method: string;
  /** Route path, e.g. /users/:id */
  path: string;
  /** Full route including controller prefix, e.g. /api/users/:id */
  fullPath: string;
  /** Controller class name */
  controllerClass?: string;
  /** Handler method name */
  handlerMethod?: string;
  /** Summary from JSDoc/Swagger decorator */
  summary?: string;
  /** Request body shape */
  requestBody?: PayloadShape;
  /** Response shape */
  response?: PayloadShape;
  /** File where this endpoint was found */
  sourceFile: string;
  /** Line number */
  line?: number;
  /** Outbound HTTP calls made from this handler */
  outboundCalls: OutboundCall[];
  /** Message queue events triggered from this handler */
  messageEvents?: MessageEvent[];
}

export interface OutboundCall {
  /** Raw URL or template string as found in code, e.g. `${this.MS2_URL}/api/orders` */
  rawUrl: string;
  /** Resolved service name (if matched), e.g. "order-service" */
  resolvedService?: string;
  /** Resolved endpoint path on the target service, e.g. /api/orders */
  resolvedPath?: string;
  /** HTTP method used */
  method: string;
  /** How the call was made (axios, fetch, HttpClient, RestTemplate, etc.) */
  callPattern: string;
  /** File and line */
  sourceFile: string;
  line?: number;
  /** Confidence of service resolution 0-1 */
  confidence: number;
  /** True when the call is inside an if/else/switch/ternary/try-catch block */
  conditional?: boolean;
  /** Best-effort extracted condition text, e.g. "if user.is_premium" */
  conditionHint?: string;
}

// ─────────────────────────────────────────────
// MESSAGE QUEUE & ASYNC MESSAGING
// ─────────────────────────────────────────────

export type MessagePattern = "kafka" | "rabbitmq" | "sqs" | "pubsub" | "redis-pubsub" | "nats";

export interface MessageEvent {
  /** Topic/queue/exchange name */
  topic: string;
  /** "publish" or "subscribe" */
  direction: "publish" | "subscribe";
  /** Message broker type */
  pattern: MessagePattern;
  /** Payload type if detectable */
  payloadType?: string;
  /** Source file and line */
  sourceFile: string;
  line?: number;
}

// ─────────────────────────────────────────────
// CALL CHAINS
// ─────────────────────────────────────────────

export interface CallChainNode {
  service: string;
  endpoint: string; // "METHOD /path"
  fullPath: string;
  requestBody?: PayloadShape;
  response?: PayloadShape;
  /** Child calls made from this endpoint */
  calls: CallChainNode[];
  /** True if this node was already visited (cycle detected) */
  isCycle?: boolean;
  /** True if no further outbound calls (leaf node) */
  isLeaf?: boolean;
  /** True if target could not be resolved */
  isUnresolved?: boolean;
}

export interface CallChain {
  /** Entry service */
  rootService: string;
  /** Entry endpoint */
  rootEndpoint: string;
  /** The full tree */
  tree: CallChainNode;
  /** Flattened list of all edges (for graph rendering) */
  edges: CallChainEdge[];
}

export interface CallChainEdge {
  from: string; // "service:METHOD /path"
  to: string; // "service:METHOD /path"
  fromService: string;
  toService: string;
  rawUrl: string;
  confidence: number;
  /** True when the call is inside a conditional block */
  conditional?: boolean;
  /** Best-effort extracted condition text */
  conditionHint?: string;
}

// ─────────────────────────────────────────────
// SCAN RESULTS (unified across languages)
// ─────────────────────────────────────────────

export interface CodeScanResult {
  /** Absolute path to the scanned project */
  projectPath: string;
  /** Detected language/framework */
  language: DetectedLanguage;
  /** Service name (derived from folder name or framework config) */
  serviceName: string;
  /** All endpoints found in controllers */
  endpoints: SourceEndpoint[];
  /** All DTOs/models found */
  dtos: PayloadShape[];
  /** Environment variables / constants that look like service URLs */
  serviceUrlHints: ServiceUrlHint[];
  /** Whether an OpenAPI spec was also found (can enrich payload shapes) */
  hasOpenApiSpec: boolean;
  specFile?: string;
  /** Service-wide message events (e.g. global publishers/subscribers) */
  messageEvents?: MessageEvent[];
  /** Database tables/collections used by this service (v0.3) */
  dbUsage?: DbUsage[];
}

export interface ServiceUrlHint {
  /** Variable name, e.g. ORDER_SERVICE_URL */
  key: string;
  /** Value if hardcoded, e.g. http://order-service:3000 */
  value?: string;
  /** File it was found in */
  sourceFile: string;
}

// ─────────────────────────────────────────────
// LEGACY / OPENAPI TYPES (kept for compatibility)
// ─────────────────────────────────────────────

/** Represents a single API endpoint (OpenAPI-derived) */
export interface Endpoint {
  service: string;
  method: string;
  path: string;
  summary?: string;
  requestBody?: SchemaInfo;
  response?: SchemaInfo;
}

/** Simplified schema representation (legacy) */
export interface SchemaInfo {
  type: string;
  properties?: Record<string, string>;
}

/** Represents a discovered service */
export interface Service {
  name: string;
  baseUrls: string[];
  specFile: string;
  specVersion: string;
  endpointCount: number;
}

/** Represents a dependency between two services */
export interface Dependency {
  from: string;
  to: string;
  detectedVia: "server-url" | "schema-ref" | "description" | "source-code";
  evidence: string;
}

/** Complete CrossCtx output */
export interface CrossCtxOutput {
  meta: {
    generatedAt: string;
    version: string;
    scanPaths: string[];
    totalFiles: number;
  };
  services: Service[];
  endpoints: Endpoint[];
  dependencies: Dependency[];
  /** Full code-scan results per project */
  codeScanResults?: CodeScanResult[];
  /** Computed call chains */
  callChains?: CallChain[];
  /** Shared internal libraries crossing service boundaries (v0.3) */
  sharedLibraries?: SharedLibrary[];
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
  serverUrls: string[];
  referencedUrls: string[];
}

// ─────────────────────────────────────────────
// DIFF / BREAKING CHANGE DETECTION
// ─────────────────────────────────────────────

export interface EndpointDiff {
  type: "added" | "removed" | "changed";
  service: string;
  method: string;
  path: string;
  /** For "changed": what changed */
  changes?: {
    requestBody?: { before?: string; after?: string };
    response?: { before?: string; after?: string };
    removedFields?: string[];
    addedFields?: string[];
  };
}

export interface DiffReport {
  baseline: string; // path to baseline file
  scannedAt: string; // ISO timestamp
  breaking: EndpointDiff[];
  nonBreaking: EndpointDiff[];
  summary: {
    totalBreaking: number;
    totalNonBreaking: number;
    removedEndpoints: number;
    addedEndpoints: number;
    changedEndpoints: number;
  };
}
