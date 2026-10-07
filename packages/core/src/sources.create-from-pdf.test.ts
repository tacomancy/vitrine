import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { citekeyFor } from "./sources.js";
import type { LooseEnds, LooseEndRow } from "./loose-ends.js";
import {
  closeCores,
  core,
  fixtures,
  vaultWith,
  LONG_RUN_WINDOW_MS,
} from "./test-core.js";

afterEach(closeCores);

// *Create a Source* on a no-Source row, and the *PDF unreadable* row a file
// the engine cannot read becomes (#418; spec #416 stories 6–9, 65–67, 111).
// Driven through the core in-process, the real engine behind it.

type Created =
  | { readable: true; path: string; citekey: string; id: string }
  | { readable: false; reason: string };

const pdfFixture = (name: string) => join(fixtures, "pdf", name);

// A vault with a PDF folder (a `.keep` so it exists before the PDFs are copied in).
const withFolder = async (
  pdfs: Record<string, string | Buffer>,
  options?: Parameters<typeof core>[0]
) => {
  const vault = await vaultWith({
    "questions/x.md": "# x\n",
    "sources/pdf/.keep": "",
  });
  return { vault, ...(await openIn(vault, pdfs, options)) };
};

async function openIn(
  vault: string,
  pdfs: Record<string, string | Buffer>,
  options: Parameters<typeof core>[0] = {}
) {
  for (const [name, source] of Object.entries(pdfs)) {
    const target = join(vault, "sources/pdf", name);
    if (typeof source === "string") {
      await copyFile(pdfFixture(source), target);
    } else {
      await writeFile(target, source);
    }
  }
  // A run window no test waits out: what this waits on must not wait for it (#553).
  const c = await core({
    settleMs: 40,
    runWindowMs: LONG_RUN_WINDOW_MS,
    newId: () => "src-minted-1",
    ...options,
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const ends = async () =>
    (await c.query<LooseEnds>("looseEnds.rows")).result!.data;
  const rowsOf = async (kind: LooseEndRow["kind"]) =>
    (await ends()).groups.flatMap((g) => g.rows).filter((r) => r.kind === kind);
  const create = (pdf: string) =>
    c.mutate<Created>("sources.createFromFile", { pdf: `sources/pdf/${pdf}` });
  const again = (pdf: string) =>
    c.mutate<{ readable: boolean; reason?: string }>("sources.tryAgain", {
      pdf: `sources/pdf/${pdf}`,
    });
  return { c, ends, rowsOf, create, again };
}

describe("sources.createFromFile", () => {
  it("writes a Source with the PDF's title and authors and the citekey a stub would get", async () => {
    const { vault, create, c } = await withFolder({
      "paper.pdf": "synthetic-info.pdf",
    });
    const reply = await create("paper.pdf");
    expect(reply.error).toBeUndefined();
    const made = reply.result!.data;
    if (!made.readable) throw new Error("expected a Source");
    // The rule a hand-made stub gets, over the same title and authors.
    expect(made.citekey).toBe(
      citekeyFor({
        authors: "Jens G. Klinzing; Jan Born",
        year: "",
        title: "Odor cues and the invented night",
      })
    );
    expect(made.path).toBe(`sources/${made.citekey}.md`);
    expect(made.id).toBe("src-minted-1");
    expect(await readFile(join(vault, made.path), "utf8")).toBe(
      [
        "---",
        "kind: source",
        "id: src-minted-1",
        "citekey: klinzing",
        "title: Odor cues and the invented night",
        "authors:",
        "  - Jens G. Klinzing",
        "  - Jan Born",
        "pdf: paper.pdf",
        "---",
        "",
      ].join("\n")
    );
    // The PDF itself is exactly as it was.
    expect(await readFile(join(vault, "sources/pdf/paper.pdf"))).toEqual(
      await readFile(pdfFixture("synthetic-info.pdf"))
    );
    await c.indexed();
  });

  it("reads the file at once, so an annotated paper's blocks are in its new Source", async () => {
    const { vault, create, c } = await withFolder({
      "paper.pdf": "annotated-questions.pdf",
    });
    const events = await c.events();
    const made = (await create("paper.pdf")).result!.data;
    if (!made.readable) throw new Error("expected a Source");
    expect((await events.next("ingestLanded")).summary.new).toBeGreaterThan(0);
    expect(await readFile(join(vault, made.path), "utf8")).toMatch(/\^h1/);
  });

  it("falls back to the file name for a missing title and leaves out authors it does not have", async () => {
    const { vault, create } = await withFolder({
      "Whatever it was called.pdf": "synthetic-no-info.pdf",
    });
    const made = (await create("Whatever it was called.pdf")).result!.data;
    if (!made.readable) throw new Error("expected a Source");
    expect(made.citekey).toBe("whatever");
    const text = await readFile(join(vault, made.path), "utf8");
    expect(text).toBe(
      [
        "---",
        "kind: source",
        "id: src-minted-1",
        "citekey: whatever",
        "title: Whatever it was called",
        "pdf: Whatever it was called.pdf",
        "---",
        "",
      ].join("\n")
    );
  });

  it("keeps the author it was given when there is no title", async () => {
    const { vault, create } = await withFolder({
      "reyes.pdf": "synthetic-no-title.pdf",
    });
    const made = (await create("reyes.pdf")).result!.data;
    if (!made.readable) throw new Error("expected a Source");
    const text = await readFile(join(vault, made.path), "utf8");
    expect(text).toContain("title: reyes\n");
    expect(text).toContain("authors:\n  - Ana Reyes\n");
    expect(made.citekey).toBe("reyes");
  });

  it("reads a file PDFKit saved", async () => {
    const { create } = await withFolder({ "saved.pdf": "pdfkit-saved.pdf" });
    const made = (await create("saved.pdf")).result!.data;
    expect(made.readable).toBe(true);
  });

  it("takes the next citekey when two papers would share one", async () => {
    const { create } = await withFolder({
      "one.pdf": "synthetic-info.pdf",
      "two.pdf": "pdfkit-saved.pdf",
    });
    const first = (await create("one.pdf")).result!.data;
    const second = (await create("two.pdf")).result!.data;
    if (!first.readable || !second.readable) throw new Error("expected both");
    expect([first.citekey, second.citekey]).toEqual(["klinzing", "klinzinga"]);
  });

  it("clears the row: the PDF is named by the new Source", async () => {
    const { create, ends, c } = await withFolder({
      "paper.pdf": "synthetic-info.pdf",
    });
    expect((await ends()).groups).toHaveLength(1);
    await create("paper.pdf");
    await c.indexed();
    expect((await ends()).groups).toEqual([]);
  });
});

describe("a PDF the engine cannot read", () => {
  it("becomes a PDF unreadable row with a plain reason and no path, in Broken plumbing", async () => {
    const { create, ends } = await withFolder({
      "locked.pdf": "encrypted.pdf",
    });
    const reply = await create("locked.pdf");
    expect(reply.error).toBeUndefined();
    expect(reply.result!.data).toEqual({
      readable: false,
      reason: "it is protected by a password",
    });
    expect((await ends()).groups).toEqual([
      {
        group: "Broken plumbing",
        rows: [
          {
            kind: "unreadable-pdf",
            subject: "sources/pdf/locked.pdf",
            path: "sources/pdf/locked.pdf",
            title: "locked.pdf",
            reason: "it is protected by a password",
          },
        ],
      },
    ]);
  });

  it("names a damaged file, keeps answering, and still handles a second PDF in the same run", async () => {
    const good = await readFile(pdfFixture("synthetic-info.pdf"));
    const { create, rowsOf, c } = await withFolder({
      "broken.pdf": good.subarray(0, 40),
      "fine.pdf": "synthetic-info.pdf",
    });
    const broken = (await create("broken.pdf")).result!.data;
    expect(broken).toEqual({
      readable: false,
      reason: "it is damaged, or is not a PDF",
    });
    // The core is still up, and the next file reads.
    expect((await c.query("vault.status")).error).toBeUndefined();
    expect((await create("fine.pdf")).result!.data.readable).toBe(true);
    await c.indexed();
    expect((await rowsOf("unreadable-pdf")).map((r) => r.title)).toEqual([
      "broken.pdf",
    ]);
  });

  it("is not offered to the engine again on its own: create refuses it until try again", async () => {
    const { create } = await withFolder({ "locked.pdf": "encrypted.pdf" });
    await create("locked.pdf");
    const second = await create("locked.pdf");
    expect(second.error?.message).toMatch(/try again/);
  });

  it("is silenced by mark deliberate, like every row", async () => {
    const { create, c, ends } = await withFolder({
      "locked.pdf": "encrypted.pdf",
    });
    await create("locked.pdf");
    await c.mutate("looseEnds.dismiss", {
      subject: "sources/pdf/locked.pdf",
      kind: "unreadable-pdf",
    });
    expect((await ends()).groups).toEqual([]);
  });
});

describe("try again", () => {
  it("runs the engine once when asked, and a file that now reads is a no-Source row again", async () => {
    const { vault, create, again, rowsOf } = await withFolder({
      "paper.pdf": Buffer.from("not yet a pdf"),
    });
    expect((await create("paper.pdf")).result!.data.readable).toBe(false);
    // The bytes are replaced with a readable file; nothing re-reads on its
    // own, so the row is gone (a replaced file is not the one that failed)
    // but the record only clears when asked.
    await copyFile(
      pdfFixture("synthetic-info.pdf"),
      join(vault, "sources/pdf/paper.pdf")
    );
    // The watcher re-hashes the file once it has settled.
    await vi.waitFor(async () =>
      expect(await rowsOf("unreadable-pdf")).toEqual([])
    );
    expect((await rowsOf("no-source")).map((r) => r.title)).toEqual([
      "paper.pdf",
    ]);
    expect((await again("paper.pdf")).result!.data).toEqual({
      readable: true,
    });
    expect((await create("paper.pdf")).result!.data.readable).toBe(true);
  });

  it("keeps the row, with the new reason, when the file still will not read", async () => {
    const { again, create, rowsOf } = await withFolder({
      "locked.pdf": "encrypted.pdf",
    });
    await create("locked.pdf");
    expect((await again("locked.pdf")).result!.data).toEqual({
      readable: false,
      reason: "it is protected by a password",
    });
    expect(await rowsOf("unreadable-pdf")).toHaveLength(1);
  });

  it("refuses a file that is not marked unreadable", async () => {
    const { again } = await withFolder({ "paper.pdf": "synthetic-info.pdf" });
    expect((await again("paper.pdf")).error?.message).toMatch(
      /not marked unreadable/
    );
  });
});

describe("a worker that traps", () => {
  const trap = new URL("./pdf-engine.trap.worker.ts", import.meta.url);

  it("reports only that Source as unreadable, and the core and the next PDF carry on", async () => {
    const { create, rowsOf, c } = await withFolder(
      {
        "trap.pdf": Buffer.from("TRAP and the rest"),
        "next.pdf": Buffer.from("something else"),
      },
      { pdfWorker: trap }
    );
    expect((await create("trap.pdf")).result!.data).toEqual({
      readable: false,
      reason: "the reader stopped on it",
    });
    expect((await c.query("vault.status")).error).toBeUndefined();
    expect((await create("next.pdf")).result!.data.readable).toBe(true);
    await c.indexed();
    expect((await rowsOf("unreadable-pdf")).map((r) => r.title)).toEqual([
      "trap.pdf",
    ]);
  });

  it("does not retry a trapped file on its own — only try again does", async () => {
    const { create, again } = await withFolder(
      { "trap.pdf": Buffer.from("TRAP") },
      { pdfWorker: trap }
    );
    await create("trap.pdf");
    expect((await create("trap.pdf")).error?.message).toMatch(/try again/);
    expect((await again("trap.pdf")).result!.data).toEqual({
      readable: false,
      reason: "the reader stopped on it",
    });
  });
});
