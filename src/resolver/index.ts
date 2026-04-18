import type {
  CodeScanResult,
  OutboundCall,
  CallChain,
  CallChainNode,
  CallChainEdge,
  SourceEndpoint,
} from "../types/index.js";

const MAX_DEPTH = 20; // prevent infinite recursion on cycles

// ─────────────────────────────────────────────────────────────────────────────
// Service Registry
// Builds a global map: (URL pattern | service name | env var) → CodeScanResult
// ─────────────────────────────────────────────────────────────────────────────

export interface ServiceRegistry {
  /** service name → scan result */
  byName: Map<string, CodeScanResult>;
  /** hostname → service name */
  byHostname: Map<string, string>;
  /** env var key → service name (best guess) */
  byEnvKey: Map<string, string>;
  /** url fragment → service name */
  byUrlFragment: Map<string, string>;
}

export function buildServiceRegistry(scanResults: CodeScanResult[]): ServiceRegistry {
  const byName = new Map<string, CodeScanResult>();
  const byHostname = new Map<string, string>();
  const byEnvKey = new Map<string, string>();
  const byUrlFragment = new Map<string, string>();

  for (const result of scanResults) {
    const name = result.serviceName;
    byName.set(name, result);

    // Register all URL hints from this service
    for (const hint of result.serviceUrlHints) {
      if (hint.value) {
        try {
          const url = new URL(hint.value);
          byHostname.set(url.hostname, name);
          // Also index by port-stripped hostname
          byHostname.set(url.hostname.split(":")[0], name);
        } catch {
          // not a valid URL — try to use as a fragment
          const fragment = hint.value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
          byUrlFragment.set(fragment, name);
        }
      }

      // Map env var names to services using heuristics
      // ORDER_SERVICE_URL → order-service, MS2_BASE_URL → ms2
      const guessedService = guessServiceFromEnvKey(hint.key, name, Array.from(byName.keys()));
      if (guessedService && guessedService !== name) {
        byEnvKey.set(hint.key, guessedService);
      }
    }

    // Also register the service name itself as URL fragments
    byUrlFragment.set(name, name);
    byUrlFragment.set(name.replace(/-/g, ""), name);

    // Register by path fragments (e.g. /orders → order-service)
    for (const endpoint of result.endpoints) {
      const fragment = endpoint.path.split("/")[1]; // first path segment
      if (fragment && fragment.length > 2) {
        if (!byUrlFragment.has(fragment)) {
          byUrlFragment.set(fragment, name);
        }
      }
    }
  }

  return { byName, byHostname, byEnvKey, byUrlFragment };
}

function guessServiceFromEnvKey(
  envKey: string,
  currentService: string,
  allServiceNames: string[]
): string | null {
  const lower = envKey.toLowerCase().replace(/_/g, "-");

  // Direct match: ORDER_SERVICE_URL → order-service
  for (const svcName of allServiceNames) {
    if (lower.includes(svcName.toLowerCase())) {
      return svcName;
    }
  }

  // Partial match: MS2_URL → service named "ms2" or containing "ms2"
  const prefix = lower
    .replace(/-url$/, "")
    .replace(/-host$/, "")
    .replace(/-endpoint$/, "")
    .replace(/-base-url$/, "")
    .replace(/-service$/, "");

  for (const svcName of allServiceNames) {
    if (svcName.toLowerCase().includes(prefix) || prefix.includes(svcName.toLowerCase())) {
      return svcName;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Call Resolution
// For each outbound call, resolve which service + endpoint it targets
// ─────────────────────────────────────────────────────────────────────────────

export function resolveOutboundCall(
  call: OutboundCall,
  registry: ServiceRegistry,
  currentService: string
): OutboundCall {
  const resolved = { ...call };

  const rawUrl = call.rawUrl;

  // Strategy 1: Extract hostname from URL, look up in registry
  if (rawUrl.startsWith("http")) {
    try {
      const url = new URL(rawUrl.replace(/\$\{[^}]+\}/g, "placeholder"));
      const hostname = url.hostname;

      const byHost = registry.byHostname.get(hostname);
      if (byHost && byHost !== currentService) {
        resolved.resolvedService = byHost;
        resolved.resolvedPath = url.pathname;
        resolved.confidence = 0.95;
        return resolved;
      }
    } catch {
      // not a valid URL, continue
    }
  }

  // Strategy 2: Template string URL — extract env var name and resolve via byEnvKey
  // Handles:
  //   `${this.orderServiceUrl}/api/orders`  (JS/TS/C# template literal)
  //   `{ORDER_SERVICE_URL}/api/orders`      (Python f-string)
  //   ORDER_SERVICE_URL + "/api/orders"     (Python string concat)
  const templateEnvMatch =
    rawUrl.match(/\$\{(?:this\.|process\.env\.)?([A-Z_a-z][A-Za-z0-9_]*)[^}]*\}/) ||
    rawUrl.match(/^\{([A-Z][A-Z0-9_]+(?:URL|HOST|ENDPOINT|BASE_URL|SERVICE)[A-Z0-9_]*)\}/) ||
    rawUrl.match(/^([A-Z][A-Z0-9_]+(?:URL|HOST|ENDPOINT|BASE_URL|SERVICE)[A-Z0-9_]*)\s*\+/);
  if (templateEnvMatch) {
    const varName = templateEnvMatch[1].toUpperCase();

    // Helper: extract path portion after the template variable
    const extractPath = (url: string): string | undefined => {
      // `}/api/orders/...`  (template literal / f-string)
      const m1 = url.match(/\}([/][^`'"${}\s]+)/);
      if (m1) return normalizeTemplatePath(m1[1].split("?")[0]);
      // `VAR + "/api/orders/..."`  (string concat)
      const m2 = url.match(/\+\s*["']([/][^"']+)/);
      if (m2) return normalizeTemplatePath(m2[1].split("?")[0]);
      return undefined;
    };

    // Direct env key lookup
    const byEnv = registry.byEnvKey.get(varName);
    if (byEnv && byEnv !== currentService) {
      resolved.resolvedService = byEnv;
      resolved.resolvedPath = extractPath(rawUrl);
      resolved.confidence = 0.8;
      return resolved;
    }

    // Guess from the variable name fragments
    const guessed = guessServiceFromEnvKey(varName, currentService, Array.from(registry.byName.keys()));
    if (guessed && guessed !== currentService) {
      resolved.resolvedService = guessed;
      resolved.resolvedPath = extractPath(rawUrl);
      resolved.confidence = 0.65;
      return resolved;
    }
  }

  // Strategy 3: URL fragment matching — does the URL contain a service name?
  const urlLower = rawUrl.toLowerCase();
  for (const [fragment, svcName] of registry.byUrlFragment) {
    if (svcName !== currentService && urlLower.includes(fragment.toLowerCase())) {
      // Extract path: everything after the service name fragment
      const pathMatch = rawUrl.match(new RegExp(`${fragment}[^/]*(/[^'"\`$]+)`, "i"));
      resolved.resolvedService = svcName;
      resolved.resolvedPath = pathMatch ? normalizeTemplatePath(pathMatch[1]) : undefined;
      resolved.confidence = 0.6;
      return resolved;
    }
  }

  // Strategy 4: Relative path — might be an internal call or external unknown
  if (rawUrl.startsWith("/")) {
    // Check if any service has this endpoint
    for (const [svcName, result] of registry.byName) {
      if (svcName === currentService) continue;
      const matchedEndpoint = result.endpoints.find((ep) => pathMatches(ep.path, rawUrl));
      if (matchedEndpoint) {
        resolved.resolvedService = svcName;
        resolved.resolvedPath = rawUrl;
        resolved.confidence = 0.55;
        return resolved;
      }
    }
  }

  // Unresolved
  resolved.confidence = 0;
  return resolved;
}

function normalizeTemplatePath(path: string): string {
  // Replace :id, ${id} patterns with {param} for display
  return path
    .replace(/\$\{[^}]+\}/g, "{param}")
    .replace(/:[a-zA-Z]+/g, "{param}")
    .replace(/\/+/g, "/")
    .trim();
}

function pathMatches(endpointPath: string, requestPath: string): boolean {
  // Normalize both paths to compare
  const normalize = (p: string) =>
    p.replace(/:[^/]+/g, "{x}").replace(/\{[^}]+\}/g, "{x}").replace(/\/+$/, "");

  return normalize(endpointPath) === normalize(requestPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Find target endpoint given resolved service + path
// ─────────────────────────────────────────────────────────────────────────────

export function findTargetEndpoint(
  targetService: string,
  targetPath: string | undefined,
  targetMethod: string,
  registry: ServiceRegistry
): SourceEndpoint | undefined {
  const svc = registry.byName.get(targetService);
  if (!svc || !targetPath) return undefined;

  // Match by method + path
  return svc.endpoints.find(
    (ep) =>
      ep.method === targetMethod &&
      (pathMatches(ep.path, targetPath) || pathMatches(ep.fullPath, targetPath))
  ) ?? svc.endpoints.find((ep) => pathMatches(ep.path, targetPath) || pathMatches(ep.fullPath, targetPath));
}

// ─────────────────────────────────────────────────────────────────────────────
// Call Chain Walker
// Builds the full tree: MS1-API1 → MS2-API3 → MS4-API6 → [leaf]
// ─────────────────────────────────────────────────────────────────────────────

export function buildAllCallChains(
  scanResults: CodeScanResult[],
  registry: ServiceRegistry
): CallChain[] {
  const chains: CallChain[] = [];

  for (const result of scanResults) {
    for (const endpoint of result.endpoints) {
      // Only build chains from endpoints that actually make outbound calls
      if (endpoint.outboundCalls.length === 0) continue;

      const edges: CallChainEdge[] = [];
      const visited = new Set<string>();

      const tree = walkChain(endpoint, result.serviceName, registry, visited, edges, 0);

      chains.push({
        rootService: result.serviceName,
        rootEndpoint: `${endpoint.method} ${endpoint.fullPath}`,
        tree,
        edges,
      });
    }
  }

  return chains;
}

function walkChain(
  endpoint: SourceEndpoint,
  serviceName: string,
  registry: ServiceRegistry,
  visited: Set<string>,
  edges: CallChainEdge[],
  depth: number
): CallChainNode {
  const nodeKey = `${serviceName}:${endpoint.method}:${endpoint.fullPath}`;
  const endpointLabel = `${endpoint.method} ${endpoint.fullPath}`;

  const node: CallChainNode = {
    service: serviceName,
    endpoint: endpointLabel,
    fullPath: endpoint.fullPath,
    requestBody: endpoint.requestBody,
    response: endpoint.response,
    calls: [],
    isLeaf: endpoint.outboundCalls.length === 0,
  };

  if (visited.has(nodeKey)) {
    node.isCycle = true;
    node.isLeaf = false;
    return node;
  }

  if (depth >= MAX_DEPTH) {
    node.isLeaf = true;
    return node;
  }

  visited.add(nodeKey);

  for (const call of endpoint.outboundCalls) {
    // Resolve the call
    const resolvedCall = resolveOutboundCall(call, registry, serviceName);

    if (!resolvedCall.resolvedService) {
      // Unresolved — add as unresolved leaf
      node.calls.push({
        service: "unknown",
        endpoint: `${call.method} ${call.rawUrl}`,
        fullPath: call.rawUrl,
        calls: [],
        isLeaf: true,
        isUnresolved: true,
      });
      continue;
    }

    // Find the target endpoint
    const targetEndpoint = findTargetEndpoint(
      resolvedCall.resolvedService,
      resolvedCall.resolvedPath,
      resolvedCall.method,
      registry
    );

    const edgeKey = `${nodeKey}→${resolvedCall.resolvedService}:${resolvedCall.method}:${resolvedCall.resolvedPath}`;

    // Add edge
    const edgeExists = edges.some(
      (e) => e.from === `${serviceName}:${endpointLabel}` && e.toService === resolvedCall.resolvedService
    );

    if (!edgeExists) {
      edges.push({
        from: `${serviceName}:${endpointLabel}`,
        to: targetEndpoint
          ? `${resolvedCall.resolvedService}:${targetEndpoint.method} ${targetEndpoint.fullPath}`
          : `${resolvedCall.resolvedService}:${call.method} ${resolvedCall.resolvedPath ?? call.rawUrl}`,
        fromService: serviceName,
        toService: resolvedCall.resolvedService,
        rawUrl: call.rawUrl,
        confidence: resolvedCall.confidence,
      });
    }

    if (targetEndpoint) {
      // Recurse — walk the target endpoint's chain
      const childNode = walkChain(
        targetEndpoint,
        resolvedCall.resolvedService,
        registry,
        new Set(visited), // copy visited set so sibling calls don't block each other
        edges,
        depth + 1
      );
      node.calls.push(childNode);
    } else {
      // We know the service but not the exact endpoint
      node.calls.push({
        service: resolvedCall.resolvedService,
        endpoint: `${call.method} ${resolvedCall.resolvedPath ?? call.rawUrl}`,
        fullPath: resolvedCall.resolvedPath ?? call.rawUrl,
        calls: [],
        isLeaf: true,
        isUnresolved: resolvedCall.confidence < 0.5,
      });
    }
  }

  // Update leaf status
  node.isLeaf = node.calls.length === 0;

  return node;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flatten chains to edges for graph rendering
// ─────────────────────────────────────────────────────────────────────────────

export function flattenChainEdges(chains: CallChain[]): CallChainEdge[] {
  const seen = new Set<string>();
  const edges: CallChainEdge[] = [];

  for (const chain of chains) {
    for (const edge of chain.edges) {
      const key = `${edge.from}→${edge.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(edge);
      }
    }
  }

  return edges;
}
