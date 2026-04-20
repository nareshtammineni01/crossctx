/**
 * CrossCtx Plugin / Analyzer Interface
 *
 * Community contributors can implement a LanguageParserPlugin to add support
 * for new languages or frameworks without forking crossctx.
 *
 * ## Quick start
 *
 * ```ts
 * import type { LanguageParserPlugin } from "crossctx/plugins";
 *
 * const rubyPlugin: LanguageParserPlugin = {
 *   name: "ruby-rails",
 *   version: "1.0.0",
 *   language: "ruby",
 *   frameworks: ["rails", "sinatra"],
 *
 *   canHandle(projectPath, files) {
 *     return files.some(f => f.endsWith("Gemfile"));
 *   },
 *
 *   detect(projectPath, files) {
 *     return { language: "ruby", framework: "rails", confidence: 0.9,
 *              detectedFrom: "Gemfile" };
 *   },
 *
 *   async parse(projectPath, detectedLanguage, serviceName) {
 *     // ... return CodeScanResult
 *   },
 * };
 *
 * export default rubyPlugin;
 * ```
 *
 * ## Loading plugins
 *
 * Register via .crossctxrc.json:
 * ```json
 * { "plugins": ["crossctx-plugin-ruby", "./local-plugin.js"] }
 * ```
 */

import type { CodeScanResult, DetectedLanguage } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Core plugin interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A language parser plugin that extends crossctx with support for additional
 * languages or frameworks.
 */
export interface LanguageParserPlugin {
  /** Unique plugin name, e.g. "crossctx-plugin-ruby" */
  name: string;
  /** Semver string, e.g. "1.0.0" */
  version: string;
  /** Language identifier used in output, e.g. "ruby" */
  language: string;
  /** Framework identifiers this plugin handles, e.g. ["rails", "sinatra"] */
  frameworks: string[];

  /**
   * Quick check: return true if this plugin can handle the given project.
   * Called with the project path and a flat list of file names (relative).
   * Keep this fast — it runs before the full parse.
   */
  canHandle(projectPath: string, files: string[]): boolean;

  /**
   * Detect the language/framework with confidence scoring.
   * Only called when canHandle() returns true.
   */
  detect(projectPath: string, files: string[]): DetectedLanguage;

  /**
   * Full parse of the project. Return a complete CodeScanResult.
   */
  parse(
    projectPath: string,
    detectedLanguage: DetectedLanguage,
    serviceName: string,
  ): Promise<CodeScanResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin registry
// ─────────────────────────────────────────────────────────────────────────────

const _registry: Map<string, LanguageParserPlugin> = new Map();

/**
 * Register a language parser plugin. If a plugin with the same name is already
 * registered, it will be replaced (last-write-wins).
 */
export function registerPlugin(plugin: LanguageParserPlugin): void {
  _registry.set(plugin.name, plugin);
}

/**
 * Return all currently registered plugins.
 */
export function getPlugins(): LanguageParserPlugin[] {
  return Array.from(_registry.values());
}

/**
 * Find the first plugin that reports it can handle the given project.
 * Returns undefined if no plugin matches.
 */
export function findPlugin(projectPath: string, files: string[]): LanguageParserPlugin | undefined {
  for (const plugin of _registry.values()) {
    try {
      if (plugin.canHandle(projectPath, files)) return plugin;
    } catch {
      // plugin threw — treat as "cannot handle"
    }
  }
  return undefined;
}

/**
 * Load plugins from an array of specifiers (npm package names or file paths).
 * Dynamically imports each specifier and calls registerPlugin() on the default export.
 *
 * Errors are caught and surfaced as warnings — a broken plugin should never
 * prevent crossctx from running.
 */
export async function loadPlugins(
  specifiers: string[],
  warn: (msg: string) => void = console.warn,
): Promise<void> {
  for (const specifier of specifiers) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = await import(specifier);
      // Support both `export default plugin` and `module.exports = plugin`
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const plugin = (mod.default ?? mod) as LanguageParserPlugin;

      if (typeof plugin?.canHandle !== "function" || typeof plugin?.parse !== "function") {
        warn(
          `crossctx: plugin "${specifier}" does not export a valid LanguageParserPlugin — skipping`,
        );
        continue;
      }

      registerPlugin(plugin);
    } catch (err) {
      warn(
        `crossctx: failed to load plugin "${specifier}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
