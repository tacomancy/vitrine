#!/usr/bin/env node
// Beat 6b's closing demo (#650): hidden launches on one scratch vault holding
// five Scouts and the history the Queue's new mechanics rest on, one PNG each
// (docs/agents/run.md), against a local stand-in for arXiv — never the real
// arXiv. Needs both packages built.
//
//   node Scripts/queue-demo.mjs <out-folder>
//
// 1. Rank: the paper by an author you accepted from first, with its signal;
//    the counterweight slot's paper second, labelled; Newest one click away.
// 2. The digest: two aged papers behind one counted line, opened.
// 3. A Cap: two of four kept, *2 below your cap of 2*, and *Show them*.
// 4. A mute rule: its reach before saving, then the muted view.
// 5. A demote (5a) and a raise (5b), each saying why on the card.
// 6. Reject group (⇧R) and its undo (⌘Z) as one.
// 7. The Queue grouped by Question.
//
// The script also reads the queue itself: a Cap, a mute rule and a digest
// write no verdict, and a group act is one id on every row it touched.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStandin } from "./queue-demo/standin.mjs";
import { queueVault } from "./queue-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-queue-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");

const standin = await startStandin();
await queueVault(
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
const launch = async (png, step, after = 40000) => {
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
        join(here, "queue-demo/drives.mjs"),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DEMO_STEP: step,
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
const check = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};
const verdictRows = () => queue("SELECT COUNT(*) AS n FROM triage")[0].n;
const stateCount = (state) =>
  queue(`SELECT COUNT(*) AS n FROM proposals WHERE state = '${state}'`)[0].n;

try {
  await launch("1-rank-and-counterweight.png", "rank");
  // The first launch ran the two due Scouts against the stand-in.
  check(
    standin.requests.some((q) => q.includes("consolidation")),
    "the stand-in answered Sleep and consolidation"
  );
  check(stateCount("capped") === 2, "the Cap parked two arrivals as capped");
  const rows = verdictRows();
  check(
    queue("SELECT COUNT(*) AS n FROM triage WHERE action = 'raise'")[0].n === 1,
    "the second Scout's find raised the Skim paper, and wrote one row"
  );

  await launch("2-digest.png", "digest");
  await launch("3-cap-released.png", "cap");
  check(stateCount("capped") === 0, "show them returned every capped paper");
  check(verdictRows() === rows, "a Cap and its release wrote no triage row");

  await launch("4-mute-rule.png", "mute");
  check(
    readFileSync(join(vault, ".vitrine/mutes.yaml"), "utf8").includes(
      "listicle"
    ),
    "the rule is in the readable file"
  );
  check(verdictRows() === rows, "a mute rule wrote no triage row");

  await launch("5a-demoted.png", "demote");
  check(
    queue(
      "SELECT COUNT(*) AS n FROM triage WHERE action IN ('defer','demote')"
    )[0].n === 4,
    "the third defer wrote a defer row and a demote row"
  );
  await launch("5b-raised.png", "raise");

  await launch("6-group-reject-undone.png", "bulk");
  const bulk = queue(
    "SELECT action, bulk FROM triage WHERE bulk IS NOT NULL ORDER BY rowid"
  );
  check(
    bulk.length === 8 &&
      bulk.filter((r) => r.action === "reject").length === 4 &&
      bulk.filter((r) => r.action === "undo").length === 4 &&
      new Set(bulk.map((r) => r.bulk)).size === 1,
    "four rejects and four undos, all under one gesture id"
  );

  await launch("7-group-by-question.png", "question");
  console.log(`stand-in saw ${standin.requests.length} requests`);
  console.log(`scratch vault: ${vault}`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
