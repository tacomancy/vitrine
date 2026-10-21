#!/usr/bin/env node
// Beat 11b's closing demo (#746, spec #740): the Graph tab on a hub file, two
// hidden launches, one PNG each (docs/agents/run.md). Needs both packages built.
//
//   node Scripts/graph-demo.mjs <out-folder>
//
// 1. Both Rings, the *+10 more* overflow and the Not drawn list.
// 2. The same file with the notes chip off: dots go, the rest stays put.
//
// Each drive throws when the page is not what its step claims. KEEP=1 leaves
// the scratch vault behind.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { graphDemoVault } from "./graph-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-graph-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
graphDemoVault(join(repo, "packages/core/fixtures/obsidian-vault"), vault);

// Another session's app may hold run-hidden's default debug port.
const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

const launch = async (png, step) => {
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
        support,
        "--port",
        String(port),
        "--drive",
        join(here, "graph-demo", "drive.mjs"),
        "--after",
        "15000",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          GRAPH_DEMO_STEP: step,
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
  await launch("1-graph.png", "all");
  await launch("2-graph-filtered.png", "filtered");
  console.log(`scratch vault: ${vault}`);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
