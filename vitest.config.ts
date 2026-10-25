import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The vendored shadcn/ui components import through the `@/` alias that
  // `apps/web/tsconfig.json` and `apps/web/components.json` declare. Zod
  // resolves to the web build's JIT-less module (REL-069), as in the browser.
  resolve: {
    alias: [{
      find: "@",
      replacement: fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    }, {
      find: /^zod$/,
      replacement: fileURLToPath(
        new URL("./apps/web/src/lib/zod-jitless.ts", import.meta.url),
      ),
    }],
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
        "apps/web/src/features/**/*.ts",
        "apps/web/src/features/**/*.tsx",
        "apps/web/src/islands/**/*.ts",
        "apps/web/src/islands/**/*.tsx",
        "apps/web/src/components/ui/*.ts",
        "apps/web/src/components/ui/*.tsx",
        "apps/web/src/pages/docs/api/openapi.json.ts",
      ],
      exclude: [
        "apps/web/src/**/*.test.ts",
        "apps/web/src/**/*.test.tsx",
        // The suites' shared scaffolding (GAP-030) is not production code.
        "apps/web/src/testing/**",
        // A suite's own `.test-helper.ts` is scaffolding too, as the manifest
        // already treats it.
        "apps/web/src/**/*.test-helper.ts",
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
