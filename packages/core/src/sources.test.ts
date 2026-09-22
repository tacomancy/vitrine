import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Candidates } from "./picker.js";
import { citekeyFor } from "./sources.js";
import type { Stub } from "./sources.js";
import { basedOn, closeCores, core, fixtureCopy } from "./test-core.js";
import type { WriteResult } from "./vault-files.js";

afterEach(closeCores);

// A stub made by hand from the attach form (#220; ADR 0020 decision 7;
// § Vault layout, Source / Source stub). Four fields, the citekey rule the
// Scout beat's accept will reuse, and the file the Scout beat writes minus
// its Origin.

describe("the citekey rule", () => {
  // `<surname><year>`, ASCII-folded and lowercased; the first word of the
  // title when authors are missing (§ Vault layout).
  const cases: Array<[string, string, string, string]> = [
    ["surname and year", "Jan Born", "2010", "born2010"],
    ["surname last, given first", "Klinzing, Jens G.", "2019", "klinzing2019"],
    [
      "several authors — the first one only",
      "Rasch; Born",
      "2013",
      "rasch2013",
    ],
    ["a diacritic folded to ASCII", "Müller", "2019", "muller2019"],
    ["a letter with no decomposition", "Sørensen", "2021", "sorensen2021"],
    ["a hyphen dropped", "Meer-Ruiz", "2018", "meerruiz2018"],
    // Given name first, the surname is the last word — so a particle is not
    // part of it. Written surname-first, the whole surname is kept: the
    // comma is what says where the surname ends, and nothing else can.
    ["a particle, given name first", "Ana van der Meer", "2018", "meer2018"],
    [
      "a particle, surname first",
      "van der Meer, Ana",
      "2018",
      "vandermeer2018",
    ],
    ["a year buried in what was typed", "Born", "published 2010", "born2010"],
    ["no year at all — the surname alone", "Born", "", "born"],
  ];

  it.each(cases)("%s", (_name, authors, year, expected) => {
    expect(citekeyFor({ authors, year, title: "Sleep to remember" })).toBe(
      expected
    );
  });

  it("falls back to the title's first word when no author was typed", () => {
    expect(
      citekeyFor({ authors: "", year: "2019", title: "Mechanisms of sleep" })
    ).toBe("mechanisms2019");
    // Neither an author nor a year: the title's first word is the whole key,
    // and a second paper starting the same way takes a suffix on disk.
    expect(citekeyFor({ authors: "", year: "", title: "Mechanisms" })).toBe(
      "mechanisms"
    );
  });

  it("falls back to `source` when nothing typed survives the folding", () => {
    // A title in a script ASCII cannot carry still has to name a file.
    expect(citekeyFor({ authors: "", year: "2019", title: "日本語" })).toBe(
      "source2019"
    );
  });
});

/** A core with the fixture vault open and indexed, ready to make a stub. */
async function opened() {
  const vault = await fixtureCopy("obsidian-vault");
  let n = 0;
  const c = await core({ newId: () => `stubid${n++}` });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return {
    vault,
    createStub: async (fields: Record<string, string>) => {
      const made = await c.mutate<Stub>("sources.createStub", fields);
      expect(made.error).toBeUndefined();
      return made.result?.data as Stub;
    },
    candidates: async (query: string) => {
      const reply = await c.query<Candidates>("picker.candidates", {
        query,
        kinds: ["source", "source-stub"],
      });
      expect(reply.error).toBeUndefined();
      return reply.result?.data as Candidates;
    },
    attach: (input: Record<string, unknown>) =>
      c.mutate<WriteResult>("researchQuestions.attachSource", input),
    read: (path: string) => readFile(join(vault, path), "utf8"),
  };
}

const PAGE =
  "questions/Is the overnight benefit consolidation or encoding (RQ).md";

describe("sources.createStub", () => {
  it("writes the stub's keys in § Vault layout's order, as a source-stub", async () => {
    const c = await opened();
    const stub = await c.createStub({
      title: "Memory consolidation during sleep",
      authors: "Müller, Anna; Jan Born",
      year: "2019",
      url: "https://example.org/muller2019",
    });

    expect(stub).toEqual({
      path: "sources/muller2019.md",
      citekey: "muller2019",
    });
    expect(await c.read(stub.path)).toBe(
      [
        "---",
        "id: stubid0",
        "kind: source-stub",
        "citekey: muller2019",
        "title: Memory consolidation during sleep",
        "authors:",
        "  - Müller, Anna",
        "  - Jan Born",
        "year: 2019",
        "url: https://example.org/muller2019",
        "---",
        "",
      ].join("\n")
    );
  });

  it("leaves out a field nobody filled in rather than writing it empty", async () => {
    const c = await opened();
    const stub = await c.createStub({ title: "Mechanisms", authors: "" });

    expect(stub.citekey).toBe("mechanisms");
    expect(await c.read(stub.path)).toBe(
      [
        "---",
        "id: stubid0",
        "kind: source-stub",
        "citekey: mechanisms",
        "title: Mechanisms",
        "---",
        "",
      ].join("\n")
    );
  });

  it("takes the next suffix rather than refusing when the citekey is taken", async () => {
    const c = await opened();
    // `klinzing2019` is already in the fixture vault, written by hand.
    const first = await c.createStub({
      title: "A second Klinzing paper",
      authors: "Klinzing",
      year: "2019",
    });
    const second = await c.createStub({
      title: "A third Klinzing paper",
      authors: "Klinzing",
      year: "2019",
    });

    expect([first.citekey, second.citekey]).toEqual([
      "klinzing2019a",
      "klinzing2019b",
    ]);
    // The paper already in the vault is untouched: a suffix is taken, never
    // the file.
    expect(await c.read("sources/klinzing2019.md")).toContain(
      "Mechanisms of systems memory consolidation during sleep"
    );
  });

  it("takes a suffix over a file the index has never seen", async () => {
    const c = await opened();
    // Written behind the index's back, as a sync or an editor would: the
    // suffix is decided against the disk, not against a table.
    await writeFile(join(c.vault, "sources", "born2011.md"), "Not indexed.\n");

    const stub = await c.createStub({
      title: "Sleep to remember",
      authors: "Born",
      year: "2011",
    });

    expect(stub.citekey).toBe("born2011a");
    expect(await c.read("sources/born2011.md")).toBe("Not indexed.\n");
  });

  it("is in the picker and attachable the moment it is made", async () => {
    const c = await opened();
    const stub = await c.createStub({
      title: "Memory consolidation during sleep",
      authors: "Cordi",
      year: "2021",
    });

    // The index is told of the write before the call returns, so the row is
    // there without waiting for the watcher (ADR 0010).
    expect((await c.candidates("cordi")).rows).toEqual([
      {
        path: "sources/cordi2021.md",
        name: "cordi2021",
        kind: "source-stub",
        title: "Memory consolidation during sleep",
        pdf: false,
      },
    ]);

    const attached = await c.attach({
      path: PAGE,
      target: stub.path,
      side: "supporting",
      note: "",
      basedOn: await basedOn(c.vault, PAGE),
    });
    expect(attached.error).toBeUndefined();
    expect(await c.read(PAGE)).toContain("- [[cordi2021]]");
  });
});
