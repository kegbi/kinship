import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The vendored shadcn/ui components import through the `@/` alias that
  // `apps/web/tsconfig.json` and `apps/web/components.json` declare.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" },
  },
  test: {
    include: [
      "apps/web/src/**/*.test.ts",
      "apps/web/src/**/*.test.tsx",
    ],
    coverage: {
      provider: "v8",
      include: [
        "apps/web/src/lib/*.ts",
        "apps/web/src/islands/**/*.ts",
        "apps/web/src/islands/**/*.tsx",
        "apps/web/src/components/ui/*.ts",
        "apps/web/src/components/ui/*.tsx",
      ],
      exclude: [
        "apps/web/src/**/*.test.ts",
        "apps/web/src/**/*.test.tsx",
      ],
      reporter: ["text"],
      reportsDirectory: ".coverage/web",
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        // The island kit every migrated surface builds on carries a higher
        // obligation than the repository floor (GAP-026).
        "apps/web/src/islands/core/**": {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
      },
    },
  },
});
