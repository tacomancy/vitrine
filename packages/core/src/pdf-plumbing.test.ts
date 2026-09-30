import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Host } from "./host.js";
import type { LooseEnds, LooseEndRow } from "./index.js";
import {
  closeCores,
  core,
  fakeHost,
  fixtures,
  vaultWith,
} from "./test-core.js";

afterEach(closeCores);

// The PDF folder's later rows (#423; spec #416 stories 59–64, 68–69): a
// conflict copy, a PDF that is gone, and a Source read and never used.
// Driven as the window drives them — the folder changes, Loose Ends is read,
// a row is resolved through the router — and observed on disk.

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

/** Records what it was asked to Trash, and does what a Trash does: the file leaves. */
function trashingHost(): Host & { trashed: string[] } {
  const trashed: string[] = [];
  return {
    ...fakeHost(null),
    trashed,
    trash: async (path) => {
      trashed.push(path);
      await rm(path);
    },
  };
}

async function opened(
  extra: Record<string, string> = {},
  { linked = true }: { linked?: boolean } = {}
) {
  const vault = await vaultWith({
    "sources/rasch2013.md": SOURCE,
    "sources/pdf/rasch2013.pdf": "",
    ...(linked ? { "notes/plan.md": "See [[rasch2013#^h1]].\n" } : {}),
    ...extra,
  });
  await writeFile(
    join(vault, "sources/pdf/rasch2013.pdf"),
    await pdf("annotated.pdf")
  );
  const host = trashingHost();
  const c = await core({ settleMs: 40, host });
  await c.mutate("vault.open", { path: vault });
  await c.indexed();
  const sidecarPath = join(vault, ".vitrine/annotations/src-1.json");
  const sidecar = async () =>
    JSON.parse(await readFile(sidecarPath, "utf8")) as {
      file: { hash: string };
    };
  const ingested = async (bytes: Buffer) =>
    vi.waitFor(
      async () => expect((await sidecar()).file.hash).toBe(sha256(bytes)),
      { timeout: 4000, interval: 25 }
    );
  await ingested(await pdf("annotated.pdf"));
  const rows = async () => {
    const reply = await c.query<LooseEnds>("looseEnds.rows");
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  const all = async (): Promise<LooseEndRow[]> =>
    (await rows()).groups.flatMap((g) => g.rows);
  const kinds = async () => (await all()).map((r) => r.kind);
  const folder = () =>
    readdir(join(vault, "sources/pdf")).then((f) => f.sort());
  const arrives = async (name: string, bytes: Buffer) => {
    await writeFile(join(vault, "sources/pdf", name), bytes);
    // The watcher settles it into the index, and says so.
    await vi.waitFor(
      () =>
        expect(
          c.changes.some((e) => e.changed.includes(`sources/pdf/${name}`))
        ).toBe(true),
      { timeout: 4000, interval: 25 }
    );
  };
  return {
    vault,
    c,
    host,
    sidecar,
    ingested,
    rows,
    all,
    kinds,
    folder,
    arrives,
    note: () => readFile(join(vault, "sources/rasch2013.md"), "utf8"),
  };
}

describe("a conflict copy", () => {
  it("is a Broken plumbing row, never a Source of its own and never a no-Source row", async () => {
    const t = await opened();
    // The iPad saved while the Mac held the file: the same paper, one
    // annotation fewer, under the name a sync service gives a second copy.
    await t.arrives(
      "rasch2013 (conflicted copy).pdf",
      await pdf("annotated-fewer.pdf")
    );
    const ends = await t.rows();
    expect(ends.groups.map((g) => g.group)).toEqual(["Broken plumbing"]);
    expect(ends.groups[0]!.rows).toEqual([
      expect.objectContaining({
        kind: "conflict-copy",
        title: "rasch2013 (conflicted copy).pdf",
        source: "sources/rasch2013.md",
        sourceTitle: "Odor cues during slow-wave sleep",
      }),
    ]);
    // Not offered to be a Source: nothing but the one Source exists.
    expect(await t.kinds()).toEqual(["conflict-copy"]);
  });

  it("leaves a different paper as the no-Source row it is", async () => {
    const t = await opened();
    await t.arrives("other.pdf", await pdf("synthetic-other.pdf"));
    expect(await t.kinds()).toEqual(["no-source"]);
  });

  it("carries no path in anything it says", async () => {
    const t = await opened();
    await t.arrives("copy.pdf", await pdf("annotated-fewer.pdf"));
    expect(JSON.stringify(await t.rows())).not.toContain(t.vault);
  });

  it("is replaced by *use this copy*: the canonical file takes its bytes, the copy is gone and the next Ingest re-matches", async () => {
    const t = await opened();
    const copy = await pdf("annotated-fewer.pdf");
    await t.arrives("copy.pdf", copy);
    const reply = await t.c.mutate("sources.resolveConflict", {
      copy: "sources/pdf/copy.pdf",
      resolution: "use",
    });
    expect(reply.error).toBeUndefined();
    expect(await t.folder()).toEqual(["rasch2013.pdf"]);
    expect(await readFile(join(t.vault, "sources/pdf/rasch2013.pdf"))).toEqual(
      copy
    );
    await t.ingested(copy);
    expect(await t.kinds()).not.toContain("conflict-copy");
  });

  it("is sent to the Trash by *discard*, and the canonical file is untouched", async () => {
    const t = await opened();
    const canonical = await pdf("annotated.pdf");
    await t.arrives("copy.pdf", await pdf("annotated-fewer.pdf"));
    const reply = await t.c.mutate("sources.resolveConflict", {
      copy: "sources/pdf/copy.pdf",
      resolution: "discard",
    });
    expect(reply.error).toBeUndefined();
    expect(t.host.trashed).toEqual([join(t.vault, "sources/pdf/copy.pdf")]);
    expect(await t.folder()).toEqual(["rasch2013.pdf"]);
    expect(await readFile(join(t.vault, "sources/pdf/rasch2013.pdf"))).toEqual(
      canonical
    );
    await vi.waitFor(async () => expect(await t.kinds()).toEqual([]));
  });

  it("is not something either resolution will act on for a file that is not one", async () => {
    const t = await opened();
    await t.arrives("other.pdf", await pdf("synthetic-other.pdf"));
    for (const path of ["sources/pdf/other.pdf", "sources/pdf/rasch2013.pdf"]) {
      for (const resolution of ["use", "discard"]) {
        const reply = await t.c.mutate("sources.resolveConflict", {
          copy: path,
          resolution,
        });
        expect(reply.error?.message).toMatch(/no longer a copy/);
      }
    }
    expect(t.host.trashed).toEqual([]);
    expect(await t.folder()).toEqual(["other.pdf", "rasch2013.pdf"]);
  });

  it("can be marked deliberate", async () => {
    const t = await opened();
    await t.arrives("copy.pdf", await pdf("annotated-fewer.pdf"));
    await t.c.mutate("looseEnds.dismiss", {
      subject: "sources/pdf/copy.pdf",
      kind: "conflict-copy",
    });
    expect(await t.kinds()).toEqual([]);
  });
});

describe("a PDF that is gone", () => {
  async function missing() {
    const t = await opened();
    await rm(join(t.vault, "sources/pdf/rasch2013.pdf"));
    await vi.waitFor(
      async () => expect(await t.kinds()).toContain("pdf-missing"),
      {
        timeout: 4000,
        interval: 25,
      }
    );
    return t;
  }

  it("is a Broken plumbing row naming the file, with no path", async () => {
    const t = await missing();
    const ends = await t.rows();
    const row = ends.groups.find((g) => g.group === "Broken plumbing")!.rows;
    expect(row).toEqual([
      expect.objectContaining({
        kind: "pdf-missing",
        path: "sources/rasch2013.md",
        title: "Odor cues during slow-wave sleep",
        file: "rasch2013.pdf",
      }),
    ]);
    expect(JSON.stringify(ends)).not.toContain(t.vault);
  });

  it("refuses to locate a file that is not the same document, in plain words", async () => {
    const t = await missing();
    await t.arrives("stranger.pdf", await pdf("synthetic-other.pdf"));
    const reply = await t.c.mutate("sources.locate", {
      source: "sources/rasch2013.md",
      pdf: "sources/pdf/stranger.pdf",
    });
    expect(reply.error?.message).toMatch(/not the same document/);
    expect(reply.error?.message).not.toContain(t.vault);
    expect(await t.note()).toContain("pdf: rasch2013.pdf");
  });

  it("locates a file that is the same document, and the Source names it", async () => {
    const t = await missing();
    const found = await pdf("annotated-fewer.pdf");
    await t.arrives("moved-elsewhere.pdf", found);
    const reply = await t.c.mutate("sources.locate", {
      source: "sources/rasch2013.md",
      pdf: "sources/pdf/moved-elsewhere.pdf",
    });
    expect(reply.error).toBeUndefined();
    expect(await t.note()).toContain("pdf: moved-elsewhere.pdf");
    await t.ingested(found);
    expect(await t.kinds()).not.toContain("pdf-missing");
  });

  it("detaches: `pdf:` is cleared and the blocks, the sidecar and the links stay", async () => {
    const t = await opened();
    const before = await readFile(
      join(t.vault, ".vitrine/annotations/src-1.json"),
      "utf8"
    );
    const blocks = (await t.note()).match(/\^h\d+/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    await rm(join(t.vault, "sources/pdf/rasch2013.pdf"));
    await vi.waitFor(
      async () => expect(await t.kinds()).toContain("pdf-missing"),
      {
        timeout: 4000,
        interval: 25,
      }
    );
    const reply = await t.c.mutate("sources.detach", {
      source: "sources/rasch2013.md",
    });
    expect(reply.error).toBeUndefined();
    const note = await t.note();
    expect(note).toContain('pdf: ""');
    expect(note.match(/\^h\d+/g)).toEqual(blocks);
    expect(
      await readFile(join(t.vault, ".vitrine/annotations/src-1.json"), "utf8")
    ).toBe(before);
    // Still resolves: the block the plan links to is in the note.
    expect(await t.kinds()).not.toContain("pdf-missing");
    const links = await t.c.query<{ links: Array<{ resolution: string }> }>(
      "vault.outline",
      { path: "notes/plan.md" }
    );
    expect(JSON.stringify(links.result?.data)).not.toContain("unresolved");
  });

  it("is refused to be detached while the file is there", async () => {
    const t = await opened();
    const reply = await t.c.mutate("sources.detach", {
      source: "sources/rasch2013.md",
    });
    expect(reply.error?.message).toMatch(/not missing/);
    expect(await t.note()).toContain("pdf: rasch2013.pdf");
  });

  it("is a row even for a Source that was never ingested, and detach still works", async () => {
    const vault = await vaultWith({
      "sources/rasch2013.md": SOURCE,
      "sources/pdf/stranger.pdf": "%PDF-1.4 unrelated\n",
    });
    const c = await core({ settleMs: 40 });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const reply = await c.query<LooseEnds>("looseEnds.rows");
    const rows = reply.result!.data.groups.flatMap((g) => g.rows);
    expect(rows.map((r) => r.kind)).toContain("pdf-missing");
    const locate = await c.mutate("sources.locate", {
      source: "sources/rasch2013.md",
      pdf: "sources/pdf/stranger.pdf",
    });
    expect(locate.error?.message).toMatch(/Nothing has been recorded/);
    const detach = await c.mutate("sources.detach", {
      source: "sources/rasch2013.md",
    });
    expect(detach.error).toBeUndefined();
  });

  it("can be marked deliberate", async () => {
    const t = await missing();
    await t.c.mutate("looseEnds.dismiss", {
      subject: "src-1",
      kind: "pdf-missing",
    });
    expect(await t.kinds()).not.toContain("pdf-missing");
  });
});

describe("a Source with annotations that nothing links to", () => {
  it("is a Disconnected material row, and linking any one of them removes it", async () => {
    const t = await opened({}, { linked: false });
    const ends = await t.rows();
    expect(ends.groups.map((g) => g.group)).toEqual(["Disconnected material"]);
    expect(ends.groups[0]!.rows).toEqual([
      expect.objectContaining({
        kind: "unlinked-annotations",
        path: "sources/rasch2013.md",
        title: "Odor cues during slow-wave sleep",
        annotations: expect.any(Number) as number,
      }),
    ]);
    await writeFile(join(t.vault, "notes-plan.md"), "See [[rasch2013#^h1]].\n");
    await vi.waitFor(async () => expect(await t.kinds()).toEqual([]), {
      timeout: 4000,
      interval: 25,
    });
  });

  it("is not there for a Source whose PDF has no annotations", async () => {
    const vault = await vaultWith({
      "sources/rasch2013.md": SOURCE,
      "sources/pdf/rasch2013.pdf": "",
    });
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("synthetic-body.pdf")
    );
    const c = await core({ settleMs: 40 });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const reply = await c.query<LooseEnds>("looseEnds.rows");
    expect(reply.result!.data.groups).toEqual([]);
  });

  it("can be marked deliberate", async () => {
    const t = await opened({}, { linked: false });
    await t.c.mutate("looseEnds.dismiss", {
      subject: "src-1",
      kind: "unlinked-annotations",
    });
    expect(await t.kinds()).toEqual([]);
  });
});
