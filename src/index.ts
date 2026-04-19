/**
 * CrossCtx - Cross-service API dependency mapper
 *
 * Pipeline: Detect → Scan → Parse → Resolve → Chain → Render
 */

// Legacy OpenAPI pipeline
export { scanForSpecs } from "./scanner/index.js";
export { parseSpec } from "./parser/index.js";
export { analyzeDependencies } from "./analyzer/index.js";
export { buildOutput, saveOutput, printSummary } from "./renderer/index.js";
export { renderMarkdown, saveMarkdown } from "./renderer/markdown.js";
export { renderGraph, saveGraph } from "./renderer/graph.js";

// New source-code pipeline (v0.2)
export { detectLanguage, deriveServiceName } from "./detector/index.js";
export { parseTypeScriptProject } from "./parsers/typescript.js";
export { parseJavaProject } from "./parsers/java.js";
export { parseCSharpProject } from "./parsers/csharp.js";
export { parsePythonProject } from "./parsers/python.js";
export { extractMessageEvents } from "./parsers/messaging.js";
export {
  buildServiceRegistry,
  buildAllCallChains,
  resolveOutboundCall,
  findTargetEndpoint,
} from "./resolver/index.js";

// Diff / Breaking change detection
export { diffOutputs } from "./differ/index.js";

export type {
  // Legacy types
  CrossCtxOutput,
  Service,
  Endpoint,
  Dependency,
  ParsedSpec,
  ScanResult,
  SchemaInfo,
  // New types (v0.2)
  DetectedLanguage,
  SupportedLanguage,
  SupportedFramework,
  PayloadField,
  PayloadShape,
  SourceEndpoint,
  OutboundCall,
  MessageEvent,
  MessagePattern,
  CallChain,
  CallChainNode,
  CallChainEdge,
  CodeScanResult,
  ServiceUrlHint,
  // Diff types
  EndpointDiff,
  DiffReport,
} from "./types/index.js";
