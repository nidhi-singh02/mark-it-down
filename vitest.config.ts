import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ── Coverage ──────────────────────────────────────────────────────
    // Run with: npx vitest run --coverage
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/turndown-plugin-gfm.d.ts"],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
