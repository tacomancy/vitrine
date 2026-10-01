import { defineConfig } from "vitest/config";

// The opt-in live tests (`live/`), kept out of `vitest.config.ts` so that
// `pnpm test` never reaches the network.
export default defineConfig({
  test: {
    name: "core-live",
    environment: "node",
    include: ["live/**/*.live.test.ts"],
  },
});
