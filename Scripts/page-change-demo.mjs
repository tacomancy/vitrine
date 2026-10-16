#!/usr/bin/env node
// The page-change spec's closing demo (#613, spec #563, ADR 0043): hidden
// launches on one scratch copy of the fixture vault, one PNG each
// (docs/agents/run.md), against a local stand-in for a lab that moves its
// publications page and for the model's API — never the real network. The
// key is kept in memory by VITRINE_CREDENTIALS=memory, so the user's Keychain
// is never touched. Needs both packages built.
//
//   node Scripts/page-change-demo.mjs <out-folder>
//
// 1. A Scout watching the lab's page has read it, and five Proposals are accepted.
// 2. The lab moves; the old address 404s and the Scout says so.
// 3. On the form the Address is changed: *try* (3a), then Save (3b). Saving
//    writes the new URL and nothing else in the file, and runs nothing.
// 4. The next launch's first look: the Scout says its new page was read and
//    the run is Retroactive (4a); Loose Ends carries nothing for the old
//    page (4b).
// 5. The weekly line says in one sentence that it spans two pages.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStandin } from "./page-change-demo/standin.mjs";
import { expect } from "./page-change-demo/helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-page-change-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
const mark = join(scratch, "saved-at");
cpSync(join(repo, "packages/core/fixtures/obsidian-vault"), vault, {
  recursive: true,
});

const standin = await startStandin();

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
const launch = async (png, drive, after = 25000) => {
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
        join(here, "page-change-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DEMO_MARK: mark,
          DEMO_ORIGIN: standin.origin,
          ANTHROPIC_BASE_URL: standin.origin,
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
const runs = () =>
  queue("SELECT query, outcome, retroactive FROM scout_runs ORDER BY id");
const scoutFile = () =>
  readFileSync(join(vault, ".vitrine/scouts/sleep-lab.yaml"), "utf8");

try {
  await launch("1-before-the-move.png", "before.mjs");
  const before = scoutFile();
  expect(before.includes(`${standin.origin}/old/`), "the Scout watches /old/");

  standin.mode.moved = true;
  await launch("2-the-lab-moves.png", "moved.mjs");
  await launch("3a-try-the-new-page.png", "try.mjs");
  await launch("3b-saved.png", "save.mjs");

  // The file: the URL changed, and no other line did.
  const after = scoutFile();
  const was = before.split("\n");
  const changed = after.split("\n").filter((line, i) => line !== was[i]);
  expect(
    changed.length === 1 && changed[0].includes(`${standin.origin}/new/`),
    `only source.url changed in the file, got ${JSON.stringify(changed)}`
  );
  const saved = readFileSync(mark, "utf8");
  expect(
    queue(`SELECT id FROM scout_runs WHERE started > '${saved}'`).length === 0,
    "saving a changed page ran something"
  );

  await launch("4a-first-look.png", "first-look.mjs", 35000);
  const last = runs().at(-1);
  expect(
    last.query === `${standin.origin}/new/` &&
      last.outcome === "ok" &&
      last.retroactive === 1,
    `the first look at the new page is a Retroactive ok run, got ${JSON.stringify(last)}`
  );
  await launch("4b-loose-ends.png", "loose-ends.mjs");
  await launch("5-weekly-line.png", "weekly-line.mjs");

  console.log(`MODEL CALLS: ${standin.mode.modelCalls}`);
  console.log(`RUNS: ${JSON.stringify(runs())}`);
  console.log(`scratch vault: ${vault}`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
