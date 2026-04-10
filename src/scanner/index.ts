import fg from "fast-glob";
import path from "path";
import type { ScanResult } from "../types/index.js";

/** Supported OpenAPI file patterns */
const OPENAPI_PATTERNS = [
  "**/openapi.{json,yaml,yml}",
  "**/swagger.{json,yaml,yml}",
  "**/*.openapi.{json,yaml,yml}",
  "**/*.swagger.{json,yaml,yml}",
  "**/openapi/**/*.{json,yaml,yml}",
  "**/swagger/**/*.{json,yaml,yml}",
  "**/api-spec.{json,yaml,yml}",
  "**/api-docs.{json,yaml,yml}",
];

/** Directories to always skip */
const IGNORE_PATTERNS = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"];

/**
 * Scan directories for OpenAPI/Swagger spec files
 */
export async function scanForSpecs(scanPaths: string[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  for (const scanPath of scanPaths) {
    const absolutePath = path.resolve(scanPath);

    const files = await fg(OPENAPI_PATTERNS, {
      cwd: absolutePath,
      ignore: IGNORE_PATTERNS,
      absolute: true,
      onlyFiles: true,
      dot: false,
    });

    for (const filePath of files) {
      results.push({
        filePath,
        relativePath: path.relative(absolutePath, filePath),
      });
    }
  }

  return results;
}
