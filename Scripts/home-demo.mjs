#!/usr/bin/env node
// Beat 12's closing demo (#737, spec #728): two hidden launches, each on its
// own scratch copy of the fixture vault plus a small fleet of Scouts
// (Scripts/home-demo/vault.mjs, seeded by SQL), one PNG each
// (docs/agents/run.md). The arXiv endpoint is a dead port, so no Scout
// reaches the network. Needs both packages built.
//
//   node Scripts/home-demo.mjs <out-folder>
//
// 1. Quiet: every Scout looking, nothing pending, nothing changed. A claim
//    with its Warrant in each place, no interrupt.
// 2. Full: a Scout failing (the interrupt, with run now and pause), a Review
//    with depth, changes by Tag, three Questions back from the notebook.
//
// Each drive throws when Home is not what its step claims, and logs every
// line of the page that carries a digit (`NUMBER:`), so the page is read for
// a figure that leads nowhere. KEEP=1 leaves the scratch vaults behind.
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
const scratch = mkdtempSync(join(tmpdir(), "vitrine-home-demo-"));

// Another session's app may hold run-hidden's default debug port.
const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

const launch = async (png, step) => {
  const vault = join(scratch, step, "vault");
  await homeVault(
    join(repo, "packages/core/fixtures/obsidian-vault"),
    vault,
    join(repo, "packages/core"),
    step
  );
  const port = await freePort();
  return new Promise((done, fail) => {
    const child = spawn(
      "node",
      [
        join(here, "run-hidden.mjs"),
        "--snapshot",
        join(out, png),
        "--vault",
        vault,
        "--support",
        join(scratch, step, "support"),
        "--port",
        String(port),
        "--drive",
        join(here, "home-demo/drives.mjs"),
        "--after",
        "40000",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DEMO_STEP: step,
          VITRINE_ARXIV_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_OPENALEX_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_CREDENTIALS: "memory",
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
    );
  });
};

try {
  await launch("1-quiet.png", "quiet");
  await launch("2-full.png", "full");
  console.log(`scratch: ${scratch}`);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
