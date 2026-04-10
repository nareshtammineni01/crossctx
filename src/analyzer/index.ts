import type { Dependency, ParsedSpec } from "../types/index.js";

/**
 * Analyze parsed specs to detect inter-service dependencies.
 *
 * Strategy:
 * 1. Build a hostname → service map from all specs' server URLs
 * 2. For each service, check if its referenced URLs match another service's hostname
 * 3. Also check server URL cross-references
 */
export function analyzeDependencies(parsedSpecs: ParsedSpec[]): Dependency[] {
  const dependencies: Dependency[] = [];
  const seen = new Set<string>();

  // Build hostname → service name map
  const hostnameToService = buildHostnameMap(parsedSpecs);

  for (const spec of parsedSpecs) {
    const serviceName = spec.service.name;

    // Check referenced URLs against known service hostnames
    for (const url of spec.referencedUrls) {
      const hostname = extractHostname(url);
      if (!hostname) continue;

      const targetService = hostnameToService.get(hostname);
      if (targetService && targetService !== serviceName) {
        const key = `${serviceName}->${targetService}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push({
            from: serviceName,
            to: targetService,
            detectedVia: "description",
            evidence: `Referenced URL: ${url}`,
          });
        }
      }
    }

    // Check if server URLs reference other services
    for (const serverUrl of spec.serverUrls) {
      const hostname = extractHostname(serverUrl);
      if (!hostname) continue;

      // Look for other services whose names appear in this hostname
      for (const otherSpec of parsedSpecs) {
        if (otherSpec.service.name === serviceName) continue;

        const otherName = otherSpec.service.name.toLowerCase();
        if (hostname.toLowerCase().includes(otherName)) {
          const key = `${serviceName}->${otherSpec.service.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            dependencies.push({
              from: serviceName,
              to: otherSpec.service.name,
              detectedVia: "server-url",
              evidence: `Server URL contains service name: ${serverUrl}`,
            });
          }
        }
      }
    }
  }

  return dependencies;
}

/** Build a map of hostname → service name from all specs */
function buildHostnameMap(parsedSpecs: ParsedSpec[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const spec of parsedSpecs) {
    for (const url of spec.serverUrls) {
      const hostname = extractHostname(url);
      if (hostname) {
        map.set(hostname, spec.service.name);
      }
    }
  }

  return map;
}

/** Extract hostname from a URL string */
function extractHostname(url: string): string | null {
  try {
    // Handle relative URLs and template variables
    if (url.startsWith("/") || url.startsWith("{")) return null;

    // Replace template variables for URL parsing
    const cleanUrl = url.replace(/\{[^}]+\}/g, "placeholder");
    const parsed = new URL(cleanUrl);
    return parsed.hostname;
  } catch {
    return null;
  }
}
