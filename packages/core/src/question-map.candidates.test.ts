import { mkdir, readFile, rename, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CandidateQuestion } from "./question-map.js";
import { closeCores, core, vaultWith } from "./test-core.js";

afterEach(closeCores);

// Candidate links (#487; ADR 0041 decisions 9–10), driven through the router
// on a temp vault, the way the review panel reads and writes them.

const question = (
  name: string,
  {
    tags = [],
    captured = "2026-09-01T10:00:00Z",
    related = [],
  }: { tags?: string[]; captured?: string; related?: string[] } = {}
) => `---
kind: question
id: q-${name}
question: "${name}?"
status: open
captured: ${captured}
context: other
tags: [${tags.join(", ")}]
${related.length === 0 ? "" : `related:\n${related.map((r) => `  - "${r}"`).join("\n")}\n`}---
`;

const paper = (name: string, tags: string[], kind = "source") => `---
kind: ${kind}
citekey: ${name}
title: ${name}
tags: [${tags.join(", ")}]
---
`;

/** `mtimes` are days after a fixed epoch, so recency is the test's to say. */
async function review(
  files: Record<string, string>,
  mtimes: Record<string, number> = {},
  settleMs?: number
) {
  const vault = await vaultWith(files);
  for (const [path, day] of Object.entries(mtimes)) {
    const when = new Date(Date.UTC(2026, 0, 1 + day));
    await utimes(join(vault, path), when, when);
  }
  const c = await core(settleMs === undefined ? {} : { settleMs });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const read = async () => {
    const reply = await c.query<CandidateQuestion[]>("questionMap.candidates");
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  return { vault, c, read };
}

const papersOf = (q: CandidateQuestion) => q.candidates.map((p) => p.path);

describe("questionMap.candidates", () => {
  it("offers a paper that shares at least one Tag, and none that shares none", async () => {
    const { read } = await review({
      "q/Q.md": question("Q", { tags: ["sleep", "memory"] }),
      "s/one.md": paper("one", ["sleep"]),
      "s/two.md": paper("two", ["ml"]),
      "s/stub.md": paper("stub", ["memory"], "source-stub"),
    });
    const [q] = await read();
    expect(papersOf(q!).sort()).toEqual(["s/one.md", "s/stub.md"]);
    expect(q!.candidates.find((p) => p.path === "s/one.md")!.shared).toEqual([
      "sleep",
    ]);
  });

  it("ranks by shared Tags, then the paper's recency", async () => {
    const { read } = await review(
      {
        "q/Q.md": question("Q", { tags: ["a", "b", "c"] }),
        "s/old-three.md": paper("old-three", ["a", "b", "c"]),
        "s/new-one.md": paper("new-one", ["a"]),
        "s/old-one.md": paper("old-one", ["b"]),
        "s/new-two.md": paper("new-two", ["a", "b"]),
      },
      {
        "s/old-three.md": 1,
        "s/old-one.md": 2,
        "s/new-one.md": 9,
        "s/new-two.md": 8,
      }
    );
    expect(papersOf((await read())[0]!)).toEqual([
      "s/old-three.md",
      "s/new-two.md",
      "s/new-one.md",
      "s/old-one.md",
    ]);
  });

  it("never offers a paper already linked, and an anchored Question has no candidates", async () => {
    const { read } = await review({
      "q/Anchored.md": question("Anchored", {
        tags: ["a"],
        related: ["[[one]]"],
      }),
      "s/one.md": paper("one", ["a"]),
    });
    expect(await read()).toEqual([]);
  });

  it("lists Questions with the most candidates first, then newest, and omits those with none", async () => {
    const { read } = await review({
      "q/Few.md": question("Few", {
        tags: ["a"],
        captured: "2026-09-05T10:00:00Z",
      }),
      "q/Many.md": question("Many", {
        tags: ["b"],
        captured: "2026-09-01T10:00:00Z",
      }),
      "q/Tied older.md": question("Tied older", {
        tags: ["a"],
        captured: "2026-09-02T10:00:00Z",
      }),
      "q/None.md": question("None", { tags: ["zzz"] }),
      "s/x.md": paper("x", ["a"]),
      "s/y.md": paper("y", ["b"]),
      "s/z.md": paper("z", ["b"]),
    });
    expect((await read()).map((q) => q.path)).toEqual([
      "q/Many.md",
      "q/Few.md",
      "q/Tied older.md",
    ]);
  });
});

describe("accepting a candidate", () => {
  it("writes only a related entry, through questions.link, and the next read has the Question anchored", async () => {
    const { c, vault, read } = await review({
      "q/Q.md": question("Q", { tags: ["a"] }),
      "s/one.md": paper("one", ["a"]),
    });
    const reply = await c.mutate("questions.link", {
      path: "q/Q.md",
      target: "s/one.md",
    });
    expect(reply.error).toBeUndefined();
    const written = await readFile(join(vault, "q/Q.md"), "utf8");
    expect(written).toMatch(/related:\n\s+- "?\[\[one\]\]"?/);
    expect(written).not.toMatch(/supporting|opposing/i);
    await c.indexed();
    expect(await read()).toEqual([]);
  });

  it("leaves the file untouched for an already-linked paper", async () => {
    const { c, vault } = await review({
      "q/Q.md": question("Q", { tags: ["a"], related: ["[[one]]"] }),
      "s/one.md": paper("one", ["a"]),
    });
    const before = await readFile(join(vault, "q/Q.md"), "utf8");
    await c.mutate("questions.link", { path: "q/Q.md", target: "s/one.md" });
    expect(await readFile(join(vault, "q/Q.md"), "utf8")).toBe(before);
  });
});

describe("rejecting a candidate", () => {
  const files = {
    "q/Q.md": question("Q", { tags: ["a"] }),
    "s/one.md": paper("one", ["a"]),
    "s/two.md": paper("two", ["a"]),
  };
  const rejectionOf = async (
    read: () => Promise<CandidateQuestion[]>,
    path: string
  ) => (await read())[0]!.candidates.find((p) => p.path === path)!.rejection;
  const dismissalsOf = async (vault: string) =>
    JSON.parse(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    ) as Record<string, Record<string, string>>;

  it("records one dismissal per pair under the Question's id, and leaves its other candidates offered", async () => {
    const { c, vault, read } = await review(files);
    const rejection = await rejectionOf(read, "s/one.md");
    expect(rejection.subject).toBe("q-Q");
    expect(rejection.kind).toMatch(/^inferred-link:/);
    expect(
      (await c.mutate("looseEnds.dismiss", rejection)).error
    ).toBeUndefined();
    expect(Object.keys((await dismissalsOf(vault))["q-Q"]!)).toEqual([
      rejection.kind,
    ]);
    expect(papersOf((await read())[0]!)).toEqual(["s/two.md"]);
  });

  it("never offers a rejected pair again, and a rejected Question's last candidate removes the Question", async () => {
    const { c, read } = await review({
      "q/Q.md": files["q/Q.md"],
      "s/one.md": files["s/one.md"],
    });
    await c.mutate("looseEnds.dismiss", await rejectionOf(read, "s/one.md"));
    expect(await read()).toEqual([]);
  });

  it("undo removes exactly that pair", async () => {
    const { c, vault, read } = await review(files);
    const one = await rejectionOf(read, "s/one.md");
    const two = await rejectionOf(read, "s/two.md");
    await c.mutate("looseEnds.dismiss", one);
    await c.mutate("looseEnds.dismiss", two);
    await c.mutate("looseEnds.undismiss", one);
    expect(Object.keys((await dismissalsOf(vault))["q-Q"]!)).toEqual([
      two.kind,
    ]);
    expect(papersOf((await read())[0]!)).toEqual(["s/one.md"]);
  });

  it("is refused, saying so, when the dismissals file does not parse", async () => {
    const { c, vault, read } = await review(files);
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    await writeFile(join(vault, ".vitrine/dismissals.json"), "{ not json");
    const reply = await c.mutate(
      "looseEnds.dismiss",
      await rejectionOf(read, "s/one.md")
    );
    expect(reply.error?.message).toMatch(/dismissals\.json could not be read/);
    expect(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    ).toBe("{ not json");
  });

  it("survives the Question being renamed", async () => {
    const { c, vault, read } = await review(files, {}, 40);
    await c.mutate("looseEnds.dismiss", await rejectionOf(read, "s/one.md"));
    const events = await c.events();
    await rename(join(vault, "q/Q.md"), join(vault, "q/Renamed.md"));
    await events.next("vaultChanged");
    events.close();
    const [q] = await read();
    expect(q!.path).toBe("q/Renamed.md");
    expect(papersOf(q!)).toEqual(["s/two.md"]);
  });

  it("does nothing for a dismissal naming a paper that no longer exists", async () => {
    const { c, read } = await review(files);
    await c.mutate("looseEnds.dismiss", {
      subject: "q-Q",
      kind: "inferred-link:gone-paper",
    });
    expect(papersOf((await read())[0]!).sort()).toEqual([
      "s/one.md",
      "s/two.md",
    ]);
  });
});

// Keyword-overlap candidates (#654; ADR 0045, ADR 0041 decision 9): a paper
// sharing no Tag with the row, whose text holds two distinct Terms of one
// Lexicon of a Tag the row carries.

const abstractPaper = (name: string, tags: string[], abstract: string) => `---
kind: source
citekey: ${name}
title: ${name}
tags: [${tags.join(", ")}]
---
${abstract
  .split(". ")
  .map((s) => `> ${s}`)
  .join("\n")}
`;

// Three papers whose abstracts recur on "residual stream" and "linear
// probe" make those Terms of the Tag; an untagged filler keeps them rare.
const PROBING = {
  "s/z.md": abstractPaper("z", [], "Rats sleep deeply."),
  "s/a.md": abstractPaper(
    "a",
    ["probing"],
    "The residual stream carries features. A linear probe reads alpha."
  ),
  "s/b.md": abstractPaper(
    "b",
    ["probing"],
    "The residual stream is sparse. A linear probe reads beta."
  ),
  "s/c.md": abstractPaper(
    "c",
    ["probing"],
    "The residual stream grows. A linear probe reads gamma."
  ),
};
const BOTH = "The residual stream feeds a linear probe.";

// Exactly two Terms ("residual", "stream"): every other word is the paper's
// own, so a paper holding one of them holds exactly one Term. (Overlapping
// phrases such as "residual stream" would make a single mention several.)
const TWO_WORDS = {
  "s/z.md": PROBING["s/z.md"],
  "s/a.md": abstractPaper("a", ["probing"], "Residual alpha. Stream beta."),
  "s/b.md": abstractPaper("b", ["probing"], "Residual gamma. Stream delta."),
  "s/c.md": abstractPaper("c", ["probing"], "Residual epsilon. Stream zeta."),
};

const byPath = (q: CandidateQuestion, path: string) =>
  q.candidates.find((p) => p.path === path);

describe("questionMap.candidates — keyword overlap", () => {
  it("offers a paper with two distinct Terms and not one with a single Term, naming the Terms", async () => {
    const { read } = await review({
      ...TWO_WORDS,
      "q/Q.md": question("Q", { tags: ["probing"] }),
      "s/both.md": abstractPaper("both", [], "Residual and stream."),
      "s/one.md": abstractPaper("one", [], "Residual only."),
    });
    const [q] = await read();
    expect(byPath(q!, "s/one.md")).toBeUndefined();
    expect(byPath(q!, "s/both.md")!.terms).toEqual(["residual", "stream"]);
    expect(byPath(q!, "s/both.md")!.shared).toEqual([]);
  });

  it("never offers a paper sharing a Tag as a keyword match: it keeps its Tags and has no Terms", async () => {
    const { read } = await review({
      ...PROBING,
      "q/Q.md": question("Q", { tags: ["probing"] }),
    });
    const [q] = await read();
    expect(papersOf(q!).sort()).toEqual(["s/a.md", "s/b.md", "s/c.md"]);
    for (const c of q!.candidates) {
      expect(c.shared).toEqual(["probing"]);
      expect(c.terms).toEqual([]);
    }
  });

  it("ranks every shared-Tag candidate above a keyword one, however new the keyword paper", async () => {
    const { read } = await review(
      {
        ...PROBING,
        "q/Q.md": question("Q", { tags: ["probing"] }),
        "s/both.md": abstractPaper("both", [], BOTH),
      },
      { "s/a.md": 1, "s/b.md": 2, "s/c.md": 3, "s/both.md": 99 }
    );
    expect(papersOf((await read())[0]!)).toEqual([
      "s/c.md",
      "s/b.md",
      "s/a.md",
      "s/both.md",
    ]);
  });

  it("needs both Terms from one Tag's Lexicon, not one from each of two", async () => {
    const { read } = await review({
      ...TWO_WORDS,
      "s/d.md": abstractPaper("d", ["sleep"], "Slow kappa. Wave lambda."),
      "s/e.md": abstractPaper("e", ["sleep"], "Slow mu. Wave nu."),
      "s/f.md": abstractPaper("f", ["sleep"], "Slow xi. Wave pi."),
      "q/Q.md": question("Q", { tags: ["probing", "sleep"] }),
      // "residual" is probing's Term, "slow" is sleep's: two, but not of one.
      "s/split.md": abstractPaper("split", [], "Residual slow."),
    });
    expect(byPath((await read())[0]!, "s/split.md")).toBeUndefined();
  });

  it("offers nothing for a Question whose Tags are too thin to have a Lexicon", async () => {
    const { read } = await review({
      "q/Q.md": question("Q", { tags: ["probing"] }),
      "s/a.md": abstractPaper("a", ["probing"], BOTH),
      "s/both.md": abstractPaper("both", [], BOTH),
    });
    expect(papersOf((await read())[0]!)).toEqual(["s/a.md"]);
  });

  it("never offers a rejected keyword pair, and undo brings it back", async () => {
    const { c, read } = await review({
      ...PROBING,
      "q/Q.md": question("Q", { tags: ["probing"] }),
      "s/both.md": abstractPaper("both", [], BOTH),
    });
    const rejection = byPath((await read())[0]!, "s/both.md")!.rejection;
    await c.mutate("looseEnds.dismiss", rejection);
    expect(byPath((await read())[0]!, "s/both.md")).toBeUndefined();
    await c.mutate("looseEnds.undismiss", rejection);
    expect(byPath((await read())[0]!, "s/both.md")).toBeDefined();
  });

  it("accepting writes Related only, and the linked paper is never offered again", async () => {
    const { c, vault, read } = await review({
      ...PROBING,
      "q/Q.md": question("Q", { tags: ["probing"] }),
      "s/both.md": abstractPaper("both", [], BOTH),
    });
    const reply = await c.mutate("questions.link", {
      path: "q/Q.md",
      target: "s/both.md",
    });
    expect(reply.error).toBeUndefined();
    const written = await readFile(join(vault, "q/Q.md"), "utf8");
    expect(written).toMatch(/related:\n\s+- "?\[\[both\]\]"?/);
    expect(written).not.toMatch(/supporting|opposing/i);
    await c.indexed();
    expect(await read()).toEqual([]);
  });
});
