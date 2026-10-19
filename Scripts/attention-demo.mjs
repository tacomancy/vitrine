#!/usr/bin/env node
// Beat 10's closing demo (#658): hidden launches on one scratch vault, one PNG
// each (docs/agents/run.md), against a local stand-in for OpenAlex — never the
// real one. Needs both packages built.
//
//   node Scripts/attention-demo.mjs <out-folder>
//
// 1. A Lexicon derived and read before anything is sent; the stand-in has seen
//    nothing.
// 2. The first *Sync now*: asked first, then the scatter with its quadrants,
//    the axes' crossing, and the Tags that cannot be placed, each with why.
// 3. A Seed: the Tag's old point stays, marked re-measure pending.
// 4. The sync on open fails for it: it keeps its measurement and says so, and
//    Loose Ends and the Inbox carry nothing of it.
// 5. The review offers a paper by keyword overlap, after the shared-Tag ones.
// 6. The next sync re-measured it: nothing pending or failed, in each of the
//    theme states.
//
// Each drive throws when the page does not show what its step claims, so a
// green run is the evidence.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "./attention-demo/helpers.mjs";
import { startStandin } from "./attention-demo/standin.mjs";
import { attentionVault } from "./attention-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-attention-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
attentionVault(join(repo, "packages/core/fixtures/obsidian-vault"), vault);
const standin = await startStandin();

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
const launch = async (png, drive, { after = 40000, env = {} } = {}) => {
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
        join(here, "attention-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          VITRINE_OPENALEX_ENDPOINT: standin.endpoint,
          // Nothing in this vault is a Scout; a dead port is the safe guard.
          VITRINE_ARXIV_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_CREDENTIALS: "memory",
          AD_BASELINE: join(scratch, "baseline.json"),
          ...env,
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
    );
  });
};

const measurements = () =>
  JSON.parse(readFileSync(join(vault, ".vitrine/measurements.json"), "utf8"));

try {
  await launch("1-lexicon-before-sync.png", "before-sync.mjs", {
    after: 15000,
  });
  expect(standin.requests.length === 0, "nothing was sent before Sync now");

  await launch("2-first-sync.png", "first-sync.mjs", { after: 60000 });
  const sent = standin.requests;
  expect(sent.length > 0, "the first Sync now reached the stand-in");
  expect(
    sent.every(
      (u) =>
        u.pathname === "/works" &&
        /^title_and_abstract\.search:\(.*\),from_publication_date:/.test(
          u.searchParams.get("filter") ?? ""
        ) &&
        [...u.searchParams.keys()].every((k) =>
          ["filter", "per-page", "select", "cursor"].includes(k)
        )
    ),
    "only compiled Terms were sent"
  );
  // Five placed Tags and the one too thin in the field, 24 months each; the
  // 2-paper Tag is never asked about.
  expect(
    sent.length === 24 * 6,
    `six Tags measured, 24 months each: ${sent.length}`
  );
  expect(
    !sent.some((u) => /dream report/.test(u.searchParams.get("filter") ?? "")),
    "a Tag with two papers is never sent"
  );
  const first = measurements();

  await launch("3-re-measure-pending.png", "pending.mjs", { after: 20000 });
  expect(standin.requests.length === sent.length, "a Seed sent nothing");

  standin.mode.failTerm = "memory trace";
  const before = standin.requests.length;
  await launch("4-failed-sync.png", "failed.mjs", { after: 60000 });
  expect(standin.requests.length > before, "the sync on open asked again");
  const kept = (m) => m.measurements.find((x) => x.tag === "engrams");
  expect(
    JSON.stringify(kept(measurements())) === JSON.stringify(kept(first)),
    "the failed Tag kept its stored measurement exactly"
  );
  expect(
    measurements().failures.some((f) => f.tag === "engrams"),
    "the failure is stored, since the sync on open has no caller to tell"
  );

  standin.mode.failTerm = null;
  await launch("5-keyword-overlap.png", "overlap.mjs", { after: 30000 });
  for (const theme of ["dark", "light", "forced-dark", "forced-light"])
    await launch(`6-recovered-${theme}.png`, "recovered.mjs", {
      after: 30000,
      env: { AD_THEME: theme },
    });
  console.log(`stand-in saw ${standin.requests.length} requests`);
  console.log(`scratch vault: ${vault}`);
} finally {
  standin.close();
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
