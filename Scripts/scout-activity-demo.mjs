#!/usr/bin/env node
// The Scout Activity beat's closing demo (#523): hidden launches on one
// scratch vault holding a dozen Scouts of mixed quality, one PNG each
// (docs/agents/run.md), against a local stand-in for arXiv and for the lab's
// page — never the real arXiv. No key is stored and the credential store is
// held in memory, so nothing reaches a model or the Keychain either. Needs
// both packages built.
//
//   node Scripts/scout-activity-demo.mjs <out-folder>
//
// 1. The fleet in need-order: a fault, then Scouts not looking, then accept
//    rate ascending, *nothing triaged* last; no row painted a judgement.
// 2. The poor Scout opened: its weekly line and headline rate.
// 3. Its Query fixed from the row — the dry run says what changes (3a), the
//    save runs the Scout at once (3b).
// 4. A cadence changed from the three-option menu.
// 5. A Scout dropped (5a); after a relaunch it is off the table with its
//    Proposals still in Review (5b); restored from the dropped line (5c).
// 6. A coverage gap read through to *brief a scout*.
//
// Each drive throws when the page does not show what its step claims, so a
// green run is the evidence.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStandin } from "./scout-activity-demo/standin.mjs";
import { expect } from "./scout-activity-demo/helpers.mjs";
import { fleetVault } from "./scout-activity-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-scout-activity-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");

const standin = await startStandin();
await fleetVault(
  join(repo, "packages/core/fixtures/obsidian-vault"),
  vault,
  join(repo, "packages/core"),
  standin.origin
);

// run-hidden's default debug port is whoever got there first, and another
// session's app may hold it: a drive would then talk to the wrong window.
const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

// Async, not execFileSync: the stand-in lives in this process and a blocked
// event loop would leave the app's requests unanswered.
const launch = async (png, drive, after = 30000) => {
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
        join(here, "scout-activity-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          VITRINE_ARXIV_ENDPOINT: standin.endpoint,
          VITRINE_CREDENTIALS: "memory",
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
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
const staleStack = () =>
  queue(
    `SELECT p.state, COUNT(*) AS n FROM proposals p JOIN appearances a ON a.proposal_id = p.id
     WHERE a.scout_id = 'stale-topic' AND p.state IN ('pending', 'deferred') GROUP BY p.state ORDER BY p.state`
  );
const verdicts = () =>
  queue(
    `SELECT COUNT(*) AS n FROM triage t JOIN appearances a ON a.proposal_id = t.proposal_id
     WHERE a.scout_id = 'stale-topic' AND t.at > datetime('now', '-1 hour')`
  )[0].n;

try {
  await launch("1-fleet.png", "table.mjs");
  await launch("2-poor-scout.png", "poor.mjs");
  await launch("3a-try-edited-query.png", "fix-try.mjs");
  expect(
    standin.requests.some((q) => q.includes("cat:q-bio.NC")),
    "the dry run asked the stand-in, not the real arXiv"
  );
  await launch("3b-saved-and-ran.png", "fix-save.mjs");
  await launch("4-cadence.png", "cadence.mjs");

  const before = JSON.stringify(staleStack());
  await launch("5a-dropped-in-place.png", "drop.mjs");
  expect(
    readFileSync(
      join(vault, ".vitrine/scouts/stale-topic.yaml"),
      "utf8"
    ).includes("dropped:"),
    "the Scout's file records the retirement"
  );
  expect(JSON.stringify(staleStack()) === before, "a drop moved a Proposal");
  expect(verdicts() === 0, "a drop wrote a verdict into the triage log");
  await launch("5b-dropped-stays-in-review.png", "dropped-stays.mjs");
  await launch("5c-restored.png", "restore.mjs");
  expect(
    !readFileSync(
      join(vault, ".vitrine/scouts/stale-topic.yaml"),
      "utf8"
    ).includes("dropped:"),
    "a restore leaves the Scout retired"
  );
  expect(JSON.stringify(staleStack()) === before, "a restore moved a Proposal");

  await launch("6-brief-a-scout.png", "gap.mjs");
  console.log(`stand-in saw ${standin.requests.length} requests`);
  console.log(`scratch vault: ${vault}`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
