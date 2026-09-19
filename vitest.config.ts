import { defineConfig } from "vitest/config";

// One command runs every package's suite: `pnpm test` at the root.
export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "packages/renderer",
      {
        test: {
          name: "tooling",
          environment: "node",
          include: ["tooling/**/*.test.js"],
        },
      },
    ],
  },
});
