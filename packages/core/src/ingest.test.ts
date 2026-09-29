import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { questionText } from "./ingest.js";
import { closeCores, core, fixtures, vaultWith } from "./test-core.js";

afterEach(closeCores);

// Ingest of a returning PDF (#419; spec #416 stories 13–24, 58): an annotated
// PDF that changes on disk is read when it settles, every markup and note
// becomes one block in its Source, and the run says what landed in one line.
// These state what a first return looks like; re-matching is
// `ingest.rematch.test.ts`.

const pdf = (name: string) => readFile(join(fixtures, "pdf", name));
const SOURCE = `---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.
`;

type Sidecar = {
  pdf: string;
  file: { size: number; mtime: number; hash: string };
  next_block: number;
  annotations: Array<Record<string, unknown>>;
  pending?: { kept: number };
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
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const events = await c.events();
  const source = () => readFile(join(vault, "sources/rasch2013.md"), "utf8");
  const sidecar = async () =>
    JSON.parse(
      await readFile(join(vault, ".vitrine/annotations/src-1.json"), "utf8")
    ) as Sidecar;
  /** Replace the PDF as Preview would on a return, and wait for the run it makes. */
  const returned = async (bytes: Buffer, name = "rasch2013.pdf") => {
    await writeFile(join(vault, "sources/pdf", name), bytes);
    return (await events.next("ingestLanded")).summary;
  };
  return { vault, c, events, source, sidecar, returned };
}

describe("an annotated PDF returning", () => {
  it("adds one block per markup and note, in page order, with the quote and then the note", async () => {
    const { source, returned } = await opened();
    expect(await returned(await pdf("annotated.pdf"))).toEqual({
      new: 6,
      questions: 0,
      removed: 0,
      unmatched: 0,
    });
    expect(await source()).toBe(`---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.

## Annotations

- p.1 · "Participants who heard the odor cue" ^h1

  Check this against the control group

- p.1 · "difference was reliable across the downstream analyses" ^h2

- p.1 · "Ask Ana about this" ^h3

- p.2 · "different sentence about memory" ^h4
`);
  });

  it("makes every block a target a link resolves to", async () => {
    const { returned, c } = await opened({
      "questions/does it hold.md":
        "---\nkind: question\nquestion: Does it hold?\nstatus: open\ncaptured: 2026-09-29T10:00:00Z\ncontext: other\nrelated: []\n---\nSee [[rasch2013#^h2]] and [[rasch2013#^h9]].\n",
    });
    await returned(await pdf("annotated.pdf"));
    await c.indexed();
    const outline = await c.query<{
      outline: { links: Array<{ blockId: string; resolution: string }> };
    }>("vault.outline", { path: "questions/does it hold.md" });
    expect(
      outline.result!.data.outline.links.map((l) => [l.blockId, l.resolution])
    ).toEqual([
      ["h2", "resolved"],
      ["h9", "unresolved"],
    ]);
  });

  it("keeps the raw values the tiers will compare, and no normalised quote", async () => {
    const { returned, sidecar } = await opened();
    await returned(await pdf("annotated.pdf"));
    const stored = await sidecar();
    expect(stored.pdf).toBe("rasch2013.pdf");
    expect(stored.next_block).toBe(5);
    const first = stored.annotations.find((a) => a["block"] === "h1")!;
    expect(first).toMatchObject({
      block: "h1",
      kind: "highlight",
      page: 0,
      quote: "Participants who heard the odor cue",
      note: "Check this against the control group",
    });
    expect(first["quads"]).toHaveLength(1);
    expect(Object.keys(first).sort()).not.toContain("normalised_quote");
    // The across-lines highlight keeps its raw case and both quads.
    const across = stored.annotations.find((a) => a["block"] === "h2")!;
    expect(across["quads"]).toHaveLength(2);
  });

  it("counts ink and a stamp and gives neither a block or a link target", async () => {
    const { returned, source, sidecar } = await opened();
    await returned(await pdf("annotated.pdf"));
    const stored = await sidecar();
    const kept = stored.annotations.filter((a) =>
      ["ink", "stamp"].includes(a["kind"] as string)
    );
    expect(kept.map((a) => a["kind"]).sort()).toEqual(["ink", "stamp"]);
    expect(kept.every((a) => a["block"] === undefined)).toBe(true);
    expect(await source()).not.toMatch(/ink|stamp/);
  });

  it("never reuses a block number, even after everything before it is gone", async () => {
    const { returned, source, sidecar } = await opened();
    await returned(await pdf("annotated.pdf"));
    expect((await sidecar()).next_block).toBe(5);
    await returned(await pdf("annotated-again.pdf"));
    // Nothing in the new file is any of the four: they are removed, their
    // blocks leave the note, and what is new takes the next number.
    const text = await source();
    expect(text).toContain('"Another line follows here for a highlight" ^h5');
    expect((await sidecar()).next_block).toBe(6);
    expect(text.match(/\^h\d+/g)).toEqual(["^h5"]);
  });

  it("writes nothing to the PDF", async () => {
    const { vault, returned } = await opened();
    const bytes = await pdf("annotated.pdf");
    await returned(bytes);
    expect(
      Buffer.compare(
        await readFile(join(vault, "sources/pdf/rasch2013.pdf")),
        bytes
      )
    ).toBe(0);
  });

  it("says nothing when the file has not changed since it was read", async () => {
    const { returned, events, vault } = await opened();
    await returned(await pdf("annotated.pdf"));
    // The same bytes again, touched: a sync client's rewrite is no change.
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated.pdf")
    );
    await expect(
      events.next("ingestLanded", { timeoutMs: 400 })
    ).rejects.toThrow();
  });
});

describe("a Source with a PDF and no id", () => {
  const BARE = `---
kind: source
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.
`;

  it("is given an id on its first return, changing that one key and nothing else", async () => {
    const vault = await vaultWith({
      "sources/rasch2013.md": BARE,
      "sources/pdf/rasch2013.pdf": "",
    });
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("synthetic-body.pdf")
    );
    const c = await core({ settleMs: 40, newId: () => "src-minted-9" });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const events = await c.events();
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated.pdf")
    );
    await events.next("ingestLanded");
    const text = await readFile(join(vault, "sources/rasch2013.md"), "utf8");
    expect(text.replace("id: src-minted-9\n", "")).toBe(
      BARE + "\n## Annotations\n" + text.split("## Annotations\n")[1]
    );
    expect(text).toContain("id: src-minted-9\n");
    const stored = JSON.parse(
      await readFile(
        join(vault, ".vitrine/annotations/src-minted-9.json"),
        "utf8"
      )
    ) as Sidecar;
    expect(stored.annotations).toHaveLength(6);
  });

  it("keeps the id it minted when the next PDF returns", async () => {
    const vault = await vaultWith({
      "sources/rasch2013.md": BARE,
      "sources/pdf/rasch2013.pdf": "",
    });
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("synthetic-body.pdf")
    );
    let n = 0;
    const c = await core({ settleMs: 40, newId: () => `minted-${++n}` });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const events = await c.events();
    for (const name of ["annotated.pdf", "annotated-again.pdf"]) {
      await writeFile(
        join(vault, "sources/pdf/rasch2013.pdf"),
        await pdf(name)
      );
      await events.next("ingestLanded");
    }
    const text = await readFile(join(vault, "sources/rasch2013.md"), "utf8");
    expect(text.match(/^id: /gm)).toHaveLength(1);
  });
});

describe("an Ingest that could not finish", () => {
  it("is taken up again without adding the same annotations twice", async () => {
    const { c, vault, events, source, sidecar } = await opened();
    // A folder that refuses the note's rename: the counter lands, the blocks cannot.
    await chmod(join(vault, "sources"), 0o555);
    try {
      await writeFile(
        join(vault, "sources/pdf/rasch2013.pdf"),
        await pdf("annotated.pdf")
      );
      await expect(
        events.next("ingestLanded", { timeoutMs: 800 })
      ).rejects.toThrow();
    } finally {
      await chmod(join(vault, "sources"), 0o755);
    }
    expect((await sidecar()).pending).toEqual({
      kept: 0,
      removed: 0,
      unmatched: 0,
    });
    await c.close();
    const again = await core({ settleMs: 40 });
    await again.mutate("vault.open", { path: vault });
    await again.indexed();
    await (await again.events()).next("ingestLanded");
    const blocks = (await source()).match(/\^h\d+/g);
    expect(blocks).toHaveLength(4);
    expect((await sidecar()).annotations).toHaveLength(6);
  });
});

describe("a vault opened again", () => {
  it("reads a PDF that changed while the app was closed, and only that one", async () => {
    const { c, vault, returned, source } = await opened();
    await returned(await pdf("annotated.pdf"));
    await c.close();
    // Nothing changed: the sweep at open finds each PDF as its sidecar
    // recorded it, and Ingest has nothing to do — not a second copy of h1–h4.
    const again = await core({ settleMs: 40 });
    await again.mutate("vault.open", { path: vault });
    await again.indexed();
    const events = await again.events();
    await expect(
      events.next("ingestLanded", { timeoutMs: 400 })
    ).rejects.toThrow();
    expect((await source()).match(/\^h\d+/g)).toHaveLength(4);
  });
});

describe("a batch of PDFs", () => {
  it("is one run and one summary, and a run with nothing matched opens no panel", async () => {
    const files: Record<string, string> = {};
    for (let n = 1; n <= 50; n++) {
      files[`sources/s${n}.md`] =
        `---\nkind: source\nid: s${n}\ncitekey: s${n}\npdf: s${n}.pdf\n---\n`;
    }
    const vault = await vaultWith(files);
    await mkdir(join(vault, "sources/pdf"), { recursive: true });
    const base = await pdf("annotated-again.pdf");
    const c = await core({ settleMs: 40 });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const events = await c.events();
    for (let n = 1; n <= 50; n++) {
      // Distinct bytes: identical files that arrive together would pair as renames.
      await writeFile(
        join(vault, `sources/pdf/s${n}.pdf`),
        Buffer.concat([base, Buffer.from(`\n%${n}\n`)])
      );
    }
    const landed = await events.next("ingestLanded");
    expect(landed.summary).toEqual({
      new: 50,
      questions: 0,
      removed: 0,
      unmatched: 0,
    });
    expect(landed.sources).toHaveLength(50);
    await expect(
      events.next("ingestLanded", { timeoutMs: 400 })
    ).rejects.toThrow();
  });
});

describe("a PDF that is not on this Mac yet", () => {
  it("is never read until it is, and is read once it is", async () => {
    const vault = await vaultWith({ "sources/rasch2013.md": SOURCE });
    await mkdir(join(vault, "sources/pdf"), { recursive: true });
    // Sparse: a size and no blocks, which is what an online-only file looks like.
    const handle = await open(join(vault, "sources/pdf/rasch2013.pdf"), "w");
    await handle.truncate(4 * 1024 * 1024);
    await handle.close();
    const c = await core({ settleMs: 40 });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const events = await c.events();
    await expect(
      events.next("ingestLanded", { timeoutMs: 400 })
    ).rejects.toThrow();
    expect(await readdir(join(vault, ".vitrine"))).not.toContain("annotations");
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated.pdf")
    );
    expect((await events.next("ingestLanded")).summary.new).toBe(6);
  });
});

describe("a PDF that cannot be read", () => {
  it("leaves the Source alone and does not stop the next file", async () => {
    const { returned, source, vault } = await opened({
      "sources/other.md":
        "---\nkind: source\nid: src-2\ncitekey: other\npdf: other.pdf\n---\n",
    });
    await writeFile(join(vault, "sources/pdf/other.pdf"), "not a pdf at all");
    const summary = await returned(await pdf("annotated.pdf"));
    expect(summary.new).toBe(6);
    expect(await source()).toContain("## Annotations");
    expect(
      await readFile(join(vault, "sources/other.md"), "utf8")
    ).not.toContain("Annotations");
  });
});

// The `Q:` convention (#422; spec #416 stories 25–33, ADR 0013 decision 8): a
// markup's or note's current note beginning `Q:` spawns one Question, once.

type Listed = {
  question: string;
  from?: string;
  page?: number;
  annotation?: string;
  context: string;
  captured: string;
};

describe("a note that begins Q:", () => {
  const listed = async (c: Awaited<ReturnType<typeof opened>>["c"]) =>
    (await c.query<{ questions: Listed[] }>("questions.list")).result!.data
      .questions;

  it("becomes one Question with the Source, page and block, and the summary counts it", async () => {
    const { returned, c, vault } = await opened();
    const summary = await returned(await pdf("annotated-questions.pdf"));
    expect(summary).toMatchObject({ new: 5, questions: 3 });
    await c.indexed();
    const questions = await listed(c);
    expect(
      questions
        .map((q) => [q.question, q.context, q.from, q.page, q.annotation])
        .sort()
    ).toEqual([
      ["Are spindles the mechanism", "ingest", "[[rasch2013]]", 1, "h1"],
      ["Does the cue work without sleep?", "ingest", "[[rasch2013]]", 1, "h2"],
      ["Who ran the control?", "ingest", "[[rasch2013]]", 1, "h3"],
    ]);
    const file = await readFile(
      join(vault, "questions", (await readdir(join(vault, "questions")))[0]!),
      "utf8"
    );
    expect(file).toMatch(/^> .+$/m);
  });

  it("carries the quoted passage in the Question's body", async () => {
    const { returned, vault } = await opened();
    await returned(await pdf("annotated-questions.pdf"));
    const bodies = await Promise.all(
      (await readdir(join(vault, "questions"))).map((f) =>
        readFile(join(vault, "questions", f), "utf8")
      )
    );
    expect(
      bodies.some((b) => b.includes("> Participants who heard the odor cue"))
    ).toBe(true);
  });

  it("does not spawn for Q: alone or for Q ; a near miss", async () => {
    const { returned, c } = await opened();
    await returned(await pdf("annotated-questions.pdf"));
    await c.indexed();
    const texts = (await listed(c)).map((q) => q.question);
    expect(texts).toHaveLength(3);
    expect(texts.join("|")).not.toMatch(/near miss/);
  });

  it("never makes a second when the same PDF returns, and records the Question in the sidecar", async () => {
    const { returned, c, sidecar, vault } = await opened();
    await returned(await pdf("annotated-questions.pdf"));
    const first = await sidecar();
    expect(
      first.annotations.filter((a) => typeof a["question"] === "string")
    ).toHaveLength(3);
    // The same bytes rewritten, as a sync client does: no change, no Question.
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated-questions.pdf")
    );
    await c.indexed();
    expect(await listed(c)).toHaveLength(3);
  });

  it("is spawned on the Ingest where a Preview pass added the prefix to an old highlight", async () => {
    const { returned, c } = await opened();
    // Same highlight, no `Q:`; then the same one, matched by its text, with it.
    await returned(await pdf("annotated.pdf"));
    await c.indexed();
    expect(await listed(c)).toHaveLength(0);
    const summary = await returned(await pdf("annotated-questions.pdf"));
    await c.indexed();
    expect(summary.questions).toBeGreaterThanOrEqual(1);
    expect(
      (await listed(c)).filter(
        (q) => q.question === "Does the cue work without sleep?"
      )
    ).toHaveLength(1);
  });

  it("makes no second Question when the PDF comes back changed, and leaves it alone when the prefix goes", async () => {
    const { returned, c } = await opened();
    await returned(await pdf("annotated-questions.pdf"));
    await c.indexed();
    const spawned = (await listed(c)).length;
    // The prefix removed from the highlight's note, matched by its text.
    await returned(await pdf("annotated.pdf"));
    // And restored: the identity already spawned, so it does not again.
    await returned(await pdf("annotated-questions.pdf"));
    await c.indexed();
    const cue = (await listed(c)).filter(
      (q) => q.question === "Does the cue work without sleep?"
    );
    expect(cue).toHaveLength(1);
    expect((await listed(c)).length).toBeGreaterThanOrEqual(spawned);
  });
});

describe("the Q: prefix", () => {
  it.each([
    ["Q: why", "why"],
    ["q: why", "why"],
    [" Q: why", "why"],
    ["\tq:why  ", "why"],
    ["Q:x", "x"],
    ["Q:", null],
    ["Q:   ", null],
    ["Q ;", null],
    ["Q ; why", null],
    ["why Q: not at the start", null],
    ["", null],
  ])("reads %j as %j", (note, expected) => {
    expect(questionText(note)).toBe(expected);
  });
});
