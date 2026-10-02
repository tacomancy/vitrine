#!/usr/bin/env node
// The Scouts beat's closing demo (#454): hidden runs on a scratch copy of the
// fixture vault, one PNG each (docs/agents/run.md), against a local stand-in
// for arXiv — never the real one. Needs both packages built.
//
//   node Scripts/scout-demo.mjs <out-folder>
//
// 1. The form, with *try* answered.
// 2. The Scout saved and run; the Review stack with a card in hand.
// 3. A Skim Scout; the Skim feed.
// 4. `A` on the card; the stub's file and its *Unfinished reading* row.
// 5. The stand-in answers 503: the *wrong* voice on the rail, and in Loose
//    Ends in the same sentence.
// 6. The stand-in recovers; *run now* and both go quiet again.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStandin } from "./scout-demo/standin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-scout-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
cpSync(join(repo, "packages/core/fixtures/obsidian-vault"), vault, {
  recursive: true,
});

const standin = await startStandin();
// Async, not execFileSync: the stand-in server lives in this process and a
// blocked event loop would leave the app's requests unanswered.
const launch = (png, drive, after = 18000) =>
  new Promise((done, fail) => {
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
        "--drive",
        join(here, "scout-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: { ...process.env, VITRINE_ARXIV_ENDPOINT: standin.endpoint },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
    );
  });

try {
  await launch("1-form-try.png", "form.mjs");
  await launch("2-review.png", "review.mjs");
  await launch("3-skim.png", "skim.mjs");
  await launch("4-accepted.png", "accept.mjs");
  const stubs = readdirSync(join(vault, "sources")).filter((f) =>
    f.endsWith(".md")
  );
  console.log(`sources/: ${stubs.join(", ")}`);
  standin.mode.failing = true;
  await launch("5a-broken-rail.png", "broken-rail.mjs");
  await launch("5b-broken-loose-ends.png", "broken-loose-ends.mjs");
  standin.mode.failing = false;
  await launch("6-recovered.png", "recover.mjs", 30000);
  console.log(`stand-in saw ${standin.mode.requests.length} requests`);
  console.log(`scratch vault: ${vault}`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
