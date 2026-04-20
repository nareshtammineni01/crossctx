/**
 * Architecture Insights Layer (v2.0)
 *
 * Post-scan analysis pass that interprets raw call-chain data into
 * human-readable architecture warnings: circular deps, high fan-out,
 * unresolved calls, overly-depended-upon ("hot") services.
 */

import type { CrossCtxOutput, CodeScanResult, CallChain } from "../types/index.js";

export type InsightSeverity = "error" | "warning" | "info";

export interface ArchInsight {
  severity: InsightSeverity;
  type:
    | "circular-dependency"
    | "high-fan-out"
    | "high-fan-in"
    | "unresolved-calls"
    | "tight-coupling"
    | "isolated-service";
  title: string;
  description: string;
  /** Services involved */
  services: string[];
}

/** Fan-out threshold: how many outbound service deps = "high" */
const HIGH_FAN_OUT = 3;
/** Fan-in threshold: how many services depend on you = "hot" */
const HIGH_FAN_IN = 4;
/** Tight coupling: what % of all service calls go between two services (0-1) */
const TIGHT_COUPLING_RATIO = 0.4;

/**
 * Detect circular dependency chains using DFS on the edge graph.
 * Returns arrays of service-name cycles found.
 */
function detectCircularDeps(callChains: CallChain[]): string[][] {
  // Build service-level adjacency: from service → set of to services
  const adj = new Map<string, Set<string>>();
  for (const chain of callChains) {
    for (const edge of chain.edges) {
      if (!adj.has(edge.fromService)) adj.set(edge.fromService, new Set());
      if (edge.toService && edge.toService !== edge.fromService) {
        adj.get(edge.fromService)!.add(edge.toService);
      }
    }
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stackPath: string[] = [];

  function dfs(node: string): void {
    if (inStack.has(node)) {
      // Found a cycle — extract it from the stack
      const cycleStart = stackPath.indexOf(node);
      if (cycleStart !== -1) {
        const cycle = [...stackPath.slice(cycleStart), node];
        // Deduplicate: normalize by starting at the lexicographically smallest node
        const minIdx = cycle.indexOf(cycle.slice(0, -1).sort()[0]);
        const normalized = [...cycle.slice(minIdx), ...cycle.slice(1, minIdx + 1)];
        // Only add if not already present
        const key = normalized.join("→");
        if (!cycles.some((c) => c.join("→") === key)) {
          cycles.push(normalized);
        }
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    stackPath.push(node);

    for (const neighbor of adj.get(node) ?? []) {
      dfs(neighbor);
    }

    stackPath.pop();
    inStack.delete(node);
  }

  for (const node of adj.keys()) {
    dfs(node);
  }

  return cycles;
}

/**
 * Compute per-service out-degree (how many distinct services it calls)
 * and in-degree (how many distinct services call it).
 */
function computeDegrees(
  codeScanResults: CodeScanResult[],
): Map<string, { out: Set<string>; in: Set<string> }> {
  const degrees = new Map<string, { out: Set<string>; in: Set<string> }>();

  const getOrCreate = (name: string) => {
    if (!degrees.has(name)) degrees.set(name, { out: new Set(), in: new Set() });
    return degrees.get(name)!;
  };

  for (const result of codeScanResults) {
    getOrCreate(result.serviceName);
    for (const endpoint of result.endpoints) {
      for (const call of endpoint.outboundCalls) {
        if (call.resolvedService && call.resolvedService !== result.serviceName) {
          getOrCreate(result.serviceName).out.add(call.resolvedService);
          getOrCreate(call.resolvedService).in.add(result.serviceName);
        }
      }
    }
  }

  return degrees;
}

/**
 * Count total cross-service call edges.
 */
function countCrossServiceEdges(callChains: CallChain[]): Map<string, number> {
  const pairCounts = new Map<string, number>();
  for (const chain of callChains) {
    for (const edge of chain.edges) {
      if (edge.fromService && edge.toService && edge.fromService !== edge.toService) {
        const key = `${edge.fromService}→${edge.toService}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  return pairCounts;
}

/**
 * Count unresolved outbound calls per service.
 */
function countUnresolved(
  codeScanResults: CodeScanResult[],
): Map<string, { count: number; examples: string[] }> {
  const result = new Map<string, { count: number; examples: string[] }>();
  for (const scan of codeScanResults) {
    let count = 0;
    const examples: string[] = [];
    for (const endpoint of scan.endpoints) {
      for (const call of endpoint.outboundCalls) {
        if (!call.resolvedService) {
          count++;
          if (examples.length < 3) examples.push(call.rawUrl);
        }
      }
    }
    if (count > 0) {
      result.set(scan.serviceName, { count, examples });
    }
  }
  return result;
}

/**
 * Main entry point: run all insight checks against a CrossCtxOutput.
 */
export function computeInsights(output: CrossCtxOutput): ArchInsight[] {
  const insights: ArchInsight[] = [];
  const scanResults = output.codeScanResults ?? [];
  const callChains = output.callChains ?? [];

  if (scanResults.length === 0) return insights;

  const degrees = computeDegrees(scanResults);

  // ── 1. Circular dependencies ─────────────────────────────────────────────
  const cycles = detectCircularDeps(callChains);
  for (const cycle of cycles) {
    const pair = cycle.slice(0, -1); // remove repeated first node at end
    insights.push({
      severity: "error",
      type: "circular-dependency",
      title: `Circular dependency: ${pair.join(" ↔ ")}`,
      description: `These services form a dependency cycle: ${pair.join(" → ")} → ${pair[0]}. This creates tight coupling and can cause cascading failures.`,
      services: pair,
    });
  }

  // ── 2. High fan-out ───────────────────────────────────────────────────────
  for (const [service, deg] of degrees) {
    if (deg.out.size >= HIGH_FAN_OUT) {
      const deps = [...deg.out].join(", ");
      insights.push({
        severity: "warning",
        type: "high-fan-out",
        title: `High fan-out: ${service} calls ${deg.out.size} services`,
        description: `${service} makes outbound calls to ${deg.out.size} different services (${deps}). Consider introducing an orchestrator or API gateway to reduce coupling.`,
        services: [service, ...deg.out],
      });
    }
  }

  // ── 3. High fan-in ("hot" services) ──────────────────────────────────────
  for (const [service, deg] of degrees) {
    if (deg.in.size >= HIGH_FAN_IN) {
      const callers = [...deg.in].join(", ");
      insights.push({
        severity: "warning",
        type: "high-fan-in",
        title: `High-risk service: ${service} is called by ${deg.in.size} services`,
        description: `${service} is depended on by ${deg.in.size} services (${callers}). An outage here has wide blast radius.`,
        services: [service, ...deg.in],
      });
    }
  }

  // ── 4. Unresolved calls ───────────────────────────────────────────────────
  const unresolved = countUnresolved(scanResults);
  if (unresolved.size > 0) {
    const totalUnresolved = [...unresolved.values()].reduce((s, v) => s + v.count, 0);
    const affectedServices = [...unresolved.keys()].join(", ");
    insights.push({
      severity: "info",
      type: "unresolved-calls",
      title: `${totalUnresolved} outbound call(s) could not be mapped`,
      description: `${totalUnresolved} calls across ${unresolved.size} service(s) (${affectedServices}) point to unrecognized targets. Add service URL hints or ensure all service directories are included in the scan.`,
      services: [...unresolved.keys()],
    });
  }

  // ── 5. Tight coupling between a specific pair ────────────────────────────
  const pairCounts = countCrossServiceEdges(callChains);
  const totalEdges = [...pairCounts.values()].reduce((s, v) => s + v, 0);
  if (totalEdges > 0) {
    for (const [pair, count] of pairCounts) {
      if (count / totalEdges >= TIGHT_COUPLING_RATIO && count >= 3) {
        const [from, to] = pair.split("→");
        insights.push({
          severity: "warning",
          type: "tight-coupling",
          title: `Tight coupling: ${from} → ${to}`,
          description: `${Math.round((count / totalEdges) * 100)}% of all cross-service calls go from ${from} to ${to} (${count} calls). Consider extracting a shared domain or interface.`,
          services: [from, to],
        });
      }
    }
  }

  // ── 6. Isolated services (no edges at all) ────────────────────────────────
  for (const result of scanResults) {
    const deg = degrees.get(result.serviceName);
    if (deg && deg.in.size === 0 && deg.out.size === 0 && result.endpoints.length > 0) {
      insights.push({
        severity: "info",
        type: "isolated-service",
        title: `Isolated service: ${result.serviceName}`,
        description: `${result.serviceName} has ${result.endpoints.length} endpoint(s) but no detected cross-service calls. It may be an entry point, or its outbound calls couldn't be resolved.`,
        services: [result.serviceName],
      });
    }
  }

  return insights;
}

/**
 * Format insights into a CLI-printable block.
 */
export function formatInsights(insights: ArchInsight[]): string {
  if (insights.length === 0) {
    return "\n  ✅  No architecture issues detected.\n";
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("  ⚡ Architecture Insights");
  lines.push("  ─────────────────────────────────────────────");
  lines.push("");

  const errors = insights.filter((i) => i.severity === "error");
  const warnings = insights.filter((i) => i.severity === "warning");
  const infos = insights.filter((i) => i.severity === "info");

  for (const insight of errors) {
    lines.push(`  ✖  ${insight.title}`);
    lines.push(`     ${insight.description}`);
    lines.push("");
  }

  for (const insight of warnings) {
    lines.push(`  ⚠️   ${insight.title}`);
    lines.push(`     ${insight.description}`);
    lines.push("");
  }

  for (const insight of infos) {
    lines.push(`  ℹ️   ${insight.title}`);
    lines.push(`     ${insight.description}`);
    lines.push("");
  }

  return lines.join("\n");
}
