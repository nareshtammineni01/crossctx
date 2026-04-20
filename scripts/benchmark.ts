#!/usr/bin/env tsx
/**
 * CrossCtx Performance Benchmark
 *
 * Measures scan time and memory usage against the examples directory and
 * optionally against a larger synthetic corpus.
 *
 * Usage:
 *   npx tsx scripts/benchmark.ts               # run examples corpus
 *   npx tsx scripts/benchmark.ts --large        # generate + run large corpus
 *   npx tsx scripts/benchmark.ts --json         # output results as JSON
 *
 * The --large flag generates a synthetic corpus of N services with M files
 * each (configurable via --services and --files-per-service), runs a scan,
 * and reports wall-clock time and peak RSS memory.
 */

import path from "path";
import { readdir, writeFile, mkdir, rm } from "fs/promises";
import { performance } from "perf_hooks";
import { execSync } from "child_process";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const largeCorp = args.includes("--large");
const servicesCount = parseInt(args[args.indexOf("--services") + 1] ?? "50") || 50;
const filesPerService = parseInt(args[args.indexOf("--files-per-service") + 1] ?? "16") || 16;

const EXAMPLES_DIR = path.resolve(import.meta.dirname ?? process.cwd(), "../examples");
const SYNTHETIC_DIR = path.resolve(import.meta.dirname ?? process.cwd(), "../.benchmark-corpus");
const CLI = path.resolve(import.meta.dirname ?? process.cwd(), "../dist/bin/cli.js");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BenchmarkResult {
  name: string;
  services: number;
  files: number;
  wallMs: number;
  peakRssKb: number;
  msPerService: number;
  msPerFile: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic corpus generation
// ─────────────────────────────────────────────────────────────────────────────

const CONTROLLER_TEMPLATE = (svcIdx: number, fileIdx: number) => `
import { Injectable, Controller, Get, Post, Delete, Param, Body } from "@nestjs/common";
import axios from "axios";

@Controller("/api/v1/resource-${svcIdx}-${fileIdx}")
export class Resource${svcIdx}x${fileIdx}Controller {
  private readonly depUrl = process.env.SERVICE_${(svcIdx + 1) % servicesCount}_URL;

  @Get()
  async list() {
    const res = await axios.get(\`\${this.depUrl}/api/v1/resource\`);
    return res.data;
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    return { id, resource: "data-${svcIdx}-${fileIdx}" };
  }

  @Post()
  async create(@Body() dto: CreateDto) {
    return { ...dto, created: true };
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    return { id, deleted: true };
  }
}

class CreateDto {
  name!: string;
  value!: number;
}
`.trim();

async function generateCorpus(): Promise<string[]> {
  await rm(SYNTHETIC_DIR, { recursive: true, force: true });
  await mkdir(SYNTHETIC_DIR, { recursive: true });

  const servicePaths: string[] = [];

  for (let s = 0; s < servicesCount; s++) {
    const svcDir = path.join(SYNTHETIC_DIR, `service-${s.toString().padStart(3, "0")}`);
    await mkdir(svcDir, { recursive: true });
    await mkdir(path.join(svcDir, "src"), { recursive: true });

    // package.json
    await writeFile(
      path.join(svcDir, "package.json"),
      JSON.stringify({ name: `service-${s}`, version: "1.0.0" }),
    );

    // Controller files
    for (let f = 0; f < filesPerService; f++) {
      await writeFile(
        path.join(svcDir, "src", `resource-${f}.controller.ts`),
        CONTROLLER_TEMPLATE(s, f),
      );
    }

    servicePaths.push(svcDir);
  }

  return servicePaths;
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark runner
// ─────────────────────────────────────────────────────────────────────────────

async function runBenchmark(name: string, paths: string[]): Promise<BenchmarkResult> {
  // Count total files
  let totalFiles = 0;
  for (const p of paths) {
    try {
      const entries = await readdir(p, { recursive: true });
      totalFiles += entries.length;
    } catch {
      /* skip */
    }
  }

  const startMs = performance.now();
  const startRss = process.memoryUsage().rss;

  try {
    execSync(
      `node ${CLI} ${paths.join(" ")} --quiet --output /dev/null`,
      { stdio: "ignore", timeout: 300_000 },
    );
  } catch (err) {
    // Non-zero exit is OK (e.g. no specs found) — just measure timing
    void err;
  }

  const wallMs = Math.round(performance.now() - startMs);
  const peakRssKb = Math.round((process.memoryUsage().rss - startRss) / 1024);

  return {
    name,
    services: paths.length,
    files: totalFiles,
    wallMs,
    peakRssKb: Math.max(0, peakRssKb), // can be negative if GC ran
    msPerService: Math.round(wallMs / Math.max(1, paths.length)),
    msPerFile: Math.round(wallMs / Math.max(1, totalFiles)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Print helpers
// ─────────────────────────────────────────────────────────────────────────────

function printTable(results: BenchmarkResult[]): void {
  console.log("\n  CrossCtx Performance Benchmarks");
  console.log("  ════════════════════════════════════════════════════════════");
  console.log(
    `  ${"Corpus".padEnd(30)} ${"Services".padStart(8)} ${"Files".padStart(8)} ${"Wall (ms)".padStart(10)} ${"ms/svc".padStart(8)} ${"ms/file".padStart(8)}`,
  );
  console.log("  ────────────────────────────────────────────────────────────");

  for (const r of results) {
    console.log(
      `  ${r.name.padEnd(30)} ${String(r.services).padStart(8)} ${String(r.files).padStart(8)} ${String(r.wallMs).padStart(10)} ${String(r.msPerService).padStart(8)} ${String(r.msPerFile).padStart(8)}`,
    );
  }

  console.log("  ════════════════════════════════════════════════════════════\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const results: BenchmarkResult[] = [];

  // Always benchmark the examples directory
  const exampleServices = (await readdir(EXAMPLES_DIR)).map((d) =>
    path.join(EXAMPLES_DIR, d),
  );
  results.push(await runBenchmark("examples (mixed langs)", exampleServices));

  // Optionally benchmark synthetic large corpus
  if (largeCorp) {
    process.stdout.write(
      `\n  Generating synthetic corpus (${servicesCount} services × ${filesPerService} files)...\n`,
    );
    const syntheticPaths = await generateCorpus();
    results.push(
      await runBenchmark(
        `synthetic (${servicesCount} svcs × ${filesPerService} files)`,
        syntheticPaths,
      ),
    );
    // Cleanup
    await rm(SYNTHETIC_DIR, { recursive: true, force: true });
  }

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printTable(results);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
