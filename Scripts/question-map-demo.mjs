#!/usr/bin/env node
// The Question Map beat's closing demo (#494): hidden launches on scratch
// vaults, one PNG each (docs/agents/run.md). Needs both packages built.
//
//   node Scripts/question-map-demo.mjs <out-folder>
//
// 1. The matrix with its stated cut, in dark, light, and each forced against
//    the other (the three theme states of tokens.css).
// 2. Every reading opened to its full list.
// 3. Depth 1: the matrix and the readings move together.
// 4. The review from an unanchored row: accept fills a cell, reject is
//    remembered across a relaunch and undone, pass returns.
// 5. The Map caught mid-build: *not yet*.
// 6. The empty vault.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bigVault, emptyVault, mapVault } from "./question-map-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-question-map-demo-"));
const support = join(scratch, "support");
const vault = join(scratch, "vault");
const unanchored = mapVault(
  join(repo, "packages/core/fixtures/obsidian-vault"),
  vault
);
const [q1, q2] = unanchored;
const questionFile = (name) => join(vault, `map/${name}.md`);

const launch = (
  png,
  drive,
  { vault: v = vault, after = 14000, env = {} } = {}
) =>
  new Promise((done, fail) => {
    const child = spawn(
      "node",
      [
        join(here, "run-hidden.mjs"),
        "--snapshot",
        join(out, png),
        "--vault",
        v,
        "--support",
        support,
        "--drive",
        join(here, "question-map-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: { ...process.env, QM_QUESTIONS: `${q1}|${q2}`, ...env },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
    );
  });

try {
  for (const theme of ["dark", "light", "forced-dark", "forced-light"])
    await launch(`1-matrix-${theme}.png`, "matrix.mjs", {
      env: { QM_THEME: theme },
    });
  await launch("2-readings.png", "readings.mjs");
  await launch("3a-depth-default.png", "depth.mjs", {
    env: { QM_DEPTH_STEP: "before" },
  });
  await launch("3b-depth-1.png", "depth.mjs", {
    env: { QM_DEPTH_STEP: "after" },
  });

  await launch("4a-accepted.png", "review.mjs", { env: { QM_STEP: "accept" } });
  const accepted = readFileSync(questionFile(q1), "utf8");
  if (!/related:[\s\S]*gen-source/.test(accepted))
    throw new Error(`accept wrote no Related link:\n${accepted}`);
  await launch("4b-rejected.png", "review.mjs", { env: { QM_STEP: "reject" } });
  await launch("4c-reject-remembered.png", "review.mjs", {
    env: { QM_STEP: "remembered" },
  });
  // Undo is of a reject made in this visit, so it rejects again first.
  await launch("4d-undone.png", "review.mjs", { env: { QM_STEP: "undo" } });
  await launch("4e-passed.png", "review.mjs", { env: { QM_STEP: "pass" } });

  const big = join(scratch, "big");
  bigVault(big);
  await launch("5-not-yet.png", "not-yet.mjs", { vault: big, after: 1500 });
  const empty = join(scratch, "empty");
  emptyVault(empty);
  await launch("6-empty.png", "empty.mjs", { vault: empty });
  console.log(`scratch vault: ${vault}`);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
