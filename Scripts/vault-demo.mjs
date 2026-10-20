#!/usr/bin/env node
// Beat 11's closing demo (#704, spec #680): hidden launches on one scratch
// copy of the fixture vault plus the notes a Vault surface is for, one PNG
// each (docs/agents/run.md). The arXiv endpoint is a dead port, so no Scout
// reaches the network. Needs both packages built.
//
//   node Scripts/vault-demo.mjs <out-folder>
//
// 1. The files tab: a Kind glyph per file, a Source's annotation count,
//    `.vitrine/` hidden, a note open with its backlinks.
// 2. Typing saves: a CRLF note keeps every byte it was not typed into, and a
//    Working answer typed here adds a Position Revision.
// 3. A file whose shape typing broke saves anyway and is said.
// 4. A Source's backlinks grouped by highlight, and its unlinked mentions.
// 5. The tag tree with both counts, and the tag the grammar refuses.
// 6. Full-text search.
// 7. Changed on disk under unsaved typing: one line, autosave waiting.
// 8. Its two actions, and a clean editor reloading silently.
// 9. Following links: a Source's own surface, an unresolved link, a scheme
//    that is not followed.
//
// The launches share one vault, in order: 3 leaves a duplicated section in
// the Research Question, and 7 and 8 both edit the Reading log. VITRINE_CREDENTIALS
// keeps any key in memory, though none is stored.
//
// Each drive throws when the page, or the file on disk, is not what its step
// claims, so a green run is the evidence. KEEP=1 leaves the scratch vault.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { vaultDemoVault } from "./vault-demo/vault.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "vitrine-vault-demo-"));
const vault = join(scratch, "vault");
const support = join(scratch, "support");
vaultDemoVault(join(repo, "packages/core/fixtures/obsidian-vault"), vault);

// run-hidden's default debug port is whoever got there first, and another
// session's app may hold it: a drive would then talk to the wrong window.
const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

const launch = async (png, drive, after = 30000) => {
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
        join(here, "vault-demo", drive),
        "--after",
        String(after),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          VAULT_DEMO_VAULT: vault,
          VITRINE_ARXIV_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_OPENALEX_ENDPOINT: "http://127.0.0.1:9",
          VITRINE_CREDENTIALS: "memory",
        },
      }
    );
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${png}: exit ${code}`))
    );
  });
};

try {
  await launch("1-tree.png", "tree.mjs", 8000);
  await launch("2-typing-saves.png", "edit.mjs", 20000);
  await launch("3-broken-shape.png", "broken.mjs", 45000);
  await launch("4-backlinks.png", "backlinks.mjs", 10000);
  await launch("5-tags.png", "tags.mjs", 10000);
  await launch("6-search.png", "search.mjs", 10000);
  await launch("7-changed-on-disk.png", "disk.mjs", 15000);
  await launch("8-disk-actions.png", "disk-actions.mjs", 30000);
  await launch("9-follow-links.png", "follow.mjs", 15000);
  console.log(`scratch vault: ${vault}`);
} finally {
  if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
}
