import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Local dates in the suite are asserted as literals; pin the zone they are in.
process.env.TZ = "UTC";

export default defineConfig({
  plugins: [react()],
  // As the core's config does: the bundled renderer imports `markdown` from
  // its `dist`, and the suite runs against the package's source so `pnpm
  // test` needs no build step (CI runs none).
  resolve: {
    alias: {
      markdown: fileURLToPath(
        new URL("../markdown/src/index.ts", import.meta.url)
      ),
    },
  },
  test: {
    name: "renderer",
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
  },
});
