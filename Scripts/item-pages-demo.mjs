#!/usr/bin/env node
// The Item pages spec's closing demo (#892, spec #884, ADR 0055): two hidden
// launches on one scratch copy of the fixture vault (docs/agents/run.md),
// against a local stand-in for anthropic.com's alignment listing, its Item
// pages and the model's API — never the real site or the real API. The key
// is kept in memory by VITRINE_CREDENTIALS=memory, so the user's Keychain is
// never touched, and `demo-egress.mjs` hands the core's provider requests to the
// stand-in and refuses anything else bound off this machine. Each drive takes
// its own PNGs, dark and light. Needs both packages built.
//
//   node Scripts/item-pages-demo.mjs <out-folder>
//
// 1. The form's *try*: three Item pages read and the first look projected.
// 2. Saved and run: a card filled from its page, with its *paper* link.
// 3. The last item past the 25 is Listing-only (3a); the next run fills it in (3b).
// Then the filled card is accepted, and its stub carries `paper:`.
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LISTING, startStandin } from "./item-pages-demo/standin.mjs";
import { expect } from "./item-pages-demo/helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-item-pages-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
const egressLog = join(scratch, "egress.log");
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
const launch = async (drive, after = 60000) => {
  const port = await freePort();
  return new Promise((done, fail) => {
    const child = spawn(
      "node",
      [
        join(here, "run-hidden.mjs"),
        "--snapshot",
        join(scratch, `${drive}.png`),
        "--vault",
        vault,
        "--support",
        support,
        "--port",
        String(port),
        "--drive",
        join(here, "item-pages-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DEMO_OUT: out,
          DEMO_ORIGIN: standin.origin,
          DEMO_EGRESS_LOG: egressLog,
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            `--import ${pathToFileURL(join(here, "demo-egress.mjs"))}`,
          ]
            .filter(Boolean)
            .join(" "),
          VITRINE_CREDENTIALS: "memory",
          // No arXiv or OpenAlex Scout is in the vault; a dead port all the same.
          VITRINE_ARXIV_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_OPENALEX_ENDPOINT: "http://127.0.0.1:9",
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${drive}: exit ${code}`))
    );
  });
};

const queue = (sql, ...params) => {
  const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
};
const runs = () =>
  queue(
    "SELECT outcome, error_message, fetched, new, item_pages_read, item_pages_unread, item_values_dropped, input_tokens, cost_usd FROM scout_runs ORDER BY id"
  );
const proposal = (title) =>
  queue(
    `SELECT state, authors, published, abstract, paper_url, item_page_tries FROM proposals WHERE title = ?`,
    title
  )[0];

try {
  await launch("first-look.mjs");
  const first = runs();
  console.log(`RUNS: ${JSON.stringify(first)}`);
  expect(
    first.length === 1 &&
      first[0].outcome === "ok" &&
      first[0].item_pages_read === 25 &&
      first[0].item_pages_unread === 0,
    "the first look reads 25 Item pages and fails none"
  );
  const listingOnly = queue(
    "SELECT title FROM proposals WHERE item_page_tries = 0 ORDER BY title"
  ).map((p) => p.title);
  expect(
    JSON.stringify(listingOnly) ===
      JSON.stringify([
        "Alignment research note 19",
        "Alignment research note 20",
        "Natural Emergent Misalignment from Reward Hacking",
      ]),
    `the last three on the listing's site are Listing-only, got ${JSON.stringify(listingOnly)}`
  );
  expect(
    proposal("A Post on the Alignment Science Blog").item_page_tries === null,
    "the off-host item is Listing-only for good, not owed a read"
  );

  await launch("fill-in.mjs");
  const second = runs().at(-1);
  console.log(`RUN 2: ${JSON.stringify(second)}`);
  expect(
    second.outcome === "ok" && second.item_pages_read === 3,
    "the next run reads the three owed pages"
  );
  expect(
    proposal("Natural Emergent Misalignment from Reward Hacking")
      .item_page_tries === null,
    "a read clears the debt"
  );

  const tracing = proposal("Tracing the thoughts of a large language model");
  expect(
    tracing.state === "accepted",
    "the card with a Paper link is accepted"
  );
  const stubs = readdirSync(join(vault, "sources"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(join(vault, "sources", f), "utf8"))
    .filter((s) => s.includes("Tracing the thoughts"));
  expect(stubs.length === 1, "accepting writes one stub");
  console.log(`STUB:\n${stubs[0]}`);
  expect(
    /\nurl: .*\/research\/tracing-thoughts-language-model\npaper: https:\/\/transformer-circuits\.pub\/2025\/attribution-graphs\/biology\.html\n/.test(
      stubs[0]
    ),
    "the stub keeps url: and writes paper: right after it"
  );

  // What the stand-in was asked: the listing, robots.txt, the Item pages and
  // the model, and no link found on an Item page.
  const allowed = new Set([
    "/robots.txt",
    LISTING,
    ...standin.itemPaths,
    "/v1/messages",
    "/v1/messages/count_tokens",
  ]);
  const strays = standin.requests.filter((path) => !allowed.has(path));
  expect(strays.length === 0, `requests beyond the Item pages: ${strays}`);
  const egress = existsSync(egressLog) ? readFileSync(egressLog, "utf8") : "";
  expect(egress === "", `requests to a non-local host:\n${egress}`);
  expect(
    !standin.mode.itemPageCalls.includes("(unrecognised page)"),
    "every Item page the model was asked about is one the stand-in answers"
  );
  console.log(`LISTING CALLS: ${standin.mode.listingCalls}`);
  console.log(`ITEM PAGE CALLS: ${JSON.stringify(standin.mode.itemPageCalls)}`);
  console.log(`REQUESTS: ${standin.requests.length}, none off this machine`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
  else console.log(`scratch: ${scratch}`);
}
