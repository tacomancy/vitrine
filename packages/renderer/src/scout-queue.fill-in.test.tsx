import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// A Listing-only card fills in while it is pending (#887; ADR 0055 decision
// 5), so the detail must be the card as it is now, never the one that was
// open when its run began (ADR 0055, Consequences).

const listingOnly: Card = {
  id: 1,
  title: "Agentic Misalignment",
  authors: [],
  published: "",
  venue: null,
  venueType: null,
  venueId: null,
  alsoOnArxiv: null,
  publisher: null,
  abstract: "",
  url: "https://www.anthropic.com/research/agentic-misalignment",
  doi: null,
  lane: "review",
  scouts: [{ id: "lab", name: "Alignment", assigned: [], dropped: false }],
  retroactive: false,
  signals: [],
  moved: null,
  pastWindow: false,
  counterweight: false,
};

describe("a card that fills in while it is open", () => {
  it("shows the fields its Item page gave once the run that read it ends", async () => {
    let card = listingOnly;
    const { stream } = renderApp({
      "vault.current": vault,
      "scouts.list": {
        scouts: [{ id: "lab", name: "Alignment", assigned: [], paused: false }],
        unreadable: [],
      },
      "scouts.queue": () => [card],
      "scouts.batches": [],
      "scouts.groups": [{ id: "lab", runId: 3, runPending: 1, held: [] }],
      "scouts.health": { scouts: [] },
      "scouts.fleet": { claim: null, naming: [] },
      "scouts.muted": { rules: [], problem: null, items: [] },
      "scouts.skim": { recent: [], older: [] },
    });
    const detail = await screen.findByRole("article", {
      name: "Agentic Misalignment",
    });
    expect(within(detail).queryByText("Rowe, Ada")).toBeNull();

    card = {
      ...listingOnly,
      authors: ["Rowe, Ada"],
      published: "2025-06-20",
      abstract: "We stress-tested 16 leading models.",
    };
    stream.push({ type: "scoutFinished", scoutId: "lab", runId: 4 });

    await waitFor(() =>
      expect(
        within(
          screen.getByRole("article", { name: "Agentic Misalignment" })
        ).getByText("We stress-tested 16 leading models.")
      ).toBeDefined()
    );
    const now = screen.getByRole("article", { name: "Agentic Misalignment" });
    expect(within(now).getByText("Rowe, Ada")).toBeDefined();
    expect(within(now).getByText("2025-06-20")).toBeDefined();
  });
});
