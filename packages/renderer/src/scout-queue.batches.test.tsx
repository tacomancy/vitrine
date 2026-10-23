import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// Retroactive batches (#839; ADR 0052 decisions 3 and 4): a first look at a
// watched page is listed apart from the new finds, one collapsible batch per
// run, each with *Reject this run*. The core says which cards a batch holds;
// the Queue never derives one from `Card.retroactive`.

const SLEEP = {
  id: "sleep",
  name: "Sleep and memory",
  assigned: [],
  paused: false,
  dropped: null,
};
const FROM = { id: "sleep", name: "Sleep and memory", dropped: false };

const card = (id: number, over: Partial<Card> = {}): Card => ({
  id,
  title: `Paper ${id}`,
  authors: [],
  published: "2026-09-29T10:00:00Z",
  venue: null,
  venueType: null,
  venueId: null,
  alsoOnArxiv: null,
  publisher: null,
  abstract: `Abstract ${id}.`,
  url: "http://arxiv.org/abs/2609.05678v1",
  doi: null,
  lane: "review",
  scouts: [{ ...FROM, assigned: [] }],
  retroactive: false,
  signals: [],
  moved: null,
  pastWindow: false,
  counterweight: false,
  ...over,
});

// Papers 1 and 2 are today's finds; 3, 4 and 5 are a first look at a page.
const stack = () => [
  card(1),
  card(2),
  card(3, { retroactive: true }),
  card(4, { retroactive: true }),
  card(5, { retroactive: true }),
];
const batch = (over: Record<string, unknown> = {}) => ({
  scoutId: "sleep",
  runId: 9,
  pending: 3,
  costUsd: 0.42,
  proposalIds: [3, 4, 5],
  ...over,
});

const answers = (
  queue: Card[],
  more: Record<string, unknown> = {}
): Record<string, unknown> => ({
  "vault.current": vault,
  "scouts.list": { scouts: [SLEEP], dropped: [], unreadable: [] },
  "scouts.queue": queue,
  "scouts.batches": [batch()],
  "scouts.groups": [
    { id: "sleep", runId: 9, runPending: 3, deferred: 0, held: [] },
  ],
  "scouts.health": { scouts: [] },
  "scouts.activity": { rows: [] },
  "scouts.muted": { rules: [], problem: null, items: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: [], older: [] },
  "questions.list": { questions: [], partial: [], unreadable: [], shape: [] },
  ...more,
});

const newFinds = () => screen.findByRole("list", { name: "New finds" });
const retro = () => screen.findByRole("region", { name: "Retroactive" });
const header = (n: number) =>
  screen.findByRole("button", { name: new RegExp(`${n} left`) });

describe("Retroactive batches", () => {
  it("lists a first look apart from the new finds, collapsed, saying what is left and what it cost", async () => {
    renderApp(answers(stack()));

    const finds = await newFinds();
    expect(within(finds).getAllByRole("button").length).toBe(2);
    expect(within(finds).queryByRole("button", { name: "Paper 3" })).toBeNull();
    const toggle = await header(3);
    expect(toggle.textContent).toContain("Sleep and memory");
    expect(toggle.textContent).toContain(
      "3 left · first look at the page · $0.42"
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Collapsed: no titles to select.
    expect(screen.queryByRole("button", { name: "Paper 4" })).toBeNull();
  });

  it("says nothing of cost when the run was not priced", async () => {
    renderApp(
      answers(stack(), { "scouts.batches": [batch({ costUsd: null })] })
    );

    expect((await header(3)).textContent).toContain(
      "3 left · first look at the page"
    );
    expect((await header(3)).textContent).not.toContain("$");
  });

  it("expands to its titles, and a title selects into the detail like any row", async () => {
    renderApp(answers(stack()));

    fireEvent.click(await header(3));
    fireEvent.click(await screen.findByRole("button", { name: "Paper 4" }));

    const detail = await screen.findByRole("article", { name: "Paper 4" });
    expect(detail.textContent).toContain("Abstract 4.");
  });

  it("is not drawn when the core has no batch, and a failed read leaves every card among the new finds and says so", async () => {
    renderApp(
      answers(stack(), {
        "scouts.batches": () => {
          throw new Error("The queue file is locked.");
        },
      })
    );

    expect(
      within(await newFinds()).getByRole("button", { name: "Paper 3" })
    ).toBeDefined();
    expect(screen.queryByRole("region", { name: "Retroactive" })).toBeNull();
    expect(await screen.findByText(/The queue file is locked\./)).toBeDefined();
  });

  it("keeps J and K out of a collapsed batch and moves through an expanded one's titles", async () => {
    renderApp(answers(stack()));
    await newFinds();
    const current = () =>
      document
        .querySelector('[aria-current="true"]')
        ?.getAttribute("aria-label");

    expect(current()).toBe("Paper 1");
    fireEvent.keyDown(document, { key: "j" });
    expect(current()).toBe("Paper 2");
    // Collapsed: the last new find is the end of the order.
    fireEvent.keyDown(document, { key: "j" });
    expect(current()).toBe("Paper 2");

    fireEvent.click(await header(3));
    fireEvent.click(await screen.findByRole("button", { name: "Paper 3" }));
    fireEvent.keyDown(document, { key: "j" });
    expect(current()).toBe("Paper 4");
    fireEvent.keyDown(document, { key: "k" });
    fireEvent.keyDown(document, { key: "k" });
    expect(current()).toBe("Paper 2");
  });

  it("leaves a Scout's batch out of another Scout's filter", async () => {
    renderApp(
      answers(stack(), {
        "scouts.list": {
          scouts: [SLEEP, { ...SLEEP, id: "other", name: "Other" }],
          dropped: [],
          unreadable: [],
        },
      })
    );
    await newFinds();

    fireEvent.click(await screen.findByRole("button", { name: /^Other/ }));

    expect(screen.queryByRole("region", { name: "Retroactive" })).toBeNull();
  });
});

describe("Reject this run", () => {
  const rejected = () => vi.fn(() => ({ rejected: 3 }));

  it("rejects the run and says the batch was not counted toward Accept rate, with an undo", async () => {
    const rejectRun = rejected();
    renderApp(answers(stack(), { "scouts.rejectRun": rejectRun }));

    await header(3);
    fireEvent.click(
      within(await retro()).getByRole("button", { name: /Reject this run/ })
    );

    expect(
      await screen.findByText(
        "Rejected this run of Sleep and memory (3) · not counted toward accept rate"
      )
    ).toBeDefined();
    expect(rejectRun).toHaveBeenCalledWith({ runId: 9 });
    expect(screen.getByRole("button", { name: /Undo/ })).toBeDefined();
  });

  it("is undone as a unit by the footer's undo and by U", async () => {
    const undoRun = vi.fn(() => ({ count: 3 }));
    renderApp(
      answers(stack(), {
        "scouts.rejectRun": rejected(),
        "scouts.undoRun": undoRun,
      })
    );
    await header(3);
    fireEvent.click(
      within(await retro()).getByRole("button", { name: /Reject this run/ })
    );
    await screen.findByText(/not counted toward accept rate/);

    fireEvent.keyDown(document, { key: "u" });

    expect(await screen.findByText("Put 3 back.")).toBeDefined();
    expect(undoRun).toHaveBeenCalledWith({ runId: 9 });
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
  });

  it("offers no run-wide reject on a Scout's header: only a Retroactive batch has one", async () => {
    renderApp(answers([card(1), card(2)], { "scouts.batches": [] }));
    await newFinds();

    fireEvent.click(screen.getByRole("button", { name: /^Sleep and memory/ }));

    await screen.findByRole("heading", { name: "Sleep and memory" });
    expect(
      screen.queryByRole("button", { name: /Reject this run/ })
    ).toBeNull();
  });

  it("says a refusal as an alert, never beside an undo", async () => {
    renderApp(
      answers(stack(), {
        "scouts.rejectRun": () => {
          throw new Error("That run is no longer pending.");
        },
      })
    );
    await header(3);

    fireEvent.click(
      within(await retro()).getByRole("button", { name: /Reject this run/ })
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "That run is no longer pending."
    );
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
  });
});
