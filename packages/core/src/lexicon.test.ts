import { afterEach, describe, expect, it } from "vitest";
import type { Attention, LexiconView } from "./lexicon.js";
import { closeCores, core, vaultWith } from "./test-core.js";

afterEach(closeCores);

// The Lexicon, read-only (#651; ADR 0018, ADR 0045; `docs/architecture.md`
// § Lexicon), driven through the router on a temp vault, the way the
// Attention panel reads it. No OpenAlex is faked: this slice makes no
// network call, and a test that needed one would be testing the next slice.

const paper = (
  name: string,
  tags: string[],
  abstract: string,
  { keywords = [] as string[], kind = "source" } = {}
) => `---
kind: ${kind}
citekey: ${name}
title: ${name} on ${abstract.split(".")[0]}
tags: [${tags.join(", ")}]
${keywords.length === 0 ? "" : `keywords: [${keywords.join(", ")}]\n`}---
${abstract
  .split(". ")
  .map((s) => `> ${s}`)
  .join("\n")}
`;

const question = (name: string, tags: string[], related: string[]) => `---
kind: question
id: q-${name}
question: "${name}?"
status: open
captured: 2026-09-01T10:00:00Z
context: other
tags: [${tags.join(", ")}]
related:
${related.map((r) => `  - "${r}"`).join("\n")}
---
`;

async function lexiconOf(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core();
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const attention = async (depth?: number) => {
    const reply = await c.query<Attention>(
      "questionMap.attention",
      depth === undefined ? undefined : { depth }
    );
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  const get = async (tag: string, depth?: number) => {
    const reply = await c.query<LexiconView>("lexicon.get", { tag, depth });
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  return { c, attention, get };
}

// Three papers of one Tag that recur on "residual stream" and "linear
// probe", plus one phrase each that appears nowhere else, and an untagged
// paper beside them: with nothing else in the vault every phrase would be
// everywhere, and rarity would score all of it nothing.
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
};

const terms = (view: LexiconView) => view.terms.map((t) => t.term);
const unused = (view: LexiconView) => view.notUsed.map((t) => t.term);

describe("lexicon.get — derivation", () => {
  it("takes the phrases that recur in at least two of the Tag's papers, and nothing a single abstract said", async () => {
    const { get } = await lexiconOf(PROBING);
    const view = await get("ml/probing");
    expect(terms(view)).toContain("residual stream");
    expect(terms(view)).toContain("linear probe");
    for (const once of ["alpha", "beta", "gamma"]) {
      expect(terms(view)).not.toContain(once);
      expect(unused(view)).not.toContain(once);
    }
  });

  it("discounts a phrase the whole vault uses, so it falls below the cut", async () => {
    const { get } = await lexiconOf({
      ...PROBING,
      // "neural networks" is in every paper of the vault: rarity zero.
      "s/a.md": paper(
        "a",
        ["ml/probing"],
        "Neural networks hold a residual stream. Neural networks again."
      ),
      "s/b.md": paper(
        "b",
        ["ml/probing"],
        "Neural networks hold a residual stream. A linear probe."
      ),
      "s/c.md": paper(
        "c",
        ["ml/probing"],
        "Neural networks hold a residual stream. A linear probe."
      ),
      "s/d.md": paper("d", ["sleep"], "Neural networks of rats sleep."),
    });
    const view = await get("ml/probing");
    expect(terms(view)).toContain("residual stream");
    expect(terms(view)).not.toContain("neural networks");
    expect(unused(view)).toContain("neural networks");
  });

  it("scores a rarer phrase above a commoner one that the Tag's papers share equally", async () => {
    const { get } = await lexiconOf({
      "s/a.md": paper("a", ["x"], "Rare thing. Common thing."),
      "s/b.md": paper("b", ["x"], "Rare thing. Common thing."),
      "s/c.md": paper("c", ["x"], "Another."),
      "s/d.md": paper("d", ["y"], "Common thing."),
      "s/e.md": paper("e", ["y"], "Common thing."),
    });
    const order = terms(await get("x"));
    expect(order.indexOf("rare thing")).toBeLessThan(
      order.indexOf("common thing")
    );
  });

  it("lets an author keyword skip the two-paper floor, but not the cut", async () => {
    const { get } = await lexiconOf({
      ...PROBING,
      "s/a.md": paper(
        "a",
        ["ml/probing"],
        "The residual stream carries features. A linear probe reads alpha.",
        { keywords: ["mechanistic interpretability"] }
      ),
    });
    const view = await get("ml/probing");
    const kw = view.terms.find(
      (t) => t.term === "mechanistic interpretability"
    );
    expect(kw?.origin).toBe("author keyword");
    expect(view.terms.find((t) => t.term === "residual stream")?.origin).toBe(
      "derived"
    );
  });

  it("counts an author keyword twice, so it outranks an equally common derived phrase", async () => {
    const { get } = await lexiconOf({
      "s/a.md": paper("a", ["x"], "Gamma delta here.", {
        keywords: ["zeta eta"],
      }),
      "s/b.md": paper("b", ["x"], "Gamma delta there.", {
        keywords: ["zeta eta"],
      }),
      "s/c.md": paper("c", ["x"], "Something else."),
      "s/d.md": paper("d", ["y"], "Elsewhere."),
    });
    // Both are in the same two papers, so rarity and votes tie and only the
    // x2 (not the alphabet, which favours "gamma delta") puts "zeta eta" first.
    const order = terms(await get("x"));
    expect(order.indexOf("zeta eta")).toBeLessThan(
      order.indexOf("gamma delta")
    );
  });

  it("keeps ten Terms in use and the rest as not used", async () => {
    const many = (n: string) =>
      Array.from(
        { length: 12 },
        (_, i) => `topic${String.fromCharCode(97 + i)} idea`
      )
        .join(". ")
        .concat(`. unique${n} bit`);
    const { get } = await lexiconOf({
      "s/a.md": paper("a", ["x"], many("a")),
      "s/b.md": paper("b", ["x"], many("b")),
      "s/c.md": paper("c", ["x"], many("c")),
      "s/d.md": paper("d", ["y"], "Elsewhere."),
    });
    const view = await get("x");
    expect(view.terms).toHaveLength(10);
    expect(view.notUsed.length).toBeGreaterThan(0);
  });

  it("compiles the Terms in use into the OpenAlex query, verbatim", async () => {
    const { get } = await lexiconOf(PROBING);
    const view = await get("ml/probing");
    expect(view.query).toBe(
      `filter=title_and_abstract.search:(${view.terms.map((t) => `"${t.term}"`).join(" OR ")})`
    );
  });
});

describe("the Tag's papers", () => {
  it("counts every paper held with the Tag, including one no Question points at, and a paper reached from a Question carrying it", async () => {
    const { attention } = await lexiconOf({
      ...PROBING,
      "s/d.md": paper("d", [], "Untagged but pointed at."),
      "q/Q.md": question("Q", ["ml/probing"], ["[[d]]"]),
    });
    const view = await attention();
    const tag = view.tags.find((t) => t.tag === "ml/probing")!;
    expect(tag.papers).toBe(4);
  });

  it("makes a parent the union of its descendants, and a leaf its own", async () => {
    const { attention, get } = await lexiconOf({
      "s/a.md": paper("a", ["ml/probing"], "Linear probe one. Shared words."),
      "s/b.md": paper("b", ["ml/probing"], "Linear probe two. Shared words."),
      "s/c.md": paper("c", ["ml/steering"], "Steering vector. Shared words."),
      "s/d.md": paper("d", ["ml/steering"], "Steering vector again."),
      "s/e.md": paper("e", ["ml/steering"], "Steering vector thrice."),
      "s/f.md": paper("f", ["ml"], "Parent only phrase. Parent only phrase."),
    });
    const parent = (await attention(1)).tags.find((t) => t.tag === "ml")!;
    expect(parent.papers).toBe(6);
    const deep = await attention();
    expect(deep.depth).toBe(2);
    expect(deep.tags.find((t) => t.tag === "ml/probing")!.papers).toBe(2);
    // Flat, not inherited: the leaf never takes its parent's Terms.
    const leaf = await get("ml/steering");
    expect(terms(leaf)).toContain("steering vector");
    expect(terms(leaf)).not.toContain("parent only phrase");
  });

  it("rolls up as the matrix does: the default depth is the deepest Tag in use", async () => {
    const { attention, c } = await lexiconOf(PROBING);
    const map = await c.query<{ deepest: number; depth: number }>(
      "questionMap.coverage"
    );
    const view = await attention();
    expect(view.deepest).toBe(map.result!.data.deepest);
    expect(view.depth).toBe(map.result!.data.depth);
  });
});

describe("unplaced", () => {
  it("is a Tag with fewer than three papers with text, never low, and still counts toward its parent", async () => {
    const { attention, get } = await lexiconOf({
      "s/a.md": paper("a", ["ml/thin"], "Thin one. Words."),
      "s/b.md": paper("b", ["ml/thin"], "Thin two. Words."),
      "s/c.md": paper("c", ["ml/other"], "Other one. Words."),
    });
    const deep = await attention();
    const thin = deep.tags.find((t) => t.tag === "ml/thin")!;
    expect(thin.state).toBe("unplaced");
    expect(thin.reason).toBe("few-papers");
    const view = await get("ml/thin");
    expect(view.query).toBeNull();
    expect(view.terms).toEqual([]);
    // The parent holds all three, so it is placeable.
    const parent = (await attention(1)).tags.find((t) => t.tag === "ml")!;
    expect(parent.papers).toBe(3);
    expect(parent.state).toBe("not yet measured");
  });
});

describe("questionMap.attention", () => {
  it("says nothing has been synced, and lists a placeable Tag as not yet measured", async () => {
    const { attention } = await lexiconOf(PROBING);
    const view = await attention();
    expect(view.asOf).toBeNull();
    expect(view.synced).toBe(false);
    expect(view.tags).toEqual([
      expect.objectContaining({
        tag: "ml/probing",
        papers: 3,
        state: "not yet measured",
        reason: null,
      }),
    ]);
  });

  it("has no Tags in a vault with none", async () => {
    const { attention } = await lexiconOf({
      "s/a.md": paper("a", [], "Untagged."),
    });
    expect((await attention()).tags).toEqual([]);
  });

  it("lists the Tags with the most papers first", async () => {
    const { attention } = await lexiconOf({
      ...PROBING,
      "s/d.md": paper("d", ["sleep"], "Sleep."),
    });
    expect((await attention()).tags.map((t) => t.tag)).toEqual([
      "ml/probing",
      "sleep",
    ]);
  });
});
