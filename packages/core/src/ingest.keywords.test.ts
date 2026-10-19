import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LexiconView } from "./lexicon.js";
import {
  closeCores,
  core,
  fixtures,
  NEXT_TIMEOUT_MS,
  vaultWith,
} from "./test-core.js";

afterEach(closeCores);

// The keyword line printed under a paper's abstract (#681; spec #679; ADR
// 0018 decision 3): Ingest records it in the Source's sidecar, never in the
// Source, and the Lexicon counts it as author keywords. Driven through the
// router on a temp vault with fixture PDFs whose text the real engine reads.
// The parser's own table is `keyword-line.test.ts`.

const pdf = (name: string) => readFile(join(fixtures, "pdf", name));

// `annotated-keywords.pdf` prints this under its first page's text.
const PRINTED = [
  "sleep spindles",
  "odor cue",
  "memory consolidation",
  "slow wave sleep",
];

/** A one-page PDF whose only text is `text`, or none; the real engine reads it. */
function textPdf(text: string | null): Buffer {
  const stream = text === null ? "" : `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`;
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    text === null
      ? "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"
      : "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ].slice(0, text === null ? 3 : 5);
  let out = "%PDF-1.4\n";
  const offsets = bodies.map((b, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${b}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const paper = (name: string, abstract: string, extra = "") => `---
kind: source
citekey: ${name}
title: ${name} on rats
tags: [ml/probing]
${extra}---
> ${abstract}
`;

const FRONTMATTER = (extra = "") => `---
kind: source
id: src-1
citekey: p1
title: Odor cues during slow-wave sleep
pdf: p1.pdf
tags: [ml/probing]
${extra}---`;
const SOURCE = (extra = "") => `${FRONTMATTER(extra)}
> Rats navigated mazes.
`;

async function opened(
  extra = "",
  { files = {}, start = "synthetic-body.pdf" } = {}
) {
  const vault = await vaultWith({
    "sources/p1.md": SOURCE(extra),
    "sources/pdf/p1.pdf": "",
    "sources/p2.md": paper("p2", "Mice explored arenas."),
    "sources/p3.md": paper("p3", "Birds followed routes."),
    ...files,
  });
  await writeFile(join(vault, "sources/pdf/p1.pdf"), await pdf(start));
  const c = await core({ settleMs: 40 });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const events = await c.events();
  // A PDF with annotations is ingested at open; one without leaves no sidecar.
  if (start !== "synthetic-body.pdf") await events.next("ingestLanded");
  const sidecar = async () =>
    JSON.parse(
      await readFile(join(vault, ".vitrine/annotations/src-1.json"), "utf8")
    ) as { keywords?: string[]; annotations: Array<Record<string, unknown>> };
  const returned = async (bytes: Buffer) => {
    await writeFile(join(vault, "sources/pdf/p1.pdf"), bytes);
    return (await events.next("ingestLanded")).summary;
  };
  const lexicon = async () => {
    const reply = await c.query<LexiconView>("lexicon.get", {
      tag: "ml/probing",
    });
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  const note = () => readFile(join(vault, "sources/p1.md"), "utf8");
  return { vault, c, events, sidecar, returned, lexicon, note };
}

describe("a PDF that prints its keywords", () => {
  it("records them raw in the sidecar and leaves the Source's frontmatter as it was", async () => {
    const { returned, sidecar, note } = await opened();
    await returned(await pdf("annotated-keywords.pdf"));
    expect((await sidecar()).keywords).toEqual(PRINTED);
    // The one thing Ingest writes to a Source it did not create is its
    // annotation blocks, below the frontmatter.
    expect((await note()).startsWith(`${FRONTMATTER()}\n`)).toBe(true);
  });

  it("reaches the Lexicon as author keywords that skipped the two-paper floor", async () => {
    const { returned, lexicon } = await opened();
    expect((await lexicon()).terms.map((t) => t.term)).not.toContain(
      "odor cue"
    );
    await returned(await pdf("annotated-keywords.pdf"));
    const view = await lexicon();
    for (const term of PRINTED) {
      // One paper prints each: a derived phrase would need two.
      expect(view.terms.find((t) => t.term === term)?.origin).toBe(
        "author keyword"
      );
    }
  });

  it("adds them to the keywords typed in `keywords:`, counting a keyword in both once", async () => {
    const { returned, lexicon } = await opened(
      "keywords: [memory consolidation, rat navigation]\n"
    );
    await returned(await pdf("annotated-keywords.pdf"));
    const view = await lexicon();
    const names = view.terms.map((t) => t.term);
    // Typed only: the PDF's list must not replace it.
    expect(names).toContain("rat navigation");
    // Both: one Term, and with the same single paper behind it as a keyword
    // printed alone it sorts by name ahead of "odor cue".
    expect(names.filter((t) => t === "memory consolidation")).toHaveLength(1);
    expect(names.indexOf("memory consolidation")).toBeLessThan(
      names.indexOf("odor cue")
    );
  });

  it("stays out of a Lexicon the user Excluded it from", async () => {
    const { c, returned, lexicon } = await opened();
    await returned(await pdf("annotated-keywords.pdf"));
    expect(
      (
        await c.mutate("lexicon.exclude", {
          tag: "ml/probing",
          term: "odor cue",
        })
      ).error
    ).toBeUndefined();
    const view = await lexicon();
    expect(view.terms.map((t) => t.term)).not.toContain("odor cue");
    expect(view.excluded).toContain("odor cue");
  });

  it("leaves the Ingest's counts and the matching exactly as for the same PDF without the line", async () => {
    const control = await opened();
    const expected = await control.returned(await pdf("annotated.pdf"));
    const withLine = await opened();
    const summary = await withLine.returned(
      await pdf("annotated-keywords.pdf")
    );
    expect(summary).toEqual(expected);
    const strip = (s: Awaited<ReturnType<typeof control.sidecar>>) =>
      s.annotations.map(({ id, last_matched, quads, ...rest }) => {
        void id;
        void last_matched;
        void quads;
        return rest;
      });
    expect(strip(await withLine.sidecar())).toEqual(
      strip(await control.sidecar())
    );
  });

  // A missing keyword line is a thinner Lexicon, not a defect (spec #679
  // story 25; brief § Loose Ends): the dashboard stays empty after the Ingest,
  // for each way a PDF can give none.
  it.each([
    ["prints no keyword line", () => textPdf("Rats navigated mazes.")],
    [
      "prints a keyword line that holds nothing",
      () => textPdf("Keywords: ;, ;"),
    ],
    ["has no text at all", () => textPdf(null)],
  ])("raises no Loose Ends row for a PDF that %s", async (_, make) => {
    const { c, returned, sidecar } = await opened("", {
      start: "annotated.pdf",
    });
    const rows = async () => {
      const reply = await c.query("looseEnds.rows");
      expect(reply.error).toBeUndefined();
      return JSON.stringify(reply.result!.data);
    };
    await returned(make());
    // The Ingest did read it, so the rows are not quiet for want of a run.
    expect((await sidecar()).keywords).toEqual([]);
    // The annotations the first PDF carried were the only loose thing; with
    // them gone the dashboard holds nothing, so no row is about keywords.
    expect(await rows()).toBe('{"groups":[],"problems":[]}');
  });
});

describe("a PDF replaced", () => {
  it("replaces the list, so a line the new version does not print leaves nothing behind", async () => {
    const { returned, sidecar, lexicon } = await opened();
    await returned(await pdf("annotated-keywords.pdf"));
    expect((await sidecar()).keywords).toEqual(PRINTED);
    await returned(await pdf("annotated-again.pdf"));
    expect((await sidecar()).keywords).toEqual([]);
    expect((await lexicon()).terms.map((t) => t.term)).not.toContain(
      "odor cue"
    );
  });
});

describe("a Source ingested before keywords were read", () => {
  // The same bytes saved again: the watcher sees a change, the hash says there
  // is none.
  const touch = async (vault: string) =>
    writeFile(
      join(vault, "sources/pdf/p1.pdf"),
      await pdf("annotated-keywords.pdf")
    );

  const old = async (vault: string, keywords?: string[]) => {
    const file = join(vault, ".vitrine/annotations/src-1.json");
    const sidecar = JSON.parse(await readFile(file, "utf8")) as {
      keywords?: string[];
    };
    delete sidecar.keywords;
    await writeFile(
      file,
      JSON.stringify(
        keywords === undefined ? sidecar : { ...sidecar, keywords }
      )
    );
  };

  it("is read once for its keywords, without a summary", async () => {
    const { vault, c, returned, sidecar, events } = await opened();
    await returned(await pdf("annotated-keywords.pdf"));
    await c.close();
    await old(vault);
    const again = await core({ settleMs: 40 });
    await again.mutate("vault.open", { path: vault });
    await again.indexed();
    await vi.waitFor(
      async () => expect((await sidecar()).keywords).toEqual(PRINTED),
      {
        timeout: NEXT_TIMEOUT_MS,
      }
    );
    void events;
  });

  it("is not read again once the field is there, empty or not", async () => {
    const { vault, c, returned, sidecar } = await opened();
    await returned(await pdf("annotated-keywords.pdf"));
    await c.close();
    // A value the PDF never printed: if the file were read again it would be
    // replaced by the real list.
    await old(vault, []);
    const again = await core({ settleMs: 40 });
    await again.mutate("vault.open", { path: vault });
    await again.indexed();
    await touch(vault);
    await new Promise((r) => setTimeout(r, 1_500));
    expect((await sidecar()).keywords).toEqual([]);
  });
});

describe("a PDF that cannot give keywords", () => {
  const textFree = () => textPdf(null);

  it("is ingested as before with no keywords when it has no text", async () => {
    const { returned, sidecar } = await opened("", {
      start: "annotated-keywords.pdf",
    });
    expect((await sidecar()).keywords).toEqual(PRINTED);
    await returned(textFree());
    expect((await sidecar()).keywords).toEqual([]);
  });

  it("is skipped as before when the engine cannot read it", async () => {
    const { vault, sidecar } = await opened("", {
      start: "annotated-keywords.pdf",
    });
    await writeFile(
      join(vault, "sources/pdf/p1.pdf"),
      Buffer.from("not a pdf at all")
    );
    await new Promise((r) => setTimeout(r, 1_500));
    // Still the sidecar of the readable file it replaced, not wiped.
    expect((await sidecar()).keywords).toEqual(PRINTED);
  });
});

describe("a sidecar write that failed", () => {
  it("records no keywords, and a retry starts clean", async () => {
    const { vault, c, sidecar } = await opened("", {
      start: "annotated.pdf",
    });
    const folder = join(vault, ".vitrine/annotations");
    await chmod(folder, 0o555);
    try {
      await writeFile(
        join(vault, "sources/pdf/p1.pdf"),
        await pdf("annotated-keywords.pdf")
      );
      await new Promise((r) => setTimeout(r, 1_500));
      // Neither half-recorded: the sidecar is the one the earlier file left.
      expect((await sidecar()).keywords).toEqual([]);
    } finally {
      await chmod(folder, 0o755);
    }
    // The next start finds the file unrecorded and reads it afresh.
    await c.close();
    const again = await core({ settleMs: 40 });
    await again.mutate("vault.open", { path: vault });
    await again.indexed();
    // Matching nothing new, this run reports nothing: the sidecar is the proof.
    await vi.waitFor(
      async () => expect((await sidecar()).keywords).toEqual(PRINTED),
      { timeout: NEXT_TIMEOUT_MS }
    );
  });
});
