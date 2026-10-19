import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Card, Muted } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// Mute rules in the Queue (#646; ADR 0044 decision 4): `M` on a card offers a
// rule, the rule's reach is told before it is saved, and the muted view names
// the rule that holds each item. Which items a rule catches is the core's, so
// every answer here is stubbed and none of it is computed.

const card = (rest: Partial<Card> = {}): Card => ({
  id: 7,
  title: "Slow Oscillations Reconsidered",
  authors: ["Ana van der Meer", "B. Other"],
  published: "2026-09-29T10:00:00Z",
  venue: "Journal of Sleep",
  abstract: "A short abstract.",
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
  ...rest,
});

const none: Muted = { rules: [], problem: null, items: [] };

const answers = (more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": {
    scouts: [
      { id: "sleep", name: "Sleep and memory", assigned: [], paused: false },
    ],
    unreadable: [],
  },
  "scouts.queue": [card()],
  "scouts.groups": [{ id: "sleep", runId: 3, runPending: 1, held: [] }],
  "scouts.health": { scouts: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: [], older: [] },
  "scouts.muted": none,
  ...more,
});

const inHand = () =>
  screen.findByRole("article", { name: "Slow Oscillations Reconsidered" });

describe("M on a card", () => {
  it("offers each author, the venue and a keyword, and acts on nothing until one is chosen", async () => {
    const mute = vi.fn(() => null);
    renderApp(answers({ "scouts.mute": mute }));
    fireEvent.keyDown(await inHand(), { key: "m" });

    const offer = await screen.findByRole("group", { name: "Mute" });
    for (const name of [
      "Mute author Ana van der Meer",
      "Mute author B. Other",
      "Mute venue Journal of Sleep",
    ]) {
      expect(within(offer).getByRole("button", { name })).toBeDefined();
    }
    expect(
      within(offer).getByRole("textbox", { name: "Keyword" })
    ).toBeDefined();
    expect(mute).not.toHaveBeenCalled();
  });

  it("offers no venue for a card that has none", async () => {
    renderApp(answers({ "scouts.queue": [card({ venue: null })] }));
    fireEvent.keyDown(await inHand(), { key: "m" });

    const offer = await screen.findByRole("group", { name: "Mute" });
    expect(within(offer).queryByRole("button", { name: /venue/ })).toBeNull();
  });

  it("reports how many pending items the rule would catch before it is saved, then saves it", async () => {
    const reach = vi.fn(() => ({ count: 3 }));
    const mute = vi.fn(() => null);
    renderApp(answers({ "scouts.muteReach": reach, "scouts.mute": mute }));
    fireEvent.keyDown(await inHand(), { key: "m" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Mute author B. Other" })
    );

    expect(
      await screen.findByText(/would mute 3 pending items/i)
    ).toBeDefined();
    expect(reach).toHaveBeenCalledWith({ kind: "author", value: "B. Other" });
    expect(mute).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() =>
      expect(mute).toHaveBeenCalledWith({ kind: "author", value: "B. Other" })
    );
    // The card the rule held leaves the offer behind it.
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Mute" })).toBeNull()
    );
    expect(await screen.findByRole("status")).toBeDefined();
  });

  it("says so when the rule would catch one item, and when it would catch none", async () => {
    let count = 1;
    renderApp(answers({ "scouts.muteReach": () => ({ count }) }));
    fireEvent.keyDown(await inHand(), { key: "m" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Mute venue Journal of Sleep" })
    );
    expect(
      await screen.findByText(/would mute 1 pending item\b/i)
    ).toBeDefined();

    count = 0;
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Mute author B. Other" })
    );
    expect(
      await screen.findByText(/would mute no pending items/i)
    ).toBeDefined();
  });

  it("takes a keyword typed in, and saves nothing on Escape", async () => {
    const reach = vi.fn(() => ({ count: 2 }));
    const mute = vi.fn(() => null);
    renderApp(answers({ "scouts.muteReach": reach, "scouts.mute": mute }));
    fireEvent.keyDown(await inHand(), { key: "m" });
    const field = await screen.findByRole("textbox", { name: "Keyword" });
    fireEvent.change(field, { target: { value: "  Mesa " } });
    fireEvent.click(screen.getByRole("button", { name: "Mute keyword" }));

    expect(
      await screen.findByText(/would mute 2 pending items/i)
    ).toBeDefined();
    expect(reach).toHaveBeenCalledWith({ kind: "keyword", value: "Mesa" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Mute" })).toBeNull()
    );
    expect(mute).not.toHaveBeenCalled();
    // Back at the card, with its keys.
    expect(await inHand()).toBeDefined();
  });

  it("works on a Skim line as it does on a card", async () => {
    renderApp(
      answers({
        "scouts.skim": { recent: [card({ lane: "skim" })], older: [] },
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Skim" }));
    fireEvent.keyDown(await inHand(), { key: "m" });

    expect(await screen.findByRole("group", { name: "Mute" })).toBeDefined();
  });

  it("says what the core refused, and keeps the offer", async () => {
    const mute = vi.fn(() => {
      throw new Error(".vitrine/mutes.yaml could not be read");
    });
    renderApp(
      answers({ "scouts.muteReach": () => ({ count: 1 }), "scouts.mute": mute })
    );
    fireEvent.keyDown(await inHand(), { key: "m" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Mute author B. Other" })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Save rule" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "mutes.yaml"
    );
  });
});

describe("the muted view", () => {
  const held = (
    id: number,
    title: string,
    rule: Muted["items"][number]["rule"]
  ) => ({
    id,
    title,
    authors: ["A"],
    venue: null,
    url: "http://x.example",
    lane: "review" as const,
    state: "pending" as const,
    rule,
  });
  const some: Muted = {
    rules: [
      { kind: "author", value: "Ada" },
      { kind: "keyword", value: "mesa" },
    ],
    problem: null,
    items: [
      held(1, "Held by author", { kind: "author", value: "Ada" }),
      held(2, "Held by keyword", { kind: "keyword", value: "mesa" }),
    ],
  };

  it("counts what is muted beside the stack and says nothing when nothing is", async () => {
    renderApp(answers({ "scouts.muted": some }));
    await inHand();
    expect(
      await screen.findByRole("button", { name: "2 muted" })
    ).toBeDefined();
    cleanup();

    renderApp(answers());
    await inHand();
    expect(screen.queryByRole("button", { name: /muted/ })).toBeNull();
  });

  it("lists each item with the rule that caught it", async () => {
    renderApp(answers({ "scouts.muted": some }));
    fireEvent.click(await screen.findByRole("button", { name: "2 muted" }));

    const list = await screen.findByRole("list", { name: "Muted" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("Held by author");
    expect(rows[0]!.textContent).toContain("author “Ada”");
    expect(rows[1]!.textContent).toContain("Held by keyword");
    expect(rows[1]!.textContent).toContain("keyword “mesa”");
  });

  it("deletes a rule from the view and reads the Queue again", async () => {
    const unmute = vi.fn(() => null);
    renderApp(answers({ "scouts.muted": some, "scouts.unmute": unmute }));
    fireEvent.click(await screen.findByRole("button", { name: "2 muted" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete rule keyword “mesa”" })
    );

    await waitFor(() =>
      expect(unmute).toHaveBeenCalledWith({ kind: "keyword", value: "mesa" })
    );
  });

  it("names a rules file that does not parse, rather than showing no rules", async () => {
    renderApp(
      answers({
        "scouts.muted": {
          rules: [],
          problem:
            ".vitrine/mutes.yaml could not be read, so no mute rule is applied: bad",
          items: [],
        },
      })
    );
    await inHand();

    const line = await screen.findByText(/mutes\.yaml could not be read/);
    expect(line.closest("footer")).not.toBeNull();
  });
});

describe("arriving on the muted list from Scout Activity (#649)", () => {
  it("opens the muted view in place of the stack", async () => {
    window.location.hash = "#/scouts?view=muted";
    renderApp(
      answers({
        "scouts.muted": {
          rules: [{ kind: "author", value: "Ada" }],
          problem: null,
          items: [
            {
              id: 1,
              title: "Held by author",
              authors: ["A"],
              venue: null,
              url: "http://x.example",
              lane: "review",
              state: "pending",
              rule: { kind: "author", value: "Ada" },
            },
          ],
        },
      })
    );

    expect(
      (await screen.findByRole("button", { name: "1 muted" })).getAttribute(
        "aria-pressed"
      )
    ).toBe("true");
    const list = await screen.findByRole("list", { name: "Muted" });
    expect(list.textContent).toContain("Held by author");
  });
});
