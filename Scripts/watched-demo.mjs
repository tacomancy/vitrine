#!/usr/bin/env node
// The Watched sources and BYOK beat's closing demo (#471): hidden runs on a
// scratch copy of the fixture vault, one PNG each (docs/agents/run.md),
// against a local stand-in for a lab's website and for the model's API —
// never a real site or the real one. The key is kept in memory by
// VITRINE_CREDENTIALS=memory, so the user's Keychain is never touched. Needs
// both packages built.
//
//   node Scripts/watched-demo.mjs <out-folder>
//
// 1. A page that advertises a feed: read from it, no model call, no cost.
// 2. A page with no feed and no key: *try* says so; the Scout, once run, says
//    *not yet*.
// 3. A key stored in Settings: the waiting Scout starts on its own; the
//    invented paper is dropped.
// 4. The lab posts a paper and the provider refuses the key: the *wrong* voice on the rail, and in
//    Loose Ends in the same sentence.
// 5. The lab redesigns its page: the structure-change row.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStandin } from "./watched-demo/standin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-watched-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
cpSync(join(repo, "packages/core/fixtures/obsidian-vault"), vault, {
  recursive: true,
});

const standin = await startStandin();
// Async, not execFileSync: the stand-in lives in this process and a blocked
// event loop would leave the app's requests unanswered.
const launch = (png, drive, after = 25000) =>
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
        join(here, "watched-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DEMO_ORIGIN: standin.origin,
          // The SDK reads this itself; the provider needs no demo code.
          ANTHROPIC_BASE_URL: standin.origin,
          VITRINE_CREDENTIALS: "memory",
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
    );
  });

try {
  await launch("1-feed.png", "feed.mjs");
  if (standin.mode.modelCalls !== 0)
    throw new Error("the feed Scout called the model");
  console.log("FEED SCOUT MODEL CALLS: 0");
  await launch("2-no-key.png", "no-key.mjs");
  if (standin.mode.modelCalls !== 0)
    throw new Error("a Scout with no key called the model");
  await launch("3-key-stored.png", "key-stored.mjs", 35000);
  console.log(`PAGE SCOUT MODEL CALLS: ${standin.mode.modelCalls}`);
  if (standin.mode.modelCalls !== 1)
    throw new Error("the page Scout should have made exactly one call");
  standin.mode.posted = true;
  await launch("4a-key-refused-rail.png", "refused.mjs");
  await launch("4b-key-refused-loose-ends.png", "refused-loose-ends.mjs");
  standin.mode.redesigned = true;
  await launch("5a-redesigned-rail.png", "redesigned.mjs");
  await launch("5b-structure-loose-ends.png", "structure-loose-ends.mjs");
  console.log(`scratch vault: ${vault}`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
