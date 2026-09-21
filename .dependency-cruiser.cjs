// @ts-check
// Package boundaries, checked by `pnpm lint:boundaries` (dependency-cruiser).
//
// The layering rules ADR 0008 decision 7 asks for: `packages/markdown` is
// Obsidian's grammar as pure TypeScript, imported by core and renderer alike,
// so it may import neither of them and no Node built-in. The entry-point
// rules `setup-ts-deep-modules` ships (root files public, subfolders private)
// are not adopted: every package here is a flat `src/` reached through
// `src/index.ts`, and restructuring them is a separate decision.
//
// tooling/dependency-cruiser/boundaries.test.js proves each rule fires.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "markdown-imports-no-package",
      comment:
        "packages/markdown is shared by core and renderer and must not depend on either (ADR 0008 decision 7).",
      severity: "error",
      from: { path: "^packages/markdown/" },
      // By resolved path when the workspace link exists, by bare specifier
      // when it does not (an unresolvable import is reported as itself).
      to: {
        path: "^packages/(core|renderer|shell)/|^(core|renderer|shell)(/|$)",
      },
    },
    {
      name: "markdown-no-node-builtins",
      comment:
        "packages/markdown runs in the renderer too: no Node built-in, `node:` prefixed or not (ADR 0008 decision 7).",
      severity: "error",
      from: { path: "^packages/markdown/src/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "no-circular",
      comment: "No dependency cycles between modules.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "node_modules|/dist/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
