import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Candidates, CandidateKind } from "./picker.js";
import { closeCores, core, fixtureCopy, tmp } from "./test-core.js";

afterEach(closeCores);

/** A core with the folder open and its index built, ready to be asked for candidates. */
async function opened(vault: string) {
  const c = await core();
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return {
    candidates: async (input: {
      query: string;
      kinds?: CandidateKind[];
      exclude?: string[];
    }) => {
      const reply = await c.query<Candidates>("picker.candidates", input);
      expect(reply.error).toBeUndefined();
      return reply.result?.data as Candidates;
    },
  };
}

/** Every candidate as `<glyph-bearing kind> <name>`, which is what a row shows. */
const shown = (c: Candidates) => c.rows.map((row) => `${row.kind} ${row.name}`);

describe("picker.candidates", () => {
  it("lists every Markdown Kind the vault holds when nothing is typed, each as its Kind", async () => {
    const c = await opened(await fixtureCopy("obsidian-vault"));
    expect(shown(await c.candidates({ query: "" }))).toEqual([
      "source born2010",
      "question Does slow-wave density predict recall gain",
      "research-question Is the overnight benefit consolidation or encoding (RQ)",
      "source-stub klinzing2019",
      "source rasch2013",
      "note Sleep and consolidation",
    ]);
  });

  it("matches the name, case-insensitively and anywhere in it", async () => {
    const c = await opened(await fixtureCopy("obsidian-vault"));

    expect(shown(await c.candidates({ query: "RECALL" }))).toEqual([
      "question Does slow-wave density predict recall gain",
    ]);
    expect(shown(await c.candidates({ query: "2019" }))).toEqual([
      "source-stub klinzing2019",
    ]);
    // The title is not searched: name-contains is the whole of it (beat 11
    // owns full text), and `born2010` is titled *Sleep to remember*.
    expect(shown(await c.candidates({ query: "sleep" }))).toEqual([
      "note Sleep and consolidation",
    ]);
    expect(shown(await c.candidates({ query: "no such file" }))).toEqual([]);
  });

  it("narrows to the Kinds the caller asks for; Link's five leave a Hypothesis out", async () => {
    const vault = await tmp("kinds");
    const files: Record<string, string> = {
      "beta question": "kind: question",
      "beta page (RQ)": "kind: research-question",
      "beta source": "kind: source",
      "beta stub": "kind: source-stub",
      "beta claim": "kind: hypothesis",
      "beta note": "",
    };
    for (const [name, front] of Object.entries(files)) {
      await writeFile(
        join(vault, `${name}.md`),
        front === "" ? "Just a note.\n" : `---\n${front}\n---\n`
      );
    }
    const c = await opened(vault);

    // What Link narrows to; the renderer is where that list lives.
    const link: CandidateKind[] = [
      "question",
      "research-question",
      "note",
      "source",
      "source-stub",
    ];
    expect(shown(await c.candidates({ query: "beta", kinds: link }))).toEqual([
      "note beta note",
      "research-question beta page (RQ)",
      "question beta question",
      "source beta source",
      "source-stub beta stub",
    ]);
    // Without narrowing, every Markdown file the name matches — what the
    // why line asks for.
    expect(shown(await c.candidates({ query: "beta" }))).toContain(
      "hypothesis beta claim"
    );
    // A caller that narrowed to nothing gets nothing, not everything.
    expect(shown(await c.candidates({ query: "beta", kinds: [] }))).toEqual([]);
  });

  it("leaves out the files the caller is standing on, which could only refuse", async () => {
    const c = await opened(await fixtureCopy("obsidian-vault"));
    expect(
      shown(
        await c.candidates({
          query: "",
          exclude: ["sources/born2010.md", "sources/rasch2013.md"],
        })
      )
    ).toEqual([
      "question Does slow-wave density predict recall gain",
      "research-question Is the overnight benefit consolidation or encoding (RQ)",
      "source-stub klinzing2019",
      "note Sleep and consolidation",
    ]);
  });

  it("says whether a Source's PDF is there — derived from the folder, never from the key alone", async () => {
    const c = await opened(await fixtureCopy("obsidian-vault"));
    const rows = (await c.candidates({ query: "", kinds: ["source"] })).rows;
    expect(rows).toEqual([
      {
        path: "sources/born2010.md",
        name: "born2010",
        kind: "source",
        title: "Sleep to remember",
        // `pdf: born2010.pdf`, and no such file under sources/pdf/.
        pdf: false,
      },
      {
        path: "sources/rasch2013.md",
        name: "rasch2013",
        kind: "source",
        title: "About sleep's role in memory",
        pdf: true,
      },
    ]);
    // A stub has no `pdf:` at all, and says so rather than staying silent.
    expect(
      (await c.candidates({ query: "klinzing", kinds: ["source-stub"] })).rows
    ).toEqual([
      {
        path: "sources/klinzing2019.md",
        name: "klinzing2019",
        kind: "source-stub",
        title: "Mechanisms of systems memory consolidation during sleep",
        pdf: false,
      },
    ]);
  });

  it("narrows to Sources and stubs for the attach form, each row saying whether its PDF is there", async () => {
    const c = await opened(await fixtureCopy("obsidian-vault"));
    // What attaching a source narrows to: the two Kinds a side can hold, and
    // nothing else the vault carries (ADR 0020 decision 5).
    const rows = (
      await c.candidates({ query: "", kinds: ["source", "source-stub"] })
    ).rows;
    expect(rows).toEqual([
      {
        path: "sources/born2010.md",
        name: "born2010",
        kind: "source",
        title: "Sleep to remember",
        pdf: false,
      },
      {
        path: "sources/klinzing2019.md",
        name: "klinzing2019",
        kind: "source-stub",
        title: "Mechanisms of systems memory consolidation during sleep",
        pdf: false,
      },
      {
        path: "sources/rasch2013.md",
        name: "rasch2013",
        kind: "source",
        title: "About sleep's role in memory",
        pdf: true,
      },
    ]);
  });

  it("carries a paper's title for the row to show, and nothing for a Kind that has none", async () => {
    const vault = await tmp("titles");
    await writeFile(
      join(vault, "untitled2020.md"),
      "---\nkind: source-stub\ncitekey: untitled2020\n---\n"
    );
    await writeFile(
      join(vault, "A plain note.md"),
      "---\ntitle: Not a paper\n---\n\nA note.\n"
    );
    const c = await opened(vault);

    // A stub with no `title:` says nothing rather than inventing one from
    // the file name, which the row already shows.
    expect((await c.candidates({ query: "untitled" })).rows).toEqual([
      {
        path: "untitled2020.md",
        name: "untitled2020",
        kind: "source-stub",
        pdf: false,
      },
    ]);
    // `title:` is a paper's key. A Note carrying one is not a paper, and the
    // row is the file name it has always been.
    expect((await c.candidates({ query: "plain note" })).rows).toEqual([
      { path: "A plain note.md", name: "A plain note", kind: "note" },
    ]);
  });

  it("offers no PDF, no image, and nothing under a dot folder: a picker links to Markdown", async () => {
    const c = await opened(await fixtureCopy("obsidian-corpus"));
    expect(shown(await c.candidates({ query: "image" }))).toEqual([]);
    expect(shown(await c.candidates({ query: "app" }))).toEqual([]);
  });

  it("leads with the names that start with what was typed, then the rest, each alphabetically", async () => {
    const vault = await tmp("ordering");
    for (const name of ["Beta note", "alpha beta", "Beta alpha", "zeta beta"]) {
      await writeFile(join(vault, `${name}.md`), "");
    }
    const c = await opened(vault);
    expect(
      (await c.candidates({ query: "beta" })).rows.map((r) => r.name)
    ).toEqual(["Beta alpha", "Beta note", "alpha beta", "zeta beta"]);
  });

  it("caps the rows and says how many there are, so a long list is never silently cut", async () => {
    const vault = await tmp("many");
    for (let n = 0; n < 60; n++) {
      await writeFile(join(vault, `note ${String(n).padStart(2, "0")}.md`), "");
    }
    const c = await opened(vault);
    const all = await c.candidates({ query: "note" });
    expect(all.rows).toHaveLength(50);
    expect(all.total).toBe(60);

    const few = await c.candidates({ query: "note 1" });
    expect(few.rows).toHaveLength(10);
    expect(few.total).toBe(10);
  });

  it("refuses when no vault is open", async () => {
    const c = await core();
    const reply = await c.query<Candidates>("picker.candidates", {
      query: "a",
    });
    expect(reply.error?.message).toMatch(/no vault/i);
  });
});
