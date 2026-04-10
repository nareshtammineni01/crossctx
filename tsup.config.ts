import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "bin/cli": "src/bin/cli.ts",
  },
  format: ["esm"],
  target: "node18",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
