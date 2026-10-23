import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// Review as a ranked list beside a detail pane (#837; ADR 0052 decisions 3,
// 7 and 8): the selection is by Proposal id, the keys act on it and move on,
// and one footer line holds the last act with its undo.

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

const three = () => [card(1), card(2), card(3)];
const detail = async (title: string) =>
  screen.findByRole("article", { name: title });
const rows = () =>
  within(screen.getByRole("list", { name: "New finds" })).getAllByRole(
    "button"
  );

describe("the list and the detail", () => {
  it("lists the finds in the core's order with the first in the detail, and tabs count them", async () => {
    renderApp(answers(three()));
    await detail("Paper 1");

    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining("Paper 1"),
      expect.stringContaining("Paper 2"),
      expect.stringContaining("Paper 3"),
    ]);
    expect(rows()[0]!.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("tab", { name: "Review 3" })).toBeDefined();
  });

  it("selects on click", async () => {
    renderApp(answers(three()));
    await detail("Paper 1");

    fireEvent.click(rows()[2]!);

    await detail("Paper 3");
    expect(rows()[2]!.getAttribute("aria-current")).toBe("true");
  });

  it("moves with J and K, and stops at the ends", async () => {
    renderApp(answers(three()));
    await detail("Paper 1");

    fireEvent.keyDown(document.body, { key: "j" });
    await detail("Paper 2");
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "j" });
    await detail("Paper 3");
    fireEvent.keyDown(document.body, { key: "k" });
    await detail("Paper 2");
  });

  it("steps over the rows on screen only, not a closed digest's cards", async () => {
    renderApp(answers([card(1), card(2, { pastWindow: true })]));
    await detail("Paper 1");

    fireEvent.keyDown(document.body, { key: "j" });
    await detail("Paper 1");

    fireEvent.click(
      screen.getByRole("button", { name: /1 older than the window/ })
    );
    fireEvent.keyDown(document.body, { key: "j" });
    await detail("Paper 2");
  });

  it("ignores its keys in a field", async () => {
    renderApp(answers(three()));
    await detail("Paper 1");
    fireEvent.click(screen.getByRole("button", { name: "Mute by name" }));
    const field = await screen.findByRole("textbox");

    fireEvent.keyDown(field, { key: "j" });

    expect(screen.getByRole("article", { name: "Paper 1" })).toBeDefined();
  });

  it("scrolls the selected row into view", async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    renderApp(answers(three()));
    await detail("Paper 1");
    scrollIntoView.mockClear();

    fireEvent.keyDown(document.body, { key: "j" });

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });
});

describe("acting on the selection", () => {
  it("rejects the selected card, not the first, and selects the next", async () => {
    const reject = vi.fn(() => null);
    renderApp(answers(three(), { "scouts.reject": reject }));
    await detail("Paper 1");
    fireEvent.click(rows()[1]!);
    await detail("Paper 2");

    fireEvent.keyDown(document.body, { key: "r" });

    await waitFor(() => expect(reject).toHaveBeenCalledWith({ proposalId: 2 }));
    await detail("Paper 3");
  });

  it("has Accept, Defer, Reject and Pass buttons that do what their keys do", async () => {
    const defer = vi.fn(() => null);
    renderApp(answers(three(), { "scouts.defer": defer }));
    const article = await detail("Paper 1");

    fireEvent.click(within(article).getByRole("button", { name: /^Defer/ }));

    await waitFor(() => expect(defer).toHaveBeenCalledWith({ proposalId: 1 }));
    expect(
      within(article).getByRole("button", { name: /^Accept/ })
    ).toBeDefined();
    expect(
      within(article).getByRole("button", { name: /^Reject/ })
    ).toBeDefined();
    expect(
      within(article).getByRole("button", { name: /^Pass/ })
    ).toBeDefined();
  });

  it("passes the selected card to the bottom and selects the next, recording nothing", async () => {
    const reject = vi.fn(() => null);
    renderApp(answers(three(), { "scouts.reject": reject }));
    await detail("Paper 1");

    fireEvent.keyDown(document.body, { key: "p" });

    await detail("Paper 2");
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining("Paper 2"),
      expect.stringContaining("Paper 3"),
      expect.stringContaining("Paper 1"),
    ]);
    expect(reject).not.toHaveBeenCalled();
  });
});

describe("the footer channel", () => {
  it("holds the last act with undo · U, and U undoes it", async () => {
    const undo = vi.fn(() => null);
    renderApp(answers(three(), { "scouts.reject": null, "scouts.undo": undo }));
    await detail("Paper 1");
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();

    fireEvent.keyDown(document.body, { key: "r" });
    const footer = within(await screen.findByRole("contentinfo"));
    await footer.findByText("Rejected “Paper 1”.");
    expect(
      footer.getByRole("button", { name: "Undo reject" }).textContent
    ).toContain("undo · U");

    fireEvent.keyDown(document.body, { key: "u" });

    await waitFor(() => expect(undo).toHaveBeenCalledWith({ proposalId: 1 }));
  });

  it("offers no undo after an accept", async () => {
    renderApp(
      answers(three(), {
        "scouts.accept": { path: "sources/x.md", held: false },
      })
    );
    await detail("Paper 1");

    fireEvent.keyDown(document.body, { key: "a" });

    await screen.findByText("Accepted into sources/x.md");
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
  });

  it("replaces the act's words with a refusal, as an alert with no undo beside it", async () => {
    renderApp(
      answers(three(), {
        "scouts.reject": null,
        "scouts.defer": () => {
          throw new Error("Could not defer: the log is read-only.");
        },
      })
    );
    await detail("Paper 1");
    fireEvent.keyDown(document.body, { key: "r" });
    await screen.findByText("Rejected “Paper 1”.");

    fireEvent.keyDown(document.body, { key: "d" });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("the log is read-only");
    expect(screen.queryByText("Rejected “Paper 1”.")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
  });

  it("names a failed read in the footer", async () => {
    renderApp(
      answers(three(), {
        "scouts.fleet": () => {
          throw new Error("fleet unreadable");
        },
      })
    );

    const footer = within(await screen.findByRole("contentinfo"));
    expect(await footer.findByText(/fleet unreadable/)).toBeDefined();
  });
});

describe("the detail", () => {
  it("names only the signals that fired as chips, and none when none did", async () => {
    renderApp(
      answers([
        card(1, { signals: [{ kind: "corroboration", scouts: 2 }] }),
        card(2),
      ])
    );
    const first = await detail("Paper 1");
    expect(
      within(within(first).getByRole("list", { name: "Why" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toContain("found by 2 Scouts");

    fireEvent.click(rows()[1]!);
    const second = await detail("Paper 2");
    expect(within(second).queryByRole("list", { name: "Why" })).toBeNull();
  });

  it("labels the counterweight in its row and as a chip, and a lane move as a chip", async () => {
    renderApp(
      answers([
        card(1),
        card(2, {
          counterweight: true,
          moved: { kind: "demoted" },
        }),
      ])
    );
    await detail("Paper 1");
    expect(rows()[1]!.textContent).toContain("outside the usual");

    fireEvent.click(rows()[1]!);
    const article = await detail("Paper 2");
    const chips = within(within(article).getByRole("list", { name: "Why" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(chips).toContain("outside the usual");
    expect(chips).toContain("moved to Skim after three defers");
  });

  it("says missing for a field the source did not give, in muted italic", async () => {
    renderApp(answers([card(1)]));
    const article = await detail("Paper 1");

    const authors = within(article).getByText("authors").nextElementSibling!;
    expect(authors.textContent).toBe("missing");
    expect(authors.className).toMatch(/missing/);
  });
});
