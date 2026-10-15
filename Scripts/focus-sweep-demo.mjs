#!/usr/bin/env node
// The focus sweep's closing demo (#576, spec #568): two hidden launches of a
// scratch copy of the fixture vault whose `sources/pdf` is a link to a sync
// folder (docs/agents/run.md), the second with the same app-support folder as
// the first, so the PDF is already read. The arXiv endpoint is a dead port.
// Needs both packages built.
//
//   node Scripts/focus-sweep-demo.mjs <out-folder>
//
// 1. First launch: reads the PDF (the baseline; its note gains the blocks).
// 2. Second launch, nothing changed: the Source's note is byte-for-byte what
//    it was, the footer says no Ingest line, no Source is *PDF missing* and
//    Loose Ends shows what the first launch left, no more.
//
// What this cannot show: a hidden window gets no `focus` event and the core
// takes focus only as a message from the shell, so the shell's event reaching
// the sweep is not driven (`pdf-folder.focus.test.ts` calls the function the
// message calls). No run can make FSEvents deaf, so that the catch-up is the
// sweep's is shown only by that test.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-focus-sweep-demo-"));
const fixtures = join(repo, "packages/core/fixtures");

// As the linked-folder demo's vault: born2010 is removed so its truly absent
// PDF does not put a *PDF missing* row beside the check this makes.
const vault = join(scratch, "vault");
const sync = join(scratch, "sync");
const support = join(scratch, "support");
cpSync(join(fixtures, "obsidian-vault"), vault, { recursive: true });
rmSync(join(vault, "sources/born2010.md"));
rmSync(join(vault, "sources/pdf"), { recursive: true });
mkdirSync(sync);
copyFileSync(join(fixtures, "pdf/annotated.pdf"), join(sync, "rasch2013.pdf"));
copyFileSync(join(fixtures, "pdf/twins.pdf"), join(sync, "stray.pdf"));
symlinkSync(sync, join(vault, "sources/pdf"));
const note = join(vault, "sources/rasch2013.md");
const sha = () => createHash("sha256").update(readFileSync(note)).digest("hex");

const launch = (png, drive, settleMs, env = {}) =>
  new Promise((done, fail) => {
    const child = spawn(
      "node",
      [
        join(repo, "Scripts/run-hidden.mjs"),
        "--snapshot",
        join(out, png),
        "--vault",
        vault,
        "--support",
        support,
        "--drive",
        join(here, "focus-sweep-demo", drive),
        "--after",
        String(settleMs),
      ],
      {
        stdio: "inherit",
        // A dead port: no Scout reaches the real arXiv.
        env: {
          ...process.env,
          VITRINE_ARXIV_ENDPOINT: "http://127.0.0.1:9",
          DEMO_NOTE: note,
          ...env,
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
    );
  });

try {
  await launch("1-first.png", "first.mjs", 5000);
  const baseline = sha();
  await launch("2-no-change.png", "no-change.mjs", 7000);
  // The parent's check, beside the drive's own: the note is untouched.
  if (sha() !== baseline) throw new Error("the second launch changed the note");
  console.log("OK   the Source's note is byte-for-byte what the first left");
  console.log(`scratch: ${scratch}`);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
