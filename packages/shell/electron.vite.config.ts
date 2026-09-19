import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

// One config drives all three targets. The renderer's source lives in its own
// package (ADR 0005); this file only points the build at it.
const renderer = resolve(__dirname, "../renderer");

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: renderer,
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      rollupOptions: { input: resolve(renderer, "index.html") },
    },
    plugins: [react()],
  },
});
