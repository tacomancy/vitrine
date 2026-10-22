import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// Reject group (`⇧R`) and defer group (`⇧D`) (#644; ADR 0044 decision 9): the
// keys name the cards of the group on screen, the line says what was done and
// how to undo it, and `⌘Z` takes the whole gesture back. What a bulk act does
// to the log is the core's, tested there.

const by = (scoutId: string, name: string) => ({
  id: scoutId,
  name,
  assigned: [],
  dropped: false,
});

const card = (
  id: number,
  scoutId = "sleep",
  rest: Partial<Card> = {}
): Card => ({
  id,
  title: `Paper ${id}`,
  authors: ["Ana van der Meer"],
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
  scouts: [by(scoutId, scoutId === "sleep" ? "Sleep and memory" : "Attention")],
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
      { id: "attn", name: "Attention", assigned: [], paused: false },
    ],
    unreadable: [],
  },
  "scouts.queue": queue,
  "scouts.groups": [
    { id: "sleep", runId: 3, runPending: 2, held: [] },
    { id: "attn", runId: 4, runPending: 1, held: [] },
  ],
  "scouts.health": { scouts: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: [], older: [] },
  ...more,
});

const hand = () => screen.findByRole("article");

describe("reject group and defer group", () => {
  it("⇧R rejects exactly the cards of the group on screen and says how to undo it", async () => {
    const rejectGroup = vi.fn(() => ({ bulk: 5, count: 2 }));
    const reject = vi.fn(() => null);
    renderApp(
      answers([card(1), card(2), card(3, "attn")], {
        "scouts.rejectGroup": rejectGroup,
        "scouts.reject": reject,
      })
    );
    await hand();
    fireEvent.click(screen.getByRole("button", { name: /Sleep and memory/ }));

    fireEvent.keyDown(document.body, { key: "R", shiftKey: true });

    await waitFor(() =>
      expect(rejectGroup).toHaveBeenCalledWith({ proposalIds: [1, 2] })
    );
    expect(
      await screen.findByText(
        "Rejected 2 in this group. ⌘Z puts them all back."
      )
    ).toBeDefined();
    // The shifted key is the group's, never also the card's own `R`.
    expect(reject).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Undo reject of 2" })
    ).toBeDefined();
  });

  it("⇧D defers the group", async () => {
    const deferGroup = vi.fn(() => ({ bulk: 6, count: 3 }));
    const defer = vi.fn(() => null);
    renderApp(
      answers([card(1), card(2), card(3)], {
        "scouts.deferGroup": deferGroup,
        "scouts.defer": defer,
      })
    );
    await hand();

    fireEvent.keyDown(document.body, { key: "D", shiftKey: true });

    await waitFor(() =>
      expect(deferGroup).toHaveBeenCalledWith({ proposalIds: [1, 2, 3] })
    );
    expect(
      await screen.findByText(
        "Deferred 3 in this group until the next run. ⌘Z puts them all back."
      )
    ).toBeDefined();
    expect(defer).not.toHaveBeenCalled();
  });

  it("leaves out cards folded into the digest, which are not on screen", async () => {
    const rejectGroup = vi.fn(() => ({ bulk: 5, count: 1 }));
    renderApp(
      answers([card(1), card(2, "sleep", { pastWindow: true })], {
        "scouts.rejectGroup": rejectGroup,
      })
    );
    await hand();

    fireEvent.keyDown(document.body, { key: "R", shiftKey: true });

    await waitFor(() =>
      expect(rejectGroup).toHaveBeenCalledWith({ proposalIds: [1] })
    );
  });

  it("⌘Z undoes the whole gesture with its bulk id, and a single undo follows it", async () => {
    const undoBulk = vi.fn(() => ({ bulk: 5, count: 2 }));
    renderApp(
      answers([card(1), card(2)], {
        "scouts.rejectGroup": () => ({ bulk: 5, count: 2 }),
        "scouts.undoBulk": undoBulk,
      })
    );
    await hand();
    fireEvent.keyDown(document.body, { key: "R", shiftKey: true });
    await screen.findByText(/Rejected 2 in this group/);

    fireEvent.keyDown(document.body, { key: "z", metaKey: true });

    await waitFor(() => expect(undoBulk).toHaveBeenCalledWith({ bulk: 5 }));
    expect(await screen.findByText("Put 2 back.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
  });

  it("does nothing when no card is on screen", async () => {
    const rejectGroup = vi.fn(() => ({ bulk: 5, count: 0 }));
    renderApp(answers([], { "scouts.rejectGroup": rejectGroup }));
    await screen.findByRole("heading", { name: "Scout Queue" });

    fireEvent.keyDown(document.body, { key: "R", shiftKey: true });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(rejectGroup).not.toHaveBeenCalled();
  });
});
