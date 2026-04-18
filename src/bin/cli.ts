import { Command } from "commander";
import path from "path";
import { readdir } from "fs/promises";

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
import { buildServiceRegistry, buildAllCallChains } from "../resolver/index.js";

import type { ParsedSpec, CodeScanResult } from "../types/index.js";

const program = new Command();

program
  .name("crossctx")
  .description("Generate cross-service API dependency maps from source code + OpenAPI specs")
  .version("0.2.0")
  .argument("<paths...>", "project directories to scan (one per microservice)")
  .option("-o, --output <file>", "output JSON file path", "crossctx-output.json")
  .option("-m, --markdown [file]", "generate Markdown output")
  .option("-g, --graph [file]", "generate interactive HTML dependency graph (default: crossctx-graph.html)")
  .option("-q, --quiet", "suppress terminal output", false)
  .option("--openapi-only", "only scan OpenAPI/Swagger spec files (legacy mode)", false)
  .action(
    async (
      paths: string[],
      options: {
        output: string;
        markdown?: boolean | string;
        graph?: boolean | string;
        quiet: boolean;
        openapiOnly: boolean;
      }
    ) => {
      try {
        const resolvedPaths = paths.map((p) => path.resolve(p));

        if (!options.quiet) console.log("\n  CrossCtx v0.2.0\n");

        // ── Phase 1: Source code scanning ──────────────────────────────────────
        const codeScanResults: CodeScanResult[] = [];

        if (!options.openapiOnly) {
          if (!options.quiet) console.log("  [1/4] Detecting languages and scanning source code...");

          for (const projectPath of resolvedPaths) {
            // Make sure path exists and is a directory
            try {
              const entries = await readdir(projectPath);
              void entries; // just checking it exists
            } catch {
              if (!options.quiet) console.log(`  ⚠️  Skipping ${projectPath} (not found or not a directory)`);
              continue;
            }

            const lang = await detectLanguage(projectPath);

            if (!options.quiet) {
              console.log(`  → ${path.basename(projectPath)} (${lang.language}/${lang.framework}, confidence: ${Math.round(lang.confidence * 100)}%)`);
            }

            try {
              let scanResult: CodeScanResult | null = null;

              if (lang.language === "typescript") {
                // Read package.json for service name
                let pkg: Record<string, unknown> | undefined;
                try {
                  const { readFile } = await import("fs/promises");
                  pkg = JSON.parse(await readFile(path.join(projectPath, "package.json"), "utf-8")) as Record<string, unknown>;
                } catch { /* no package.json */ }

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

              } else {
                // Unknown language — service name only placeholder
                const serviceName = deriveServiceName(projectPath);
                if (!options.quiet) {
                  console.log(`  ⚠️  ${lang.language}/${lang.framework} — no parser available, using service name only`);
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
                console.log(`  ⚠️  Failed to scan ${projectPath}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }

          if (!options.quiet) {
            const totalEndpoints = codeScanResults.reduce((sum, r) => sum + r.endpoints.length, 0);
            console.log(`  Found ${codeScanResults.length} service(s), ${totalEndpoints} endpoint(s)\n`);
          }
        }

        // ── Phase 2: OpenAPI scanning (always runs, enriches code scan) ────────
        if (!options.quiet) console.log("  [2/4] Scanning for OpenAPI/Swagger specs...");

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
        if (!options.quiet) console.log("  [3/4] Resolving call chains...");

        const registry = buildServiceRegistry(codeScanResults);
        const callChains = buildAllCallChains(codeScanResults, registry);

        if (!options.quiet) {
          console.log(`  Found ${callChains.length} call chain(s)\n`);
        }

        // ── Phase 4: Build output ──────────────────────────────────────────────
        if (!options.quiet) console.log("  [4/4] Building output...");

        const legacyDependencies = analyzeDependencies(parsedSpecs);
        const output = buildOutput(parsedSpecs, legacyDependencies, paths, scanResults.length);

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
      } catch (err) {
        console.error("\n  Error:", err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
  );

program.parse();
