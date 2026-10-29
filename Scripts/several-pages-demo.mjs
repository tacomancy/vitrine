#!/usr/bin/env node
// Beat 16's closing demo (#916, spec #909, ADR 0056): one Watched Scout of
// three pages, in three hidden launches on one scratch copy of the fixture
// vault (docs/agents/run.md), against a local stand-in for one lab's site and
// for the model's API — never a real site or the real API. The key is kept in
// memory by VITRINE_CREDENTIALS=memory, so the user's Keychain is never
// touched, and `demo-egress.mjs` hands the core's provider requests to the
// stand-in and refuses anything else bound off this machine. Each drive takes
// its own PNGs. Needs both packages built.
//
//   node Scripts/several-pages-demo.mjs <out-folder>
//
// 1–2. form.mjs: the form adds three pages, *try* answers each and sums the
//      first look; saved, the first check reads all three.
// 3–4. quiet.mjs: the second check, where the talks page goes quiet while
//      its siblings find; their finds triaged, the Accept rate and cost by page.
// 5–6. broken.mjs: the papers page breaks, on the Scouts screen, Loose Ends
//      and Home; mended by *run now* on that page alone.
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
import { NEW_AT, PAGES, startStandin } from "./several-pages-demo/standin.mjs";
import { expect } from "./several-pages-demo/helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-several-pages-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
const egressLog = join(scratch, "egress.log");
cpSync(join(repo, "packages/core/fixtures/obsidian-vault"), vault, {
  recursive: true,
});

const standin = await startStandin();
const url = (which) => `${standin.origin}${PAGES[which]}`;

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
const launch = async (drive, after = 90000) => {
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
        join(here, "several-pages-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DEMO_OUT: out,
          DEMO_VAULT: vault,
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
/** Each check's runs, oldest first: an array per check of its rows, in the order it read its pages. */
const checks = () => {
  const rows = queue(
    "SELECT id, check_id, query, outcome, new FROM scout_runs WHERE finished IS NOT NULL ORDER BY id"
  );
  const by = new Map();
  for (const row of rows) {
    const key = row.check_id ?? row.id;
    by.set(key, [...(by.get(key) ?? []), row]);
  }
  return [...by.values()];
};
const scoutFile = () => {
  const dir = join(vault, ".vitrine/scouts");
  const [file] = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  return readFileSync(join(dir, file), "utf8");
};
const proposalsFrom = (page) =>
  queue(
    `SELECT p.title FROM proposals p JOIN appearances a ON a.proposal_id = p.id
       JOIN scout_runs r ON r.id = a.run_id WHERE r.query = ? ORDER BY p.title`,
    page
  ).map((p) => p.title);

try {
  await launch("form.mjs");
  const file = scoutFile();
  console.log(`SCOUT FILE:\n${file}`);
  const listed = /\n {2}urls:\n((?: {4}- .*\n)+)/.exec(file)?.[1];
  expect(
    listed ===
      ["feed", "papers", "talks"].map((w) => `    - ${url(w)}\n`).join(""),
    "the saved file lists the three pages under urls:, in the order added"
  );
  const [first] = checks();
  console.log(`FIRST CHECK: ${JSON.stringify(first)}`);
  expect(
    checks().length === 1 &&
      first.length === 3 &&
      first.every((r) => r.outcome === "ok" && r.new > 0),
    "the first check is one check of three pages, each finding"
  );

  standin.mode.round = 2;
  await launch("quiet.mjs");
  const second = checks().at(-1);
  console.log(`SECOND CHECK: ${JSON.stringify(second)}`);
  expect(
    second.length === 3 &&
      second.map((r) => r.new).join() ===
        [NEW_AT(2).feed.length, NEW_AT(2).papers.length, 0].join(),
    "the second check finds on the blog and papers pages, nothing on the talks page"
  );
  const fresh = NEW_AT(2);
  expect(
    fresh.papers.every((t) => proposalsFrom(url("papers")).includes(t)),
    "the papers page's finds are credited to its runs"
  );

  standin.mode.round = 3;
  standin.mode.broken = true;
  await launch("broken.mjs", 120000);
  const all = checks();
  const [broken, mended] = all.slice(-2);
  console.log(`BROKEN CHECK: ${JSON.stringify(broken)}`);
  console.log(`MENDING CHECK: ${JSON.stringify(mended)}`);
  expect(
    broken.length === 3 &&
      broken.every(
        (r) => r.outcome === (r.query === url("papers") ? "failed" : "ok")
      ) &&
      broken.find((r) => r.query === url("talks")).new === 0,
    "the papers page alone failed on a check of three, and the talks page stayed quiet"
  );
  expect(
    mended.length === 1 &&
      mended[0].query === url("papers") &&
      mended[0].outcome === "ok" &&
      mended[0].new === NEW_AT(3).papers.length,
    "the page's *run now* read that page alone, and found its one new paper"
  );

  const allowed = new Set(standin.paths);
  const strays = standin.requests.filter((path) => !allowed.has(path));
  expect(strays.length === 0, `requests beyond the site: ${strays}`);
  const egress = existsSync(egressLog) ? readFileSync(egressLog, "utf8") : "";
  expect(egress === "", `requests to a non-local host:\n${egress}`);
  expect(standin.mode.listingCalls > 0, "no run reached the model stand-in");
  console.log(
    `MODEL CALLS: ${standin.mode.listingCalls} listing, ${standin.mode.itemPageCalls} item page`
  );
  console.log(`REQUESTS: ${standin.requests.length}, none off this machine`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
  else console.log(`scratch: ${scratch}`);
}
