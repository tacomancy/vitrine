import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The core imports `markdown` from its `dist` at runtime; tests run against
  // the package's source so `pnpm test` needs no build step (CI runs none).
  resolve: {
    alias: {
      markdown: fileURLToPath(
        new URL("../markdown/src/index.ts", import.meta.url)
      ),
    },
  },
  test: {
    name: "core",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // A returned PDF is read after the settle window and the run window (#553),
    // so the harness's wait bound (`NEXT_TIMEOUT_MS`, 6 s) is past Vitest's 5 s
    // default. A test timeout above it keeps that bound's diagnostic the one a
    // lost event gets, rather than a bare `Test timed out`.
    testTimeout: 15_000,
  },
});
