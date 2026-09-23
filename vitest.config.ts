import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("tests/mocks/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globalSetup: "tests/global-setup.ts",
    setupFiles: ["tests/setup-env.ts"],
    include: ["tests/**/*.test.ts"],
    // Test files share one disposable database (DATABASE_URL_TEST). Suites
    // reset the schema between tests, so files must not run in parallel.
    fileParallelism: false,
  },
});