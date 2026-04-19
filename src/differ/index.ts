import type { CrossCtxOutput, DiffReport, EndpointDiff } from "../types/index.js";

type EndpointChanges = NonNullable<EndpointDiff["changes"]>;

/**
 * Compare two CrossCtx outputs and generate a diff report.
 * Detects breaking changes (removed endpoints, removed fields) and non-breaking changes (added endpoints).
 */
export function diffOutputs(baseline: CrossCtxOutput, current: CrossCtxOutput): DiffReport {
  const baselineMap = buildEndpointMap(baseline);
  const currentMap = buildEndpointMap(current);

  const breaking: EndpointDiff[] = [];
  const nonBreaking: EndpointDiff[] = [];

  // Check for removed or changed endpoints
  for (const [key, baselineEndpoint] of baselineMap.entries()) {
    const currentEndpoint = currentMap.get(key);

    if (!currentEndpoint) {
      // Endpoint was removed - BREAKING
      breaking.push({
        type: "removed",
        service: baselineEndpoint.service,
        method: baselineEndpoint.method,
        path: baselineEndpoint.path,
      });
    } else {
      // Check for changes
      const changes = detectEndpointChanges(baselineEndpoint, currentEndpoint);
      if (changes) {
        const diff: EndpointDiff = {
          type: "changed",
          service: baselineEndpoint.service,
          method: baselineEndpoint.method,
          path: baselineEndpoint.path,
          changes,
        };

        // Determine if breaking or non-breaking
        if (changes.removedFields && changes.removedFields.length > 0) {
          breaking.push(diff);
        } else if (
          changes.requestBody?.before !== changes.requestBody?.after ||
          changes.response?.before !== changes.response?.after
        ) {
          breaking.push(diff);
        } else {
          nonBreaking.push(diff);
        }
      }
    }
  }

  // Check for added endpoints
  for (const [key, currentEndpoint] of currentMap.entries()) {
    if (!baselineMap.has(key)) {
      // Endpoint was added - NON-BREAKING
      nonBreaking.push({
        type: "added",
        service: currentEndpoint.service,
        method: currentEndpoint.method,
        path: currentEndpoint.path,
      });
    }
  }

  return {
    baseline: baseline.meta.scanPaths.join(", "),
    scannedAt: new Date().toISOString(),
    breaking,
    nonBreaking,
    summary: {
      totalBreaking: breaking.length,
      totalNonBreaking: nonBreaking.length,
      removedEndpoints: breaking.filter((d) => d.type === "removed").length,
      addedEndpoints: nonBreaking.filter((d) => d.type === "added").length,
      changedEndpoints:
        breaking.filter((d) => d.type === "changed").length +
        nonBreaking.filter((d) => d.type === "changed").length,
    },
  };
}

/**
 * Build a map of "service:METHOD /path" -> Endpoint for quick lookup
 */
function buildEndpointMap(output: CrossCtxOutput): Map<string, (typeof output.endpoints)[0]> {
  const map = new Map<string, (typeof output.endpoints)[0]>();

  for (const endpoint of output.endpoints) {
    const key = `${endpoint.service}:${endpoint.method} ${endpoint.path}`;
    map.set(key, endpoint);
  }

  return map;
}

/**
 * Detect what changed between baseline and current endpoints.
 * Returns null if no changes detected.
 */
function detectEndpointChanges(
  baseline: (typeof buildEndpointMap.prototype.get)[0],
  current: (typeof buildEndpointMap.prototype.get)[0],
): EndpointChanges | null {
  const changes: EndpointChanges = {};

  // Compare request body
  const baselineReqType = baseline.requestBody?.type ?? "undefined";
  const currentReqType = current.requestBody?.type ?? "undefined";

  if (baselineReqType !== currentReqType) {
    changes.requestBody = {
      before: baselineReqType,
      after: currentReqType,
    };
  }

  // Compare request body fields
  if (baseline.requestBody?.properties && current.requestBody?.properties) {
    const baselineFields = new Set(Object.keys(baseline.requestBody.properties));
    const currentFields = new Set(Object.keys(current.requestBody.properties));

    const removedFields = Array.from(baselineFields).filter((f) => !currentFields.has(f));
    const addedFields = Array.from(currentFields).filter((f) => !baselineFields.has(f));

    if (removedFields.length > 0 || addedFields.length > 0) {
      changes.removedFields = removedFields;
      changes.addedFields = addedFields;
    }
  }

  // Compare response type
  const baselineRespType = baseline.response?.type ?? "undefined";
  const currentRespType = current.response?.type ?? "undefined";

  if (baselineRespType !== currentRespType) {
    changes.response = {
      before: baselineRespType,
      after: currentRespType,
    };
  }

  // Compare response fields
  if (baseline.response?.properties && current.response?.properties) {
    const baselineFields = new Set(Object.keys(baseline.response.properties));
    const currentFields = new Set(Object.keys(current.response.properties));

    const removedFields = Array.from(baselineFields).filter((f) => !currentFields.has(f));

    if (removedFields.length > 0) {
      if (!changes.removedFields) changes.removedFields = [];
      changes.removedFields.push(...removedFields);
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}
