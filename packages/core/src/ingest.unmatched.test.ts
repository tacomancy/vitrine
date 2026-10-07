import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LooseEnds, UnmatchedRow } from "./index.js";
import {
  closeCores,
  core,
  fixtures,
  vaultWith,
  DELIVERY_TEST_BUDGET_MS,
} from "./test-core.js";

afterEach(closeCores);

// Unmatched annotations in Loose Ends and their three resolutions (#421; spec
// #416 stories 45–58). Driven as the researcher's window drives them: a PDF
// returns, the dashboard is read, a row is resolved through the router, and
// what is observed is the note, the sidecar and the links that were not
// touched.

const pdf = (name: string) => readFile(join(fixtures, "pdf", name));
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const SOURCE = `---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.
`;

const PLAN = "See [[rasch2013#^h2]] for the effect.\n";
const QUESTION =
  "---\nkind: question\nid: q-1\nquestion: Why?\nstatus: open\ncaptured: 2026-09-29T10:00:00Z\nfrom: '[[rasch2013]]'\nannotation: h2\ncontext: reading\n---\n";

type Entry = {
  id: string;
  block?: string;
  quads: number[][];
  quote: string;
  page: number;
  unmatched_since?: string;
  document_changed_at?: string;
  gone_at?: string;
  removed_at?: string;
  previous_quote?: string;
};
type Stored = {
  next_block: number;
  file: { hash: string };
  annotations: Entry[];
  held?: unknown[];
};

async function opened(extra: Record<string, string> = {}) {
  const vault = await vaultWith({
    "sources/rasch2013.md": SOURCE,
    "sources/pdf/rasch2013.pdf": "",
    ...extra,
  });
  await writeFile(
    join(vault, "sources/pdf/rasch2013.pdf"),
    await pdf("synthetic-body.pdf")
  );
  const c = await core({ settleMs: 40 });
  await c.mutate("vault.open", { path: vault });
  await c.indexed();
  const sidecar = async () =>
    JSON.parse(
      await readFile(join(vault, ".vitrine/annotations/src-1.json"), "utf8")
    ) as Stored;
  const source = () => readFile(join(vault, "sources/rasch2013.md"), "utf8");
  const returned = async (name: string) => {
    const bytes = await pdf(name);
    await writeFile(join(vault, "sources/pdf/rasch2013.pdf"), bytes);
    await vi.waitFor(
      async () => expect((await sidecar()).file.hash).toBe(sha256(bytes)),
      { timeout: 4000, interval: 25 }
    );
    return sidecar();
  };
  const rows = async () => {
    const reply = await c.query<LooseEnds>("looseEnds.rows");
    return reply.result!.data;
  };
  const unmatched = async (): Promise<UnmatchedRow[]> =>
    (await rows()).groups
      .filter((g) => g.group === "Broken plumbing")
      .flatMap((g) => g.rows)
      .filter(
        (r): r is UnmatchedRow =>
          r.kind === "unmatched-annotation" || r.kind === "document-changed"
      );
  const id = async (block: string) =>
    (await sidecar()).annotations.find((a) => a.block === block)!.id;
  return { vault, c, sidecar, source, returned, rows, unmatched, id };
}

/** Deleted in Preview, and the note links to it: Unmatched, not removed. */
async function withLostLink() {
  const t = await opened({
    "notes/plan.md": PLAN,
    "questions/why.md": QUESTION,
  });
  await t.returned("annotated.pdf");
  await t.returned("annotated-fewer.pdf");
  return t;
}

describe("an Unmatched annotation in Loose Ends", () => {
  it("is a Broken plumbing row with its quote as it was, its page and what linked to it", async () => {
    const t = await withLostLink();
    const ends = await t.rows();
    expect(ends.groups.map((g) => g.group)).toEqual(["Broken plumbing"]);
    expect(await t.unmatched()).toEqual([
      expect.objectContaining({
        kind: "unmatched-annotation",
        title: "Odor cues during slow-wave sleep",
        block: "h2",
        quote: "difference was reliable across the downstream analyses",
        page: expect.any(Number) as number,
        links: [
          expect.objectContaining({ path: "notes/plan.md" }),
          expect.objectContaining({ path: "questions/why.md" }),
        ],
      }),
    ]);
  });

  it("is not there when nothing is Unmatched — only the paper nothing links to", async () => {
    const t = await opened();
    await t.returned("annotated.pdf");
    expect((await t.rows()).groups.map((g) => g.group)).toEqual([
      "Disconnected material",
    ]);
    expect(await t.unmatched()).toEqual([]);
    expect(JSON.stringify(await t.rows())).not.toContain("total");
  });

  it("persists across a restart of the core until resolved", async () => {
    const t = await withLostLink();
    await t.c.close();
    const c = await core({ settleMs: 40 });
    await c.mutate("vault.open", { path: t.vault });
    await c.indexed();
    const reply = await c.query<LooseEnds>("looseEnds.rows");
    expect(reply.result!.data.groups[0]!.rows).toHaveLength(1);
  });
});

describe.each(["dropLinks", "treatAsNew"] as const)("%s", (act) => {
  it("leaves a (gone) block, every link as it was, and the row resolved", async () => {
    const t = await withLostLink();
    const before = await readFile(join(t.vault, "notes/plan.md"), "utf8");
    const id = await t.id("h2");
    const done = await t.c.mutate(`unmatched.${act}`, {
      source: "sources/rasch2013.md",
      annotations: [id],
    });
    expect(done.error).toBeUndefined();
    expect(await t.source()).toContain(
      '"difference was reliable across the downstream analyses" (gone) ^h2'
    );
    expect(await readFile(join(t.vault, "notes/plan.md"), "utf8")).toBe(before);
    const kept = (await t.sidecar()).annotations.find((a) => a.id === id)!;
    expect(kept.gone_at).toBeDefined();
    expect(kept.unmatched_since).toBeUndefined();
    expect(kept.quote).toBe(
      "difference was reliable across the downstream analyses"
    );
    expect(await t.unmatched()).toEqual([]);
  });

  it(
    "is the same Tombstone whichever it was called, and survives the next Ingest",
    async () => {
      const t = await withLostLink();
      const id = await t.id("h2");
      await t.c.mutate(`unmatched.${act}`, {
        source: "sources/rasch2013.md",
        annotations: [id],
      });
      // The highlight put back is a new one; the tombstone is not revived.
      const again = await t.returned("annotated.pdf");
      expect(again.annotations.find((a) => a.id === id)!.gone_at).toBeDefined();
      expect(await t.source()).toContain("(gone) ^h2");
      expect(await t.unmatched()).toEqual([]);
    },
    DELIVERY_TEST_BUDGET_MS
  );

  it("refuses an annotation that is not waiting for a decision, in words", async () => {
    const t = await withLostLink();
    const other = await t.id("h1");
    const done = await t.c.mutate(`unmatched.${act}`, {
      source: "sources/rasch2013.md",
      annotations: [other],
    });
    expect(done.error?.message).toMatch(/no longer waiting for a decision/);
    expect(await t.source()).not.toContain("(gone)");
  });
});

describe("two identical highlights that could not be told apart", () => {
  const twins = async () => {
    const t = await opened();
    await t.returned("twins.pdf");
    await t.returned("twins-moved.pdf");
    return t;
  };

  it("offer each other's places as relink candidates, ranked", async () => {
    const t = await twins();
    const rows = await t.unmatched();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.kind).toBe("unmatched-annotation");
      if (row.kind === "unmatched-annotation") {
        expect(row.candidates).toHaveLength(2);
        expect(row.candidates.every((c) => c.ref.startsWith("held:"))).toBe(
          true
        );
      }
    }
  });

  it("relink moves the identity to the chosen annotation and keeps its block", async () => {
    const t = await twins();
    const [first] = await t.unmatched();
    if (first?.kind !== "unmatched-annotation") throw new Error("shape");
    const before = (await t.sidecar()).annotations.find(
      (a) => a.id === first.annotation
    )!;
    const done = await t.c.mutate("unmatched.relink", {
      source: first.path,
      annotation: first.annotation,
      candidate: first.candidates[0]!.ref,
    });
    expect(done.error).toBeUndefined();
    const after = await t.sidecar();
    const moved = after.annotations.find((a) => a.id === first.annotation)!;
    expect(moved.block).toBe(before.block);
    expect(moved.unmatched_since).toBeUndefined();
    expect(moved.quads).not.toEqual(before.quads);
    expect(after.held).toHaveLength(1);
    expect(await t.source()).not.toContain(`(unmatched) ^${before.block}`);
    // The other is still a decision, and relinking it is still possible.
    expect(await t.unmatched()).toHaveLength(1);
  });

  it("a batch resolves both and the annotations they might have been become new", async () => {
    const t = await twins();
    const ids = [await t.id("h1"), await t.id("h2")];
    const done = await t.c.mutate("unmatched.treatAsNew", {
      source: "sources/rasch2013.md",
      annotations: ids,
    });
    expect(done.error).toBeUndefined();
    const after = await t.sidecar();
    expect(after.held).toEqual([]);
    expect(after.annotations.filter((a) => a.gone_at)).toHaveLength(2);
    // Fresh identities on fresh block numbers: h1 and h2 are spent.
    expect(after.annotations.map((a) => a.block).sort()).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
    ]);
    expect(await t.source()).toMatch(/\(gone\) \^h1/);
    expect(await t.source()).toMatch(/"Twin sentence here\."\s*\^h3/);
    expect(await t.unmatched()).toEqual([]);
  });

  it("relink refuses a choice the file no longer offers", async () => {
    const t = await twins();
    const [first] = await t.unmatched();
    if (first?.kind !== "unmatched-annotation") throw new Error("shape");
    const done = await t.c.mutate("unmatched.relink", {
      source: first.path,
      annotation: first.annotation,
      candidate: "held:9",
    });
    expect(done.error?.message).toMatch(/no longer one of the choices/);
  });
});

describe("a replaced document", () => {
  const links = Object.fromEntries([
    [
      "notes/plan.md",
      "[[rasch2013#^h1]] [[rasch2013#^h2]] [[rasch2013#^h3]] [[rasch2013#^h4]]\n",
    ],
  ]);
  const replaced = async () => {
    const t = await opened(links);
    await t.returned("annotated.pdf");
    await t.returned("replaced.pdf");
    return t;
  };

  it("is one row, headed by the event, holding every annotation it left", async () => {
    const t = await replaced();
    const rows = await t.unmatched();
    expect(rows).toHaveLength(1);
    const [group] = rows;
    if (group?.kind !== "document-changed") throw new Error("shape");
    expect(group.annotations.length).toBeGreaterThan(1);
    expect(group.title).toBe("Odor cues during slow-wave sleep");
  });

  it("relinks per annotation to a fresh one nothing links to, retiring that identity's block", async () => {
    const t = await replaced();
    const [group] = await t.unmatched();
    if (group?.kind !== "document-changed") throw new Error("shape");
    const row = group.annotations.find((a) =>
      a.candidates.some((c) => c.ref.startsWith("entry:"))
    )!;
    expect(row).toBeDefined();
    const choice = row.candidates.find((c) => c.ref.startsWith("entry:"))!;
    const fresh = (await t.sidecar()).annotations.find(
      (a) => `entry:${a.id}` === choice.ref
    )!;
    const done = await t.c.mutate("unmatched.relink", {
      source: row.path,
      annotation: row.annotation,
      candidate: choice.ref,
    });
    expect(done.error).toBeUndefined();
    const after = await t.sidecar();
    const kept = after.annotations.find((a) => a.id === row.annotation)!;
    expect(kept.quote).toBe(choice.quote);
    expect(kept.previous_quote).toBe(row.quote);
    expect(
      after.annotations.find((a) => a.id === fresh.id)!.removed_at
    ).toBeDefined();
    expect(await t.source()).not.toContain(`^${fresh.block}`);
    expect(await t.source()).toContain(`^${row.block}`);
  });

  it("is dropped in one act, and the group goes", async () => {
    const t = await replaced();
    const [group] = await t.unmatched();
    if (group?.kind !== "document-changed") throw new Error("shape");
    const done = await t.c.mutate("unmatched.dropLinks", {
      source: group.path,
      annotations: group.annotations.map((a) => a.annotation),
    });
    expect(done.error).toBeUndefined();
    expect(await t.unmatched()).toEqual([]);
    const note = await t.source();
    for (const a of group.annotations) {
      expect(note).toContain(`(gone) ^${a.block}`);
    }
  });

  it("is refused whole when one of its annotations is not waiting, changing nothing", async () => {
    const t = await replaced();
    const [group] = await t.unmatched();
    if (group?.kind !== "document-changed") throw new Error("shape");
    const done = await t.c.mutate("unmatched.dropLinks", {
      source: group.path,
      annotations: [group.annotations[0]!.annotation, "nope"],
    });
    expect(done.error?.message).toMatch(/no longer waiting/);
    expect(await t.source()).not.toContain("(gone)");
  });
});

describe("mark deliberate", () => {
  it("takes the row out permanently, and its undo brings it back", async () => {
    const t = await withLostLink();
    const [row] = await t.unmatched();
    await t.c.mutate("looseEnds.dismiss", {
      subject: row!.subject,
      kind: row!.kind,
    });
    expect(await t.unmatched()).toEqual([]);
    // Nothing was lost: the block still reads Unmatched in the note.
    expect(await t.source()).toContain("(unmatched) ^h2");
    await t.c.mutate("looseEnds.undismiss", {
      subject: row!.subject,
      kind: row!.kind,
    });
    expect(await t.unmatched()).toHaveLength(1);
  });
});
