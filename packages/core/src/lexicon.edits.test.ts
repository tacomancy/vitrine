import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Attention, LexiconView } from "./lexicon.js";
import { closeCores, core, vaultWith } from "./test-core.js";

afterEach(closeCores);

// Seeds and Exclusions (#652; ADR 0018, ADR 0045 decisions 3 and 9;
// `docs/architecture.md` § Lexicon), driven through the router on a temp
// vault, the way the Lexicon editor does. Still no OpenAlex: nothing here
// leaves the device.

const paper = (name: string, tags: string[], abstract: string) => `---
kind: source
citekey: ${name}
title: ${name} on ${abstract.split(".")[0]}
tags: [${tags.join(", ")}]
---
${abstract
  .split(". ")
  .map((s) => `> ${s}`)
  .join("\n")}
`;

const PROBING = {
  "s/z.md": paper("z", [], "Rats sleep deeply."),
  "s/a.md": paper(
    "a",
    ["ml/probing"],
    "The residual stream carries features. A linear probe reads alpha."
  ),
  "s/b.md": paper(
    "b",
    ["ml/probing"],
    "The residual stream is sparse. A linear probe reads beta."
  ),
  "s/c.md": paper(
    "c",
    ["ml/probing"],
    "The residual stream grows. A linear probe reads gamma."
  ),
  "s/d.md": paper("d", ["ml/steering"], "Steering vector. Other words."),
  "s/e.md": paper("e", ["ml/steering"], "Steering vector again."),
  "s/f.md": paper("f", ["ml/steering"], "Steering vector thrice."),
};

async function open(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core();
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const get = async (tag: string) => {
    const reply = await c.query<LexiconView>("lexicon.get", { tag });
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  const attention = async () => {
    const reply = await c.query<Attention>("questionMap.attention");
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  const edit = (
    procedure: "seed" | "exclude" | "restore",
    tag: string,
    term: string
  ) => c.mutate(`lexicon.${procedure}`, { tag, term });
  const stored = async () =>
    JSON.parse(
      await readFile(join(vault, ".vitrine/lexicon.json"), "utf8")
    ) as Record<string, { seeds: string[]; excluded: string[] }>;
  return { c, vault, get, attention, edit, stored };
}

const terms = (view: LexiconView) => view.terms.map((t) => t.term);
const unused = (view: LexiconView) => view.notUsed.map((t) => t.term);

describe("Seeds", () => {
  it("adds a typed Term at the top, as seeded, and compiles it into the query", async () => {
    const { get, edit } = await open(PROBING);
    expect(
      (await edit("seed", "ml/probing", "sparse autoencoder")).error
    ).toBeUndefined();
    const view = await get("ml/probing");
    expect(view.terms[0]).toEqual({
      term: "sparse autoencoder",
      origin: "seeded",
    });
    expect(view.query).toContain('"sparse autoencoder"');
  });

  it("normalises what was typed as a derived phrase: lower-cased, ASCII-folded, punctuation-stripped", async () => {
    const { get, edit } = await open(PROBING);
    await edit("seed", "ml/probing", "  Résidual-Stream's Probe! ");
    const view = await get("ml/probing");
    expect(view.terms[0]!.term).toBe("residual streams probe");
  });

  it("turns an already-derived Term into a seeded one in place, once", async () => {
    const { get, edit } = await open(PROBING);
    expect(terms(await get("ml/probing"))).toContain("linear probe");
    expect(
      (await edit("seed", "ml/probing", "Linear Probe")).error
    ).toBeUndefined();
    const view = await get("ml/probing");
    expect(view.terms.filter((t) => t.term === "linear probe")).toEqual([
      { term: "linear probe", origin: "seeded" },
    ]);
    expect(unused(view)).not.toContain("linear probe");
  });

  it("keeps a Seed no paper contains, and still compiles it", async () => {
    const { get, edit } = await open(PROBING);
    await edit("seed", "ml/probing", "grokking");
    const view = await get("ml/probing");
    expect(terms(view)).toContain("grokking");
    expect(view.query).toContain('"grokking"');
  });

  it("refuses an empty Seed, naming the reason, and writes nothing", async () => {
    const { edit, vault } = await open(PROBING);
    const reply = await edit("seed", "ml/probing", "  ... ");
    expect(reply.error?.message).toMatch(/empty/i);
    await expect(
      readFile(join(vault, ".vitrine/lexicon.json"), "utf8")
    ).rejects.toThrow();
  });

  it("refuses a Seed of more than three words, naming the reason", async () => {
    const { edit } = await open(PROBING);
    const reply = await edit("seed", "ml/probing", "one two three four");
    expect(reply.error?.message).toMatch(/at most 3 words/i);
  });

  it("refuses a duplicate Seed, naming the reason, however it was typed", async () => {
    const { edit, stored } = await open(PROBING);
    await edit("seed", "ml/probing", "grokking");
    const again = await edit("seed", "ml/probing", " GROKKING ");
    expect(again.error?.message).toMatch(/already/i);
    expect((await stored())["ml/probing"]!.seeds).toEqual(["grokking"]);
  });

  it("clears an Exclusion of the same Term, since the user now wants it", async () => {
    const { get, edit } = await open(PROBING);
    await edit("exclude", "ml/probing", "linear probe");
    await edit("seed", "ml/probing", "linear probe");
    const view = await get("ml/probing");
    expect(view.excluded).toEqual([]);
    expect(view.terms).toContainEqual({
      term: "linear probe",
      origin: "seeded",
    });
  });

  it("places a Tag with too few papers, and undoing the Seed puts it back unplaced", async () => {
    const files = {
      ...PROBING,
      "s/t1.md": paper("t1", ["ml/thin"], "Thin one. Words."),
      "s/t2.md": paper("t2", ["ml/thin"], "Thin two. Words."),
    };
    const { get, attention, edit } = await open(files);
    const state = async () =>
      (await attention()).tags.find((t) => t.tag === "ml/thin")!.state;
    expect(await state()).toBe("unplaced");

    await edit("seed", "ml/thin", "thin theory");
    expect(await state()).toBe("not yet measured");
    const placed = await get("ml/thin");
    expect(placed.placed).toBe(true);
    expect(placed.reason).toBeNull();
    expect(terms(placed)[0]).toBe("thin theory");

    await edit("restore", "ml/thin", "thin theory");
    expect(await state()).toBe("unplaced");
    expect((await get("ml/thin")).placed).toBe(false);
  });
});

describe("Exclusions", () => {
  it("drops a derived Term from use and from not used, and out of the query", async () => {
    const { get, edit } = await open(PROBING);
    expect(
      (await edit("exclude", "ml/probing", "linear probe")).error
    ).toBeUndefined();
    const view = await get("ml/probing");
    expect(terms(view)).not.toContain("linear probe");
    expect(unused(view)).not.toContain("linear probe");
    expect(view.query).not.toContain('"linear probe"');
    expect(view.excluded).toEqual(["linear probe"]);
  });

  it("is never derived back for that Tag, even when more papers say it", async () => {
    const { get, edit, vault, c } = await open(PROBING);
    await edit("exclude", "ml/probing", "linear probe");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(vault, "s/g.md"),
      paper("g", ["ml/probing"], "A linear probe again. A linear probe more.")
    );
    await c.indexed();
    expect(terms(await get("ml/probing"))).not.toContain("linear probe");
  });

  it("is undone by restore, which also removes a Seed", async () => {
    const { get, edit } = await open(PROBING);
    await edit("exclude", "ml/probing", "linear probe");
    await edit("restore", "ml/probing", "linear probe");
    expect(terms(await get("ml/probing"))).toContain("linear probe");

    await edit("seed", "ml/probing", "grokking");
    await edit("restore", "ml/probing", "grokking");
    expect(terms(await get("ml/probing"))).not.toContain("grokking");
  });

  it("excluding a seeded Term removes the Seed rather than leaving both", async () => {
    const { get, edit, stored } = await open(PROBING);
    await edit("seed", "ml/probing", "grokking");
    await edit("exclude", "ml/probing", "grokking");
    expect(terms(await get("ml/probing"))).not.toContain("grokking");
    expect((await stored())["ml/probing"]!.seeds).toEqual([]);
  });
});

describe("the Tag as written", () => {
  const files = {
    ...PROBING,
    "s/p.md": paper("p", ["ml"], "Parent paper words. Parent paper words."),
  };

  it("keeps a parent's Seeds and Exclusions out of its children, and the reverse", async () => {
    const { get, edit } = await open(files);
    await edit("seed", "ml", "parent seed");
    await edit("exclude", "ml", "residual stream");
    await edit("seed", "ml/probing", "child seed");
    await edit("exclude", "ml/probing", "linear probe");

    const child = await get("ml/probing");
    expect(terms(child)).toContain("child seed");
    expect(terms(child)).not.toContain("parent seed");
    expect(terms(child)).toContain("residual stream");
    expect(child.excluded).toEqual(["linear probe"]);

    const parent = await get("ml");
    expect(terms(parent)).toContain("parent seed");
    expect(terms(parent)).not.toContain("child seed");
    expect(parent.excluded).toEqual(["residual stream"]);
  });

  it("keys each by the full Tag path in lexicon.json, and holds nothing else", async () => {
    const { edit, stored } = await open(files);
    await edit("seed", "ml", "parent seed");
    await edit("exclude", "ml/probing", "linear probe");
    expect(await stored()).toEqual({
      ml: { seeds: ["parent seed"], excluded: [] },
      "ml/probing": { seeds: [], excluded: ["linear probe"] },
    });
  });
});

describe("lexicon.json", () => {
  it("survives dropping and rebuilding the Index", async () => {
    const { vault, edit } = await open(PROBING);
    await edit("seed", "ml/probing", "grokking");
    await edit("exclude", "ml/probing", "linear probe");
    await closeCores();

    await rm(join(vault, ".vitrine/index.sqlite"), { force: true });
    const again = await core();
    await again.mutate("vault.open", { path: vault });
    await again.indexed();
    const reply = await again.query<LexiconView>("lexicon.get", {
      tag: "ml/probing",
    });
    const view = reply.result!.data;
    expect(terms(view)).toContain("grokking");
    expect(terms(view)).not.toContain("linear probe");
  });

  it("loses no edit when several land at once", async () => {
    const { edit, stored } = await open(PROBING);
    const words = ["alpha one", "beta two", "gamma three", "delta four"];
    const replies = await Promise.all([
      ...words.map((w) => edit("seed", "ml/probing", w)),
      edit("exclude", "ml/steering", "steering vector"),
      edit("seed", "ml", "parent seed"),
    ]);
    for (const reply of replies) expect(reply.error).toBeUndefined();
    const file = await stored();
    expect([...file["ml/probing"]!.seeds].sort()).toEqual([...words].sort());
    expect(file["ml/steering"]!.excluded).toEqual(["steering vector"]);
    expect(file["ml"]!.seeds).toEqual(["parent seed"]);
  });

  it("is refused loudly when it does not parse, and the file is left as found", async () => {
    const { c, vault, edit } = await open({
      ...PROBING,
      ".vitrine/lexicon.json": "{ not json",
    });
    const read = await c.query("lexicon.get", { tag: "ml/probing" });
    expect(read.error?.message).toMatch(/lexicon\.json/);
    const write = await edit("seed", "ml/probing", "grokking");
    expect(write.error?.message).toMatch(/lexicon\.json/);
    expect(await readFile(join(vault, ".vitrine/lexicon.json"), "utf8")).toBe(
      "{ not json"
    );
  });
});
