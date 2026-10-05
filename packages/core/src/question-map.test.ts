import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Coverage, Matrix, Readings } from "./question-map.js";
import { MAP_COLUMNS, MAP_ROWS, rollUp } from "./question-map.js";
import { closeCores, core, vaultWith, type CoreOptions } from "./test-core.js";

afterEach(closeCores);

// The Map's Coverage derivation (#483; ADR 0041 decisions 5, 6, 8, 13),
// driven through the router on a temp vault, the way the page reads it.

const question = (
  name: string,
  {
    status = "open",
    id = `q-${name}`,
    related = [],
    captured = "2026-09-01T10:00:00Z",
    extra = "",
  }: {
    status?: string;
    id?: string;
    related?: string[];
    captured?: string | null;
    extra?: string;
  } = {}
) => `---
kind: question
id: ${id}
question: "${name}?"
status: ${status}
${captured === null ? "" : `captured: ${captured}\n`}context: other
${related.length === 0 ? "" : `related:\n${related.map((r) => `  - "${r}"`).join("\n")}\n`}${extra}---
`;

const page = (
  name: string,
  {
    status = "open",
    supporting = "",
    opposing = "",
    related = "",
    promotedFrom = name,
    id = `rq-${name}`,
  }: {
    status?: string;
    supporting?: string;
    opposing?: string;
    related?: string;
    promotedFrom?: string | null;
    id?: string;
  } = {}
) => `---
kind: research-question
id: ${id}
question: "${name}?"
status: ${status}
${promotedFrom === null ? "" : `promoted_from: "[[${promotedFrom}]]"\n`}promoted: 2026-09-10T10:00:00Z
context: other
---

## Working answer

## Supporting sources
${supporting}
## Opposing sources
${opposing}
## Related questions
${related}
## Open threads

## Position history
`;

const source = (name: string, tags: string[], body = "") => `---
kind: source
citekey: ${name}
title: ${name}
tags: [${tags.join(", ")}]
---
${body}`;

const stub = (
  name: string,
  tags: string[],
  {
    questions = [] as string[],
    scout,
  }: { questions?: string[]; scout?: string } = {}
) => `---
kind: source-stub
title: ${name}
tags: [${tags.join(", ")}]
${scout === undefined ? "" : `origin_scout: ${scout}\n`}${questions.length === 0 ? "" : `origin_question:\n${questions.map((q) => `  - ${q}`).join("\n")}\n`}---
`;

async function mapOf(files: Record<string, string>, opts: CoreOptions = {}) {
  const vault = await vaultWith(files);
  const c = await core(opts);
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const read = async (depth?: number) => {
    const reply = await c.query<Coverage>(
      "questionMap.coverage",
      depth === undefined ? undefined : { depth }
    );
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  return { vault, c, read };
}

const paths = (coverage: Coverage) => coverage.rows.map((r) => r.path).sort();
const materialOf = (coverage: Coverage, row: string) =>
  coverage.rows
    .find((r) => r.path === row)!
    .material.map((m) => m.path)
    .sort();

describe("questionMap.coverage — the Map rows", () => {
  it("is an open Question and an open Research Question with its originating Question folded in, and nothing else", async () => {
    const { read } = await mapOf({
      "q/Open one.md": question("Open one"),
      "q/Promoted one.md": question("Promoted one", { status: "promoted" }),
      "q/Promoted one (RQ).md": page("Promoted one"),
      "q/Answered one.md": question("Answered one", { status: "answered" }),
      "q/Dropped one.md": question("Dropped one", { status: "abandoned" }),
      "q/Closed (RQ).md": page("Closed", { status: "answered" }),
      "q/Partial one.md": question("Partial one", { captured: null }),
      "q/Unreadable one.md": question("Unreadable one", { status: "nonsense" }),
      "h/Hypothesis.md": `---\nkind: hypothesis\nquestion: "A hypothesis?"\nstatus: open\npromoted_from: "[[Open one]]"\n---\n`,
    });
    const coverage = await read();

    // The thread is one row, and it is the page: the Question it came from
    // is folded in, never a second row (ADR 0041 decision 6).
    expect(paths(coverage)).toEqual([
      "q/Open one.md",
      "q/Promoted one (RQ).md",
    ]);
  });

  it("keeps a Question that was promoted and then reopened off the Map while its page is open", async () => {
    const { read } = await mapOf({
      "q/Back.md": question("Back"),
      "q/Back (RQ).md": page("Back"),
    });
    expect(paths(await read())).toEqual(["q/Back (RQ).md"]);
  });
});

describe("questionMap.coverage — Material", () => {
  const vault = (extra: Record<string, string> = {}) => ({
    "q/Q.md": question("Q", { related: ["[[rasch]]"] }),
    "s/rasch.md": source("rasch", ["ml/probing", "sleep", "memory"]),
    ...extra,
  });

  it("counts a paper with three Tags once, each Tag carried by it", async () => {
    const { read } = await mapOf(vault());
    const [row] = (await read()).rows;
    expect(row!.material).toHaveLength(1);
    expect(row!.material[0]!.tags).toEqual(["memory", "ml/probing", "sleep"]);
  });

  it("counts a highlight once with its Source", async () => {
    const { read } = await mapOf({
      "q/Q.md": question("Q", { related: ["[[rasch]]", "[[rasch#^h3]]"] }),
      "s/rasch.md": source("rasch", ["sleep"], "\nA passage. ^h3\n"),
    });
    expect(materialOf(await read(), "q/Q.md")).toEqual(["s/rasch.md"]);
  });

  it("counts a highlight cited alone as its Source", async () => {
    const { read } = await mapOf({
      "q/Q.md": question("Q", { related: ["[[rasch#^h3]]"] }),
      "s/rasch.md": source("rasch", ["sleep"], "\nA passage. ^h3\n"),
    });
    expect(materialOf(await read(), "q/Q.md")).toEqual(["s/rasch.md"]);
  });

  it("counts nothing for a link that lands on nothing, and says so on the row", async () => {
    const { read } = await mapOf(
      vault({ "q/Q.md": question("Q", { related: ["[[nowhere]]"] }) })
    );
    const [row] = (await read()).rows;
    expect(row!.material).toEqual([]);
    expect(row!.unresolved).toEqual([
      { link: "[[nowhere]]", reason: "matches no file in the vault" },
    ]);
  });

  it("counts nothing for an ambiguous link, and says so on the row", async () => {
    const { read } = await mapOf({
      "q/Q.md": question("Q", { related: ["[[twin]]"] }),
      "a/twin.md": source("twin", ["sleep"]),
      "b/twin.md": source("twin", ["sleep"]),
    });
    const [row] = (await read()).rows;
    expect(row!.material).toEqual([]);
    expect(row!.unresolved).toEqual([
      { link: "[[twin]]", reason: "matches more than one file" },
    ]);
  });

  it("counts nothing for a Source that merely shares a Tag with the Question", async () => {
    const { read } = await mapOf({
      "q/Q.md": question("Q", { extra: "tags: [sleep]\n" }),
      "s/rasch.md": source("rasch", ["sleep"]),
    });
    expect((await read()).rows[0]!.material).toEqual([]);
  });

  it("counts a Source mentioned in prose or in `from:` as nothing: only Related is an edge", async () => {
    const { read } = await mapOf({
      "q/Q.md": `${question("Q", { extra: 'from: "[[rasch]]"\n' })}\nSee [[rasch]].\n`,
      "s/rasch.md": source("rasch", ["sleep"]),
    });
    expect((await read()).rows[0]!.material).toEqual([]);
  });

  it("leaves a Related note that is not a Source out of the Material", async () => {
    const { read } = await mapOf({
      "q/Q.md": question("Q", { related: ["[[A note]]", "[[Other]]"] }),
      "n/A note.md": "# a note\n",
      "q/Other.md": question("Other"),
    });
    const row = (await read()).rows.find((r) => r.path === "q/Q.md")!;
    expect(row.material).toEqual([]);
    expect(row.unresolved).toEqual([]);
  });

  it("reads a Research Question's attached sources and related, plus its originating Question's Related", async () => {
    const { read } = await mapOf({
      "q/Back.md": question("Back", {
        status: "promoted",
        related: ["[[one]]"],
      }),
      "q/Back (RQ).md": page("Back", {
        supporting: "- [[two]]\n",
        opposing: "- [[three]]\n",
        related: "- [[four]]\n",
      }),
      "s/one.md": source("one", ["a"]),
      "s/two.md": source("two", ["a"]),
      "s/three.md": source("three", ["b"]),
      "s/four.md": source("four", ["b"]),
      "s/five.md": source("five", ["b"], "A mention of [[Back]] in prose.\n"),
    });
    expect(materialOf(await read(), "q/Back (RQ).md")).toEqual([
      "s/four.md",
      "s/one.md",
      "s/three.md",
      "s/two.md",
    ]);
  });

  it("counts a stub whose origin_question names the row's id, and not one naming another", async () => {
    const { read } = await mapOf({
      "q/Q.md": question("Q"),
      "q/R.md": question("R"),
      "s/kept.md": stub("kept", ["sleep"], { questions: ["q-Q"], scout: "sl" }),
    });
    const coverage = await read();
    expect(materialOf(coverage, "q/Q.md")).toEqual(["s/kept.md"]);
    expect(materialOf(coverage, "q/R.md")).toEqual([]);
    expect(
      coverage.rows.find((r) => r.path === "q/Q.md")!.material[0]!.kind
    ).toBe("source-stub");
  });

  it("reaches the next read after an edit made outside the app to Related or to Tags", async () => {
    const { vault, c, read } = await mapOf(
      {
        "q/Q.md": question("Q"),
        "s/rasch.md": source("rasch", ["sleep"]),
      },
      { settleMs: 40 }
    );
    expect((await read()).rows[0]!.material).toEqual([]);

    const events = await c.events();
    await writeFile(
      join(vault, "q/Q.md"),
      question("Q", { related: ["[[rasch]]"] })
    );
    await events.next("vaultChanged");
    expect((await read()).rows[0]!.material.map((m) => m.tags)).toEqual([
      ["sleep"],
    ]);

    await writeFile(join(vault, "s/rasch.md"), source("rasch", ["memory"]));
    await events.next("vaultChanged");
    expect((await read()).rows[0]!.material.map((m) => m.tags)).toEqual([
      ["memory"],
    ]);
    events.close();
  });
});

describe("questionMap.coverage — the Tag roll-up", () => {
  const files = {
    "q/Q.md": question("Q", {
      related: ["[[deep]]", "[[exact]]", "[[shallow]]"],
    }),
    "s/deep.md": source("deep", ["ml/probing/linear"]),
    "s/exact.md": source("exact", ["ml"]),
    "s/shallow.md": source("shallow", ["ml/steering"]),
  };
  const tagsOf = (coverage: Coverage) =>
    Object.fromEntries(coverage.rows[0]!.material.map((m) => [m.path, m.tags]));

  it("defaults to the deepest Tags in use, where a parent holds only what is tagged exactly that", async () => {
    const coverage = await (await mapOf(files)).read();
    expect(coverage.depth).toBe(3);
    expect(coverage.deepest).toBe(3);
    expect(tagsOf(coverage)).toEqual({
      "s/deep.md": ["ml/probing/linear"],
      "s/exact.md": ["ml"],
      "s/shallow.md": ["ml/steering"],
    });
  });

  it("rolls up to a shallower depth, so a parent and its children are one column", async () => {
    const coverage = await (await mapOf(files)).read(1);
    expect(coverage.depth).toBe(1);
    expect(tagsOf(coverage)).toEqual({
      "s/deep.md": ["ml"],
      "s/exact.md": ["ml"],
      "s/shallow.md": ["ml"],
    });
    expect(coverage.tags).toEqual([{ canonical: "ml", display: "ml" }]);
  });

  it("counts an Implicit tag as the union of its children, and shows it only when rolled up to", async () => {
    const implicit = {
      "q/Q.md": question("Q", { related: ["[[a]]", "[[b]]"] }),
      "s/a.md": source("a", ["ml/probing"]),
      "s/b.md": source("b", ["ml/steering"]),
    };
    const { read } = await mapOf(implicit);
    const deepest = await read();
    expect(deepest.tags.map((t) => t.canonical)).toEqual([
      "ml/probing",
      "ml/steering",
    ]);
    const rolled = await read(1);
    expect(rolled.tags.map((t) => t.canonical)).toEqual(["ml"]);
    expect(rolled.rows[0]!.material.map((m) => m.tags)).toEqual([
      ["ml"],
      ["ml"],
    ]);
  });

  it("clamps a depth outside what is in use", async () => {
    const { read } = await mapOf(files);
    expect((await read(0)).depth).toBe(1);
    expect((await read(9)).depth).toBe(3);
  });

  it("names a Tag in the casing the vault writes it", async () => {
    const { read } = await mapOf({
      "q/Q.md": question("Q", { related: ["[[a]]"] }),
      "s/a.md": source("a", ["ML/Probing"]),
    });
    expect((await read()).tags).toEqual([
      { canonical: "ml/probing", display: "ML/Probing" },
    ]);
  });
});

describe("rollUp", () => {
  it("truncates to the depth, keeps the shorter ones, and is distinct and sorted", () => {
    expect(rollUp(["b/x", "a/y/z", "a/y", "b", "a"], 2)).toEqual([
      "a",
      "a/y",
      "b",
      "b/x",
    ]);
    expect(rollUp(["b/x", "a/y/z", "a/y", "b", "a"], 1)).toEqual(["a", "b"]);
  });
});

describe("questionMap.readings", () => {
  const readings = async (
    files: Record<string, string>,
    depth?: number
  ): Promise<Readings> => {
    const { c } = await mapOf(files);
    const reply = await c.query<Readings>(
      "questionMap.readings",
      depth === undefined ? undefined : { depth }
    );
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  const names = (list: Array<{ question: string }>) =>
    list.map((r) => r.question);

  it("ranks unanchored rows newest first, and counts every one the matrix would cut off", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      const day = String(i + 1).padStart(2, "0");
      files[`q/Bare ${day}.md`] = question(`Bare ${day}`, {
        captured: `2026-08-${day}T10:00:00Z`,
      });
    }
    files["q/Held.md"] = question("Held", { related: ["[[a]]"] });
    files["s/a.md"] = source("a", ["x"]);
    const r = await readings(files);
    expect(r.unanchored.count).toBe(30);
    expect(r.unanchored.items).toHaveLength(30);
    expect(names(r.unanchored.items).slice(0, 2)).toEqual([
      "Bare 30?",
      "Bare 29?",
    ]);
  });

  it("puts the rows with most Material at the top of well-supported, and no row without any", async () => {
    const r = await readings({
      "q/Two.md": question("Two", { related: ["[[a]]", "[[b]]"] }),
      "q/One.md": question("One", { related: ["[[a]]"] }),
      "q/None.md": question("None"),
      "s/a.md": source("a", ["x"]),
      "s/b.md": source("b", ["x"]),
    });
    expect(names(r.wellSupported.items)).toEqual(["Two?", "One?"]);
    expect(r.wellSupported.count).toBe(2);
    expect(r.wellSupported.items[0]!.material).toBe(2);
  });

  it("holds a Tag whose Material no row reaches, ranked by Material count", async () => {
    const r = await readings({
      "q/Q.md": question("Q", { related: ["[[a]]"] }),
      "s/a.md": source("a", ["asked"]),
      "s/b.md": source("b", ["lone"]),
      "s/c.md": source("c", ["pair"]),
      "s/d.md": source("d", ["pair"]),
    });
    expect(r.unquestionedKnowledge.count).toBe(2);
    expect(
      r.unquestionedKnowledge.items.map((t) => [t.tag, t.material.length])
    ).toEqual([
      ["pair", 2],
      ["lone", 1],
    ]);
  });

  it("holds a stub from an unassigned Scout, and not one from an assigned Scout or one a Question has since linked", async () => {
    const r = await readings({
      "q/Q.md": question("Q", { related: ["[[linked]]"] }),
      "s/free.md": stub("free", ["sleep"], { scout: "sc-1" }),
      "s/assigned.md": stub("assigned", ["sleep"], {
        scout: "sc-2",
        questions: ["q-Q"],
      }),
      "s/linked.md": stub("linked", ["sleep"], { scout: "sc-1" }),
      "s/manual.md": stub("manual", ["sleep"]),
    });
    expect(r.clockedButUnquestioned.count).toBe(1);
    expect(r.clockedButUnquestioned.items).toEqual([
      {
        tag: "sleep",
        display: "sleep",
        stubs: [{ path: "s/free.md", display: "free" }],
      },
    ]);
  });

  it("ranks clocked but unquestioned by stubs per Tag", async () => {
    const r = await readings({
      "s/a.md": stub("a", ["few"], { scout: "s" }),
      "s/b.md": stub("b", ["many"], { scout: "s" }),
      "s/c.md": stub("c", ["many"], { scout: "s" }),
    });
    expect(r.clockedButUnquestioned.items.map((t) => t.tag)).toEqual([
      "many",
      "few",
    ]);
  });

  it("rolls its Tags up at a shallower depth and shows the deepest by default", async () => {
    const files = {
      "s/a.md": source("a", ["ml/probing"]),
      "s/b.md": source("b", ["ml/scaling"]),
    };
    const deep = await readings(files);
    expect(deep.unquestionedKnowledge.items.map((t) => t.tag)).toEqual([
      "ml/probing",
      "ml/scaling",
    ]);
    const shallow = await readings(files, 1);
    expect(
      shallow.unquestionedKnowledge.items.map((t) => [t.tag, t.material.length])
    ).toEqual([["ml", 2]]);
  });

  it("is empty on a vault with nothing to say", async () => {
    const r = await readings({
      "q/Q.md": question("Q", { related: ["[[a]]"] }),
      "s/a.md": source("a", ["x"]),
    });
    expect(r.unanchored.count).toBe(0);
    expect(r.clockedButUnquestioned.count).toBe(0);
    expect(r.unquestionedKnowledge.count).toBe(0);
  });
});

// The coverage matrix (#484; ADR 0041 decision 3): a cut in the core, from
// the same Coverage, with the uncut totals beside it.

describe("questionMap.matrix", () => {
  const read = async (files: Record<string, string>, depth?: number) => {
    const { c } = await mapOf(files);
    const reply = await c.query<Matrix>(
      "questionMap.matrix",
      depth === undefined ? undefined : { depth }
    );
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  const names = (m: Matrix) => m.rows.map((r) => r.path);

  it("sorts rows and columns by weight and counts each cell as distinct Material carrying the Tag", async () => {
    const m = await read({
      "q/Few.md": question("Few", { related: ["[[a]]"] }),
      "q/Many.md": question("Many", { related: ["[[a]]", "[[b]]", "[[c]]"] }),
      "s/a.md": source("a", ["sleep", "memory"]),
      "s/b.md": source("b", ["sleep"]),
      "s/c.md": source("c", ["sleep"]),
    });
    expect(names(m)).toEqual(["q/Many.md", "q/Few.md"]);
    expect(m.rows.map((r) => r.weight)).toEqual([3, 1]);
    // `a` carries two Tags but is one piece of Material: sleep outweighs
    // memory by distinct papers, not by cells.
    expect(m.columns.map((c) => [c.canonical, c.weight])).toEqual([
      ["sleep", 3],
      ["memory", 1],
    ]);
    expect(m.cells).toEqual([
      [3, 1],
      [1, 1],
    ]);
  });

  it("weighs a column by distinct Material across the rows shown, not the sum of its cells", async () => {
    const m = await read({
      "q/One.md": question("One", { related: ["[[shared]]"] }),
      "q/Two.md": question("Two", { related: ["[[shared]]"] }),
      "s/shared.md": source("shared", ["sleep"]),
    });
    expect(m.columns[0]!.weight).toBe(1);
    expect(m.cells).toEqual([[1], [1]]);
  });

  it("breaks row ties by recency, the later of captured and promoted, newest first", async () => {
    const m = await read({
      "q/Old.md": question("Old", { captured: "2026-01-01T00:00:00Z" }),
      "q/New.md": question("New", { captured: "2026-09-01T00:00:00Z" }),
      "q/Page (RQ).md": page("Page", { promotedFrom: null }),
      "q/Page.md": question("Page", { status: "promoted" }),
    });
    // The page was promoted 2026-09-10, later than either capture.
    expect(names(m)).toEqual(["q/Page (RQ).md", "q/New.md", "q/Old.md"]);
  });

  it("breaks column ties by Tag name ascending", async () => {
    const m = await read({
      "q/Q.md": question("Q", { related: ["[[a]]"] }),
      "s/a.md": source("a", ["zebra", "apple", "mango"]),
    });
    expect(m.columns.map((c) => c.canonical)).toEqual([
      "apple",
      "mango",
      "zebra",
    ]);
  });

  it("cuts a vault of several hundred Questions to the heaviest 24 rows and 22 columns, with the uncut totals", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 300; i++) {
      const n = String(i).padStart(3, "0");
      files[`q/Q${n}.md`] = question(`Q${n}`, { related: [`[[s${n}]]`] });
      files[`s/s${n}.md`] = source(`s${n}`, [`tag${n}`]);
    }
    const m = await read(files);
    expect(m.rows).toHaveLength(MAP_ROWS);
    expect(m.columns).toHaveLength(MAP_COLUMNS);
    expect(m.cells).toHaveLength(MAP_ROWS);
    expect(m.cells.every((r) => r.length === MAP_COLUMNS)).toBe(true);
    expect(m.totals).toEqual({ rows: 300, columns: 300 });
  });

  it("weighs columns over the rows that survive the cut", async () => {
    const files: Record<string, string> = {};
    // 24 rows each hold one paper tagged `kept`; the 25th, weightless
    // but newest-first irrelevant, is cut and its heavy Tag goes with it.
    for (let i = 0; i < MAP_ROWS; i++) {
      const n = String(i).padStart(2, "0");
      files[`q/Q${n}.md`] = question(`Q${n}`, {
        related: [`[[a${n}]]`, `[[b${n}]]`],
      });
      files[`s/a${n}.md`] = source(`a${n}`, ["kept"]);
      files[`s/b${n}.md`] = source(`b${n}`, ["kept"]);
    }
    files["q/Cut.md"] = question("Cut", { related: ["[[x]]"] });
    files["s/x.md"] = source("x", ["only-in-cut"]);
    const m = await read(files);
    expect(names(m)).not.toContain("q/Cut.md");
    expect(m.columns.find((c) => c.canonical === "only-in-cut")!.weight).toBe(
      0
    );
    expect(m.totals.rows).toBe(MAP_ROWS + 1);
  });

  it("returns an uncut matrix with totals equal to what is shown", async () => {
    const m = await read({
      "q/Q.md": question("Q", { related: ["[[a]]"] }),
      "s/a.md": source("a", ["sleep"]),
    });
    expect(m.totals).toEqual({ rows: 1, columns: 1 });
  });

  it("gives a row's label the Kind it opens as", async () => {
    const m = await read({
      "q/Q.md": question("Q"),
      "q/P (RQ).md": page("P", { promotedFrom: null }),
    });
    expect(m.rows.map((r) => [r.path, r.kind]).sort()).toEqual([
      ["q/P (RQ).md", "research-question"],
      ["q/Q.md", "question"],
    ]);
  });
});
