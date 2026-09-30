#!/usr/bin/env node
// The Reader beat's closing demo (#429): three hidden runs on a scratch copy
// of the fixture vault, one PNG each (docs/agents/run.md). Needs both
// packages built, and macOS for the PDFKit stand-in for Preview.
//
//   node Scripts/reader-demo.mjs <out-folder>
//
// 1. A PDF no Source names is attached to a stub; the first Ingest lands
//    (footer line, Questions from `Q:` highlights, blocks in the Source).
// 2. Preview re-saves the PDF with three linked highlights gone; three
//    Unmatched rows are resolved three ways (`resolve.mjs`).
// 3. The Source opens in the Reader and a selection becomes a Question.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-reader-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
cpSync(join(repo, "packages/core/fixtures/obsidian-vault"), vault, {
  recursive: true,
});
const pdf = join(vault, "sources/pdf/klinzing-2019.pdf");
cpSync(join(repo, "packages/core/fixtures/pdf/annotated-questions.pdf"), pdf);

const launch = (png, drive, after) =>
  execFileSync(
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
      join(here, "reader-demo", drive),
      "--after",
      String(after),
    ],
    { stdio: "inherit" }
  );

launch("1-attach.png", "attach.mjs", 22000);
console.log(
  readFileSync(join(vault, "sources/klinzing2019.md"), "utf8").split(
    "## Annotations"
  )[1]
);

// Preview's edit, made while the app is closed as it would be from an iPad.
const resaved = join(scratch, "resaved.pdf");
execFileSync("swift", [
  join(here, "reader-demo/preview-resave.swift"),
  pdf,
  resaved,
  "--remove",
  "Sleep spindles were counted",
  "--remove",
  "Participants who heard",
  "--remove",
  "different sentence about memory",
  "--add",
  "Participants",
]);
cpSync(resaved, pdf);
mkdirSync(join(vault, "reading"), { recursive: true });
writeFileSync(
  join(vault, "reading/klinzing notes.md"),
  "# Reading notes\n\nSpindles: [[klinzing2019#^h1]]\n\nThe cue: [[klinzing2019#^h2]]\n\nThe second-page claim: [[klinzing2019#^h4]]\n"
);
launch("2a-unmatched.png", "rows.mjs", 26000);
launch("2b-resolved.png", "resolve.mjs", 34000);
console.log(
  readFileSync(join(vault, "sources/klinzing2019.md"), "utf8").split(
    "## Annotations"
  )[1]
);

launch("3-question.png", "question.mjs", 25000);
console.log(
  readFileSync(join(vault, "sources/klinzing2019.md"), "utf8").split(
    "## Annotations"
  )[1]
);
console.log(`scratch vault: ${vault}`);
if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
