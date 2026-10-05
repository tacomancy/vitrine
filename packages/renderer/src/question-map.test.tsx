import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Coverage, Matrix, OriginRow, Origins } from "core";
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

const MATRIX: Matrix = {
  depth: 1,
  deepest: 1,
  rows: [],
  columns: [],
  cells: [],
  material: [],
  totals: { rows: 0, columns: 0 },
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
    ...more,
  });
};

const page = () => screen.findByRole("region", { name: "Question Map" });
const SLOTS = ["matrix", "readings", "origins", "review"];
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
  unresolved: 0,
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

describe("the Question Map's matrix", () => {
  it("draws the grid in the matrix slot", async () => {
    open({ "questionMap.matrix": shaped([2, 3], [2, 3]) });
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
    open({ "questionMap.matrix": shaped([24, 22], [64, 44]) });
    const view = await page();
    await within(view).findByText(
      "64 questions · 44 tags · matrix shows the 24 × 22 heaviest"
    );
  });

  it("drops the clause when nothing is cut", async () => {
    open({ "questionMap.matrix": shaped([2, 3], [2, 3]) });
    const view = await page();
    await within(view).findByText("2 questions · 3 tags");
    expect(view.textContent).not.toMatch(/heaviest/);
  });

  it("keeps the shape: a vault of hundreds draws the same 24 × 22", async () => {
    open({ "questionMap.matrix": shaped([24, 22], [412, 150]) });
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
      "questionMap.matrix": atDepth,
      "questionMap.readings": (input: unknown) => {
        asked.push(input);
        return NO_READINGS;
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
