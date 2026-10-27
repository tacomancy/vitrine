#!/usr/bin/env node
// The Queue's layout check (#871, spec #867, beat #853): one hidden launch on
// beat 14's scratch vault (nine rail entries: eight Scouts and one file that does not parse,
// the triage history, two Retroactive batches), the arXiv endpoint on beat 6b's stand-in — never the real arXiv.
// jsdom cannot evaluate a container query or lay out text, so this is where the
// abstract's line length and the order space is given up are measured. The
// drive screenshots 1280px with the sidebar open and the rail collapsed, then
// narrows the window and prints what each pane was given. Needs both packages
// built.
//
//   node Scripts/queue-layout-demo.mjs <out-folder>
//
// KEEP=1 leaves the scratch vault behind.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStandin } from "./queue-demo/standin.mjs";
import { revampVault } from "./scout-queue-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-queue-layout-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");

const standin = await startStandin();
await revampVault(
  join(repo, "packages/core/fixtures/obsidian-vault"),
  vault,
  join(repo, "packages/core")
);

// Another session's app may hold run-hidden's default debug port.
const port = await new Promise((done) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => done(port));
  });
});

try {
  await new Promise((done, fail) => {
    const child = spawn(
      "node",
      [
        join(here, "run-hidden.mjs"),
        "--snapshot",
        join(scratch, "layout.png"),
        "--vault",
        vault,
        "--support",
        support,
        "--port",
        String(port),
        "--drive",
        join(here, "queue-layout-demo/drives.mjs"),
        "--after",
        "90000",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DEMO_OUT: out,
          VITRINE_ARXIV_ENDPOINT: standin.endpoint,
          VITRINE_CREDENTIALS: "memory",
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`layout: exit ${code}`))
    );
  });
  console.log(`\nPictures and measurements in ${out}`);
} finally {
  standin.close();
  if (process.env.KEEP) console.log(`kept: ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
}
process.exit(0);
