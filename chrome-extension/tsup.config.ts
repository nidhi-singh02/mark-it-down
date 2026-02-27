import { defineConfig } from "tsup";
import { renameSync } from "node:fs";

export default defineConfig({
  entry: { popup: "src/popup.ts" },
  format: ["iife"],
  target: "es2020",
  platform: "browser",
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
  noExternal: [/.*/],
  onSuccess: async () => {
    // tsup names IIFE files .global.js — rename to .js for the extension
    renameSync("dist/popup.global.js", "dist/popup.js");
  },
});
