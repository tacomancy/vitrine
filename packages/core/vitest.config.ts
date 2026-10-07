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
  },
});
