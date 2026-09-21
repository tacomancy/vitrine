import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cruise } from "dependency-cruiser";
import { afterEach, describe, expect, it } from "vitest";

import config from "../../.dependency-cruiser.cjs";

// Each boundary rule in .dependency-cruiser.cjs, proved to fire: a config
// that passes on a violation is worthless. Cruised in a temp workspace that
// mirrors the repo's shape — packages/<name>/src, workspace links under
// node_modules — so nothing is written into the real tree.
let root;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function workspace(files) {
  // realpath: on macOS the temp dir is a symlink, and a resolved path that
  // escapes the base directory would not match any rule.
  root = mkdtempSync(join(realpathSync(tmpdir()), "vitrine-boundaries-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  // pnpm's workspace links: packages/markdown/node_modules/core → packages/core.
  mkdirSync(join(root, "packages/markdown/node_modules"), { recursive: true });
  symlinkSync(
    join(root, "packages/core"),
    join(root, "packages/markdown/node_modules/core")
  );
  return root;
}

async function violations(base) {
  const result = await cruise(["packages"], {
    ...config.options,
    baseDir: base,
    ruleSet: config,
    validate: true,
  });
  return result.output.summary.violations.map(
    (v) => `${v.rule.name}: ${v.from} → ${v.to}`
  );
}

const clean = {
  // The real core's package.json shape: `types` resolves to the source.
  "packages/core/package.json": JSON.stringify({
    name: "core",
    exports: { ".": { types: "./src/index.ts", default: "./dist/index.js" } },
  }),
  "packages/core/src/index.ts":
    'import { parseTag } from "markdown";\nexport const app = parseTag;\n',
  "packages/markdown/src/index.ts": 'export { parseTag } from "./tag.js";\n',
  "packages/markdown/src/tag.ts": "export const parseTag = (t: string) => t;\n",
};

describe("package boundaries", () => {
  it("pass on the clean shape", async () => {
    expect(await violations(workspace(clean))).toEqual([]);
  });

  it("markdown-imports-no-package: markdown importing core through the workspace link", async () => {
    const base = workspace({
      ...clean,
      "packages/markdown/src/tag.ts":
        'import { app } from "core";\nexport const parseTag = app;\n',
    });
    expect(await violations(base)).toEqual([
      "markdown-imports-no-package: packages/markdown/src/tag.ts → packages/core/src/index.ts",
    ]);
  });

  it("markdown-imports-no-package: by relative path, and renderer too", async () => {
    const base = workspace({
      ...clean,
      "packages/renderer/src/App.tsx": "export const App = 1;\n",
      "packages/markdown/src/tag.ts":
        'import { App } from "../../renderer/src/App.js";\nexport const parseTag = App;\n',
    });
    expect(await violations(base)).toEqual([
      "markdown-imports-no-package: packages/markdown/src/tag.ts → packages/renderer/src/App.tsx",
    ]);
  });

  it("markdown-imports-no-package: an unresolvable bare `renderer` is still caught", async () => {
    const base = workspace({
      ...clean,
      "packages/markdown/src/tag.ts":
        'import { App } from "renderer";\nexport const parseTag = App;\n',
    });
    expect(await violations(base)).toEqual([
      "markdown-imports-no-package: packages/markdown/src/tag.ts → renderer",
    ]);
  });

  it("markdown-no-node-builtins: `node:fs` and bare `path` alike", async () => {
    const base = workspace({
      ...clean,
      "packages/markdown/src/tag.ts":
        'import { readFileSync } from "node:fs";\nimport { join } from "path";\nexport const parseTag = [readFileSync, join];\n',
    });
    expect(await violations(base)).toEqual([
      "markdown-no-node-builtins: packages/markdown/src/tag.ts → fs",
      "markdown-no-node-builtins: packages/markdown/src/tag.ts → path",
    ]);
  });

  it("no-circular", async () => {
    const base = workspace({
      ...clean,
      "packages/markdown/src/index.ts":
        'export { parseTag } from "./tag.js";\nexport const a = 1;\n',
      "packages/markdown/src/tag.ts":
        'import { a } from "./index.js";\nexport const parseTag = a;\n',
    });
    expect((await violations(base)).map((v) => v.split(":")[0])).toContain(
      "no-circular"
    );
  });
});
