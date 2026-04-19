/**
 * CrossCtx config file support
 *
 * Looks for `.crossctxrc.json` or `crossctx.config.json` in the current working directory.
 * Config values are used as defaults — CLI flags always take precedence.
 */

import { readFile } from "fs/promises";
import path from "path";

export interface CrossCtxConfig {
  /** Project paths to scan */
  paths?: string[];
  /** Output JSON file path */
  output?: string;
  /** Format(s) to generate: json, markdown, graph, all */
  format?: string | string[];
  /** Markdown output path (legacy) */
  markdown?: string | boolean;
  /** Graph output path (legacy) */
  graph?: string | boolean;
  /** Suppress terminal output */
  quiet?: boolean;
  /** Only scan OpenAPI/Swagger spec files */
  openapiOnly?: boolean;
  /** Filter edges below this confidence threshold (0–1) */
  minConfidence?: number;
}

const CONFIG_FILE_NAMES = [".crossctxrc.json", "crossctx.config.json"];

/**
 * Load config from the nearest config file in cwd.
 * Returns an empty object if no config file is found.
 */
export async function loadConfig(cwd = process.cwd()): Promise<CrossCtxConfig> {
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = path.join(cwd, fileName);
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as CrossCtxConfig;
      return parsed;
    } catch {
      // Not found or parse error — try next
    }
  }
  return {};
}

/**
 * Merge config file values with CLI option values.
 * CLI options win over config file when explicitly set.
 */
export function mergeConfig<T extends Record<string, unknown>>(
  configFileValues: CrossCtxConfig,
  cliOptions: T,
): T {
  const merged: Record<string, unknown> = { ...cliOptions };

  for (const [key, value] of Object.entries(configFileValues)) {
    // Only apply config value if the CLI option is still at its "unset" state
    // Commander uses undefined for unset optional values
    if (merged[key] === undefined) {
      merged[key] = value;
    }
  }

  return merged as T;
}

/**
 * The default config scaffold written by `crossctx init`.
 */
export const DEFAULT_CONFIG: CrossCtxConfig = {
  paths: ["./service-a", "./service-b"],
  output: "crossctx-output.json",
  format: "json",
  quiet: false,
  minConfidence: 0,
};

export const DEFAULT_CONFIG_JSON = JSON.stringify(
  {
    $schema:
      "https://raw.githubusercontent.com/nareshtammineni01/crossctx/main/schema/crossctxrc.schema.json",
    ...DEFAULT_CONFIG,
  },
  null,
  2,
);
