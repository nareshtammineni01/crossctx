/**
 * Monorepo Service Root Discoverer
 *
 * Given a root directory, auto-discovers service sub-directories by looking for
 * language marker files up to a configurable depth (default: 3 levels).
 *
 * Language markers used:
 *   TypeScript/JS  →  package.json   (must contain "main", "scripts", or no "private": true)
 *   Go             →  go.mod
 *   Python         →  requirements.txt | pyproject.toml | Pipfile | setup.py | setup.cfg
 *   Java           →  pom.xml | build.gradle | build.gradle.kts
 *   C#             →  *.csproj | *.sln
 *
 * Excludes: node_modules, vendor, dist, build, .git, __pycache__, .venv, venv
 */

import { readdir, stat, readFile } from "fs/promises";
import path from "path";

export interface DiscoveredService {
  /** Absolute path to the service root directory */
  path: string;
  /** Inferred service name from directory name */
  name: string;
  /** Which marker file triggered detection */
  markerFile: string;
  /** Language detected from marker */
  language: "typescript" | "go" | "python" | "java" | "csharp" | "unknown";
}

const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".env",
  "target",
  "bin",
  "obj",
  ".gradle",
  "coverage",
  ".nyc_output",
  ".next",
  ".nuxt",
  "out",
]);

const LANGUAGE_MARKERS: Array<{
  filename: string | RegExp;
  language: DiscoveredService["language"];
}> = [
  { filename: "go.mod", language: "go" },
  { filename: "pom.xml", language: "java" },
  { filename: "build.gradle", language: "java" },
  { filename: "build.gradle.kts", language: "java" },
  { filename: /^.+\.csproj$/, language: "csharp" },
  { filename: /^.+\.sln$/, language: "csharp" },
  { filename: "pyproject.toml", language: "python" },
  { filename: "requirements.txt", language: "python" },
  { filename: "Pipfile", language: "python" },
  { filename: "setup.py", language: "python" },
  { filename: "setup.cfg", language: "python" },
  { filename: "package.json", language: "typescript" },
];

/**
 * Recursively discover service roots under `rootPath` up to `maxDepth` levels deep.
 *
 * @param rootPath  - The monorepo root directory
 * @param maxDepth  - How many directory levels to search (default: 3)
 * @returns Array of discovered services, sorted by path
 */
export async function discoverServiceRoots(
  rootPath: string,
  maxDepth = 3,
): Promise<DiscoveredService[]> {
  const discovered: DiscoveredService[] = [];
  const seenPaths = new Set<string>();

  await walkDir(path.resolve(rootPath), 0, maxDepth, discovered, seenPaths);

  // Sort by path depth (shallower first), then alphabetically
  return discovered.sort((a, b) => {
    const depthA = a.path.split(path.sep).length;
    const depthB = b.path.split(path.sep).length;
    if (depthA !== depthB) return depthA - depthB;
    return a.path.localeCompare(b.path);
  });
}

async function walkDir(
  dirPath: string,
  depth: number,
  maxDepth: number,
  discovered: DiscoveredService[],
  seenPaths: Set<string>,
): Promise<void> {
  if (depth > maxDepth) return;

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return;
  }

  // Check if this directory itself has a marker file
  for (const marker of LANGUAGE_MARKERS) {
    const matchingEntry = entries.find((e) => {
      if (typeof marker.filename === "string") return e === marker.filename;
      return marker.filename.test(e);
    });

    if (matchingEntry) {
      const markerPath = path.join(dirPath, matchingEntry);

      // For package.json: skip root monorepo package.json if it has "workspaces"
      if (matchingEntry === "package.json") {
        const isMonorepoRoot = await isWorkspaceRoot(markerPath);
        if (isMonorepoRoot && depth === 0) {
          // Don't register the monorepo root itself — keep searching
          break;
        }
      }

      if (!seenPaths.has(dirPath)) {
        seenPaths.add(dirPath);
        discovered.push({
          path: dirPath,
          name: path.basename(dirPath),
          markerFile: matchingEntry,
          language: marker.language,
        });
      }

      // Don't recurse into a directory that IS a service (avoids nested package.json confusion)
      return;
    }
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;

    const entryPath = path.join(dirPath, entry);
    try {
      const s = await stat(entryPath);
      if (s.isDirectory()) {
        await walkDir(entryPath, depth + 1, maxDepth, discovered, seenPaths);
      }
    } catch {
      /* skip */
    }
  }
}

async function isWorkspaceRoot(packageJsonPath: string): Promise<boolean> {
  try {
    const content = await readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as Record<string, unknown>;
    return "workspaces" in pkg;
  } catch {
    return false;
  }
}

/**
 * Filter discovered services to avoid duplicates when a parent dir and a child dir
 * both appear as service roots (e.g. the user scanned both /services and /services/orders).
 */
export function deduplicateServiceRoots(services: DiscoveredService[]): DiscoveredService[] {
  const paths = services.map((s) => s.path);
  return services.filter((s) => {
    // Keep if no other discovered path is a parent of this one
    return !paths.some((p) => p !== s.path && s.path.startsWith(p + path.sep));
  });
}
