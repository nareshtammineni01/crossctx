import { readFile, access } from "fs/promises";
import path from "path";
import type { DetectedLanguage, SupportedLanguage, SupportedFramework } from "../types/index.js";

/**
 * Language Detector
 *
 * Detects language + framework for a given project folder by reading marker files.
 * Priority order (highest confidence first):
 *   1. package.json with @nestjs/core → TypeScript/NestJS
 *   2. package.json with express → TypeScript/Express
 *   3. package.json (any) → TypeScript/unknown
 *   4. pom.xml with spring-boot → Java/Spring Boot
 *   5. pom.xml → Java/unknown
 *   6. .csproj → C#/ASP.NET
 *   7. requirements.txt / pyproject.toml with fastapi → Python/FastAPI
 *   8. requirements.txt with django → Python/Django
 *   9. requirements.txt with flask → Python/Flask
 *  10. requirements.txt → Python/unknown
 */
export async function detectLanguage(projectPath: string): Promise<DetectedLanguage> {
  const checks: Array<() => Promise<DetectedLanguage | null>> = [
    () => checkNestJS(projectPath),
    () => checkExpress(projectPath),
    () => checkPackageJson(projectPath),
    () => checkSpringBoot(projectPath),
    () => checkJava(projectPath),
    () => checkCSharp(projectPath),
    () => checkPython(projectPath),
  ];

  for (const check of checks) {
    const result = await check();
    if (result) return result;
  }

  return {
    language: "unknown",
    framework: "unknown",
    detectedFrom: projectPath,
    confidence: 0,
  };
}

// ─── TypeScript / Node ───────────────────────────────────────────────────────

async function checkNestJS(projectPath: string): Promise<DetectedLanguage | null> {
  const pkg = await readJsonFile(path.join(projectPath, "package.json"));
  if (!pkg) return null;

  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  if ("@nestjs/core" in allDeps || "@nestjs/common" in allDeps) {
    return {
      language: "typescript",
      framework: "nestjs",
      detectedFrom: path.join(projectPath, "package.json"),
      confidence: 0.98,
    };
  }
  return null;
}

async function checkExpress(projectPath: string): Promise<DetectedLanguage | null> {
  const pkg = await readJsonFile(path.join(projectPath, "package.json"));
  if (!pkg) return null;

  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  if ("express" in allDeps) {
    // Check for TypeScript
    const isTS = "typescript" in allDeps || (await fileExists(path.join(projectPath, "tsconfig.json")));
    return {
      language: isTS ? "typescript" : "typescript", // treat JS/TS the same for parsing
      framework: "express",
      detectedFrom: path.join(projectPath, "package.json"),
      confidence: 0.92,
    };
  }
  return null;
}

async function checkPackageJson(projectPath: string): Promise<DetectedLanguage | null> {
  const pkg = await readJsonFile(path.join(projectPath, "package.json"));
  if (!pkg) return null;

  return {
    language: "typescript",
    framework: "unknown",
    detectedFrom: path.join(projectPath, "package.json"),
    confidence: 0.7,
  };
}

// ─── Java / Spring ───────────────────────────────────────────────────────────

async function checkSpringBoot(projectPath: string): Promise<DetectedLanguage | null> {
  // Check pom.xml for spring-boot
  const pomPath = path.join(projectPath, "pom.xml");
  if (await fileExists(pomPath)) {
    const content = await safeReadFile(pomPath);
    if (content?.includes("spring-boot")) {
      return {
        language: "java",
        framework: "spring-boot",
        detectedFrom: pomPath,
        confidence: 0.97,
      };
    }
  }

  // Check build.gradle for spring-boot
  const gradlePath = path.join(projectPath, "build.gradle");
  const gradleKtsPath = path.join(projectPath, "build.gradle.kts");
  for (const gPath of [gradlePath, gradleKtsPath]) {
    if (await fileExists(gPath)) {
      const content = await safeReadFile(gPath);
      if (content?.includes("spring-boot")) {
        return {
          language: "java",
          framework: "spring-boot",
          detectedFrom: gPath,
          confidence: 0.95,
        };
      }
    }
  }

  return null;
}

async function checkJava(projectPath: string): Promise<DetectedLanguage | null> {
  const pomPath = path.join(projectPath, "pom.xml");
  if (await fileExists(pomPath)) {
    return {
      language: "java",
      framework: "unknown",
      detectedFrom: pomPath,
      confidence: 0.8,
    };
  }

  // Check for .java files
  if (await fileExists(path.join(projectPath, "src", "main", "java"))) {
    return {
      language: "java",
      framework: "unknown",
      detectedFrom: path.join(projectPath, "src", "main", "java"),
      confidence: 0.75,
    };
  }

  return null;
}

// ─── C# / ASP.NET ────────────────────────────────────────────────────────────

async function checkCSharp(projectPath: string): Promise<DetectedLanguage | null> {
  // Look for any .csproj file
  const csprojFile = await findFileByExtension(projectPath, ".csproj");
  if (csprojFile) {
    const content = await safeReadFile(csprojFile);
    const framework = content?.includes("Microsoft.AspNetCore") ? "aspnet" : "aspnet";
    return {
      language: "csharp",
      framework,
      detectedFrom: csprojFile,
      confidence: 0.97,
    };
  }

  // Check for .sln
  const slnFile = await findFileByExtension(projectPath, ".sln");
  if (slnFile) {
    return {
      language: "csharp",
      framework: "aspnet",
      detectedFrom: slnFile,
      confidence: 0.85,
    };
  }

  return null;
}

// ─── Python ──────────────────────────────────────────────────────────────────

async function checkPython(projectPath: string): Promise<DetectedLanguage | null> {
  const candidateFiles = [
    path.join(projectPath, "requirements.txt"),
    path.join(projectPath, "pyproject.toml"),
    path.join(projectPath, "setup.py"),
    path.join(projectPath, "Pipfile"),
  ];

  for (const filePath of candidateFiles) {
    if (!(await fileExists(filePath))) continue;

    const content = (await safeReadFile(filePath)) ?? "";
    let framework: SupportedFramework = "unknown";

    if (/fastapi/i.test(content)) framework = "fastapi";
    else if (/django/i.test(content)) framework = "django";
    else if (/flask/i.test(content)) framework = "flask";

    return {
      language: "python",
      framework,
      detectedFrom: filePath,
      confidence: framework === "unknown" ? 0.7 : 0.95,
    };
  }

  // Last resort: look for .py files
  if (await fileExists(path.join(projectPath, "main.py")) ||
      await fileExists(path.join(projectPath, "app.py"))) {
    return {
      language: "python",
      framework: "unknown",
      detectedFrom: projectPath,
      confidence: 0.6,
    };
  }

  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Find a file with a given extension directly in projectPath (not recursive).
 * Used for .csproj, .sln detection.
 */
async function findFileByExtension(dir: string, ext: string): Promise<string | null> {
  try {
    const { readdir } = await import("fs/promises");
    const entries = await readdir(dir);
    const match = entries.find((e) => e.endsWith(ext));
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

/**
 * Derive a service name from the project folder path.
 * Falls back to basename of the folder.
 */
export function deriveServiceName(projectPath: string, pkg?: Record<string, unknown>): string {
  if (pkg?.name && typeof pkg.name === "string") {
    return slugify(pkg.name);
  }
  return slugify(path.basename(projectPath));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
