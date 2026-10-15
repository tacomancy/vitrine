#!/usr/bin/env node
// The run window's closing demo (#562, spec #556): three hidden launches on a
// scratch copy of the fixture vault, one PNG each (docs/agents/run.md), the
// arXiv endpoint pointed at a local stand-in so no Scout reaches the real
// one. Needs both packages built.
//
//   node Scripts/run-window-demo.mjs <out-folder>
//
// 1. Fifty PDFs written into the PDF folder a few at a time, over longer than
//    the settle window: one footer line with the whole count, every Source's
//    note holding its blocks.
// 2. A lone PDF returned: read about 7 s after the save.
// 3. Two PDFs attached back to back: one footer line with both counts.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStandin } from "./scout-demo/standin.mjs";
import { deliver, name } from "./run-window-demo/helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-run-window-demo-"));
let vault = join(scratch, "vault");
const support = join(scratch, "support");
const pdfs = join(repo, "packages/core/fixtures/pdf");
const count = 50;
cpSync(join(repo, "packages/core/fixtures/obsidian-vault"), vault, {
  recursive: true,
});
for (let i = 1; i <= count; i++)
  writeFileSync(
    join(vault, `sources/${name(i)}.md`),
    `---\nkind: source\ncitekey: ${name(i)}\ntitle: Paper ${i}\npdf: ${name(i)}.pdf\n---\n\nReturned from the sync client.\n`
  );

const standin = await startStandin();
// Async, not execFileSync: the stand-in lives in this process and a blocked
// event loop would leave the app's requests unanswered.
const launch = (png, drive, after, env = {}) =>
  new Promise((done, fail) => {
    const t0 = Date.now();
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
        join(here, "run-window-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          VITRINE_ARXIV_ENDPOINT: standin.endpoint,
          DEMO_T0: String(t0),
          DEMO_VAULT: vault,
          DEMO_COUNT: String(count),
          DEMO_PDF: join(pdfs, "annotated.pdf"),
          DEMO_PDF_RETURNED: join(pdfs, "annotated-questions.pdf"),
          ...env,
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
    );
  });

try {
  await launch("1-fifty.png", "fifty.mjs", 25000);
  await launch("2-lone.png", "lone.mjs", 10000);
  // A vault of its own for the pair: two PDFs of two different papers that no
  // Source names, and two stubs to attach them to. In the first vault the
  // fixture's PDFs would be conflict copies of Paper 1.
  vault = join(scratch, "vault-pair");
  cpSync(join(repo, "packages/core/fixtures/obsidian-vault"), vault, {
    recursive: true,
  });
  // The fixture's own stub would be the first candidate; the pair is two of ours.
  rmSync(join(vault, "sources/klinzing2019.md"));
  for (const [i, [citekey, fixture]] of [
    ["lehmann2020", "annotated.pdf"],
    ["okafor2021", "twins.pdf"],
  ].entries()) {
    writeFileSync(
      join(vault, `sources/${citekey}.md`),
      `---\nkind: source-stub\ncitekey: ${citekey}\ntitle: Stub ${i + 1}\n---\n`
    );
    deliver(
      join(vault, `sources/pdf/unclaimed-${i + 1}.pdf`),
      join(pdfs, fixture),
      `unclaimed-${i + 1}`
    );
  }
  await launch("3-pair.png", "pair.mjs", 4500);
  console.log(`scratch vault: ${vault}`);
} finally {
  standin.close?.();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
