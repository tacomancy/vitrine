#!/usr/bin/env node
// Beat 10b's closing demo (#692, spec #678): hidden launches on one scratch
// copy of the fixture vault with a `probing` Tag of three papers, one PNG each
// (docs/agents/run.md), against a local stand-in for arXiv
// (Scripts/scout-activity-demo/standin.mjs, reached through
// VITRINE_ARXIV_ENDPOINT) — never the real arXiv. No key is stored and the
// credential store is held in memory. Needs both packages built.
//
//   node Scripts/tag-filter-demo.mjs <out-folder>
//
// 1. The form: the Tag chosen, its Terms and the compiled arXiv query
//    verbatim, *try* answered (1a); saved and run (1b).
// 2. A Seed in the Lexicon editor; nothing is sent.
// 3. Run now: the query sent carries the Seed.
// 4. A Scout whose Tag has no Terms fails by name in Loose Ends.
// 5. Scout Activity shows the Tag Filter as its Tags.
//
// The script prints the queries the stand-in received and throws when one is
// not what its step claims, so a green run is the evidence.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStandin } from "./scout-activity-demo/standin.mjs";
import { expect } from "./tag-filter-demo/helpers.mjs";
import { tagFilterVault } from "./tag-filter-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-tag-filter-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
tagFilterVault(join(repo, "packages/core/fixtures/obsidian-vault"), vault);

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
        join(here, "tag-filter-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          VITRINE_ARXIV_ENDPOINT: standin.endpoint,
          // The Lexicon editor lives beside the attention scatter; a dead
          // port keeps it from reaching OpenAlex.
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

const runs = () => {
  const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
  try {
    return db
      .prepare(
        "SELECT scout_id, query, outcome, error_kind FROM scout_runs ORDER BY id"
      )
      .all();
  } finally {
    db.close();
  }
};

try {
  await launch("1a-form-try.png", "try.mjs");
  // *try* asks arXiv once, with no window; nothing else is sent.
  expect(
    standin.requests.length === 1 &&
      !standin.requests[0].includes("submittedDate"),
    `try sent one query with no window, got ${JSON.stringify(standin.requests)}`
  );
  console.log(`1a. TRY SENT: ${standin.requests[0]}`);
  standin.requests.length = 0;

  await launch("1b-saved-and-run.png", "save.mjs");
  const first = standin.requests.filter((q) => q.includes("submittedDate"));
  expect(first.length === 1, `one windowed query, got ${first.length}`);
  expect(
    first[0].includes('abs:"linear probe"') && !first[0].includes("steering"),
    "the first run asks for the derived Terms"
  );
  console.log(`1. QUERY SENT: ${first[0]}`);

  const before = standin.requests.length;
  await launch("2-seed.png", "seed.mjs", 20000);
  expect(standin.requests.length === before, "a Seed ran a Scout");

  await launch("3-run-now-after-seed.png", "run-now.mjs");
  const next = standin.requests.at(-1);
  expect(
    standin.requests.length === before + 1 &&
      next.includes("activation steering"),
    `the next run asks for the Seed, got ${next}`
  );
  console.log(`3. QUERY SENT: ${next}`);

  await launch("4-bare-fails-by-name.png", "bare-fails.mjs");
  const bare = runs().filter((r) => r.scout_id === "bare-watch");
  expect(
    bare.length > 0 &&
      bare.every((r) => r.outcome === "failed" && r.error_kind === "tags"),
    `Bare watch fails with the tags kind, got ${JSON.stringify(bare)}`
  );

  await launch("5-scout-activity.png", "activity.mjs");

  console.log(`RUNS: ${JSON.stringify(runs())}`);
  console.log(`scratch vault: ${vault}`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
