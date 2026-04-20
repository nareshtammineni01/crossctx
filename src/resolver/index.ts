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
  /**
   * Named HTTP client → service name.
   * Covers: C# AddHttpClient("order-service"), Java @FeignClient(name="order-service"),
   * Spring Cloud @LoadBalancerClient(name="order-service")
   */
  byNamedClient: Map<string, string>;
}

export function buildServiceRegistry(scanResults: CodeScanResult[]): ServiceRegistry {
  const byName = new Map<string, CodeScanResult>();
  const byHostname = new Map<string, string>();
  const byEnvKey = new Map<string, string>();
  const byUrlFragment = new Map<string, string>();
  const byNamedClient = new Map<string, string>();

  for (const result of scanResults) {
    const name = result.serviceName;
    byName.set(name, result);

    // Register all URL hints from this service
    for (const hint of result.serviceUrlHints) {
      if (hint.value) {
        // feign://order-service  (emitted by Java FeignClient parser)
        if (hint.value.startsWith("feign://")) {
          const feignTarget = hint.value.slice(8).split("/")[0];
          byNamedClient.set(feignTarget, name);
          byNamedClient.set(feignTarget.toLowerCase(), name);
          continue;
        }

        // lb://order-service  (Spring Cloud LoadBalancer)
        if (hint.value.startsWith("lb://")) {
          const lbTarget = hint.value.slice(5).split("/")[0];
          byNamedClient.set(lbTarget, name);
          byNamedClient.set(lbTarget.toLowerCase(), name);
          continue;
        }

        try {
          const url = new URL(hint.value);
          const hostname = url.hostname;
          const bareHostname = hostname.split(":")[0];

          // The hostname in a URL hint tells us which service is being referenced,
          // not which service owns the hint. Map hostname → the referenced service.
          // e.g. notification-service has hint UserServiceUrl=http://user-service:8080
          //      → byHostname["user-service"] = "user-service"  (not "notification-service")
          // If the referenced service is not in the scanned set, skip — don't map to owner
          const referencedByName =
            guessServiceFromName(bareHostname, "", Array.from(byName.keys())) ??
            (byName.has(bareHostname) ? bareHostname : null);

          if (referencedByName) {
            byHostname.set(hostname, referencedByName);
            byHostname.set(bareHostname, referencedByName);
          }
          // else: hostname references an unscanned service — don't register it

          // Kubernetes DNS: order-service.default.svc.cluster.local → order-service
          const k8sMatch = hostname.match(/^([a-z0-9-]+)\.[a-z0-9-]+\.svc\.cluster\.local$/i);
          if (k8sMatch) {
            const k8sTarget = guessServiceFromName(k8sMatch[1], "", Array.from(byName.keys()));
            if (k8sTarget) {
              byHostname.set(k8sMatch[1], k8sTarget);
              byNamedClient.set(k8sMatch[1], k8sTarget);
            }
          }

          // Consul DNS: order-service.service.consul → order-service
          const consulMatch = hostname.match(/^([a-z0-9-]+)\.service\.consul$/i);
          if (consulMatch) {
            const consulTarget = guessServiceFromName(
              consulMatch[1],
              "",
              Array.from(byName.keys()),
            );
            if (consulTarget) {
              byHostname.set(consulMatch[1], consulTarget);
              byNamedClient.set(consulMatch[1], consulTarget);
            }
          }
        } catch {
          // not a valid URL — try to use as a fragment
          const fragment = hint.value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
          byUrlFragment.set(fragment, name);
        }
      }

      // Map env var names to services using heuristics
      // ORDER_SERVICE_URL → order-service, MS2_BASE_URL → ms2
      // Normalize keys to UPPER_SNAKE_CASE so lookups match regardless of hint casing
      const guessedService = guessServiceFromEnvKey(hint.key, name, Array.from(byName.keys()));
      if (guessedService && guessedService !== name) {
        // Store under both original key and uppercased key for broad matching
        byEnvKey.set(hint.key, guessedService);
        byEnvKey.set(hint.key.toUpperCase(), guessedService);
        // Also camelCase→UPPER_SNAKE: UserServiceUrl → USER_SERVICE_URL
        const upperSnake = hint.key.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
        byEnvKey.set(upperSnake, guessedService);
      }

      // HTTP_CLIENT_ORDER_SERVICE → named client "order-service"
      // This is emitted by C# AddHttpClient("order-service", ...) → key = HTTP_CLIENT_ORDER_SERVICE
      if (hint.key.startsWith("HTTP_CLIENT_")) {
        const clientName = hint.key.slice("HTTP_CLIENT_".length).toLowerCase().replace(/_/g, "-");
        const target = guessServiceFromName(clientName, name, Array.from(byName.keys()));
        if (target && target !== name) {
          byNamedClient.set(clientName, target);
        }
      }
    }

    // Register the service name itself as named client (direct name match)
    byNamedClient.set(name, name);
    byNamedClient.set(name.toLowerCase(), name);
    // Also common variants: order-service → orderservice, OrderService
    byNamedClient.set(name.replace(/-/g, ""), name);
    byNamedClient.set(name.replace(/-/g, "").toLowerCase(), name);

    // Also register the service name itself as URL fragments
    byUrlFragment.set(name, name);
    byUrlFragment.set(name.replace(/-/g, ""), name);

    // Register by path fragments (e.g. /orders → order-service)
    // Use fullPath (with controller prefix) so partial controller names are also indexed
    for (const endpoint of result.endpoints) {
      // Index first path segment from fullPath (e.g. "/api/notification/..." → "notification")
      const segments = endpoint.fullPath.split("/").filter(Boolean);
      // Skip generic segments like "api", "v1", "v2"
      const genericSegments = new Set(["api", "v1", "v2", "v3", "rest", "service"]);
      for (const seg of segments) {
        if (!seg || seg.length <= 2 || seg.startsWith("{") || genericSegments.has(seg)) continue;
        if (!byUrlFragment.has(seg)) {
          byUrlFragment.set(seg, name);
        }
        break; // only register first meaningful segment
      }
      // Also try path (without prefix) for broad matching
      const fragment = endpoint.path.split("/")[1];
      if (
        fragment &&
        fragment.length > 2 &&
        !fragment.startsWith("{") &&
        !genericSegments.has(fragment)
      ) {
        if (!byUrlFragment.has(fragment)) {
          byUrlFragment.set(fragment, name);
        }
      }
    }
  }

  return { byName, byHostname, byEnvKey, byUrlFragment, byNamedClient };
}

function guessServiceFromEnvKey(
  envKey: string,
  currentService: string,
  allServiceNames: string[],
): string | null {
  // Normalize: handle both UPPER_SNAKE_CASE and camelCase keys
  // UserServiceUrl → user-service-url, ORDER_SERVICE_URL → order-service-url
  const kebabFromCamel = envKey.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const lower = kebabFromCamel.replace(/_/g, "-");

  // Direct match: ORDER_SERVICE_URL → order-service, UserServiceUrl → user-service
  // Also check dehyphenated service name: "notificationserviceurl".includes("notificationservice") ✓
  for (const svcName of allServiceNames) {
    if (svcName !== currentService) {
      const svcLower = svcName.toLowerCase();
      const svcNohyphen = svcLower.replace(/-/g, "");
      if (lower.includes(svcLower) || lower.includes(svcNohyphen)) {
        return svcName;
      }
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
    if (
      svcName !== currentService &&
      (svcName.toLowerCase().includes(prefix) || prefix.includes(svcName.toLowerCase()))
    ) {
      return svcName;
    }
  }

  return null;
}

/**
 * Match a raw client/service name (from FeignClient, LoadBalancer, etc.) to a known service.
 * Handles: exact match, camelCase → kebab-case, suffix stripping.
 */
function guessServiceFromName(
  clientName: string,
  currentService: string,
  allServiceNames: string[],
): string | null {
  const lower = clientName.toLowerCase();
  // camelCase → kebab-case: orderService → order-service
  const kebab = clientName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

  for (const svcName of allServiceNames) {
    if (svcName === currentService) continue;
    const svcLower = svcName.toLowerCase();
    if (
      svcLower === lower ||
      svcLower === kebab ||
      svcLower === lower.replace(/-service$/, "") ||
      svcLower.replace(/-service$/, "") === lower ||
      svcLower.replace(/-service$/, "") === kebab.replace(/-service$/, "")
    ) {
      return svcName;
    }
  }

  // Partial: does the client name contain the service name (minus "service")?
  for (const svcName of allServiceNames) {
    if (svcName === currentService) continue;
    const core = svcName.toLowerCase().replace(/-service$/, "");
    if (core.length > 2 && (lower.includes(core) || kebab.includes(core))) {
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
  currentService: string,
): OutboundCall {
  const resolved = { ...call };
  const rawUrl = call.rawUrl;

  // ── Strategy 0: Named client / FeignClient / LoadBalancer (highest confidence) ──
  // feign://order-service/api/orders  (Java FeignClient)
  // lb://order-service/api/orders     (Spring Cloud LoadBalancer)
  // CreateClient("order-service")     (C# IHttpClientFactory — rawUrl is just the client name)
  const namedSchemeMatch = rawUrl.match(/^(?:feign|lb):\/\/([^/]+)(\/.*)?$/i);
  if (namedSchemeMatch) {
    const clientName = namedSchemeMatch[1];
    const path = namedSchemeMatch[2];
    const target =
      registry.byNamedClient.get(clientName) ??
      registry.byNamedClient.get(clientName.toLowerCase());
    if (target && target !== currentService) {
      resolved.resolvedService = target;
      resolved.resolvedPath = path ? normalizeTemplatePath(path.split("?")[0]) : undefined;
      resolved.confidence = 0.95;
      return resolved;
    }
    // Even if we can't find it in registry, guess from name
    const guessed = guessServiceFromName(
      clientName,
      currentService,
      Array.from(registry.byName.keys()),
    );
    if (guessed && guessed !== currentService) {
      resolved.resolvedService = guessed;
      resolved.resolvedPath = path ? normalizeTemplatePath(path.split("?")[0]) : undefined;
      resolved.confidence = 0.85;
      return resolved;
    }
  }

  // Named client patterns without scheme — just a bare name used as rawUrl
  // e.g. CreateClient("order-service") where we stored "order-service" as rawUrl
  if (!rawUrl.includes("/") && !rawUrl.includes("{") && !rawUrl.startsWith("http")) {
    const directClient =
      registry.byNamedClient.get(rawUrl) ?? registry.byNamedClient.get(rawUrl.toLowerCase());
    if (directClient && directClient !== currentService) {
      resolved.resolvedService = directClient;
      resolved.confidence = 0.85;
      return resolved;
    }
  }

  // ── Strategy 1: Extract hostname from URL ──
  if (rawUrl.startsWith("http")) {
    try {
      // Sanitize template expressions before URL parsing
      const sanitized = rawUrl
        .replace(/\$\{[^}]+\}/g, "placeholder")
        .replace(/\{[A-Z_][A-Z0-9_]*\}/g, "placeholder")
        .split("?")[0];
      const url = new URL(sanitized);
      const hostname = url.hostname;

      // Direct hostname lookup
      const byHost =
        registry.byHostname.get(hostname) ?? registry.byHostname.get(hostname.split(":")[0]);
      if (byHost && byHost !== currentService) {
        resolved.resolvedService = byHost;
        resolved.resolvedPath = url.pathname === "/placeholder" ? undefined : url.pathname;
        resolved.confidence = 0.95;
        return resolved;
      }

      // Kubernetes DNS: order-service.namespace.svc.cluster.local
      const k8sMatch = hostname.match(/^([a-z0-9-]+)\.[a-z0-9-]+\.svc\.cluster\.local$/i);
      if (k8sMatch) {
        const svcShort = k8sMatch[1];
        const k8sTarget = registry.byNamedClient.get(svcShort) ?? registry.byHostname.get(svcShort);
        if (k8sTarget && k8sTarget !== currentService) {
          resolved.resolvedService = k8sTarget;
          resolved.resolvedPath = url.pathname;
          resolved.confidence = 0.95;
          return resolved;
        }
      }

      // Consul DNS: order-service.service.consul
      const consulMatch = hostname.match(/^([a-z0-9-]+)\.service\.consul$/i);
      if (consulMatch) {
        const consulTarget =
          registry.byNamedClient.get(consulMatch[1]) ?? registry.byHostname.get(consulMatch[1]);
        if (consulTarget && consulTarget !== currentService) {
          resolved.resolvedService = consulTarget;
          resolved.resolvedPath = url.pathname;
          resolved.confidence = 0.95;
          return resolved;
        }
      }
    } catch {
      // not a valid URL, continue
    }
  }

  // ── Strategy 2: Template string URL — extract env var / field name ──
  // JS/TS:  `${this.orderServiceUrl}/api/orders`  or  `${process.env.ORDER_SERVICE_URL}/api/orders`
  // Python: `{ORDER_SERVICE_URL}/api/orders`
  // Concat: `ORDER_SERVICE_URL + "/api/orders"`  or  `orderServiceUrl + "/api/orders"` (camelCase field)
  const templateEnvMatch =
    rawUrl.match(/\$\{(?:this\.|process\.env\.)?([A-Z_a-z][A-Za-z0-9_]*)[^}]*\}/) ||
    rawUrl.match(/^\{([A-Z][A-Z0-9_]+(?:URL|HOST|ENDPOINT|BASE_URL|SERVICE)[A-Z0-9_]*)\}/) ||
    rawUrl.match(/^([A-Z][A-Z0-9_]+(?:URL|HOST|ENDPOINT|BASE_URL|SERVICE)[A-Z0-9_]*)\s*\+/) ||
    rawUrl.match(/^([a-z][A-Za-z0-9]*(?:Url|Host|BaseUrl|ServiceUrl|Endpoint|Client))\s*\+/);

  if (templateEnvMatch) {
    const varName = templateEnvMatch[1].toUpperCase();

    const extractPath = (url: string): string | undefined => {
      const m1 = url.match(/\}([/][^`'"${}\s]+)/);
      if (m1) return normalizeTemplatePath(m1[1].split("?")[0]);
      const m2 = url.match(/\+\s*["']([/][^"']+)/);
      if (m2) return normalizeTemplatePath(m2[1].split("?")[0]);
      return undefined;
    };

    // Direct env key lookup
    const byEnv = registry.byEnvKey.get(varName);
    if (byEnv && byEnv !== currentService) {
      resolved.resolvedService = byEnv;
      resolved.resolvedPath = extractPath(rawUrl);
      resolved.confidence = 0.85;
      return resolved;
    }

    // Guess from variable name
    const guessed = guessServiceFromEnvKey(
      varName,
      currentService,
      Array.from(registry.byName.keys()),
    );
    if (guessed && guessed !== currentService) {
      resolved.resolvedService = guessed;
      resolved.resolvedPath = extractPath(rawUrl);
      resolved.confidence = 0.7;
      return resolved;
    }

    // Try resolving the actual env var value from hints
    // varName is uppercased; hint keys may be camelCase, so normalize both for comparison
    for (const [, result] of registry.byName) {
      const hint = result.serviceUrlHints.find((h) => {
        const hKeyUpper = h.key.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
        return (hKeyUpper === varName || h.key.toUpperCase() === varName) && h.value;
      });
      if (hint?.value) {
        try {
          const url = new URL(hint.value);
          const byHost = registry.byHostname.get(url.hostname);
          if (byHost && byHost !== currentService) {
            resolved.resolvedService = byHost;
            resolved.resolvedPath = extractPath(rawUrl);
            resolved.confidence = 0.8;
            return resolved;
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  // ── Strategy 3: URL fragment matching ──
  const urlLower = rawUrl.toLowerCase();
  const pathSegmentPattern = "([/][^'\"\\s?#]+)";
  for (const [fragment, svcName] of registry.byUrlFragment) {
    if (
      svcName !== currentService &&
      fragment.length > 2 &&
      urlLower.includes(fragment.toLowerCase())
    ) {
      const escapedFrag = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pathMatch = rawUrl.match(new RegExp(escapedFrag + "[^/]*" + pathSegmentPattern, "i"));
      resolved.resolvedService = svcName;
      resolved.resolvedPath = pathMatch
        ? normalizeTemplatePath(pathMatch[1].split("?")[0])
        : undefined;
      resolved.confidence = 0.6;
      return resolved;
    }
  }

  // ── Strategy 4: Named client guess from partial name in URL ──
  // e.g. "orderService" in a camelCase field name → order-service
  for (const [clientName, svcName] of registry.byNamedClient) {
    if (
      svcName !== currentService &&
      clientName.length > 3 &&
      urlLower.includes(clientName.toLowerCase())
    ) {
      const escapedClient = clientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pathAfter = rawUrl.match(new RegExp(escapedClient + "[^/]*" + pathSegmentPattern, "i"));
      resolved.resolvedService = svcName;
      resolved.resolvedPath = pathAfter
        ? normalizeTemplatePath(pathAfter[1].split("?")[0])
        : undefined;
      resolved.confidence = 0.55;
      return resolved;
    }
  }

  // ── Strategy 5: Relative path — check if any other service has this endpoint ──
  if (rawUrl.startsWith("/")) {
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
    p
      .replace(/:[^/]+/g, "{x}")
      .replace(/\{[^}]+\}/g, "{x}")
      .replace(/\/+$/, "");

  return normalize(endpointPath) === normalize(requestPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Find target endpoint given resolved service + path
// ─────────────────────────────────────────────────────────────────────────────

export function findTargetEndpoint(
  targetService: string,
  targetPath: string | undefined,
  targetMethod: string,
  registry: ServiceRegistry,
): SourceEndpoint | undefined {
  const svc = registry.byName.get(targetService);
  if (!svc || !targetPath) return undefined;

  // Match by method + path
  return (
    svc.endpoints.find(
      (ep) =>
        ep.method === targetMethod &&
        (pathMatches(ep.path, targetPath) || pathMatches(ep.fullPath, targetPath)),
    ) ??
    svc.endpoints.find(
      (ep) => pathMatches(ep.path, targetPath) || pathMatches(ep.fullPath, targetPath),
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Call Chain Walker
// Builds the full tree: MS1-API1 → MS2-API3 → MS4-API6 → [leaf]
// ─────────────────────────────────────────────────────────────────────────────

export function buildAllCallChains(
  scanResults: CodeScanResult[],
  registry: ServiceRegistry,
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
  depth: number,
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
      registry,
    );

    // Add edge — keep highest-confidence edge for each from→toService pair
    const existingEdgeIdx = edges.findIndex(
      (e) =>
        e.from === `${serviceName}:${endpointLabel}` &&
        e.toService === resolvedCall.resolvedService,
    );

    const newEdge: CallChainEdge = {
      from: `${serviceName}:${endpointLabel}`,
      to: targetEndpoint
        ? `${resolvedCall.resolvedService}:${targetEndpoint.method} ${targetEndpoint.fullPath}`
        : `${resolvedCall.resolvedService}:${call.method} ${resolvedCall.resolvedPath ?? call.rawUrl}`,
      fromService: serviceName,
      toService: resolvedCall.resolvedService,
      rawUrl: call.rawUrl,
      confidence: resolvedCall.confidence,
      ...(call.conditional && { conditional: true }),
      ...(call.conditionHint && { conditionHint: call.conditionHint }),
    };

    if (existingEdgeIdx === -1) {
      edges.push(newEdge);
    } else if ((resolvedCall.confidence ?? 0) > (edges[existingEdgeIdx].confidence ?? 0)) {
      // Replace with higher-confidence edge
      edges[existingEdgeIdx] = newEdge;
    }

    if (targetEndpoint) {
      // Recurse — walk the target endpoint's chain
      const childNode = walkChain(
        targetEndpoint,
        resolvedCall.resolvedService,
        registry,
        new Set(visited), // copy visited set so sibling calls don't block each other
        edges,
        depth + 1,
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
