#!/usr/bin/env node
// Beat 6c's closing demo (#810, spec #800): hidden launches on one scratch copy
// of the fixture vault, one PNG each (docs/agents/run.md), against a local
// stand-in for arXiv and for OpenAlex (Scripts/openalex-demo/standin.mjs,
// reached through VITRINE_ARXIV_ENDPOINT and VITRINE_OPENALEX_ENDPOINT) —
// never the real ones. No key is stored and the credential store is held in
// memory. Needs both packages built.
//
//   node Scripts/openalex-demo.mjs <out-folder>      ONLY=3 runs one step; 4 needs 1, 7 needs 6
//
// 1. An OpenAlex Scout by Query: Try answers with the total, five titles and
//    the credits left; saved.
// 2. One by Tags: the Tag's compiled query on the form; Try; saved.
// 3. A venue allowlist: two near-identical venues told apart by ISSN, one
//    added, and Try asks only it.
// 4. A venue and a publisher muted by name search; the muted view holds what
//    they caught.
// 5. An arXiv Scout and an OpenAlex Scout finding one paper: one card,
//    journal link first, *also on arXiv*, two Appearances.
// 6. The ceiling: a broad Query stops at 400 and says how many more matched.
// 7. The budget: under the sync's reserve the scatter pauses (7a); spent, a
//    Scout waits and says it resets at midnight UTC (7b).
//
// The script prints the requests the stand-in received and throws when one is
// not what its step claims, so a green run is the evidence.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStandin } from "./openalex-demo/standin.mjs";
import { expect } from "./openalex-demo/helpers.mjs";
import { openalexVault, writeScout } from "./openalex-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-openalex-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
openalexVault(join(repo, "packages/core/fixtures/obsidian-vault"), vault);

const standin = await startStandin();
const only = process.env.ONLY;
const wanted = (step) => only === undefined || only.split(",").includes(step);

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
        join(here, "openalex-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          VITRINE_ARXIV_ENDPOINT: standin.arxivEndpoint,
          VITRINE_OPENALEX_ENDPOINT: standin.openalexEndpoint,
          VITRINE_CREDENTIALS: "memory",
          DEMO_STANDIN: standin.origin,
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
const sent = (kind) => standin.state.requests.filter((r) => r.kind === kind);

try {
  if (wanted("1")) {
    await launch("1-query-scout.png", "query.mjs");
    const asked = standin.state.requests.filter((r) => r.kind === "works");
    expect(asked.length >= 1, "Try asked OpenAlex");
    for (const r of asked)
      expect(
        r.filter.includes("primary_location.source.type:journal|conference") &&
          r.filter.includes("is_retracted:false"),
        `every works request is for published venues only, got ${r.filter}`
      );
    console.log(`1. TRY SENT: ${asked[0].filter}`);
  }
  if (wanted("2")) await launch("2-tags-scout.png", "tags.mjs");
  if (wanted("3")) {
    await launch("3-venue-allowlist.png", "allowlist.mjs");
    // The list is sent as source IDs, never as a post-filter (ADR 0051 d.9).
    expect(
      sent("works").some((r) =>
        r.filter.includes("primary_location.source.id:S1")
      ),
      "Try sent the allowlist as primary_location.source.id"
    );
  }
  if (wanted("4")) await launch("4-mute-by-name.png", "mutes.mjs");
  if (wanted("5")) {
    writeScout(
      vault,
      "preprints",
      "name: Sleep preprints\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: oscillations\n"
    );
    writeScout(
      vault,
      "published",
      "name: Sleep published\nsource:\n  kind: openalex\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: oscillations\n"
    );
    await launch("5-one-card.png", "one-card.mjs");
    const rows = queue(
      "SELECT p.id, (SELECT COUNT(*) FROM appearances a WHERE a.proposal_id = p.id) AS seen FROM proposals p WHERE p.title = 'Slow Oscillations Reconsidered'"
    );
    expect(
      rows.length === 1 && rows[0].seen === 2,
      `one Proposal with two Appearances, got ${JSON.stringify(rows)}`
    );
  }
  if (wanted("6")) {
    writeScout(
      vault,
      "broad",
      "name: Broad watch\nsource:\n  kind: openalex\ncadence: daily\nlane: skim\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: ceiling\n"
    );
    await launch("6-ceiling.png", "ceiling.mjs");
    const works = sent("works").filter((r) => r.filter.includes("ceiling"));
    expect(
      works.every((r) => r.per === "200"),
      "pages of 200"
    );
  }
  if (wanted("7")) {
    await launch("7a-sync-yields.png", "yields.mjs");
    await launch("7b-budget-spent.png", "spent.mjs");
  }
  console.log(`scratch vault: ${vault}`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
