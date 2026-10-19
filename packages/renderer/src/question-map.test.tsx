import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type {
  Attention,
  Coverage,
  LexiconView,
  Matrix,
  OriginRow,
  Origins,
} from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Question Map's frame (#483; ADR 0041; ADR 0032): a Dashboard at its
// own Address with a named slot per reading, and a page-wide *not yet* in
// front of every slot until the vault has been read in full.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const COVERAGE: Coverage = { depth: 1, deepest: 1, rows: [], tags: [] };

const empty0 = { count: 0, items: [] };
const NO_READINGS = {
  depth: 1,
  wellSupported: empty0,
  unanchored: empty0,
  unquestionedKnowledge: empty0,
  clockedButUnquestioned: empty0,
};

const NO_UNREAD = { partial: [], unreadable: [] };

const MATRIX: Matrix = {
  depth: 1,
  deepest: 1,
  rows: [],
  columns: [],
  cells: [],
  material: [],
  totals: { rows: 0, columns: 0 },
};

const NO_ATTENTION: Attention = {
  depth: 1,
  deepest: 1,
  sources: 0,
  asOf: null,
  synced: false,
  tags: [],
  crossing: null,
};

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = "#/question-map";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "questionMap.coverage": COVERAGE,
    "questionMap.origins": { rows: [], total: 0 },
    "questionMap.readings": NO_READINGS,
    "questionMap.matrix": MATRIX,
    "questionMap.unread": NO_UNREAD,
    "questionMap.attention": NO_ATTENTION,
    ...more,
  });
};

const page = () => screen.findByRole("region", { name: "Question Map" });
const SLOTS = ["matrix", "readings", "origins", "review", "attention"];
const slots = (view: HTMLElement) =>
  SLOTS.filter((name) => view.querySelector(`[data-slot="${name}"]`) !== null);

describe("the Question Map", () => {
  it("opens at its Address with an empty frame: one named slot for each reading, and the Sidebar entry lit", async () => {
    open();
    const view = await page();
    expect(view.querySelector("h1")?.textContent).toBe("Question Map");
    expect(screen.getByRole("link", { current: "page" }).textContent).toBe(
      "Question Map"
    );
    await vi.waitFor(() => expect(slots(view)).toEqual(SLOTS));
  });

  it("is reached from the Sidebar", async () => {
    window.location.hash = "#/inbox";
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": READ,
      "questionMap.coverage": COVERAGE,
      "questionMap.origins": { rows: [], total: 0 },
      "questionMap.readings": NO_READINGS,
      "questionMap.matrix": MATRIX,
      "questionMap.unread": NO_UNREAD,
    });
    await screen.findByRole("region", { name: "Question Inbox" });
    fireEvent.click(screen.getByRole("link", { name: "Question Map" }));
    expect(await page()).toBeDefined();
    expect(window.location.hash).toBe("#/question-map");
  });

  it.each([
    [
      "the vault is still being read",
      {
        indexing: { done: 3, total: 10 },
        watching: { ok: true },
        current: { ok: false, reason: "a sweep has not completed" },
      },
      "◐ reading the vault · 3 of 10 files",
    ],
    [
      "the watcher is down",
      {
        indexing: null,
        watching: { ok: false, reason: "the watch gave no sign of life" },
        current: { ok: false, reason: "not watching" },
      },
      "‖ not watching — the watch gave no sign of life · retry",
    ],
    [
      "a settled batch is not yet applied",
      {
        indexing: null,
        watching: { ok: true },
        current: { ok: false, reason: "a settled batch is not yet applied" },
      },
      null,
    ],
  ])(
    "says not yet in place of every slot while %s",
    async (_, status, line) => {
      open({ "vault.status": status });
      const view = await page();
      await within(view).findByText(/not read yet|not known/);
      expect(slots(view)).toEqual([]);
      if (line !== null) expect(view.textContent).toContain(line);
    }
  );

  it("shows the slots once the Index is Current", async () => {
    open();
    const view = await page();
    await vi.waitFor(() => expect(slots(view)).toEqual(SLOTS));
    expect(view.textContent).not.toMatch(/not read yet/);
  });
});

// Origins (#486; ADR 0041 decision 2): a list beside the matrix, two facts a
// row, the cut stated, and no accumulation statistic anywhere.

const origin = (over: Partial<OriginRow>): OriginRow => ({
  label: "rasch",
  path: "s/rasch.md",
  kind: "source",
  questions: 3,
  material: 1,
  ...over,
});

const origins = async (more: Record<string, unknown>) => {
  open(more);
  const view = await page();
  return within(
    await vi.waitFor(() => {
      const slot = view.querySelector<HTMLElement>('[data-slot="origins"]');
      if (slot === null || slot.textContent === "") throw new Error("empty");
      return slot;
    })
  );
};

describe("Origins on the Question Map", () => {
  it("shows both numbers per row, and opens a row only where it has an Address", async () => {
    const slot = await origins({
      "questionMap.origins": {
        rows: [
          origin({}),
          origin({ label: "unattached", path: null, kind: null, questions: 2 }),
          origin({ label: "a lecture", path: null, kind: null, questions: 1 }),
          origin({
            label: "Pilot",
            path: "x/Pilot.md",
            kind: "experiment",
            questions: 1,
            material: 0,
          }),
          origin({
            label: "A note",
            path: "n/A.md",
            kind: "note",
            questions: 1,
          }),
        ],
        total: 5,
      } satisfies Origins,
    });
    const rasch = slot.getByRole("link", { name: /rasch/ });
    expect(rasch.getAttribute("href")).toBe("#/source/s/rasch.md");
    expect(rasch.closest("li")!.textContent).toMatch(/3 questions/);
    expect(rasch.closest("li")!.textContent).toMatch(/1 material/);
    expect(slot.getByRole("link", { name: /Pilot/ })).toBeDefined();
    // Named and left alone: no Address, no link.
    for (const name of ["unattached", "a lecture", "A note"]) {
      expect(slot.getByText(name).closest("a")).toBeNull();
    }
  });

  it("states the cut and offers the full list on demand", async () => {
    const shown = Array.from({ length: 10 }, (_, i) =>
      origin({ label: `s${i}`, path: null, kind: null, questions: 20 - i })
    );
    const everything = [
      ...shown,
      origin({ label: "s10", path: null, kind: null, questions: 1 }),
      origin({ label: "s11", path: null, kind: null, questions: 1 }),
    ];
    const asked: unknown[] = [];
    const slot = await origins({
      "questionMap.origins": (input: { all?: boolean } | undefined) => {
        asked.push(input);
        return input?.all
          ? { rows: everything, total: 12 }
          : { rows: shown, total: 12 };
      },
    });
    expect(slot.getAllByRole("listitem")).toHaveLength(10);
    expect(slot.getByText(/top 10 of 12/)).toBeDefined();
    fireEvent.click(slot.getByRole("button", { name: /all 12/ }));
    await vi.waitFor(() =>
      expect(slot.getAllByRole("listitem")).toHaveLength(12)
    );
    expect(slot.queryByText(/top 10 of 12/)).toBeNull();
  });

  it("states no cut when nothing is cut, and carries no accumulation statistic", async () => {
    const slot = await origins({
      "questionMap.origins": { rows: [origin({})], total: 1 },
    });
    expect(slot.queryByText(/top 10/)).toBeNull();
    expect(slot.queryByRole("button")).toBeNull();
    expect(slot.getByRole("list").textContent).not.toMatch(
      /read \d|session|times|×/
    );
  });

  it("says plainly when no Question has been captured", async () => {
    const slot = await origins({
      "questionMap.origins": { rows: [], total: 0 },
    });
    expect(slot.getByText(/no questions captured yet/i)).toBeDefined();
  });
});

// The four readings (#485; ADR 0041 decision 4): a count per kind that
// names a decision, never summed, collapsed away when empty and opened to
// its full list only on request.

const none = { count: 0, items: [] };
const row = (question: string, path: string, material = 0) => ({
  kind: "question" as const,
  path,
  id: null,
  question,
  material,
  unresolved: [],
});
const READINGS = {
  depth: 1,
  wellSupported: {
    count: 1,
    items: [row("Does sleep help?", "q/Sleep.md", 4)],
  },
  unanchored: {
    count: 2,
    items: [row("Why now?", "q/Now.md"), row("Why then?", "q/Then.md")],
  },
  unquestionedKnowledge: {
    count: 1,
    items: [
      {
        tag: "ml/probing",
        display: "ml/probing",
        material: [{ path: "s/rasch.md", display: "Rasch" }],
      },
    ],
  },
  clockedButUnquestioned: {
    count: 2,
    items: [
      {
        tag: "memory",
        display: "memory",
        stubs: [
          { path: "s/a.md", display: "Stub A" },
          { path: "s/b.md", display: "Stub B" },
        ],
      },
    ],
  },
};

describe("the four readings", () => {
  const readings = async (data: unknown = READINGS) => {
    open({ "questionMap.readings": data });
    const view = await page();
    return await vi.waitFor(() => {
      const slot = view.querySelector<HTMLElement>('[data-slot="readings"]')!;
      expect(slot.textContent).not.toBe("");
      return slot;
    });
  };

  it("shows each reading's count and no list until asked", async () => {
    const slot = await readings();
    for (const name of [
      /2 unanchored/,
      /1 well-supported/,
      /1 tag.*unquestioned knowledge/,
      /2.*clocked but unquestioned/,
    ])
      expect(within(slot).getByRole("button", { name })).toBeDefined();
    expect(within(slot).queryByRole("list")).toBeNull();
    expect(slot.textContent).not.toMatch(/Why now/);
  });

  it("opens one reading's full list on request, and closes it again", async () => {
    const slot = await readings();
    const button = within(slot).getByRole("button", { name: /2 unanchored/ });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const link = within(slot).getByRole("link", { name: "Why now?" });
    expect(link.getAttribute("href")).toBe("#/question/q/Now.md");
    expect(slot.textContent).not.toMatch(/Does sleep help/);
    fireEvent.click(button);
    expect(within(slot).queryByRole("link", { name: "Why now?" })).toBeNull();
  });

  it("leaves an empty reading out of the page", async () => {
    const slot = await readings({ ...READINGS, unanchored: none });
    expect(slot.textContent).not.toMatch(/unanchored/);
    expect(within(slot).getAllByRole("button")).toHaveLength(3);
  });

  it("draws nothing at all when every reading is empty", async () => {
    open({
      "questionMap.readings": {
        ...READINGS,
        wellSupported: none,
        unanchored: none,
        unquestionedKnowledge: none,
        clockedButUnquestioned: none,
      },
    });
    const view = await page();
    await vi.waitFor(() => expect(slots(view)).toEqual(SLOTS));
    expect(view.querySelector('[data-slot="readings"]')!.textContent).toBe("");
  });

  it("names a stub kept from a Scout and never says Skim, and opens what has an Address only", async () => {
    const slot = await readings();
    fireEvent.click(
      within(slot).getByRole("button", { name: /clocked but unquestioned/ })
    );
    expect(slot.textContent).toMatch(/kept from a Scout/);
    expect(slot.textContent).not.toMatch(/skim/i);
    expect(slot.textContent).toMatch(/Stub A/);
    expect(within(slot).queryByRole("link", { name: "Stub A" })).toBeNull();

    fireEvent.click(
      within(slot).getByRole("button", { name: /unquestioned knowledge/ })
    );
    expect(
      within(slot).getByRole("link", { name: "Rasch" }).getAttribute("href")
    ).toBe("#/source/s/rasch.md");
  });

  it("shows no total across the readings", async () => {
    const slot = await readings();
    expect(slot.textContent).not.toMatch(/\b6\b|of \d+/);
  });
});

// The matrix slot (#484; ADR 0041 decision 3): the grid, and a line that
// states the cut from real counts.

const matrixRow = (n: number) => ({
  kind: "question" as const,
  path: `q/Q${n}.md`,
  question: `Question ${n}?`,
  weight: 1,
  unresolved: [],
});
const shaped = (shown: [number, number], totals: [number, number]): Matrix => ({
  ...MATRIX,
  rows: Array.from({ length: shown[0] }, (_, i) => matrixRow(i)),
  columns: Array.from({ length: shown[1] }, (_, i) => ({
    canonical: `t${i}`,
    display: `Tag ${i}`,
    weight: 1,
  })),
  cells: Array.from({ length: shown[0] }, () =>
    Array<number>(shown[1]).fill(1)
  ),
  material: Array.from({ length: shown[0] }, () =>
    Array.from({ length: shown[1] }, () => [])
  ),
  totals: { rows: totals[0], columns: totals[1] },
});

// The short pages read Coverage, so a matrix is only drawn behind a row with
// a source attached.
const attached = () => ({
  "questionMap.coverage": {
    ...COVERAGE,
    rows: [mapRow("Q", ["s/a.md"])],
  },
});

describe("the Question Map's matrix", () => {
  it("draws the grid in the matrix slot", async () => {
    open({ ...attached(), "questionMap.matrix": shaped([2, 3], [2, 3]) });
    const view = await page();
    const slot = await vi.waitFor(() => {
      const el = view.querySelector('[data-slot="matrix"]')!;
      expect(within(el as HTMLElement).getAllByRole("gridcell")).toHaveLength(
        6
      );
      return el as HTMLElement;
    });
    expect(slot.querySelector("a")?.textContent).toBe("Question 0?");
  });

  it("states the cut from the real totals", async () => {
    open({ ...attached(), "questionMap.matrix": shaped([24, 22], [64, 44]) });
    const view = await page();
    await within(view).findByText(
      "64 questions · 44 tags · matrix shows the 24 × 22 heaviest"
    );
  });

  it("drops the clause when nothing is cut", async () => {
    open({ ...attached(), "questionMap.matrix": shaped([2, 3], [2, 3]) });
    const view = await page();
    await within(view).findByText("2 questions · 3 tags");
    expect(view.textContent).not.toMatch(/heaviest/);
  });

  it("keeps the shape: a vault of hundreds draws the same 24 × 22", async () => {
    open({ ...attached(), "questionMap.matrix": shaped([24, 22], [412, 150]) });
    const view = await page();
    await within(view).findByText(/412 questions · 150 tags/);
    expect(within(view).getAllByRole("gridcell")).toHaveLength(24 * 22);
  });

  it("draws no grid when it has no axes", async () => {
    open();
    const view = await page();
    await vi.waitFor(() => expect(slots(view)).toEqual(SLOTS));
    expect(within(view).queryByRole("grid")).toBeNull();
  });
});

// The page's one depth control (#491; ADR 0041 decision 8): the matrix and
// the readings are asked at the same depth, and the choice is only a request
// parameter — nothing is stored.
describe("the Question Map's depth control", () => {
  const TAGS: Record<number, string[]> = {
    1: ["ai"],
    2: ["ai", "ai/safety"],
    3: ["ai/safety/rlhf", "ai/safety/eval"],
  };
  const atDepth = (input: unknown): Matrix => {
    const depth = (input as { depth?: number } | undefined)?.depth ?? 3;
    const tags = TAGS[depth]!;
    return {
      ...shaped([1, tags.length], [1, tags.length]),
      depth,
      deepest: 3,
      columns: tags.map((t) => ({ canonical: t, display: t, weight: 1 })),
    };
  };

  const setup = () => {
    const asked: unknown[] = [];
    open({
      ...attached(),
      "questionMap.matrix": atDepth,
      "questionMap.readings": (input: unknown) => {
        asked.push(input);
        return {
          ...NO_READINGS,
          depth: (input as { depth?: number } | undefined)?.depth ?? 3,
        };
      },
    });
    return asked;
  };

  it("opens at the deepest depth, with that depth pressed", async () => {
    setup();
    const view = await page();
    const group = await within(view).findByRole("group", { name: "Depth" });
    const pressed = (name: string) =>
      within(group).getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("3")).toBe("true");
    expect(pressed("1")).toBe("false");
    expect(within(view).getByText("ai/safety/rlhf")).toBeDefined();
  });

  it("rolls the matrix's columns up, and asks the readings at the same depth", async () => {
    const asked = setup();
    const view = await page();
    const group = await within(view).findByRole("group", { name: "Depth" });
    fireEvent.click(within(group).getByRole("button", { name: "1" }));
    await vi.waitFor(() => {
      expect(within(view).queryByText("ai/safety/rlhf")).toBeNull();
      expect(within(view).getByText("ai")).toBeDefined();
    });
    expect(asked.at(-1)).toEqual({ depth: 1 });
  });

  it("draws no control when there is only one depth to choose", async () => {
    open();
    const view = await page();
    await vi.waitFor(() => expect(slots(view)).toEqual(SLOTS));
    expect(within(view).queryByRole("group", { name: "Depth" })).toBeNull();
  });
});

// What the Map could not read, and the short pages (#492; ADR 0041
// decisions 13–14): the footer counts what was skipped, and a short page is a
// Claim with a Warrant rather than a blank.

const mapRow = (name: string, material: string[] = []) => ({
  kind: "question" as const,
  path: `q/${name}.md`,
  id: null,
  question: `${name}?`,
  captured: "2026-09-01T10:00:00Z",
  promoted: null,
  material: material.map((path) => ({
    path,
    kind: "source" as const,
    display: path,
    tags: ["sleep"],
  })),
  unresolved: [],
});

describe("what the Map could not read", () => {
  it("counts Partial and Unreadable Questions in the footer and opens to each path and reason", async () => {
    open({
      "questionMap.unread": {
        partial: [{ path: "q/half.md", reason: "no question: or captured:" }],
        unreadable: [{ path: "q/odd.md", reason: "status is not open" }],
      },
    });
    const view = await page();
    const summary = await within(view).findByText("2 files could not be read");
    fireEvent.click(summary);
    expect(within(view).getByText("q/half.md")).toBeDefined();
    expect(within(view).getByText("no question: or captured:")).toBeDefined();
    expect(within(view).getByText("q/odd.md")).toBeDefined();
    expect(within(view).getByText("status is not open")).toBeDefined();
  });

  it("draws no line when every Question read", async () => {
    open();
    const view = await page();
    await vi.waitFor(() => expect(slots(view)).toEqual(SLOTS));
    expect(view.textContent).not.toMatch(/could not be read/);
  });

  it("marks an unresolved and an ambiguous Related on the row, each in its own words, and does not count the row as plainly unanchored", async () => {
    const bad = {
      ...row("Why now?", "q/Now.md"),
      unresolved: [
        { link: "[[nowhere]]", reason: "matches no file in the vault" },
        { link: "[[twin]]", reason: "matches more than one file" },
      ],
    };
    open({
      "questionMap.readings": {
        ...NO_READINGS,
        unanchored: { count: 2, items: [bad, row("Why then?", "q/Then.md")] },
      },
    });
    const view = await page();
    const slot = await vi.waitFor(() => {
      const el = view.querySelector<HTMLElement>('[data-slot="readings"]')!;
      expect(el.textContent).not.toBe("");
      return el;
    });
    expect(
      within(slot).getByRole("button", { name: "1 unanchored question" })
    ).toBeDefined();
    fireEvent.click(
      within(slot).getByRole("button", {
        name: /1 question with a link in Related that does not resolve/,
      })
    );
    expect(slot.textContent).toContain("Why now?");
    expect(slot.textContent).toContain(
      "a link in this question’s Related lands on nothing"
    );
    expect(slot.textContent).toContain(
      "a link in this question’s Related is ambiguous: [[twin]]"
    );
  });
});

describe("the short pages", () => {
  it("says there are no open questions, warranted by what was read", async () => {
    open();
    const view = await page();
    await within(view).findByText("No open questions to map.");
    expect(view.textContent).toContain("read 0 of 0 questions · just now");
  });

  it("counts what it could not read in the warrant, so the claim is not a quiet field", async () => {
    open({
      "questionMap.unread": {
        partial: [],
        unreadable: [{ path: "q/odd.md", reason: "status is not open" }],
      },
    });
    const view = await page();
    await within(view).findByText("No open questions to map.");
    expect(view.textContent).toContain("read 0 of 1 questions · just now");
  });

  it("leads with the unanchored reading and says the matrix has no columns when no source is attached", async () => {
    open({
      "questionMap.coverage": {
        ...COVERAGE,
        rows: [mapRow("Why now"), mapRow("Why then")],
      },
      "questionMap.readings": {
        ...NO_READINGS,
        unanchored: {
          count: 2,
          items: [row("Why now?", "q/Now.md"), row("Why then?", "q/Then.md")],
        },
      },
    });
    const view = await page();
    await within(view).findByText("The matrix has no columns.");
    expect(view.textContent).toContain(
      "2 open questions read · 0 sources attached"
    );
    expect(view.querySelector('[role="grid"]')).toBeNull();
    const order = [...view.querySelectorAll("[data-slot]")].map((el) =>
      el.getAttribute("data-slot")
    );
    expect(order.indexOf("readings")).toBeLessThan(order.indexOf("matrix"));
  });

  it("draws the matrix, and no short-page claim, once a source is attached", async () => {
    open({
      "questionMap.coverage": {
        ...COVERAGE,
        rows: [mapRow("Why now", ["s/a.md"])],
      },
    });
    const view = await page();
    await vi.waitFor(() => expect(slots(view)).toEqual(SLOTS));
    expect(view.textContent).not.toMatch(/no columns|No open questions/);
  });
});

// The Attention panel (#651; ADR 0045, ADR 0018): the Question Map's second
// panel, apart from the matrix, with the Lexicon editor open beside its list,
// read-only. Nothing is measured yet, so every placeable Tag is *not yet
// measured* and the panel says nothing has been synced.

const tag = (
  name: string,
  papers: number,
  placed = true
): Attention["tags"][number] => ({
  tag: name,
  display: name,
  papers,
  withText: placed ? papers : 1,
  state: placed ? "not yet measured" : "unplaced",
  reason: placed ? null : "few-papers",
  growth: null,
  counts: null,
  measuredAt: null,
});

const ATTENTION: Attention = {
  ...NO_ATTENTION,
  sources: 7,
  tags: [tag("ml/probing", 5), tag("sleep", 2, false)],
};

const LEXICON: LexiconView = {
  tag: "ml/probing",
  display: "ml/probing",
  depth: 1,
  papers: 5,
  withText: 5,
  placed: true,
  reason: null,
  counts: null,
  measuredAt: null,
  terms: [
    { term: "residual stream", origin: "derived" },
    { term: "mechanistic interpretability", origin: "author keyword" },
  ],
  notUsed: [{ term: "linear probe", origin: "derived" }],
  excluded: [],
  query:
    'filter=title_and_abstract.search:("residual stream" OR "mechanistic interpretability")',
};

const attentionSlot = async () => {
  const view = await page();
  await vi.waitFor(() =>
    expect(view.querySelector('[data-slot="attention"]')).not.toBeNull()
  );
  return view.querySelector('[data-slot="attention"]') as HTMLElement;
};

describe("the Attention panel", () => {
  it("is its own panel with an as-of line that says nothing has been synced, and says it counts papers held", async () => {
    open({ "questionMap.attention": ATTENTION });
    const panel = await attentionSlot();
    await within(panel).findByRole("heading", { name: "Attention" });
    expect(within(panel).getByText(/nothing synced/)).toBeDefined();
    expect(
      within(panel).getByText(
        /counts papers held, not papers attached to questions/
      )
    ).toBeDefined();
    // Apart from the matrix, not inside it.
    const view = await page();
    expect(view.querySelector('[data-slot="matrix"]')!.contains(panel)).toBe(
      false
    );
  });

  it("lists the Tags with their paper counts, and marks each placeable one not yet measured and each thin one unplaced with its reason", async () => {
    open({ "questionMap.attention": ATTENTION });
    const panel = await attentionSlot();
    const probing = await within(panel).findByRole("button", {
      name: /ml\/probing/,
    });
    expect(probing.textContent).toContain("5 papers");
    expect(probing.textContent).toContain("not yet measured");
    const sleep = within(panel).getByRole("button", { name: /sleep/ });
    expect(sleep.textContent).toContain("2 papers");
    expect(sleep.textContent).toContain("unplaced");
    expect(sleep.textContent).toContain("too few papers with text");
  });

  it("opens the Lexicon beside the list: the Terms with where each came from, the not used line, the paper count and the query verbatim", async () => {
    const asked: unknown[] = [];
    open({
      "questionMap.attention": ATTENTION,
      "lexicon.get": (input: unknown) => {
        asked.push(input);
        return LEXICON;
      },
    });
    const panel = await attentionSlot();
    fireEvent.click(
      await within(panel).findByRole("button", { name: /ml\/probing/ })
    );
    const editor = await within(panel).findByRole("region", {
      name: /Lexicon: ml\/probing/,
    });
    const terms = within(editor).getByRole("list", { name: "Terms in use" });
    expect(
      within(terms)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual([
      "residual streamderivedExclude",
      "mechanistic interpretabilityauthor keywordExclude",
    ]);
    expect(within(editor).getByText(/not used/).textContent).toContain(
      "linear probe"
    );
    expect(within(editor).getByText(/5 papers/)).toBeDefined();
    expect(within(editor).getByText(LEXICON.query!).tagName).toBe("CODE");
    expect(asked.at(-1)).toEqual({ tag: "ml/probing" });
  });

  it("shows an unplaced Tag's editor with no Terms and no query, and the reason", async () => {
    open({
      "questionMap.attention": ATTENTION,
      "lexicon.get": {
        ...LEXICON,
        tag: "sleep",
        display: "sleep",
        papers: 2,
        withText: 1,
        placed: false,
        reason: "few-papers",
        counts: null,
        measuredAt: null,
        terms: [],
        notUsed: [],
        excluded: [],
        query: null,
      },
    });
    const panel = await attentionSlot();
    fireEvent.click(
      await within(panel).findByRole("button", { name: /sleep/ })
    );
    const editor = await within(panel).findByRole("region", {
      name: /Lexicon: sleep/,
    });
    expect(within(editor).getByText(/too few papers with text/)).toBeDefined();
    expect(
      within(editor).queryByRole("list", { name: "Terms in use" })
    ).toBeNull();
    expect(within(editor).queryByText(/filter=/)).toBeNull();
  });

  it("plots the measured Tags, states where the axes cross, and lists an unplaced Tag as a chip with its reason, never as a point", async () => {
    const measured = (name: string, papers: number, growth: number) => ({
      ...tag(name, papers),
      state: "measured" as const,
      growth,
      counts: { last12: 100, prior12: 100 },
      measuredAt: "2026-10-16T09:00:00.000Z",
    });
    open({
      "questionMap.attention": {
        ...ATTENTION,
        tags: [
          measured("a", 9, 1),
          measured("b", 7, 0.5),
          measured("c", 4, 2),
          measured("d", 2, 0.1),
          { ...tag("thin", 1, false), reason: "few-in-field" },
        ],
        crossing: { placed: 4, papers: 5.5, growth: 0.75 },
      },
    });
    const panel = await attentionSlot();
    const chart = await within(panel).findByRole("listbox");
    expect(within(chart).getAllByRole("option")).toHaveLength(4);
    expect(within(chart).queryByRole("option", { name: /thin/ })).toBeNull();
    expect(
      within(panel).getByText("axes cross at the median of 4 placed tags")
    ).toBeDefined();
    const chips = within(panel).getByRole("list", { name: "Unplaced" });
    expect(chips.textContent).toContain("thin");
    expect(chips.textContent).toContain("too few in the field");
  });

  it("opens a Tag's Lexicon from a point", async () => {
    const asked: unknown[] = [];
    open({
      "questionMap.attention": {
        ...ATTENTION,
        tags: [
          {
            ...tag("ml/probing", 5),
            state: "measured",
            growth: 1,
            counts: { last12: 200, prior12: 100 },
            measuredAt: "2026-10-16T09:00:00.000Z",
          },
        ],
      },
      "lexicon.get": (input: unknown) => {
        asked.push(input);
        return LEXICON;
      },
    });
    const panel = await attentionSlot();
    fireEvent.click(
      await within(panel).findByRole("option", {
        name: "ml/probing: 5 papers, growth +100%",
      })
    );
    await within(panel).findByRole("region", { name: /Lexicon: ml\/probing/ });
    expect(asked.at(-1)).toEqual({ tag: "ml/probing" });
  });

  it("draws no chart when nothing is placed, only the list", async () => {
    open({ "questionMap.attention": ATTENTION });
    const panel = await attentionSlot();
    await within(panel).findByRole("button", { name: /ml\/probing/ });
    expect(within(panel).queryByRole("listbox")).toBeNull();
  });

  it("asks at the page's depth, and the editor at that depth too", async () => {
    const asked: unknown[] = [];
    const lexicon: unknown[] = [];
    open({
      ...attached(),
      "questionMap.matrix": { ...shaped([1, 2], [1, 2]), depth: 2, deepest: 2 },
      "questionMap.attention": (input: unknown) => {
        asked.push(input);
        return ATTENTION;
      },
      "lexicon.get": (input: unknown) => {
        lexicon.push(input);
        return LEXICON;
      },
    });
    const view = await page();
    const group = await within(view).findByRole("group", { name: "Depth" });
    fireEvent.click(within(group).getByRole("button", { name: "1" }));
    await vi.waitFor(() => expect(asked.at(-1)).toEqual({ depth: 1 }));
    fireEvent.click(
      await within(view).findByRole("button", { name: /ml\/probing/ })
    );
    await vi.waitFor(() =>
      expect(lexicon.at(-1)).toEqual({ tag: "ml/probing", depth: 1 })
    );
  });

  it("says there are no tags to place as a Claim with a Warrant", async () => {
    open({ "questionMap.attention": { ...NO_ATTENTION, sources: 4 } });
    const panel = await attentionSlot();
    await within(panel).findByText("No tags to place.");
    expect(
      within(panel).getByText("read 4 of 4 sources · just now")
    ).toBeDefined();
  });

  it("says not yet, and draws no panel, while the vault is still being read", async () => {
    open({
      "questionMap.attention": ATTENTION,
      "vault.status": {
        indexing: { done: 3, total: 10 },
        watching: { ok: true },
        current: { ok: false, reason: "a sweep has not completed" },
      },
    });
    const view = await page();
    await within(view).findByText(/reading the vault/);
    expect(view.querySelector('[data-slot="attention"]')).toBeNull();
  });
});

// The Lexicon editor's two edits (#652; ADR 0045 decisions 3 and 9): Seed a
// Term by typing it, Exclude a derived one, undo either. The core answers a
// refusal; the editor says it on the control, as an alert (ADR 0033).

describe("the Lexicon editor's edits", () => {
  const SEEDED: LexiconView = {
    ...LEXICON,
    terms: [{ term: "grokking", origin: "seeded" }, ...LEXICON.terms],
    excluded: ["attention head"],
  };

  const opened = async (more: Record<string, unknown> = {}) => {
    const asked: unknown[] = [];
    open({
      "questionMap.attention": ATTENTION,
      "lexicon.get": () => {
        asked.push(null);
        return SEEDED;
      },
      ...more,
    });
    const panel = await attentionSlot();
    fireEvent.click(
      await within(panel).findByRole("button", { name: /ml\/probing/ })
    );
    const editor = await within(panel).findByRole("region", {
      name: /Lexicon: ml\/probing/,
    });
    await within(editor).findByRole("list", { name: "Terms in use" });
    return { editor, asked };
  };

  it("seeds a typed Term for the Tag as written, clears the box, and reads the Lexicon again", async () => {
    const seeded: unknown[] = [];
    const { editor, asked } = await opened({
      "lexicon.seed": (input: unknown) => seeded.push(input) && null,
    });
    const before = asked.length;
    const box = within(editor).getByRole("textbox", { name: "Seed a term" });
    fireEvent.change(box, { target: { value: "Sparse Autoencoder" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Seed" }));
    await vi.waitFor(() =>
      expect(seeded).toEqual([
        { tag: "ml/probing", term: "Sparse Autoencoder" },
      ])
    );
    await vi.waitFor(() => expect(asked.length).toBeGreaterThan(before));
    await vi.waitFor(() => expect((box as HTMLInputElement).value).toBe(""));
  });

  it("shows a Seed as seeded, with a way to remove it, and offers Exclude only on a Term the vault derived", async () => {
    const restored: unknown[] = [];
    const { editor } = await opened({
      "lexicon.restore": (input: unknown) => restored.push(input) && null,
    });
    const terms = within(editor).getByRole("list", { name: "Terms in use" });
    const [seeded, derived] = within(terms).getAllByRole("listitem");
    expect(seeded!.textContent).toContain("seeded");
    expect(
      within(seeded!).queryByRole("button", { name: /Exclude/ })
    ).toBeNull();
    expect(
      within(derived!).getByRole("button", { name: "Exclude residual stream" })
    ).toBeDefined();
    fireEvent.click(
      within(seeded!).getByRole("button", { name: "Remove grokking" })
    );
    await vi.waitFor(() =>
      expect(restored).toEqual([{ tag: "ml/probing", term: "grokking" }])
    );
  });

  it("excludes a derived Term, lists the Excluded ones, and restores one", async () => {
    const sent: Array<[string, unknown]> = [];
    const { editor } = await opened({
      "lexicon.exclude": (input: unknown) =>
        sent.push(["exclude", input]) && null,
      "lexicon.restore": (input: unknown) =>
        sent.push(["restore", input]) && null,
    });
    fireEvent.click(
      within(editor).getByRole("button", { name: "Exclude residual stream" })
    );
    await vi.waitFor(() =>
      expect(sent).toEqual([
        ["exclude", { tag: "ml/probing", term: "residual stream" }],
      ])
    );
    const excluded = within(editor).getByRole("list", { name: "Excluded" });
    expect(excluded.textContent).toContain("attention head");
    fireEvent.click(
      within(excluded).getByRole("button", { name: "Restore attention head" })
    );
    await vi.waitFor(() =>
      expect(sent.at(-1)).toEqual([
        "restore",
        { tag: "ml/probing", term: "attention head" },
      ])
    );
  });

  it("says a refused Seed as an alert on the control, with the core's reason, and keeps what was typed", async () => {
    const { editor } = await opened({
      "lexicon.seed": () => {
        throw new Error("A Term can't be empty.");
      },
    });
    const box = within(editor).getByRole("textbox", { name: "Seed a term" });
    fireEvent.change(box, { target: { value: "  " } });
    fireEvent.click(within(editor).getByRole("button", { name: "Seed" }));
    const alert = await within(editor).findByRole("alert");
    expect(alert.textContent).toContain("A Term can't be empty.");
    expect((box as HTMLInputElement).value).toBe("  ");
  });

  it("offers the Seed box on an unplaced Tag, since seeding is its way out", async () => {
    open({
      "questionMap.attention": ATTENTION,
      "lexicon.get": {
        ...LEXICON,
        tag: "sleep",
        display: "sleep",
        placed: false,
        reason: "few-papers",
        terms: [],
        notUsed: [],
        query: null,
      },
    });
    const panel = await attentionSlot();
    fireEvent.click(
      await within(panel).findByRole("button", { name: /sleep/ })
    );
    const editor = await within(panel).findByRole("region", {
      name: /Lexicon: sleep/,
    });
    expect(
      within(editor).getByRole("textbox", { name: "Seed a term" })
    ).toBeDefined();
  });
});

// The first *Sync now* (#653; ADR 0045 decisions 4, 5 and 10): the consent
// is a one-line confirm in the panel, not a modal; a Measurement shows as
// growth; a field too thin to measure is unplaced with the counts shown.

const measured = (
  name: string,
  growth: number,
  at: string
): Attention["tags"][number] => ({
  ...tag(name, 5),
  state: "measured",
  growth,
  counts: { last12: 150, prior12: 100 },
  measuredAt: at,
});

const SYNCED: Attention = { ...ATTENTION, synced: true };

describe("the Attention panel — Sync now", () => {
  it("opens a one-line confirm naming OpenAlex and what is sent on the first press, and sends nothing yet", async () => {
    const sync = vi.fn(() => ({ measured: 0, failed: [], waiting: 0 }));
    open({ "questionMap.attention": ATTENTION, "lexicon.sync": sync });
    const panel = await attentionSlot();
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Sync now" })
    );
    const confirm = await within(panel).findByRole("group", {
      name: "Confirm sync",
    });
    expect(confirm.textContent).toMatch(/OpenAlex/);
    expect(confirm.textContent).toMatch(/Terms/);
    expect(within(confirm).getByRole("button", { name: "Sync" })).toBeDefined();
    expect(sync).not.toHaveBeenCalled();
    // In the panel, not a modal.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(panel.contains(confirm)).toBe(true);
  });

  it("leaves the vault never-synced on Not now, and says so", async () => {
    const sync = vi.fn(() => ({ measured: 0, failed: [], waiting: 0 }));
    open({ "questionMap.attention": ATTENTION, "lexicon.sync": sync });
    const panel = await attentionSlot();
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Sync now" })
    );
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Not now" })
    );
    expect(
      within(panel).queryByRole("group", { name: "Confirm sync" })
    ).toBeNull();
    expect(within(panel).getByText(/nothing synced/)).toBeDefined();
    expect(sync).not.toHaveBeenCalled();
  });

  it("sends the confirmation with Sync, and reports what was measured", async () => {
    const sync = vi.fn(() => ({ measured: 2, failed: [], waiting: 0 }));
    open({ "questionMap.attention": ATTENTION, "lexicon.sync": sync });
    const panel = await attentionSlot();
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Sync now" })
    );
    fireEvent.click(await within(panel).findByRole("button", { name: "Sync" }));
    await vi.waitFor(() =>
      expect(sync).toHaveBeenCalledWith({ confirm: true })
    );
    await within(panel).findByText(/2 tags measured/);
  });

  it("asks nothing once the vault has synced: Sync now just syncs", async () => {
    const sync = vi.fn(() => ({ measured: 1, failed: [], waiting: 0 }));
    open({ "questionMap.attention": SYNCED, "lexicon.sync": sync });
    const panel = await attentionSlot();
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Sync now" })
    );
    await vi.waitFor(() => expect(sync).toHaveBeenCalled());
    expect(
      within(panel).queryByRole("group", { name: "Confirm sync" })
    ).toBeNull();
  });

  it("says a sync failed, naming the Tag and the kind, and a rate limit with how many wait", async () => {
    open({
      "questionMap.attention": SYNCED,
      "lexicon.sync": {
        measured: 1,
        failed: [
          { tag: "ml/probing", kind: "network" },
          { tag: "sleep", kind: "rate_limited" },
        ],
        waiting: 3,
      },
    });
    const panel = await attentionSlot();
    fireEvent.click(
      await within(panel).findByRole("button", { name: "Sync now" })
    );
    const line = await within(panel).findByText(/rate limit/i);
    expect(line.textContent).toMatch(/3 tags waiting/);
    expect(panel.textContent).toMatch(/ml\/probing/);
    expect(panel.textContent).toMatch(/could not be reached/);
  });

  it("shows growth for a measured Tag, an as-of date for the oldest measurement, and none for an unmeasured Tag", async () => {
    open({
      "questionMap.attention": {
        ...SYNCED,
        asOf: "2026-10-09T08:00:00.000Z",
        tags: [
          measured("ml/probing", 0.5, "2026-10-12T08:00:00.000Z"),
          measured("bio", -0.25, "2026-10-09T08:00:00.000Z"),
          tag("chem", 3),
        ],
      },
    });
    const panel = await attentionSlot();
    const probing = await within(panel).findByRole("button", {
      name: /ml\/probing/,
    });
    expect(probing.textContent).toContain("growth +50%");
    expect(
      within(panel).getByRole("button", { name: /bio/ }).textContent
    ).toContain("growth −25%");
    expect(within(panel).getByText(/as of 2026-10-09/)).toBeDefined();
    expect(
      within(panel).getByRole("button", { name: /chem/ }).textContent
    ).toContain("not yet measured");
    expect(
      within(panel).getByRole("button", { name: /chem/ }).textContent
    ).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("lists a Tag the field is too thin for as unplaced with that reason, and the editor shows the counts", async () => {
    open({
      "questionMap.attention": {
        ...SYNCED,
        asOf: "2026-10-12T08:00:00.000Z",
        tags: [
          {
            ...tag("ml/probing", 5),
            state: "unplaced",
            reason: "few-in-field",
            counts: { last12: 120, prior12: 49 },
            measuredAt: "2026-10-12T08:00:00.000Z",
          },
        ],
      },
      "lexicon.get": {
        ...LEXICON,
        placed: false,
        reason: "few-in-field",
        counts: { last12: 120, prior12: 49 },
        measuredAt: "2026-10-12T08:00:00.000Z",
      },
    });
    const panel = await attentionSlot();
    const button = await within(panel).findByRole("button", {
      name: /ml\/probing/,
    });
    expect(button.textContent).toContain("unplaced");
    expect(button.textContent).toContain("too few in the field");
    fireEvent.click(button);
    const editor = await within(panel).findByRole("region", {
      name: /Lexicon: ml\/probing/,
    });
    expect(editor.textContent).toContain("120 works in the last 12 months");
    expect(editor.textContent).toContain("49 in the 12 before");
  });
});
