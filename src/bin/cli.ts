import { Command } from "commander";
import path from "path";
import { scanForSpecs } from "../scanner/index.js";
import { parseSpec } from "../parser/index.js";
import { analyzeDependencies } from "../analyzer/index.js";
import { buildOutput, saveOutput, printSummary } from "../renderer/index.js";
import type { ParsedSpec } from "../types/index.js";

const program = new Command();

program
  .name("crossctx")
  .description("Generate cross-service API dependency maps from OpenAPI/Swagger files")
  .version("0.1.0")
  .argument("<paths...>", "directories to scan for OpenAPI specs")
  .option("-o, --output <file>", "output file path", "crossctx-output.json")
  .option("-q, --quiet", "suppress terminal output", false)
  .action(async (paths: string[], options: { output: string; quiet: boolean }) => {
    try {
      const resolvedPaths = paths.map((p) => path.resolve(p));

      // Step 1: Scan for OpenAPI files
      if (!options.quiet) {
        console.log("\n  Scanning for OpenAPI/Swagger specs...");
      }

      const scanResults = await scanForSpecs(resolvedPaths);

      if (scanResults.length === 0) {
        console.log("\n  No OpenAPI/Swagger files found in the specified paths.");
        console.log("  Looked for: openapi.{json,yaml,yml}, swagger.{json,yaml,yml}");
        console.log("  and similar patterns.\n");
        process.exit(0);
      }

      if (!options.quiet) {
        console.log(`  Found ${scanResults.length} spec file(s)`);
      }

      // Step 2: Parse each spec
      if (!options.quiet) {
        console.log("  Parsing specs...");
      }

      const parsedSpecs: ParsedSpec[] = [];
      const errors: { file: string; error: string }[] = [];

      for (const scan of scanResults) {
        try {
          const parsed = await parseSpec(scan.filePath);
          parsedSpecs.push(parsed);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ file: scan.filePath, error: message });
        }
      }

      if (errors.length > 0 && !options.quiet) {
        console.log(`\n  Warnings: ${errors.length} file(s) could not be parsed:`);
        for (const e of errors) {
          console.log(`    - ${e.file}: ${e.error}`);
        }
      }

      if (parsedSpecs.length === 0) {
        console.log("\n  No valid OpenAPI specs could be parsed.\n");
        process.exit(1);
      }

      // Step 3: Analyze dependencies
      if (!options.quiet) {
        console.log("  Analyzing dependencies...");
      }

      const dependencies = analyzeDependencies(parsedSpecs);

      // Step 4: Build and save output
      const output = buildOutput(parsedSpecs, dependencies, paths, scanResults.length);

      const outputPath = path.resolve(options.output);
      await saveOutput(output, outputPath);

      // Print summary
      if (!options.quiet) {
        const summary = printSummary(output);
        console.log(summary);
        console.log(`  Output saved to: ${outputPath}\n`);
      }
    } catch (err) {
      console.error("\n  Error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
