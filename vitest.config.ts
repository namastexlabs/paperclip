import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: ["packages/db", "packages/adapters/opencode-local", "server", "ui", "cli"],
    coverage: {
      provider: "v8",
      include: [
        "server/src/**/*.ts",
        "packages/shared/src/**/*.ts",
        "packages/db/src/**/*.ts",
      ],
      exclude: [
        "**/__tests__/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/*.test.ts",
        "**/*.spec.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      // Regression guard — raise as coverage grows toward 80% target
      thresholds: {
        statements: 50,
        branches: 60,
        functions: 60,
        lines: 50,
      },
    },
  },
});
