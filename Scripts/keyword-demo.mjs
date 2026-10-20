#!/usr/bin/env node
// Beat 10c's closing demo (#684, spec #679): four hidden launches on one
// scratch vault, one PNG each (docs/agents/run.md). No network is involved —
// keywords are read from the PDF on this machine — so no stand-in; the arXiv
// and OpenAlex endpoints are pointed at a dead port anyway. Needs both
// packages built.
//
//   node Scripts/keyword-demo.mjs <out-folder>
//
// 1. A PDF that prints a keyword line: its Terms in the Tag's editor, origin
//    *author keyword*, and the Source's frontmatter untouched.
// 2. The PDF replaced by one that prints none: the old keywords are gone.
// 3. The first PDF put back: read again.
// 4. A sidecar from before the slice (no keyword field, same bytes): read
//    once, backfilled, with the Source still byte-for-byte what it was.
//
// Each launch throws when the page or the files do not show what the step
// claims, so a green run is the evidence.
import { spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "./attention-demo/helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const fixtures = join(repo, "packages/core/fixtures");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-keyword-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");

// Three papers, so the Tag is one the Lexicon places; only the first has a PDF.
const source = `---
kind: source
id: src-kd1
citekey: kd1
title: Odor cues during slow-wave sleep
pdf: kd1.pdf
tags: [probing]
---
> Rats navigated mazes.
`;
const stub = (n, abstract) =>
  `---\nkind: source\ncitekey: kd${n}\ntitle: Probing study ${n}\ntags: [probing]\n---\n> ${abstract}\n`;
cpSync(join(fixtures, "obsidian-vault"), vault, { recursive: true });
mkdirSync(join(vault, "sources/kd"), { recursive: true });
writeFileSync(join(vault, "sources/kd/kd1.md"), source);
writeFileSync(
  join(vault, "sources/kd/kd2.md"),
  stub(2, "Mice explored arenas.")
);
writeFileSync(
  join(vault, "sources/kd/kd3.md"),
  stub(3, "Birds followed routes.")
);
const pdf = join(vault, "sources/pdf/kd1.pdf");
const sidecarPath = join(vault, ".vitrine/annotations/src-kd1.json");
const put = (name) => copyFileSync(join(fixtures, "pdf", name), pdf);
const sidecar = () => JSON.parse(readFileSync(sidecarPath, "utf8"));
const note = () => readFileSync(join(vault, "sources/kd/kd1.md"), "utf8");

// A free port: run-hidden's default is whoever got there first.
const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

const launch = async (png, { present = [], absent = [] }) => {
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
        join(here, "keyword-demo/lexicon.mjs"),
        "--after",
        "30000",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          VITRINE_ARXIV_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_OPENALEX_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_CREDENTIALS: "memory",
          KD_PRESENT: present.join(","),
          KD_ABSENT: absent.join(","),
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
    );
  });
};

const PRINTED = ["odor cue", "sleep spindles", "slow wave sleep"];
const original = note();
try {
  put("annotated-keywords.pdf");
  await launch("1-printed-keywords.png", { present: PRINTED });
  expect(
    sidecar().keywords?.length === 4,
    "the sidecar holds the four printed"
  );
  expect(note().startsWith(original), "frontmatter untouched by the read");

  put("annotated.pdf");
  await launch("2-replaced-pdf.png", { absent: PRINTED });
  expect(
    Array.isArray(sidecar().keywords) && sidecar().keywords.length === 0,
    "a replaced PDF that prints none records none"
  );

  put("annotated-keywords.pdf");
  await launch("3-put-back.png", { present: PRINTED });

  const pre = sidecar();
  delete pre.keywords;
  writeFileSync(sidecarPath, JSON.stringify(pre, null, 2));
  await launch("4-backfilled.png", { present: PRINTED });
  expect(sidecar().keywords?.length === 4, "a pre-slice sidecar is backfilled");
  expect(
    note().startsWith(original),
    "frontmatter byte-for-byte after all four"
  );
  console.log(`scratch vault: ${vault}`);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
