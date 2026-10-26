#!/usr/bin/env node
// The Scouts screen's closing run (#862, spec #854, beat #853): hidden launches
// on one scratch vault holding a snapshot of a real Scouts folder, with both
// arXiv and OpenAlex on dead ports — never a real source. The real folder is
// copied and only read; the script hashes it before and after. Needs both
// packages built.
//
//   node Scripts/scouts-screen-demo.mjs <out-folder> [<real-scouts-folder>]
//
// 1. The Queue's rail and its marker; the link to the Scouts screen, and a
//    marked Scout's line, each landing on it.
// 2. Two Scouts dropped.
// 3. One erased, after its question; its file gone and a tombstone left, the
//    queue's runs, triage rows and Proposals unchanged.
// 4. The other restored, beside the rest; the Queue's rail without the erased.
//
// The folder defaults to the one the app last remembered
// (`~/Library/Application Support/Vitrine/last-vault.json`). KEEP=1 leaves the
// scratch vault behind.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoutsOf, scoutsScreenVault } from "./scouts-screen-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });

const remembered = () => {
  const file = join(
    homedir(),
    "Library/Application Support/Vitrine/last-vault.json"
  );
  return existsSync(file)
    ? join(JSON.parse(readFileSync(file, "utf8")).path, ".vitrine/scouts")
    : null;
};
const real = process.argv[3] ? resolve(process.argv[3]) : remembered();
if (!real || !existsSync(real)) {
  console.error(
    "scouts-screen-demo: no Scouts folder; name one as the second argument"
  );
  process.exit(2);
}
const fingerprint = (dir) =>
  createHash("sha256")
    .update(
      readdirSync(dir)
        .sort()
        .map((f) => `${f}\n${readFileSync(join(dir, f), "utf8")}`)
        .join("\0")
    )
    .digest("hex");
const before = fingerprint(real);

const scouts = scoutsOf(real);
if (scouts.length < 3) {
  console.error("scouts-screen-demo: the run needs at least three Scouts");
  process.exit(2);
}
const [first, second, third] = scouts;
// The third is the one whose newest run failed, so the Queue marks it; the two
// that are dropped are not it, since a dropped Scout carries no marker.
const failing = third.id;

const scratch = mkdtempSync(join(tmpdir(), "vitrine-scouts-screen-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
await scoutsScreenVault(
  join(repo, "packages/core/fixtures/obsidian-vault"),
  vault,
  join(repo, "packages/core"),
  real,
  failing
);

const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

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
        join(here, "scouts-screen-demo/drives.mjs"),
        "--after",
        "45000",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DEMO_STEP: step,
          DEMO_OUT: out,
          DEMO_A: first.name,
          DEMO_B: second.name,
          DEMO_COUNT: String(scouts.length),
          VITRINE_ARXIV_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_OPENALEX_ENDPOINT: "http://127.0.0.1:9",
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
// The failing Scout looks again at every launch, so its runs are its own news;
// what drop, erase and restore must leave alone is everything about the two
// Scouts they act on.
const record = () =>
  JSON.stringify(
    [
      `SELECT COUNT(*) AS n FROM scout_runs WHERE scout_id IN ('${first.id}', '${second.id}')`,
      "SELECT COUNT(*) AS n FROM triage",
      "SELECT COUNT(*) AS n FROM proposals",
      "SELECT COUNT(*) AS n FROM appearances",
    ].map((sql) => queue(sql)[0].n)
  );
const file = (name) => join(vault, ".vitrine/scouts", name);
const check = (ok, what) => {
  if (!ok) throw new Error(`demo expectation failed: ${what}`);
};

try {
  await launch("reach");
  const recorded = record();
  await launch("drop");
  check(
    readFileSync(file(`${first.id}.yaml`), "utf8").includes("dropped:") &&
      readFileSync(file(`${second.id}.yaml`), "utf8").includes("dropped:"),
    "both Scout files carry a dropped date"
  );
  await launch("erase");
  check(
    !existsSync(file(`${first.id}.yaml`)) &&
      readFileSync(file(`${first.id}.erased`), "utf8").includes(first.name),
    "the erased Scout's file is gone and its tombstone holds its name"
  );
  check(
    existsSync(file(`${second.id}.yaml`)),
    "the other dropped Scout's file is where it was"
  );
  await launch("restore");
  check(
    !readFileSync(file(`${second.id}.yaml`), "utf8").includes("dropped:"),
    "the restored Scout's file carries no dropped date"
  );
  check(
    record() === recorded,
    "no run of the two Scouts, triage row, Proposal or Appearance changed through drop, erase and restore"
  );
  check(fingerprint(real) === before, "the real Scouts folder is untouched");
  console.log(`scratch vault: ${vault}`);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
