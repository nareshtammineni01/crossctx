import { Command } from "commander";
import path from "path";
import { readdir, readFile, writeFile, access } from "fs/promises";
import { watch } from "fs";
import type { FSWatcher } from "fs";

// Legacy OpenAPI pipeline
import { scanForSpecs } from "../scanner/index.js";
import { parseSpec } from "../parser/index.js";
import { analyzeDependencies } from "../analyzer/index.js";
import { buildOutput, saveOutput } from "../renderer/index.js";
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

// v0.3: DB usage, shared libraries, monorepo discovery
import { extractDbUsage, type DbLanguage } from "../parsers/db.js";
import { detectSharedLibrariesFromContents } from "../parsers/shared-libs.js";
import { discoverServiceRoots, deduplicateServiceRoots } from "../scanner/monorepo.js";
import { scanGraphQLSchemas, graphqlOperationsToEndpoints } from "../parsers/graphql.js";
import { readFile as readFileAsync } from "fs/promises";
import fg from "fast-glob";

// Diff / Breaking change detection
import { diffOutputs } from "../differ/index.js";

// Config file support
import { loadConfig, mergeConfig, DEFAULT_CONFIG_JSON } from "../config.js";

// Plugin interface
import { loadPlugins, findPlugin } from "../plugins/interface.js";

// v2.0: Architecture insights
import { computeInsights, formatInsights } from "../analyzer/insights.js";

import type { ParsedSpec, CodeScanResult, CrossCtxOutput } from "../types/index.js";

const VERSION = "2.1.2";

const program = new Command();

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function fileExistsCheck(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SCAN PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

async function runScan(
  resolvedPaths: string[],
  options: {
    output: string;
    markdown?: boolean | string;
    graph?: boolean | string;
    quiet: boolean;
    openapiOnly: boolean;
    watch?: boolean;
    minConfidence?: number;
    monorepo?: boolean;
  },
): Promise<CrossCtxOutput> {
  try {
    const codeScanResults: CodeScanResult[] = [];
    const serviceContents = new Map<
      string,
      { serviceName: string; language: string; files: Map<string, string> }
    >();

    if (!options.openapiOnly) {
      if (!options.quiet && !options.watch)
        console.log("  [1/4] Detecting languages and scanning source code...");
      if (!options.quiet && options.watch)
        console.log("  [scan] Detecting languages and scanning source code...");

      let effectivePaths = resolvedPaths;
      if (options.monorepo) {
        effectivePaths = [];
        for (const rootPath of resolvedPaths) {
          if (!options.quiet)
            console.log(`  → Discovering service roots under ${path.basename(rootPath)}...`);
          const discovered = deduplicateServiceRoots(await discoverServiceRoots(rootPath));
          if (!options.quiet) console.log(`    Found ${discovered.length} service(s)`);
          effectivePaths.push(...discovered.map((d) => d.path));
        }
        if (effectivePaths.length === 0) {
          if (!options.quiet) console.log("  ⚠️  No service roots discovered. Check your paths.\n");
          effectivePaths = resolvedPaths;
        }
      }

      for (const projectPath of effectivePaths) {
        try {
          const entries = await readdir(projectPath);
          void entries;
        } catch {
          if (!options.quiet) {
            console.log(`  ⚠️  Skipping: ${projectPath}`);
            console.log(`     Path does not exist or is not a directory.`);
            console.log(`     Check the spelling or update your .crossctxrc.json config.\n`);
          }
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

            // Fallback: if TS scan found 0 endpoints, the project root may be a
            // polyglot repo (e.g. Next.js frontend + Java/Python backend at root).
            // Try other language detectors and use whichever yields more endpoints.
            if (scanResult.endpoints.length === 0) {
              const hasPom = await fileExistsCheck(path.join(projectPath, "pom.xml"));
              const hasGradle =
                (await fileExistsCheck(path.join(projectPath, "build.gradle"))) ||
                (await fileExistsCheck(path.join(projectPath, "build.gradle.kts")));
              const hasGoMod = await fileExistsCheck(path.join(projectPath, "go.mod"));
              const hasPyReq =
                (await fileExistsCheck(path.join(projectPath, "requirements.txt"))) ||
                (await fileExistsCheck(path.join(projectPath, "pyproject.toml")));

              if (hasPom || hasGradle) {
                const javaLang = {
                  language: "java" as const,
                  framework: "spring-boot" as const,
                  detectedFrom: hasPom
                    ? path.join(projectPath, "pom.xml")
                    : path.join(projectPath, "build.gradle"),
                  confidence: 0.9,
                };
                const javaResult = await parseJavaProject(projectPath, javaLang, serviceName);
                if (javaResult.endpoints.length > scanResult.endpoints.length) {
                  if (!options.quiet)
                    console.log(
                      `  ↳ TypeScript scan found 0 endpoints — switched to Java parser (found ${javaResult.endpoints.length})`,
                    );
                  scanResult = javaResult;
                }
              } else if (hasGoMod) {
                const goLang = {
                  language: "go" as const,
                  framework: "unknown" as const,
                  detectedFrom: path.join(projectPath, "go.mod"),
                  confidence: 0.9,
                };
                const goResult = await parseGoProject(projectPath, goLang, serviceName);
                if (goResult.endpoints.length > scanResult.endpoints.length) {
                  if (!options.quiet)
                    console.log(
                      `  ↳ TypeScript scan found 0 endpoints — switched to Go parser (found ${goResult.endpoints.length})`,
                    );
                  scanResult = goResult;
                }
              } else if (hasPyReq) {
                const pyLang = {
                  language: "python" as const,
                  framework: "unknown" as const,
                  detectedFrom: path.join(projectPath, "requirements.txt"),
                  confidence: 0.9,
                };
                const pyResult = await parsePythonProject(projectPath, pyLang, serviceName);
                if (pyResult.endpoints.length > scanResult.endpoints.length) {
                  if (!options.quiet)
                    console.log(
                      `  ↳ TypeScript scan found 0 endpoints — switched to Python parser (found ${pyResult.endpoints.length})`,
                    );
                  scanResult = pyResult;
                }
              }
            }
          } else if (lang.language === "java") {
            scanResult = await parseJavaProject(projectPath, lang, deriveServiceName(projectPath));
          } else if (lang.language === "csharp") {
            scanResult = await parseCSharpProject(
              projectPath,
              lang,
              deriveServiceName(projectPath),
            );
          } else if (lang.language === "python") {
            scanResult = await parsePythonProject(
              projectPath,
              lang,
              deriveServiceName(projectPath),
            );
          } else if (lang.language === "go") {
            scanResult = await parseGoProject(projectPath, lang, deriveServiceName(projectPath));
          } else {
            const dirName = path.basename(projectPath);
            const allFiles = await fg(["**/*"], {
              cwd: projectPath,
              ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
              onlyFiles: true,
            });
            const plugin = findPlugin(projectPath, allFiles);
            const serviceName = deriveServiceName(projectPath);

            if (plugin) {
              if (!options.quiet) console.log(`  → ${dirName} handled by plugin "${plugin.name}"`);
              const pluginLang = plugin.detect(projectPath, allFiles);
              scanResult = await plugin.parse(projectPath, pluginLang, serviceName);
            } else {
              if (!options.quiet) {
                console.log(`  ⚠️  Could not detect a supported language in: ${dirName}`);
                console.log(
                  `     crossctx looks for: package.json, pom.xml, *.csproj, requirements.txt, go.mod`,
                );
                console.log(
                  `     Run \`crossctx init\` to set up a config file, or use --openapi-only.\n`,
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
          }

          if (scanResult) {
            // GraphQL enrichment
            try {
              const gqlResult = await scanGraphQLSchemas(projectPath);
              if (gqlResult.operations.length > 0) {
                const gqlEndpoints = graphqlOperationsToEndpoints(
                  gqlResult.operations,
                  scanResult.serviceName,
                );
                scanResult.endpoints.push(...gqlEndpoints);
                if (!options.quiet)
                  console.log(`    + ${gqlEndpoints.length} GraphQL operation(s) from schema`);
              }
            } catch {
              /* skip */
            }

            // DB usage detection
            if (scanResult.language.language !== "unknown") {
              const dbLang = scanResult.language.language as DbLanguage;
              const fileExts: Record<string, string> = {
                typescript: "**/*.{ts,tsx,js,jsx}",
                python: "**/*.py",
                go: "**/*.go",
                java: "**/*.java",
                csharp: "**/*.{cs,csx}",
              };
              const pattern = fileExts[dbLang];
              if (pattern) {
                try {
                  const dbFiles = await fg([pattern], {
                    cwd: projectPath,
                    ignore: [
                      "**/node_modules/**",
                      "**/dist/**",
                      "**/build/**",
                      "**/.git/**",
                      "**/vendor/**",
                    ],
                    absolute: true,
                    onlyFiles: true,
                  });
                  const dbFileContents = new Map<string, string>();
                  for (const f of dbFiles.slice(0, 200)) {
                    try {
                      dbFileContents.set(f, await readFileAsync(f, "utf-8"));
                    } catch {
                      /* skip */
                    }
                  }
                  scanResult.dbUsage = extractDbUsage(dbFileContents, dbLang);
                  serviceContents.set(projectPath, {
                    serviceName: scanResult.serviceName,
                    language: dbLang,
                    files: dbFileContents,
                  });
                } catch {
                  /* skip */
                }
              }
            }

            codeScanResults.push(scanResult);
          }
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

    // Phase 2: OpenAPI scanning
    if (!options.quiet && !options.watch)
      console.log("  [2/4] Scanning for OpenAPI/Swagger specs...");
    if (!options.quiet && options.watch)
      console.log("  [scan] Scanning for OpenAPI/Swagger specs...");

    const scanResults = await scanForSpecs(resolvedPaths);
    const parsedSpecs: ParsedSpec[] = [];
    const parseErrors: { file: string; error: string }[] = [];

    for (const scan of scanResults) {
      try {
        parsedSpecs.push(await parseSpec(scan.filePath));
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

    // Phase 3: Resolve call chains
    if (!options.quiet && !options.watch) console.log("  [3/4] Resolving call chains...");
    if (!options.quiet && options.watch) console.log("  [scan] Resolving call chains...");

    const registry = buildServiceRegistry(codeScanResults);
    const callChains = buildAllCallChains(codeScanResults, registry);

    if (!options.quiet) console.log(`  Found ${callChains.length} call chain(s)\n`);

    // Phase 4: Build output
    if (!options.quiet && !options.watch) console.log("  [4/4] Building output...");
    if (!options.quiet && options.watch) console.log("  [scan] Building output...");

    const legacyDependencies = analyzeDependencies(parsedSpecs);
    const output = buildOutput(
      parsedSpecs,
      legacyDependencies,
      resolvedPaths.map((p) => path.relative(process.cwd(), p)),
      scanResults.length,
    );

    // Apply --min-confidence filter
    const minConf = options.minConfidence ?? 0;
    let filteredChains = callChains;
    if (minConf > 0) {
      filteredChains = callChains
        .map((chain) => ({
          ...chain,
          edges: chain.edges.filter((e) => (e.confidence ?? 0) >= minConf),
        }))
        .filter((chain) => chain.edges.length > 0 || chain.rootService !== "");

      if (!options.quiet) {
        const edgesRemoved =
          callChains.reduce((s, c) => s + c.edges.length, 0) -
          filteredChains.reduce((s, c) => s + c.edges.length, 0);
        if (edgesRemoved > 0) {
          console.log(
            `  Filtered ${edgesRemoved} low-confidence edge(s) (threshold: ${minConf})\n`,
          );
        }
      }
    }

    output.codeScanResults = codeScanResults;
    output.callChains = filteredChains;

    // v0.3: Shared library detection
    if (serviceContents.size >= 2) {
      output.sharedLibraries = detectSharedLibrariesFromContents(serviceContents);
      if (!options.quiet && output.sharedLibraries.length > 0) {
        console.log(`  Found ${output.sharedLibraries.length} shared internal package(s)\n`);
      }
    }

    // Save JSON
    const outputPath = path.resolve(options.output);
    await saveOutput(output, outputPath);

    // Markdown
    if (options.markdown !== undefined) {
      const mdPath =
        typeof options.markdown === "string"
          ? path.resolve(options.markdown)
          : path.resolve("crossctx-output.md");
      await saveMarkdown(output, mdPath);
      if (!options.quiet) console.log(`  Markdown saved to: ${mdPath}`);
    }

    // Graph
    if (options.graph !== undefined) {
      const graphPath =
        typeof options.graph === "string"
          ? path.resolve(options.graph)
          : path.resolve("crossctx-graph.html");
      await saveGraph(output, graphPath);
      if (!options.quiet) console.log(`  Graph saved to: ${graphPath}`);
    }

    return output;
  } catch (err) {
    console.error("\n  Error:", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK OUTPUT: the "aha moment" printed after every scan
// ─────────────────────────────────────────────────────────────────────────────

function printHookSummary(output: CrossCtxOutput): void {
  const scanResults = output.codeScanResults ?? [];
  const callChains = output.callChains ?? [];

  // Count cross-service calls
  const crossServiceEdges = new Set<string>();
  const depPairs: Map<string, number> = new Map();
  for (const chain of callChains) {
    for (const edge of chain.edges) {
      if (edge.fromService && edge.toService && edge.fromService !== edge.toService) {
        crossServiceEdges.add(`${edge.fromService}→${edge.toService}:${edge.from}→${edge.to}`);
        const key = `${edge.fromService} → ${edge.toService}`;
        depPairs.set(key, (depPairs.get(key) ?? 0) + 1);
      }
    }
  }

  const totalEndpoints = scanResults.reduce((sum, r) => sum + r.endpoints.length, 0);

  console.log("");
  console.log("  🔍 CrossCtx Results");
  console.log("  ─────────────────────────────────────────────");
  console.log("");
  console.log(`  ✔ ${scanResults.length} service(s) detected`);
  console.log(`  ✔ ${totalEndpoints} endpoint(s) mapped`);
  console.log(`  ✔ ${crossServiceEdges.size} cross-service call(s) found`);

  // Top dependencies (by call count)
  if (depPairs.size > 0) {
    console.log("");
    console.log("  Top dependencies:");
    const sorted = [...depPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [pair] of sorted) {
      console.log(`    - ${pair}`);
    }
  }

  // High fan-out services
  const fanOut = new Map<string, Set<string>>();
  for (const chain of callChains) {
    for (const edge of chain.edges) {
      if (edge.fromService && edge.toService && edge.fromService !== edge.toService) {
        if (!fanOut.has(edge.fromService)) fanOut.set(edge.fromService, new Set());
        fanOut.get(edge.fromService)!.add(edge.toService);
      }
    }
  }
  const highFanOut = [...fanOut.entries()].filter(([, deps]) => deps.size >= 3);
  if (highFanOut.length > 0) {
    console.log("");
    console.log("  ⚠️  High fan-out:");
    for (const [svc, deps] of highFanOut) {
      console.log(`    - ${svc} calls ${deps.size} services`);
    }
  }

  console.log("");
  console.log("  Next steps:");
  console.log("    crossctx graph        # open interactive dependency graph");
  console.log("    crossctx insights     # full architecture analysis");
  console.log("    crossctx blame <svc>  # impact analysis for a service");
  console.log("    crossctx export       # save JSON / Markdown");
  console.log("");
}

// ─────────────────────────────────────────────────────────────────────────────
// `crossctx init`
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Scaffold a .crossctxrc.json config file in the current directory")
  .action(async () => {
    const configPath = path.join(process.cwd(), ".crossctxrc.json");
    try {
      await access(configPath);
      console.log("\n  .crossctxrc.json already exists. Delete it first to reinitialize.\n");
      process.exit(1);
    } catch {
      /* doesn't exist — proceed */
    }

    await writeFile(configPath, DEFAULT_CONFIG_JSON + "\n", "utf-8");
    console.log("\n  ✅  Created .crossctxrc.json\n");
    console.log("  Edit the config to point at your service directories, then run:\n");
    console.log("    crossctx scan\n");
  });

// ─────────────────────────────────────────────────────────────────────────────
// `crossctx scan`  — primary entry command
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("scan [paths...]")
  .description("Scan services and show architecture summary (default command)")
  .option("-o, --output <file>", "JSON output file path", "crossctx-output.json")
  .option("-q, --quiet", "suppress terminal output")
  .option("--openapi-only", "only scan OpenAPI/Swagger spec files")
  .option("-w, --watch", "watch for file changes and rebuild", false)
  .option("--min-confidence <threshold>", "filter edges below this confidence threshold (0–1)")
  .option("--monorepo", "auto-discover service roots under each provided path", false)
  .action(
    async (
      pathArgs: string[],
      rawOptions: {
        output?: string;
        quiet?: boolean;
        openapiOnly?: boolean;
        watch: boolean;
        minConfidence?: string;
        monorepo?: boolean;
      },
    ) => {
      const fileConfig = await loadConfig();
      const options = mergeConfig(fileConfig, rawOptions);

      if (options.output === undefined) options.output = "crossctx-output.json";
      if (options.quiet === undefined) options.quiet = false;
      if (options.openapiOnly === undefined) options.openapiOnly = false;

      if (fileConfig.plugins && fileConfig.plugins.length > 0) {
        await loadPlugins(fileConfig.plugins, (msg) => {
          if (!options.quiet) console.warn(`  ${msg}`);
        });
      }

      const inputPaths: string[] = pathArgs.length > 0 ? pathArgs : (fileConfig.paths ?? []);
      if (inputPaths.length === 0) {
        console.error(
          "\n  Error: No project paths provided.\n\n" +
            "  Usage:  crossctx scan <paths...>\n" +
            "  Or run: crossctx init  to create a .crossctxrc.json config file\n",
        );
        process.exit(1);
      }

      let minConfidence = 0;
      if (options.minConfidence !== undefined) {
        minConfidence = parseFloat(String(options.minConfidence));
        if (isNaN(minConfidence) || minConfidence < 0 || minConfidence > 1) {
          console.error("\n  Error: --min-confidence must be a number between 0 and 1\n");
          process.exit(1);
        }
      } else if (fileConfig.minConfidence !== undefined) {
        minConfidence = fileConfig.minConfidence;
      }

      const resolvedPaths = inputPaths.map((p) => path.resolve(p));

      if (!options.quiet) console.log(`\n  CrossCtx v${VERSION}\n`);

      const doScan = async () => {
        const currentOutput = await runScan(resolvedPaths, {
          output: options.output as string,
          quiet: options.quiet as boolean,
          openapiOnly: options.openapiOnly as boolean,
          watch: false,
          minConfidence,
          monorepo: options.monorepo as boolean | undefined,
        });

        if (!options.quiet) {
          printHookSummary(currentOutput);
        }

        return currentOutput;
      };

      await doScan();

      if (options.watch) {
        let debounceTimer: NodeJS.Timeout | null = null;
        const watchers: FSWatcher[] = [];
        const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".java", ".cs", ".py", ".go"];

        for (const dirPath of resolvedPaths) {
          try {
            const watcher = watch(dirPath, { recursive: true, persistent: true }, (_, filename) => {
              if (filename && sourceExtensions.some((ext) => filename.endsWith(ext))) {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                  if (!options.quiet)
                    console.log(`\n  [watch] Change detected in ${filename}, rescanning...\n`);
                  try {
                    await doScan();
                  } catch (err) {
                    if (!options.quiet)
                      console.error(
                        `  [watch] Error: ${err instanceof Error ? err.message : String(err)}`,
                      );
                  }
                }, 500);
              }
            });
            watchers.push(watcher);
          } catch (err) {
            if (!options.quiet)
              console.error(
                `  [watch] Failed to watch ${dirPath}: ${err instanceof Error ? err.message : String(err)}`,
              );
          }
        }

        if (!options.quiet)
          console.log(`  [watch] Ready. Watching ${resolvedPaths.length} path(s)...\n`);

        process.on("SIGINT", () => {
          if (!options.quiet) console.log("\n  [watch] Stopping...\n");
          watchers.forEach((w) => w.close());
          process.exit(0);
        });
      }
    },
  );

// ─────────────────────────────────────────────────────────────────────────────
// `crossctx graph`  — open the interactive HTML graph
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("graph [paths...]")
  .description("Generate an interactive HTML dependency graph")
  .option("-i, --input <file>", "use a previously saved JSON output instead of rescanning")
  .option("-o, --output <file>", "graph HTML output path", "crossctx-graph.html")
  .option("--min-confidence <threshold>", "filter edges below this confidence threshold (0–1)")
  .option("--monorepo", "auto-discover service roots under each provided path", false)
  .action(
    async (
      pathArgs: string[],
      graphOptions: {
        input?: string;
        output: string;
        minConfidence?: string;
        monorepo?: boolean;
      },
    ) => {
      const graphPath = path.resolve(graphOptions.output);

      let output: CrossCtxOutput;

      if (graphOptions.input) {
        // Load existing JSON
        try {
          output = JSON.parse(
            await readFile(path.resolve(graphOptions.input), "utf-8"),
          ) as CrossCtxOutput;
          console.log(`\n  CrossCtx v${VERSION} — using saved output: ${graphOptions.input}\n`);
        } catch (err) {
          console.error(
            `\n  Error reading input: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }
      } else {
        // Run a fresh scan
        const fileConfig = await loadConfig();
        const inputPaths: string[] = pathArgs.length > 0 ? pathArgs : (fileConfig.paths ?? []);
        if (inputPaths.length === 0) {
          console.error("\n  Error: provide paths or use --input <json-file>\n");
          process.exit(1);
        }

        let minConfidence = 0;
        if (graphOptions.minConfidence !== undefined) {
          minConfidence = parseFloat(graphOptions.minConfidence);
          if (isNaN(minConfidence) || minConfidence < 0 || minConfidence > 1) {
            console.error("\n  Error: --min-confidence must be between 0 and 1\n");
            process.exit(1);
          }
        }

        console.log(`\n  CrossCtx v${VERSION}\n`);
        output = await runScan(
          inputPaths.map((p) => path.resolve(p)),
          {
            output: "crossctx-output.json",
            quiet: false,
            openapiOnly: false,
            minConfidence,
            monorepo: graphOptions.monorepo,
          },
        );
      }

      await saveGraph(output, graphPath);
      console.log(`\n  ✅  Graph saved: ${graphPath}`);
      console.log("  Open it in your browser to explore the dependency map.\n");
    },
  );

// ─────────────────────────────────────────────────────────────────────────────
// `crossctx insights`  — full architecture analysis
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("insights [paths...]")
  .description("Run full architecture analysis: circular deps, fan-out, coupling, and more")
  .option("-i, --input <file>", "use a previously saved JSON output instead of rescanning")
  .option("--monorepo", "auto-discover service roots under each provided path", false)
  .action(async (pathArgs: string[], insightOptions: { input?: string; monorepo?: boolean }) => {
    let output: CrossCtxOutput;

    if (insightOptions.input) {
      try {
        output = JSON.parse(
          await readFile(path.resolve(insightOptions.input), "utf-8"),
        ) as CrossCtxOutput;
        console.log(`\n  CrossCtx v${VERSION} — using saved output: ${insightOptions.input}\n`);
      } catch (err) {
        console.error(
          `\n  Error reading input: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    } else {
      const fileConfig = await loadConfig();
      const inputPaths: string[] = pathArgs.length > 0 ? pathArgs : (fileConfig.paths ?? []);
      if (inputPaths.length === 0) {
        console.error("\n  Error: provide paths or use --input <json-file>\n");
        process.exit(1);
      }

      console.log(`\n  CrossCtx v${VERSION}\n`);
      output = await runScan(
        inputPaths.map((p) => path.resolve(p)),
        {
          output: "crossctx-output.json",
          quiet: false,
          openapiOnly: false,
          monorepo: insightOptions.monorepo,
        },
      );
    }

    const insights = computeInsights(output);
    console.log(formatInsights(insights));

    if (insights.some((i) => i.severity === "error")) {
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// `crossctx export`  — save JSON and/or Markdown
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("export [paths...]")
  .description("Export dependency map as JSON, Markdown, or both")
  .option("-f, --format <format>", "output format: json, markdown, or all", "all")
  .option("-i, --input <file>", "use a previously saved JSON output instead of rescanning")
  .option("--json-output <file>", "JSON output path", "crossctx-output.json")
  .option("--md-output <file>", "Markdown output path", "crossctx-output.md")
  .option("--monorepo", "auto-discover service roots under each provided path", false)
  .action(
    async (
      pathArgs: string[],
      exportOptions: {
        format: string;
        input?: string;
        jsonOutput: string;
        mdOutput: string;
        monorepo?: boolean;
      },
    ) => {
      let output: CrossCtxOutput;

      if (exportOptions.input) {
        try {
          output = JSON.parse(
            await readFile(path.resolve(exportOptions.input), "utf-8"),
          ) as CrossCtxOutput;
          console.log(`\n  CrossCtx v${VERSION} — using saved output: ${exportOptions.input}\n`);
        } catch (err) {
          console.error(
            `\n  Error reading input: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }
      } else {
        const fileConfig = await loadConfig();
        const inputPaths: string[] = pathArgs.length > 0 ? pathArgs : (fileConfig.paths ?? []);
        if (inputPaths.length === 0) {
          console.error("\n  Error: provide paths or use --input <json-file>\n");
          process.exit(1);
        }

        console.log(`\n  CrossCtx v${VERSION}\n`);
        output = await runScan(
          inputPaths.map((p) => path.resolve(p)),
          {
            output: exportOptions.jsonOutput,
            quiet: false,
            openapiOnly: false,
            monorepo: exportOptions.monorepo,
          },
        );
      }

      const fmt = exportOptions.format.toLowerCase();
      const doJson = fmt === "json" || fmt === "all";
      const doMarkdown = fmt === "markdown" || fmt === "all";

      console.log("");
      if (doJson) {
        const jsonPath = path.resolve(exportOptions.jsonOutput);
        await saveOutput(output, jsonPath);
        console.log(`  ✅  JSON saved:     ${jsonPath}`);
      }
      if (doMarkdown) {
        const mdPath = path.resolve(exportOptions.mdOutput);
        await saveMarkdown(output, mdPath);
        console.log(`  ✅  Markdown saved: ${mdPath}`);
      }
      console.log("");
    },
  );

// ─────────────────────────────────────────────────────────────────────────────
// `crossctx blame <ServiceName>`  — impact analysis
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("blame <service>")
  .description("Show what breaks if a given service goes down")
  .option("-i, --input <file>", "use a previously saved JSON output instead of rescanning")
  .option("-p, --paths <paths...>", "project directories to scan")
  .option("--monorepo", "auto-discover service roots under each provided path", false)
  .action(
    async (
      service: string,
      blameOptions: {
        input?: string;
        paths?: string[];
        monorepo?: boolean;
      },
    ) => {
      let output: CrossCtxOutput;

      if (blameOptions.input) {
        try {
          output = JSON.parse(
            await readFile(path.resolve(blameOptions.input), "utf-8"),
          ) as CrossCtxOutput;
        } catch (err) {
          console.error(
            `\n  Error reading input: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }
      } else {
        const fileConfig = await loadConfig();
        const inputPaths: string[] =
          (blameOptions.paths ?? []).length > 0 ? blameOptions.paths! : (fileConfig.paths ?? []);

        if (inputPaths.length === 0) {
          console.error("\n  Error: provide paths, use --paths, or use --input <json-file>\n");
          process.exit(1);
        }

        console.log(`\n  CrossCtx v${VERSION}\n`);
        output = await runScan(
          inputPaths.map((p) => path.resolve(p)),
          {
            output: "crossctx-output.json",
            quiet: true,
            openapiOnly: false,
            monorepo: blameOptions.monorepo,
          },
        );
      }

      const scanResults = output.codeScanResults ?? [];
      const callChains = output.callChains ?? [];

      // Find the service (case-insensitive)
      const targetLower = service.toLowerCase();
      const matched = scanResults.find(
        (r) =>
          r.serviceName.toLowerCase() === targetLower ||
          r.serviceName.toLowerCase().includes(targetLower),
      );
      const targetName = matched?.serviceName ?? service;

      // Build reverse dependency map: who calls targetName?
      const directCallers = new Set<string>();
      const affectedEndpoints: { caller: string; via: string }[] = [];

      for (const chain of callChains) {
        for (const edge of chain.edges) {
          if (edge.toService?.toLowerCase() === targetName.toLowerCase()) {
            directCallers.add(edge.fromService);
            if (affectedEndpoints.length < 10) {
              affectedEndpoints.push({ caller: edge.fromService, via: edge.to });
            }
          }
        }
      }

      // BFS: find all transitively affected services
      const allAffected = new Set<string>(directCallers);
      const queue = [...directCallers];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const chain of callChains) {
          for (const edge of chain.edges) {
            if (
              edge.toService === current &&
              !allAffected.has(edge.fromService) &&
              edge.fromService !== targetName
            ) {
              allAffected.add(edge.fromService);
              queue.push(edge.fromService);
            }
          }
        }
      }

      console.log("");
      console.log(`  💥 Blast radius: ${targetName}`);
      console.log("  ─────────────────────────────────────────────");
      console.log("");

      if (allAffected.size === 0) {
        console.log(`  No services found that depend on ${targetName}.`);
        console.log("  It may be a leaf service, or its callers aren't in the current scan.\n");
        return;
      }

      console.log(`  If ${targetName} goes down:\n`);
      console.log(`  Direct callers (${directCallers.size}):`);
      for (const caller of directCallers) {
        console.log(`    ✖ ${caller} will break`);
      }

      if (allAffected.size > directCallers.size) {
        const transitive = [...allAffected].filter((s) => !directCallers.has(s));
        console.log(`\n  Transitively affected (${transitive.length}):`);
        for (const svc of transitive) {
          console.log(`    ~ ${svc} (indirect)`);
        }
      }

      if (affectedEndpoints.length > 0) {
        console.log(`\n  Affected call sites (sample):`);
        for (const { caller, via } of affectedEndpoints.slice(0, 5)) {
          console.log(`    ${caller} → ${via}`);
        }
      }

      console.log("");
      console.log(`  Total impact: ${allAffected.size} service(s) affected`);
      console.log("");
    },
  );

// ─────────────────────────────────────────────────────────────────────────────
// `crossctx explain <endpoint>`  — LLM context builder
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("explain <endpoint>")
  .description("Generate an LLM-ready context description for an endpoint and copy to clipboard")
  .option("-i, --input <file>", "use a previously saved JSON output instead of rescanning")
  .option("-p, --paths <paths...>", "project directories to scan")
  .option("--no-copy", "print to stdout instead of copying to clipboard")
  .action(
    async (
      endpoint: string,
      explainOptions: {
        input?: string;
        paths?: string[];
        copy: boolean;
      },
    ) => {
      let output: CrossCtxOutput;

      if (explainOptions.input) {
        try {
          output = JSON.parse(
            await readFile(path.resolve(explainOptions.input), "utf-8"),
          ) as CrossCtxOutput;
        } catch (err) {
          console.error(
            `\n  Error reading input: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }
      } else {
        const fileConfig = await loadConfig();
        const inputPaths: string[] =
          (explainOptions.paths ?? []).length > 0
            ? explainOptions.paths!
            : (fileConfig.paths ?? []);

        if (inputPaths.length === 0) {
          console.error("\n  Error: provide paths, use --paths, or use --input <json-file>\n");
          process.exit(1);
        }

        output = await runScan(
          inputPaths.map((p) => path.resolve(p)),
          {
            output: "crossctx-output.json",
            quiet: true,
            openapiOnly: false,
          },
        );
      }

      const scanResults = output.codeScanResults ?? [];
      const callChains = output.callChains ?? [];

      // Find matching endpoints (path substring match, case-insensitive)
      const endpointLower = endpoint.toLowerCase();
      const matches: { service: string; method: string; path: string; fullPath: string }[] = [];

      for (const result of scanResults) {
        for (const ep of result.endpoints) {
          if (
            ep.path.toLowerCase().includes(endpointLower) ||
            ep.fullPath.toLowerCase().includes(endpointLower)
          ) {
            matches.push({
              service: result.serviceName,
              method: ep.method,
              path: ep.fullPath,
              fullPath: ep.fullPath,
            });
          }
        }
      }

      if (matches.length === 0) {
        console.log(`\n  No endpoint matching "${endpoint}" found.\n`);
        console.log("  Tip: Try a partial path like /orders or /users\n");
        process.exit(1);
      }

      // Use first match
      const match = matches[0];
      const result = scanResults.find((r) => r.serviceName === match.service)!;
      const ep = result.endpoints.find(
        (e) => e.fullPath === match.fullPath && e.method === match.method,
      );

      // Find outbound calls from this endpoint
      const outbound = ep?.outboundCalls ?? [];
      const resolvedCalls = outbound
        .filter((c) => c.resolvedService)
        .map((c) => `${c.resolvedService} (${c.method} ${c.resolvedPath ?? c.rawUrl})`);

      // Find call chains involving this endpoint
      const relevantChains = callChains.filter(
        (chain) => chain.rootService === match.service && chain.rootEndpoint.includes(match.path),
      );

      const lines: string[] = [];
      lines.push(`Context for ${match.service} — ${match.method} ${match.path}`);
      lines.push("");
      lines.push(`Service: ${match.service}`);
      lines.push(`Endpoint: ${match.method} ${match.path}`);

      if (ep?.summary) lines.push(`Summary: ${ep.summary}`);
      if (ep?.requestBody) {
        const fields = ep.requestBody.fields.map((f) => `${f.name}: ${f.type}`).join(", ");
        lines.push(`Request body: ${ep.requestBody.typeName ?? "object"} { ${fields} }`);
      }
      if (ep?.response) {
        const fields = ep.response.fields.map((f) => `${f.name}: ${f.type}`).join(", ");
        lines.push(`Response: ${ep.response.typeName ?? "object"} { ${fields} }`);
      }

      if (resolvedCalls.length > 0) {
        lines.push("");
        lines.push("This endpoint calls:");
        for (const call of resolvedCalls) lines.push(`  - ${call}`);
      }

      if (relevantChains.length > 0) {
        lines.push("");
        lines.push("Full call chain:");
        for (const chain of relevantChains.slice(0, 2)) {
          for (const edge of chain.edges.slice(0, 8)) {
            lines.push(`  ${edge.fromService}:${edge.from} → ${edge.toService}:${edge.to}`);
          }
        }
      }

      const context = lines.join("\n");

      if (explainOptions.copy) {
        // Try to copy to clipboard via pbcopy / xclip / clip.exe
        try {
          const { execSync } = await import("child_process");
          const platform = process.platform;
          if (platform === "darwin") {
            execSync("pbcopy", { input: context });
            console.log("\n  Copied to clipboard ✅\n");
          } else if (platform === "win32") {
            execSync("clip", { input: context });
            console.log("\n  Copied to clipboard ✅\n");
          } else {
            try {
              execSync("xclip -selection clipboard", { input: context });
              console.log("\n  Copied to clipboard ✅\n");
            } catch {
              execSync("xsel --clipboard --input", { input: context });
              console.log("\n  Copied to clipboard ✅\n");
            }
          }
        } catch {
          console.log("\n  Could not access clipboard — printing instead:\n");
          console.log(context);
          console.log("");
        }
      } else {
        console.log("\n" + context + "\n");
      }

      // Also print a brief preview
      console.log(`  Endpoint: ${match.service} — ${match.method} ${match.path}`);
      if (resolvedCalls.length > 0) {
        console.log(`  Calls:    ${resolvedCalls.slice(0, 3).join(", ")}`);
      }
      console.log("");
    },
  );

// ─────────────────────────────────────────────────────────────────────────────
// `crossctx diff`  — breaking change detection (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("diff <baseline> <current>")
  .description("Compare two crossctx JSON output files and report breaking changes")
  .option("-f, --format <format>", "output format: human (default) or json", "human")
  .action(async (baselineArg: string, currentArg: string, diffOptions: { format: string }) => {
    const baselinePath = path.resolve(baselineArg);
    const currentPath = path.resolve(currentArg);

    let baselineOutput: CrossCtxOutput;
    let currentOutput: CrossCtxOutput;

    try {
      baselineOutput = JSON.parse(await readFile(baselinePath, "utf-8")) as CrossCtxOutput;
    } catch (err) {
      console.error(
        `\n  Error reading baseline: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    try {
      currentOutput = JSON.parse(await readFile(currentPath, "utf-8")) as CrossCtxOutput;
    } catch (err) {
      console.error(
        `\n  Error reading current: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }

    const report = diffOutputs(baselineOutput, currentOutput);

    if (diffOptions.format === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const hasBreaking = report.breaking.length > 0;
      const hasNonBreaking = report.nonBreaking.length > 0;

      console.log("\n  CrossCtx Diff Report");
      console.log("  ─────────────────────────────────────────────");
      console.log(`  Baseline : ${baselinePath}`);
      console.log(`  Current  : ${currentPath}`);
      console.log(`  Compared : ${report.scannedAt}`);
      console.log();

      const summaryParts: string[] = [];
      if (report.summary.removedEndpoints > 0)
        summaryParts.push(`${report.summary.removedEndpoints} removed`);
      if (report.summary.addedEndpoints > 0)
        summaryParts.push(`${report.summary.addedEndpoints} added`);
      if (report.summary.changedEndpoints > 0)
        summaryParts.push(`${report.summary.changedEndpoints} changed`);

      if (summaryParts.length === 0) {
        console.log("  ✅  No changes detected.\n");
        process.exit(0);
      }

      console.log(`  Summary: ${summaryParts.join(", ")}`);
      console.log();

      if (hasBreaking) {
        console.log("  ⚠️  BREAKING CHANGES");
        console.log("  ──────────────────────");
        for (const change of report.breaking) {
          const label = `${change.service}  ${change.method} ${change.path}`;
          if (change.type === "removed") {
            console.log(`  ✖  [REMOVED] ${label}`);
          } else if (change.type === "changed" && change.changes) {
            console.log(`  ✖  [CHANGED] ${label}`);
            if (change.changes.requestBody)
              console.log(
                `       request body: ${change.changes.requestBody.before ?? "(none)"} → ${change.changes.requestBody.after ?? "(none)"}`,
              );
            if (change.changes.response)
              console.log(
                `       response:      ${change.changes.response.before ?? "(none)"} → ${change.changes.response.after ?? "(none)"}`,
              );
            if (change.changes.removedFields?.length)
              console.log(`       removed fields: ${change.changes.removedFields.join(", ")}`);
            if (change.changes.addedFields?.length)
              console.log(`       added fields:   ${change.changes.addedFields.join(", ")}`);
          }
        }
        console.log();
      }

      if (hasNonBreaking) {
        console.log("  ℹ️   NON-BREAKING CHANGES");
        console.log("  ──────────────────────────");
        for (const change of report.nonBreaking) {
          const label = `${change.service}  ${change.method} ${change.path}`;
          if (change.type === "added") {
            console.log(`  ✚  [ADDED]   ${label}`);
          } else if (change.type === "changed" && change.changes) {
            console.log(`  ~  [CHANGED] ${label}`);
            if (change.changes.addedFields?.length)
              console.log(`       added fields: ${change.changes.addedFields.join(", ")}`);
          }
        }
        console.log();
      }

      if (hasBreaking) {
        console.error(
          `  ${report.summary.totalBreaking} breaking change(s) detected — failing build.\n`,
        );
        process.exit(1);
      } else {
        console.log("  ✅  No breaking changes.\n");
        process.exit(0);
      }
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Root command — show help / redirect to `scan`
// ─────────────────────────────────────────────────────────────────────────────

program
  .name("crossctx")
  .description("Static architecture intelligence for microservices")
  .version(VERSION)
  // Allow `crossctx <paths...>` as shorthand for `crossctx scan <paths...>`
  .argument("[paths...]", "shorthand for `crossctx scan <paths...>`")
  .action(async (pathArgs: string[]) => {
    if (pathArgs.length > 0) {
      // Delegate to scan with these paths
      await loadConfig();
      const resolvedPaths = pathArgs.map((p) => path.resolve(p));
      console.log(`\n  CrossCtx v${VERSION}\n`);
      const output = await runScan(resolvedPaths, {
        output: "crossctx-output.json",
        quiet: false,
        openapiOnly: false,
        monorepo: false,
      });
      printHookSummary(output);
    } else {
      // No args — check config
      const fileConfig = await loadConfig();
      if (fileConfig.paths && fileConfig.paths.length > 0) {
        const resolvedPaths = fileConfig.paths.map((p: string) => path.resolve(p));
        console.log(`\n  CrossCtx v${VERSION}\n`);
        const output = await runScan(resolvedPaths, {
          output: "crossctx-output.json",
          quiet: false,
          openapiOnly: false,
          monorepo: false,
        });
        printHookSummary(output);
      } else {
        program.help();
      }
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// `crossctx trace <endpoint>`  — visualise the call chain for an endpoint
// ─────────────────────────────────────────────────────────────────────────────

program
  .command("trace <endpoint>")
  .description("Trace the full call chain for an endpoint path")
  .option("-i, --input <file>", "use a previously saved JSON output instead of rescanning")
  .option("-p, --paths <paths...>", "project directories to scan")
  .action(async (endpoint: string, traceOptions: { input?: string; paths?: string[] }) => {
    let output: CrossCtxOutput;

    if (traceOptions.input) {
      try {
        output = JSON.parse(
          await readFile(path.resolve(traceOptions.input), "utf-8"),
        ) as CrossCtxOutput;
      } catch (err) {
        console.error(
          `\n  Error reading input: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    } else {
      const fileConfig = await loadConfig();
      const inputPaths: string[] =
        (traceOptions.paths ?? []).length > 0 ? traceOptions.paths! : (fileConfig.paths ?? []);

      if (inputPaths.length === 0) {
        console.error("\n  Error: provide paths, use --paths, or use --input <json-file>\n");
        process.exit(1);
      }

      output = await runScan(
        inputPaths.map((p) => path.resolve(p)),
        {
          output: "crossctx-output.json",
          quiet: true,
          openapiOnly: false,
        },
      );
    }

    const scanResults = output.codeScanResults ?? [];
    const callChains = output.callChains ?? [];
    const endpointLower = endpoint.toLowerCase();

    // Find matching endpoints
    type Match = { service: string; method: string; path: string; fullPath: string };
    const matches: Match[] = [];
    for (const result of scanResults) {
      for (const ep of result.endpoints) {
        if (
          ep.path.toLowerCase().includes(endpointLower) ||
          ep.fullPath.toLowerCase().includes(endpointLower)
        ) {
          matches.push({
            service: result.serviceName,
            method: ep.method,
            path: ep.path,
            fullPath: ep.fullPath,
          });
        }
      }
    }

    if (matches.length === 0) {
      console.log(`\n  No endpoint matching "${endpoint}" found.\n`);
      process.exit(1);
    }

    const match = matches[0];

    console.log(`\n  🔎 Trace: ${match.method} ${match.fullPath}\n`);

    // Find call chains from this endpoint
    const relevantChains = callChains.filter(
      (chain) =>
        chain.rootService === match.service &&
        chain.rootEndpoint.toLowerCase().includes(match.path.toLowerCase()),
    );

    // Build a simple ASCII tree from edges
    function renderNode(
      service: string,
      epKey: string,
      edges: (typeof callChains)[0]["edges"],
      visited: Set<string>,
      indent: number,
    ): void {
      const prefix = "  " + "  ".repeat(indent);
      console.log(`${prefix}${service}`);
      const key = `${service}:${epKey}`;
      if (visited.has(key)) {
        console.log(`${prefix}  ↻ (cycle)`);
        return;
      }
      visited.add(key);
      const children = edges.filter((e) => e.from === epKey && e.fromService === service);
      for (const child of children) {
        console.log(`${prefix}  → ${child.toService} (${child.to})`);
        renderNode(child.toService, child.to, edges, new Set(visited), indent + 2);
      }
    }

    if (relevantChains.length > 0) {
      const chain = relevantChains[0];
      renderNode(match.service, chain.rootEndpoint, chain.edges, new Set(), 0);
    } else {
      // No call chain — show the endpoint and its outbound calls from scan results
      console.log(`  ${match.service}`);
      const result = scanResults.find((r) => r.serviceName === match.service);
      const ep = result?.endpoints.find(
        (e) => e.fullPath === match.fullPath && e.method === match.method,
      );
      if (ep?.outboundCalls && ep.outboundCalls.length > 0) {
        for (const call of ep.outboundCalls) {
          const target = call.resolvedService
            ? `${call.resolvedService} (${call.method} ${call.resolvedPath ?? call.rawUrl})`
            : `unresolved: ${call.rawUrl}`;
          console.log(`    → ${target}`);
        }
      } else {
        console.log("    (no outbound calls detected from this endpoint)");
      }
    }

    console.log("");
  });

// `crossctx impact` — alias for `blame` with slightly different framing
program
  .command("impact <service>")
  .description("Alias for `blame` — show what breaks if a service goes down")
  .option("-i, --input <file>", "use a previously saved JSON output instead of rescanning")
  .option("-p, --paths <paths...>", "project directories to scan")
  .action(async (service: string, opts: { input?: string; paths?: string[] }) => {
    // Reuse blame logic by spawning the same action via argv rewrite
    process.argv = [
      ...process.argv.slice(0, 2),
      "blame",
      service,
      ...(opts.input ? ["--input", opts.input] : []),
      ...(opts.paths ? ["--paths", ...opts.paths] : []),
    ];
    program.parse();
  });

program.parse();
