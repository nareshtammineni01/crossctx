import { writeFile } from "fs/promises";
import path from "path";
import type { CrossCtxOutput, ParsedSpec, Dependency } from "../types/index.js";

const VERSION = "0.1.0";

/**
 * Build the final CrossCtx output JSON
 */
export function buildOutput(
  parsedSpecs: ParsedSpec[],
  dependencies: Dependency[],
  scanPaths: string[],
  totalFiles: number,
): CrossCtxOutput {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      version: VERSION,
      scanPaths: scanPaths.map((p) => path.resolve(p)),
      totalFiles,
    },
    services: parsedSpecs.map((s) => s.service),
    endpoints: parsedSpecs.flatMap((s) => s.endpoints),
    dependencies,
  };
}

/**
 * Save output to a JSON file
 */
export async function saveOutput(output: CrossCtxOutput, outputPath: string): Promise<void> {
  const json = JSON.stringify(output, null, 2);
  await writeFile(outputPath, json, "utf-8");
}

/**
 * Print a human-readable summary to the terminal
 */
export function printSummary(output: CrossCtxOutput): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════╗");
  lines.push("║           CrossCtx Results               ║");
  lines.push("╚══════════════════════════════════════════╝");
  lines.push("");

  // Services
  lines.push(`  Services found: ${output.services.length}`);
  for (const svc of output.services) {
    lines.push(`    • ${svc.name} (${svc.endpointCount} endpoints) [${svc.specVersion}]`);
    if (svc.baseUrls.length > 0) {
      lines.push(`      URLs: ${svc.baseUrls.join(", ")}`);
    }
  }
  lines.push("");

  // Endpoints
  lines.push(`  Total endpoints: ${output.endpoints.length}`);
  lines.push("");

  // Dependencies
  lines.push(`  Dependencies: ${output.dependencies.length}`);
  for (const dep of output.dependencies) {
    lines.push(`    ${dep.from} → ${dep.to} (${dep.detectedVia})`);
  }
  lines.push("");

  // Meta
  lines.push(`  Spec files scanned: ${output.meta.totalFiles}`);
  lines.push(`  Generated: ${output.meta.generatedAt}`);
  lines.push("");

  return lines.join("\n");
}
