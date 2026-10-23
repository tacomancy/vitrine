#!/usr/bin/env node
// Beat 13's closing record (#793, spec #782): a hidden launch per theme over a
// scratch copy of the fixture vault plus the Home demo's fleet of Scouts, and
// one on no vault for First run; a PNG of every surface in each theme, named
// for the prototype it is read beside (docs/reference/prototypes/NN-*.png).
// The arXiv and OpenAlex endpoints are dead ports, so nothing reaches the
// network. Needs both packages built.
//
//   node Scripts/ui-record-demo.mjs <out-folder>
//
// KEEP=1 leaves the scratch vault behind.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homeVault } from "./home-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-ui-record-"));

const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

const launch = async (theme, step) => {
  const dir = join(scratch, `${step}-${theme}`);
  const args = [];
  if (step === "surfaces") {
    const vault = join(dir, "vault");
    await homeVault(
      join(repo, "packages/core/fixtures/obsidian-vault"),
      vault,
      join(repo, "packages/core"),
      "full"
    );
    args.push("--vault", vault);
  }
  const port = await freePort();
  return new Promise((done, fail) => {
    const child = spawn(
      "node",
      [
        join(here, "run-hidden.mjs"),
        "--snapshot",
        join(dir, "unused.png"),
        "--support",
        join(dir, "support"),
        "--port",
        String(port),
        "--drive",
        join(here, "ui-record-demo/drive.mjs"),
        "--after",
        "90000",
        ...args,
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          UI_OUT: out,
          UI_THEME: theme,
          UI_STEP: step,
          VITRINE_ARXIV_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_OPENALEX_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_CREDENTIALS: "memory",
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${step} ${theme}: exit ${code}`))
    );
  });
};

try {
  for (const theme of ["dark", "light"]) {
    await launch(theme, "surfaces");
    await launch(theme, "first-run");
  }
  console.log(`scratch: ${scratch}`);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
