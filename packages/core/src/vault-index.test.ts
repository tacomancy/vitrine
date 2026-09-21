import {
  chmod,
  mkdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { Listing } from "./list.js";
import { core, fixtureCopy, tmp, type CoreOptions } from "./test-core.js";
import type { VaultStatus } from "./vault.js";
import type { PositionsOf } from "./vault-index.js";

// The index through the harness only (spec #177 § Testing decisions): a test
// changes the vault with plain `fs`, asserts on procedure replies and on the
// files under `.vitrine/`, and never looks at a SQL row.

type Vault = { name: string; path: string };

function questionFile(text: string, captured: string) {
  return `---\nkind: question\nquestion: ${text}\nstatus: open\ncaptured: ${captured}\ncontext: other\n---\n`;
}

/** A temp vault holding `count` Questions, `Q 001.md` … in `questions/`. */
async function vaultOf(count: number): Promise<string> {
  const vault = await tmp("many");
  await mkdir(join(vault, "questions"));
  for (let n = 1; n <= count; n++) {
    const id = String(n).padStart(3, "0");
    const captured = new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString();
    await writeFile(
      join(vault, "questions", `Q ${id}.md`),
      questionFile(`Q ${id}`, captured)
    );
  }
  return vault;
}

async function opened(vault: string, opts: CoreOptions = {}) {
  const c = await core(opts);
  const reply = await c.mutate<Vault>("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  return c;
}

const listOf = async (c: Awaited<ReturnType<typeof core>>) => {
  const reply = await c.query<Listing>("questions.list");
  expect(reply.error).toBeUndefined();
  return reply.result?.data as Listing;
};

const statusOf = async (c: Awaited<ReturnType<typeof core>>) => {
  const reply = await c.query<VaultStatus>("vault.status");
  expect(reply.error).toBeUndefined();
  return reply.result?.data as VaultStatus;
};

/** A `positionsOf` stand-in for one Kind that logs what it was called with. */
function standIn(kind: string) {
  const calls: Array<{ path: string; content: string; headings: number }> = [];
  const positionsOf: PositionsOf = {
    [kind]: (outline, content) => {
      calls.push({
        path: outline.path,
        content,
        headings: outline.outline.headings.length,
      });
      return [];
    },
  };
  return { calls, positionsOf };
}

const restore: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of restore.splice(0)) await fn();
});

describe("vault.open and the index", () => {
  it("creates .vitrine/index.sqlite and a .gitignore holding exactly index.sqlite*", async () => {
    const vault = await tmp("fresh");
    await opened(vault);
    expect((await stat(join(vault, ".vitrine", "index.sqlite"))).isFile()).toBe(
      true
    );
    expect(await readFile(join(vault, ".vitrine", ".gitignore"), "utf8")).toBe(
      "index.sqlite*\n"
    );
  });

  it("leaves an existing .vitrine/.gitignore untouched", async () => {
    const vault = await tmp("ignored");
    await mkdir(join(vault, ".vitrine"));
    await writeFile(join(vault, ".vitrine", ".gitignore"), "# mine\n*.log\n");
    await opened(vault);
    expect(await readFile(join(vault, ".vitrine", ".gitignore"), "utf8")).toBe(
      "# mine\n*.log\n"
    );
  });

  it("refuses a vault whose .vitrine/ cannot be written, typed writeFailed, and opens nothing", async () => {
    const vault = await tmp("readonly");
    await mkdir(join(vault, ".vitrine"));
    await chmod(join(vault, ".vitrine"), 0o500);
    restore.push(() => chmod(join(vault, ".vitrine"), 0o700));
    const c = await core();
    const reply = await c.mutate<Vault>("vault.open", { path: vault });
    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toMatch(/\.vitrine/);
    const current = await c.query<Vault | null>("vault.current");
    expect(current.result?.data).toBeNull();
  });

  it("refuses a vault whose .vitrine/ cannot be created, typed writeFailed", async () => {
    const vault = await tmp("readonly-root");
    await chmod(vault, 0o500);
    restore.push(() => chmod(vault, 0o700));
    const c = await core();
    const reply = await c.mutate<Vault>("vault.open", { path: vault });
    expect(reply.error?.data.kind).toBe("writeFailed");
  });

  it("answers vault.current before indexing finishes, counts up, and commits 260 files in more than one chunk with questions.list growing across them", async () => {
    const vault = await vaultOf(260);
    const seen: number[] = [];
    const progress: VaultStatus["indexing"][] = [];
    const c = await core({
      onVaultChanged: async () => {
        seen.push((await listOf(c)).questions.length);
      },
      onVaultStatus: async () => {
        progress.push((await statusOf(c)).indexing);
      },
    });
    const reply = await c.mutate<Vault>("vault.open", { path: vault });
    expect(reply.error).toBeUndefined();

    // Nothing has had time to be read: the open returned first.
    const current = await c.query<Vault | null>("vault.current");
    expect(current.result?.data?.path).toBe(vault);
    expect((await statusOf(c)).current.ok).toBe(false);

    await c.indexed();
    expect(seen).toEqual([250, 260]);
    expect(progress).toContainEqual({ done: 250, total: 260 });
    expect(progress.at(-1)).toBeNull();
    expect((await listOf(c)).questions).toHaveLength(260);
  });

  it("reports current false with the sweep's reason until the build completes, then true", async () => {
    const vault = await vaultOf(3);
    const c = await opened(vault);
    const before = await statusOf(c);
    expect(before.current).toEqual({
      ok: false,
      reason: expect.stringMatching(/sweep|index/i) as string,
    });
    await c.indexed();
    expect(await statusOf(c)).toEqual({
      indexing: null,
      current: { ok: true },
    });
  });

  it("drops and rebuilds an index whose user_version differs", async () => {
    const vault = await vaultOf(2);
    await mkdir(join(vault, ".vitrine"));
    const stale = new DatabaseSync(join(vault, ".vitrine", "index.sqlite"));
    stale.exec("PRAGMA user_version = 999; CREATE TABLE files (path TEXT)");
    stale.close();

    const { calls, positionsOf } = standIn("question");
    const c = await opened(vault, { positionsOf });
    await c.indexed();
    expect((await listOf(c)).questions.map((q) => q.question)).toEqual([
      "Q 002",
      "Q 001",
    ]);
    // A rebuild outlines every file, so the stand-in saw both.
    expect(calls.map((x) => x.path).sort()).toEqual([
      "questions/Q 001.md",
      "questions/Q 002.md",
    ]);
    const rebuilt = new DatabaseSync(join(vault, ".vitrine", "index.sqlite"));
    expect(rebuilt.prepare("PRAGMA user_version").get()).not.toEqual({
      user_version: 999,
    });
    rebuilt.close();
  });

  it("drops and rebuilds a garbage index.sqlite", async () => {
    const vault = await vaultOf(2);
    await mkdir(join(vault, ".vitrine"));
    await writeFile(join(vault, ".vitrine", "index.sqlite"), "not a database");
    const c = await opened(vault);
    await c.indexed();
    expect((await listOf(c)).questions).toHaveLength(2);
    expect(await statusOf(c)).toEqual({
      indexing: null,
      current: { ok: true },
    });
  });

  it("re-outlines only what differs on a second open — a touched file is hashed and left, an edited one is read again", async () => {
    const vault = await vaultOf(3);
    const first = await opened(vault);
    await first.indexed();

    const touched = join(vault, "questions", "Q 001.md");
    const later = new Date(Date.now() + 60_000);
    await utimes(touched, later, later);
    const edited = join(vault, "questions", "Q 002.md");
    await writeFile(
      edited,
      questionFile("Q 002 edited", "2026-02-02T00:00:00Z")
    );

    const { calls, positionsOf } = standIn("question");
    const second = await opened(vault, { positionsOf });
    await second.indexed();
    expect(calls.map((x) => x.path)).toEqual(["questions/Q 002.md"]);
    expect((await listOf(second)).questions.map((q) => q.question)).toEqual([
      "Q 002 edited",
      "Q 003",
      "Q 001",
    ]);
  });
});

describe("own writes index themselves", () => {
  it("questions.capture returns with the row already in questions.list and raises vaultChanged", async () => {
    const vault = await tmp("capture");
    const { calls, positionsOf } = standIn("question");
    const c = await opened(vault, { positionsOf });
    await c.indexed();
    c.changes.length = 0;

    const reply = await c.mutate<{ path: string }>("questions.capture", {
      text: "Does this hold for sparse inputs?",
      provenance: { context: "other" },
    });
    expect(reply.error).toBeUndefined();
    const listing = await listOf(c);
    expect(listing.questions.map((q) => q.path)).toEqual([
      reply.result?.data.path,
    ]);
    expect(c.changes).toEqual([
      {
        type: "vaultChanged",
        changed: ["questions/Does this hold for sparse inputs.md"],
        removed: [],
        renamed: [],
      },
    ]);
    // The write path ran the indexer over the content it wrote.
    expect(calls).toEqual([
      {
        path: "questions/Does this hold for sparse inputs.md",
        content: await readFile(reply.result?.data.path as string, "utf8"),
        headings: 0,
      },
    ]);
  });

  it("records the stat of the file it wrote, so the next open finds nothing to re-outline", async () => {
    const vault = await tmp("stat-record");
    const c = await opened(vault);
    await c.indexed();
    await c.mutate("questions.capture", {
      text: "Recorded",
      provenance: { context: "other" },
    });

    const { calls, positionsOf } = standIn("question");
    const again = await opened(vault, { positionsOf });
    await again.indexed();
    expect(calls).toEqual([]);
    expect((await listOf(again)).questions.map((q) => q.question)).toEqual([
      "Recorded",
    ]);
  });
});

describe("the positionsOf seam", () => {
  it("is called once per outlined Markdown file of its Kind, with the outline and the content", async () => {
    const vault = await fixtureCopy("obsidian-vault");
    const { calls, positionsOf } = standIn("question");
    const c = await opened(vault, { positionsOf });
    await c.indexed();
    expect(calls).toEqual([
      {
        path: "reading/Does slow-wave density predict recall gain.md",
        content: await readFile(
          join(vault, "reading/Does slow-wave density predict recall gain.md"),
          "utf8"
        ),
        headings: 0,
      },
    ]);
  });

  it("is not called for a Kind with nothing registered", async () => {
    const vault = await fixtureCopy("obsidian-vault");
    const { calls, positionsOf } = standIn("hypothesis");
    const c = await opened(vault, { positionsOf });
    await c.indexed();
    expect(calls).toEqual([]);
  });
});

describe("problems land beside the rows", () => {
  it("a Hypothesis without ## Criteria reaches questions.list's shape channel; unreadable and partial as before", async () => {
    const vault = await tmp("problems");
    await writeFile(
      join(vault, "Claim.md"),
      "---\nkind: hypothesis\n---\n# A claim with no criteria\n"
    );
    await writeFile(join(vault, "Half.md"), "---\nkind: question\n---\n");
    await writeFile(join(vault, "Bad.md"), "---\nkind: question\nq: [\n---\n");
    const c = await opened(vault);
    await c.indexed();
    const listing = await listOf(c);
    expect(listing.shape).toEqual([
      { path: "Claim.md", kind: "hypothesis", problem: "criteriaMissing" },
    ]);
    expect(listing.partial.map((p) => p.name)).toEqual(["Half"]);
    expect(listing.unreadable.map((u) => u.path)).toEqual([
      join(vault, "Bad.md"),
    ]);
  });
});

describe("the index is disposable", () => {
  it("deleting index.sqlite while open leaves the next questions.list unchanged; the next open rebuilds", async () => {
    const vault = await vaultOf(3);
    const c = await opened(vault);
    await c.indexed();
    const before = await listOf(c);
    await rm(join(vault, ".vitrine", "index.sqlite"));
    expect(await listOf(c)).toEqual(before);

    const { calls, positionsOf } = standIn("question");
    const again = await opened(vault, { positionsOf });
    await again.indexed();
    expect(calls).toHaveLength(3);
    expect(await listOf(again)).toEqual(before);
  });
});
