import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/web/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["apps/web/src/lib/*.ts"],
      exclude: ["apps/web/src/lib/*.test.ts"],
      reporter: ["text"],
      reportsDirectory: ".coverage/web",
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
