import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Local dates in the suite are asserted as literals; pin the zone they are in.
process.env.TZ = "UTC";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "renderer",
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
  },
});
