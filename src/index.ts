/**
 * CrossCtx - Cross-service API dependency mapper
 *
 * Pipeline: Scan → Parse → Analyze → Render
 */
export { scanForSpecs } from "./scanner/index.js";
export { parseSpec } from "./parser/index.js";
export { analyzeDependencies } from "./analyzer/index.js";
export { buildOutput, saveOutput, printSummary } from "./renderer/index.js";
export type {
  CrossCtxOutput,
  Service,
  Endpoint,
  Dependency,
  ParsedSpec,
  ScanResult,
  SchemaInfo,
} from "./types/index.js";
