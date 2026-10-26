import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WIDE_FROM } from "./queue-width";
import { resetQueueWidth, setQueueWidth } from "./queue-width.stub";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

const card = (id: number, rest: Partial<Card> = {}): Card => ({
  id,
  title: `Paper ${id}`,
  authors: [],
  published: "2026-09-29T10:00:00Z",
  venue: null,
  venueType: null,
  venueId: null,
  alsoOnArxiv: null,
  publisher: null,
  abstract: "An abstract.",
  url: "http://arxiv.org/abs/2609.05678v1",
  doi: null,
  lane: "review",
  scouts: [
    { id: "sleep", name: "Sleep and memory", assigned: [], dropped: false },
  ],
  retroactive: false,
  signals: [],
  moved: null,
  pastWindow: false,
  counterweight: false,
  ...rest,
});

const answers = (queue: Card[], more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": {
    scouts: [
      { id: "sleep", name: "Sleep and memory", assigned: [], paused: false },
    ],
    unreadable: [],
  },
  "scouts.queue": queue,
  "scouts.batches": [],
  "scouts.groups": [
    { id: "sleep", runId: 3, runPending: queue.length, held: [] },
  ],
  "scouts.health": { scouts: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.muted": { rules: [], problem: null, items: [] },
  "scouts.skim": { recent: [], older: [] },
  ...more,
});

// Where the panes stack, the chosen paper opens in its own row, and chosen and
// open are one state (#869; ADR 0054 decisions 1 and 3). The Queue's width comes
// from the stand-in for the browser's signal (`queue-width.stub.ts`).

const three = () => [card(1), card(2), card(3)];
const rows = () =>
  within(screen.getByRole("list", { name: "New finds" })).getAllByRole(
    "listitem"
  );
const rowButtons = () =>
  within(screen.getByRole("list", { name: "New finds" })).getAllByRole(
    "button",
    { name: /^Paper \d$/ }
  );
/** The rows holding a detail: the open ones. */
const open = () =>
  rows().filter((row) => within(row).queryByRole("article") !== null);
const key = (k: string) => fireEvent.keyDown(document.body, { key: k });

describe("narrow: the chosen paper opens in its row", () => {
  beforeEach(() => setQueueWidth(WIDE_FROM - 1));
  afterEach(() => {
    resetQueueWidth();
    vi.restoreAllMocks();
  });

  it("holds the detail in the chosen row, with no separate pane", async () => {
    renderApp(answers(three()));
    const article = await screen.findByRole("article", { name: "Paper 1" });

    expect(rows()[0]!.contains(article)).toBe(true);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(open()).toEqual([rows()[0]]);
  });

  it("opens exactly one row as J and K move it", async () => {
    renderApp(answers(three()));
    await screen.findByRole("article", { name: "Paper 1" });

    key("j");
    await screen.findByRole("article", { name: "Paper 2" });
    expect(open()).toEqual([rows()[1]]);
    expect(rowButtons()[1]!.getAttribute("aria-current")).toBe("true");

    key("j");
    await screen.findByRole("article", { name: "Paper 3" });
    expect(open()).toEqual([rows()[2]]);

    key("k");
    await screen.findByRole("article", { name: "Paper 2" });
    expect(open()).toEqual([rows()[1]]);
  });

  it("opens the row clicked, and only that one", async () => {
    renderApp(answers(three()));
    await screen.findByRole("article", { name: "Paper 1" });

    fireEvent.click(rowButtons()[2]!);

    await screen.findByRole("article", { name: "Paper 3" });
    expect(open()).toEqual([rows()[2]]);
  });

  it("keeps the open row on the chosen paper, whichever way it was chosen", async () => {
    renderApp(answers(three()));
    await screen.findByRole("article", { name: "Paper 1" });
    fireEvent.click(rowButtons()[1]!);
    await screen.findByRole("article", { name: "Paper 2" });
    key("j");
    await screen.findByRole("article", { name: "Paper 3" });

    const current = rowButtons().filter(
      (b) => b.getAttribute("aria-current") === "true"
    );
    expect(current).toHaveLength(1);
    expect(open()).toEqual([current[0]!.closest("li")]);
  });

  it("acts on the open row with A, D, R and P", async () => {
    const defer = vi.fn(() => null);
    const reject = vi.fn(() => null);
    renderApp(
      answers(three(), {
        "scouts.defer": defer,
        "scouts.reject": reject,
      })
    );
    await screen.findByRole("article", { name: "Paper 1" });
    key("j");
    await screen.findByRole("article", { name: "Paper 2" });

    key("d");
    await waitFor(() => expect(defer).toHaveBeenCalledWith({ proposalId: 2 }));
    await screen.findByRole("article", { name: "Paper 3" });

    key("r");
    await waitFor(() => expect(reject).toHaveBeenCalledWith({ proposalId: 3 }));
  });

  it("passes and accepts the open row", async () => {
    const accept = vi.fn(() => null);
    renderApp(answers(three(), { "scouts.accept": accept }));
    await screen.findByRole("article", { name: "Paper 1" });

    key("p");
    await screen.findByRole("article", { name: "Paper 2" });
    expect(open()).toEqual([rows()[0]]);
    expect(rowButtons()[0]!.textContent).toContain("Paper 2");

    key("a");
    await waitFor(() => expect(accept).toHaveBeenCalled());
  });

  it("acts through the open row's own buttons", async () => {
    const defer = vi.fn(() => null);
    renderApp(answers(three(), { "scouts.defer": defer }));
    const article = await screen.findByRole("article", { name: "Paper 1" });

    fireEvent.click(within(article).getByRole("button", { name: /^Defer/ }));

    await waitFor(() => expect(defer).toHaveBeenCalledWith({ proposalId: 1 }));
  });

  it("keeps the chosen row in view as J moves it (ADR 0030)", async () => {
    const scrolled: string[] = [];
    window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.id);
    };
    renderApp(answers(three()));
    await screen.findByRole("article", { name: "Paper 1" });

    key("j");
    await screen.findByRole("article", { name: "Paper 2" });

    await waitFor(() => expect(scrolled).toContain("scout-row-2"));
  });

  it("opens the Skim line chosen in its row too", async () => {
    window.location.hash = "#/scouts";
    renderApp(
      answers([], {
        "scouts.skim": {
          recent: [card(7, { lane: "skim" }), card(8, { lane: "skim" })],
          older: [],
        },
      })
    );
    fireEvent.click(await screen.findByRole("tab", { name: /^Skim/ }));
    const article = await screen.findByRole("article", { name: "Paper 7" });

    const lines = within(screen.getByRole("list", { name: "Skim" }));
    expect(
      lines
        .getAllByRole("listitem")
        .filter((li) => within(li).queryByRole("article") !== null)
    ).toHaveLength(1);
    expect(article.closest("li")).toBe(lines.getAllByRole("listitem")[0]);
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });
});

describe("narrow: where one paper has several rows", () => {
  beforeEach(() => setQueueWidth(WIDE_FROM - 1));
  afterEach(resetQueueWidth);

  it("opens only the row the choice is on, not its copy under another Question", async () => {
    renderApp(
      answers(three(), {
        "scouts.questionGroups": [
          {
            question: { id: "q1", name: "Does sleep help?" },
            proposalIds: [1, 2],
          },
          {
            question: { id: "q2", name: "What is a trace?" },
            proposalIds: [2, 3],
          },
        ],
      })
    );
    await screen.findByRole("article", { name: "Paper 1" });
    fireEvent.click(screen.getByRole("button", { name: "group: scout" }));
    await screen.findByRole("heading", { name: "What is a trace?" });

    fireEvent.click(
      within(
        (
          await screen.findByRole("heading", { name: "What is a trace?" })
        ).closest("section")!
      ).getByRole("button", { name: "Paper 2" })
    );

    await screen.findByRole("article", { name: "Paper 2" });
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });
});

describe("narrow: the mute offer", () => {
  beforeEach(() => setQueueWidth(WIDE_FROM - 1));
  afterEach(resetQueueWidth);

  it("takes the open row's place and leaves one row open", async () => {
    renderApp(answers(three()));
    await screen.findByRole("article", { name: "Paper 1" });
    key("j");
    await screen.findByRole("article", { name: "Paper 2" });

    key("m");

    await waitFor(() =>
      expect(screen.queryByRole("article", { name: "Paper 2" })).toBeNull()
    );
    expect(rows()[1]!.querySelectorAll("button").length).toBeGreaterThan(1);
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });
});

describe("wide: nothing opens in the list", () => {
  afterEach(() => {
    resetQueueWidth();
    vi.restoreAllMocks();
  });

  it("keeps the detail in its pane, outside every row, as J and K move the choice", async () => {
    renderApp(answers(three()));
    await screen.findByRole("article", { name: "Paper 1" });
    expect(open()).toEqual([]);

    key("j");
    const article = await screen.findByRole("article", { name: "Paper 2" });

    expect(open()).toEqual([]);
    expect(rows().some((row) => row.contains(article))).toBe(false);
    expect(rows()).toHaveLength(3);
    expect(rowButtons()[1]!.getAttribute("aria-current")).toBe("true");
  });
});

describe("one detail in both layouts", () => {
  afterEach(() => {
    resetQueueWidth();
    vi.restoreAllMocks();
  });

  it("shows the same chips, whose and abstract in the row as in the pane", async () => {
    const rich = card(1, {
      abstract: "A long abstract worth reading.",
      signals: [{ kind: "authors", names: ["A. Author"] }],
      counterweight: true,
      moved: { kind: "demoted" },
      scouts: [
        {
          id: "sleep",
          name: "Sleep and memory",
          assigned: [{ id: "q1", name: "Does sleep help?" }],
          dropped: false,
        },
      ] as Card["scouts"],
    });
    renderApp(answers([rich, card(2)]));
    const wide = (await screen.findByRole("article", { name: "Paper 1" }))
      .textContent;

    act(() => setQueueWidth(WIDE_FROM - 1));
    const narrow = (await screen.findByRole("article", { name: "Paper 1" }))
      .textContent;

    expect(narrow).toBe(wide);
    expect(narrow).toContain("A long abstract worth reading.");
    expect(narrow).toContain("assigned to Does sleep help?");
    expect(narrow).toContain("outside the usual");
    expect(narrow).toContain("moved to Skim after three defers");
  });

  it("keeps the same paper open when the Queue crosses the threshold", async () => {
    renderApp(answers(three()));
    await screen.findByRole("article", { name: "Paper 1" });
    key("j");
    await screen.findByRole("article", { name: "Paper 2" });

    act(() => setQueueWidth(WIDE_FROM - 100));
    expect(open()).toEqual([rows()[1]]);
    act(() => setQueueWidth(WIDE_FROM + 100));
    expect(open()).toEqual([]);
    expect(screen.getByRole("article", { name: "Paper 2" })).toBeDefined();
  });
});
