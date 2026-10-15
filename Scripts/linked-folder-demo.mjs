#!/usr/bin/env node
// The linked PDF folder's closing demo (#574, spec #567): hidden launches on a
// scratch copy of the fixture vault whose `sources/pdf` is a link to a folder
// outside it, as a sync client leaves it (docs/agents/run.md). The arXiv
// endpoint is a dead port, so no Scout reaches the real one. Needs both
// packages built.
//
//   node Scripts/linked-folder-demo.mjs <out-folder> [--before <checkout>]
//
// 1. Before (only with --before): a checkout of the commit before #572, built.
//    The Source whose PDF is in the linked folder is PDF missing, and the PDF
//    is not read.
// 2. After: no PDF missing, the PDF read (its annotations in the Source's
//    note), and the PDF no Source names a *no Source* row. The read of a PDF
//    present at launch can land before the window is listening, so its footer
//    line is reported when seen and not required; the note is the evidence.
// 3. A fault: the link's target removed, then the app relaunched. The footer
//    says *papers not arriving* and Loose Ends has no PDF missing row.
//
// Make the before checkout with
//   git worktree add <dir> 11bc334 && cd <dir> && pnpm install &&
//   pnpm --filter core... build && pnpm --filter shell build
import { spawn } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
const beforeFlag = process.argv.indexOf("--before");
const before = beforeFlag > 0 ? resolve(process.argv[beforeFlag + 1]) : null;
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-linked-folder-demo-"));
const fixtures = join(repo, "packages/core/fixtures");

// The vault, a sync folder beside it holding the Source's PDF and a stray one,
// and `sources/pdf` made a link to that folder. The fixture's own
// rasch2013.pdf is a placeholder with nothing to read, so annotated.pdf stands
// in under its name. born2010 is removed: its PDF really is absent, and its
// row would stand beside the one this shows.
function makeVault(name) {
  const vault = join(scratch, name, "vault");
  const sync = join(scratch, name, "sync");
  cpSync(join(fixtures, "obsidian-vault"), vault, { recursive: true });
  rmSync(join(vault, "sources/born2010.md"));
  rmSync(join(vault, "sources/pdf"), { recursive: true });
  mkdirSync(sync);
  copyFileSync(
    join(fixtures, "pdf/annotated.pdf"),
    join(sync, "rasch2013.pdf")
  );
  copyFileSync(join(fixtures, "pdf/twins.pdf"), join(sync, "stray.pdf"));
  symlinkSync(sync, join(vault, "sources/pdf"));
  return { vault, sync, support: join(scratch, name, "support") };
}

const launch = (checkout, png, drive, { vault, support }, settleMs) =>
  new Promise((done, fail) => {
    const child = spawn(
      "node",
      [
        join(checkout, "Scripts/run-hidden.mjs"),
        "--snapshot",
        join(out, png),
        "--vault",
        vault,
        "--support",
        support,
        "--drive",
        join(here, "linked-folder-demo", drive),
        "--after",
        String(settleMs),
      ],
      {
        stdio: "inherit",
        // A dead port: no Scout reaches the real arXiv.
        env: {
          ...process.env,
          VITRINE_ARXIV_ENDPOINT: "http://127.0.0.1:9",
          DEMO_NOTE: join(vault, "sources/rasch2013.md"),
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
    );
  });

try {
  if (before)
    await launch(
      before,
      "1-before.png",
      "before.mjs",
      makeVault("before"),
      5000
    );
  const afterVault = makeVault("after");
  await launch(repo, "2-after.png", "after.mjs", afterVault, 5000);
  rmSync(afterVault.sync, { recursive: true });
  await launch(repo, "3-fault.png", "fault.mjs", afterVault, 6000);
  console.log(`scratch: ${scratch}`);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
