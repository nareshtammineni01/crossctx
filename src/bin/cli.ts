import { Command } from "commander";
import path from "path";
import { readdir, readFile } from "fs/promises";
import { watch } from "fs";
import type { FSWatcher } from "fs";

// Legacy OpenAPI pipeline
import { scanForSpecs } from "../scanner/index.js";
import { parseSpec } from "../parser/index.js";
import { analyzeDependencies } from "../analyzer/index.js";
import { buildOutput, saveOutput, printSummary } from "../renderer/index.js";
import { saveMarkdown } from "../renderer/markdown.js";
import { saveGraph } from "../renderer/graph.js";

// New source-code pipeline
import { detectLanguage, deriveServiceName } from "../detector/index.js";
import { parseTypeScriptProject } from "../parsers/typescript.js";
import { parseJavaProject } from "../parsers/java.js";
import { parseCSharpProject } from "../parsers/csharp.js";
import { parsePythonProject } from "../parsers/python.js";
import { parseGoProject } from "../parsers/go.js";
import { buildServiceRegistry, buildAllCallChains } from "../resolver/index.js";

// Diff / Breaking change detection
import { diffOutputs } from "../differ/index.js";

import type { ParsedSpec, CodeScanResult, CrossCtxOutput } from "../types/index.js";

const program = new Command();

// Extract core scan pipeline into a reusable function
async function runScan(
  resolvedPaths: string[],
  options: {
    output: string;
    markdown?: boolean | string;
    graph?: boolean | string;
    quiet: boolean;
    openapiOnly: boolean;
    watch?: boolean;
  },
): Promise<CrossCtxOutput> {
  try {
    // ── Phase 1: Source code scanning ──────────────────────────────────────
    const codeScanResults: CodeScanResult[] = [];

    if (!options.openapiOnly) {
      if (!options.quiet && !options.watch)
        console.log("  [1/4] Detecting languages and scanning source code...");
      if (!options.quiet && options.watch)
        console.log("  [scan] Detecting languages and scanning source code...");

      for (const projectPath of resolvedPaths) {
        // Make sure path exists and is a directory
        try {
          const entries = await readdir(projectPath);
          void entries; // just checking it exists
        } catch {
          if (!options.quiet)
            console.log(`  ⚠️  Skipping ${projectPath} (not found or not a directory)`);
          continue;
        }

        const lang = await detectLanguage(projectPath);

        if (!options.quiet) {
          console.log(
            `  → ${path.basename(projectPath)} (${lang.language}/${lang.framework}, confidence: ${Math.round(lang.confidence * 100)}%)`,
          );
        }

        try {
          let scanResult: CodeScanResult | null = null;

          if (lang.language === "typescript") {
            // Read package.json for service name
            let pkg: Record<string, unknown> | undefined;
            try {
              pkg = JSON.parse(
                await readFile(path.join(projectPath, "package.json"), "utf-8"),
              ) as Record<string, unknown>;
            } catch {
              /* no package.json */
            }

            const serviceName = deriveServiceName(projectPath, pkg);
            scanResult = await parseTypeScriptProject(projectPath, lang, serviceName);
          } else if (lang.language === "java") {
            const serviceName = deriveServiceName(projectPath);
            scanResult = await parseJavaProject(projectPath, lang, serviceName);
          } else if (lang.language === "csharp") {
            const serviceName = deriveServiceName(projectPath);
            scanResult = await parseCSharpProject(projectPath, lang, serviceName);
          } else if (lang.language === "python") {
            const serviceName = deriveServiceName(projectPath);
            scanResult = await parsePythonProject(projectPath, lang, serviceName);
          } else if (lang.language === "go") {
            const serviceName = deriveServiceName(projectPath);
            scanResult = await parseGoProject(projectPath, lang, serviceName);
          } else {
            // Unknown language — service name only placeholder
            const serviceName = deriveServiceName(projectPath);
            if (!options.quiet) {
              console.log(
                `  ⚠️  ${lang.language}/${lang.framework} — no parser available, using service name only`,
              );
            }
            scanResult = {
              projectPath,
              language: lang,
              serviceName,
              endpoints: [],
              dtos: [],
              serviceUrlHints: [],
              hasOpenApiSpec: false,
            };
          }

          if (scanResult) codeScanResults.push(scanResult);
        } catch (err) {
          if (!options.quiet) {
            console.log(
              `  ⚠️  Failed to scan ${projectPath}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      if (!options.quiet) {
        const totalEndpoints = codeScanResults.reduce((sum, r) => sum + r.endpoints.length, 0);
        console.log(
          `  Found ${codeScanResults.length} service(s), ${totalEndpoints} endpoint(s)\n`,
        );
      }
    }

    // ── Phase 2: OpenAPI scanning (always runs, enriches code scan) ────────
    if (!options.quiet && !options.watch)
      console.log("  [2/4] Scanning for OpenAPI/Swagger specs...");
    if (!options.quiet && options.watch)
      console.log("  [scan] Scanning for OpenAPI/Swagger specs...");

    const scanResults = await scanForSpecs(resolvedPaths);
    const parsedSpecs: ParsedSpec[] = [];
    const parseErrors: { file: string; error: string }[] = [];

    for (const scan of scanResults) {
      try {
        const parsed = await parseSpec(scan.filePath);
        parsedSpecs.push(parsed);
      } catch (err) {
        parseErrors.push({
          file: scan.filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!options.quiet) {
      console.log(`  Found ${scanResults.length} OpenAPI spec(s)\n`);
      if (parseErrors.length > 0) {
        console.log(`  Warnings (${parseErrors.length} files could not be parsed):`);
        for (const e of parseErrors) console.log(`    - ${e.file}: ${e.error}`);
        console.log();
      }
    }

    // ── Phase 3: Build call chains ─────────────────────────────────────────
    if (!options.quiet && !options.watch) console.log("  [3/4] Resolving call chains...");
    if (!options.quiet && options.watch) console.log("  [scan] Resolving call chains...");

    const registry = buildServiceRegistry(codeScanResults);
    const callChains = buildAllCallChains(codeScanResults, registry);

    if (!options.quiet) {
      console.log(`  Found ${callChains.length} call chain(s)\n`);
    }

    // ── Phase 4: Build output ──────────────────────────────────────────────
    if (!options.quiet && !options.watch) console.log("  [4/4] Building output...");
    if (!options.quiet && options.watch) console.log("  [scan] Building output...");

    const legacyDependencies = analyzeDependencies(parsedSpecs);
    const output = buildOutput(
      parsedSpecs,
      legacyDependencies,
      resolvedPaths.map((p) => path.relative(process.cwd(), p)),
      scanResults.length,
    );

    // Attach new data
    output.codeScanResults = codeScanResults;
    output.callChains = callChains;

    // JSON output
    const outputPath = path.resolve(options.output);
    await saveOutput(output, outputPath);

    // Markdown output
    if (options.markdown !== undefined) {
      const mdPath =
        typeof options.markdown === "string"
          ? path.resolve(options.markdown)
          : path.resolve("crossctx-output.md");
      await saveMarkdown(output, mdPath);
      if (!options.quiet) console.log(`  Markdown saved to: ${mdPath}`);
    }

    // Graph output
    if (options.graph !== undefined) {
      const graphPath =
        typeof options.graph === "string"
          ? path.resolve(options.graph)
          : path.resolve("crossctx-graph.html");
      await saveGraph(output, graphPath);
      if (!options.quiet) console.log(`  Graph saved to: ${graphPath}`);
    }

    // Summary
    if (!options.quiet) {
      console.log(printSummary(output));
      console.log(`  JSON output: ${outputPath}\n`);
    }

    return output;
  } catch (err) {
    console.error("\n  Error:", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

program
  .name("crossctx")
  .description("Generate cross-service API dependency maps from source code + OpenAPI specs")
  .version("0.2.0")
  .argument("<paths...>", "project directories to scan (one per microservice)")
  .option("-o, --output <file>", "output JSON file path", "crossctx-output.json")
  .option("-m, --markdown [file]", "generate Markdown output")
  .option(
    "-g, --graph [file]",
    "generate interactive HTML dependency graph (default: crossctx-graph.html)",
  )
  .option("-q, --quiet", "suppress terminal output", false)
  .option("--openapi-only", "only scan OpenAPI/Swagger spec files (legacy mode)", false)
  .option("-w, --watch", "watch for file changes and rebuild", false)
  .option(
    "-d, --diff <baseline>",
    "compare against a baseline JSON file and report breaking changes",
  )
  .action(
    async (
      paths: string[],
      options: {
        output: string;
        markdown?: boolean | string;
        graph?: boolean | string;
        quiet: boolean;
        openapiOnly: boolean;
        watch: boolean;
        diff?: string;
      },
    ) => {
      try {
        const resolvedPaths = paths.map((p) => path.resolve(p));

        if (!options.quiet) console.log("\n  CrossCtx v0.2.0\n");

        // Run initial scan
        const currentOutput = await runScan(resolvedPaths, { ...options, watch: false });

        // Handle diff if baseline provided
        if (options.diff) {
          try {
            const baselineContent = await readFile(path.resolve(options.diff), "utf-8");
            const baselineOutput = JSON.parse(baselineContent) as CrossCtxOutput;

            const report = diffOutputs(baselineOutput, currentOutput);
            console.log(JSON.stringify(report, null, 2));

            if (report.summary.totalBreaking > 0) {
              console.error(`\n  ⚠️  ${report.summary.totalBreaking} breaking change(s) detected`);
              process.exit(1);
            }
          } catch (err) {
            console.error(
              `\n  Error reading or parsing baseline file: ${err instanceof Error ? err.message : String(err)}`,
            );
            process.exit(1);
          }
        }

        if (options.watch) {
          // Debounce timer
          let debounceTimer: NodeJS.Timeout | null = null;
          const debounceMs = 500;
          const watchers: FSWatcher[] = [];

          // Collect all source file extensions
          const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".java", ".cs", ".py", ".go"];

          // Start watching each resolved path recursively
          for (const dirPath of resolvedPaths) {
            try {
              const watcher = watch(
                dirPath,
                { recursive: true, persistent: true },
                (eventType, filename) => {
                  // Only trigger on relevant file extensions
                  if (filename && sourceExtensions.some((ext) => filename.endsWith(ext))) {
                    if (debounceTimer) {
                      clearTimeout(debounceTimer);
                    }

                    debounceTimer = setTimeout(async () => {
                      if (!options.quiet) {
                        console.log(`\n  [watch] Change detected in ${filename}, rescanning...\n`);
                      }

                      try {
                        await runScan(resolvedPaths, { ...options, watch: true });
                      } catch (err) {
                        if (!options.quiet) {
                          console.error(
                            `  [watch] Error during rescan: ${err instanceof Error ? err.message : String(err)}`,
                          );
                        }
                      }
                    }, debounceMs);
                  }
                },
              );

              watchers.push(watcher);
            } catch (err) {
              if (!options.quiet) {
                console.error(
                  `  [watch] Failed to watch ${dirPath}: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }
          }

          if (!options.quiet) {
            console.log(`  [watch] Ready. Watching ${resolvedPaths.length} path(s)...\n`);
          }

          // Keep process alive
          process.on("SIGINT", () => {
            if (!options.quiet) {
              console.log("\n  [watch] Stopping...\n");
            }
            watchers.forEach((w) => w.close());
            process.exit(0);
          });
        }
      } catch (err) {
        console.error("\n  Error:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    },
  );

program.parse();
