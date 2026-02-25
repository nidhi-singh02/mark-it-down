import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    target: "node18",
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: true,
  },
  {
    entry: { "bin/markitdown": "bin/markitdown.ts" },
    format: ["esm"],
    target: "node18",
    splitting: false,
    sourcemap: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
