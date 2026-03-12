import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["src/__tests__/helpers/global-setup.ts"],
    fileParallelism: false,
    pool: "threads",
    poolOptions: {
      threads: {
        maxThreads: 1,
        minThreads: 1,
      },
    },
    teardownTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        // Server bootstrap & infrastructure
        "src/index.ts",
        "src/startup-banner.ts",
        "src/config.ts",
        "src/types/**",
        // Realtime & adapters (external services)
        "src/realtime/**",
        "src/adapters/**",
        // Auth integration (external provider)
        "src/auth/**",
        // Storage providers (external services)
        "src/storage/**",
        // Secret providers (external dotenv/vault integration)
        "src/secrets/**",
        // Logging middleware (infrastructure)
        "src/middleware/logger.ts",
        // Route registration, LLM proxy, & infrastructure routes
        "src/routes/index.ts",
        "src/routes/llms.ts",
        "src/routes/health.ts",
        "src/routes/assets.ts",
        // Express app setup (infrastructure)
        "src/app.ts",
        // Adapter-heavy services (need dedicated wish)
        "src/services/heartbeat.ts",
        "src/services/workspace-runtime.ts",
        "src/services/company-portability.ts",
        "src/services/run-log-store.ts",
        "src/services/assets.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "../coverage/server",
      // Current: ~55% statements. Three mega route files (access 2646 lines,
      // agents 1496, issues 1208) at 30-41% prevent hitting 80% globally.
      // Thresholds set as regression guard; raise as coverage grows.
      thresholds: {
        statements: 50,
        branches: 60,
        functions: 60,
        lines: 50,
      },
    },
  },
});
