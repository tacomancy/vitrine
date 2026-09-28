import { defineConfig } from "vitest/config";

// The shell's tests cover its pure choices — launch-time, what the folder
// chooser asks for, and where the window may navigate; anything that needs a running Electron is verified through
// Scripts/run-hidden.mjs.
export default defineConfig({
  test: {
    name: "shell",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
