#!/usr/bin/env node
// The Scout Queue revamp's closing run (#842, spec #836, beat #834): hidden
// launches on one scratch vault (beat 6b's six Scouts and triage history, two
// Retroactive batches, a Scout file that does not parse), against the beat 6b
// stand-in for arXiv — never the real arXiv. Each launch's drive takes its own
// pictures into the out folder: dark, a 640px window and light, to be read
// beside docs/reference/prototypes/14-scout-queue-revamp.png. Needs both
// packages built.
//
//   node Scripts/scout-queue-demo.mjs <out-folder>
//
// 1. Triage by keys: J/K, reject and its undo, accept (no undo), defer.
// 2. A Scout tile filters; its header holds the Cap and Run now; show all.
// 3. A Retroactive batch apart from new finds, expanded, a title selected;
//    another rejected as a run, said not counted toward Accept rate, undone.
// 4. The same run rejected again: a row per paper under the run id, and no
//    bulk id (it is not a group act).
// 5. Skim, Muted, and the Queue by Question.
// 6. A Scout file that cannot be read keeps a tile; a rules file that cannot
//    be read is named in the footer.
//
// KEEP=1 leaves the scratch vault behind.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStandin } from "./queue-demo/standin.mjs";
import { revampVault } from "./scout-queue-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-scout-queue-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");

const standin = await startStandin();
await revampVault(
  join(repo, "packages/core/fixtures/obsidian-vault"),
  vault,
  join(repo, "packages/core")
);

// Another session's app may hold run-hidden's default debug port.
const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

// Async, not execFileSync: the stand-in lives in this process.
const launch = async (step) => {
  const port = await freePort();
  return new Promise((done, fail) => {
    const child = spawn(
      "node",
      [
        join(here, "run-hidden.mjs"),
        "--snapshot",
        join(scratch, `${step}.png`),
        "--vault",
        vault,
        "--support",
        support,
        "--port",
        String(port),
        "--drive",
        join(here, "scout-queue-demo/drives.mjs"),
        "--after",
        "60000",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DEMO_STEP: step,
          DEMO_OUT: out,
          VITRINE_ARXIV_ENDPOINT: standin.endpoint,
          VITRINE_CREDENTIALS: "memory",
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${step}: exit ${code}`))
    );
  });
};

const queue = (sql) => {
  const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
};
const check = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};

try {
  await launch("triage");
  await launch("filter");
  await launch("batch");
  check(
    queue(
      "SELECT COUNT(*) AS n FROM triage WHERE action = 'reject' AND batch IS NOT NULL"
    )[0].n === 4 &&
      queue(
        "SELECT COUNT(*) AS n FROM triage WHERE action = 'undo' AND rowid > (SELECT MIN(rowid) FROM triage WHERE batch IS NOT NULL)"
      )[0].n === 4,
    "the run reject wrote four rows under the run id, and its undo four compensating rows"
  );
  await launch("batchReject");
  const rejected = queue(
    "SELECT action, batch, bulk FROM triage WHERE action = 'reject' AND batch IS NOT NULL"
  );
  check(
    rejected.length === 8 && rejected.every((r) => r.bulk === null),
    "a run reject is keyed by its run id and is not a group act"
  );
  await launch("skim");
  writeFileSync(
    join(vault, ".vitrine/mutes.yaml"),
    "keywords:\n  - listicle\n"
  );
  await launch("muted");
  await launch("question");
  writeFileSync(join(vault, ".vitrine/mutes.yaml"), "mystery:\n  - x\n");
  await launch("broken");
  console.log(`stand-in saw ${standin.requests.length} requests`);
  console.log(`scratch vault: ${vault}`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
