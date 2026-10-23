import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// The counterweight slot's label (#648; ADR 0044 decision 7): the core marks
// the card and the page says why it sits where it does. The core is faked, so
// what is asserted is that the mark is drawn, in the stack and on the card.

const SLEEP = {
  id: "sleep",
  name: "Sleep and memory",
  assigned: [],
  paused: false,
  dropped: null,
};

const card = (id: number, title: string, over: Partial<Card> = {}): Card => ({
  id,
  title,
  authors: ["Ana van der Meer"],
  published: "2026-09-29T10:00:00Z",
  venue: null,
  venueType: null,
  venueId: null,
  alsoOnArxiv: null,
  publisher: null,
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
  counterweight: false,
  ...over,
});

const answers = (queue: Card[]) => ({
  "vault.current": vault,
  "scouts.list": { scouts: [SLEEP], dropped: [], unreadable: [] },
  "scouts.queue": queue,
  "scouts.batches": [],
  "scouts.groups": [
    {
      id: "sleep",
      runId: 3,
      runPending: 2,
      deferred: 0,
      capped: 0,
      cap: null,
      held: [],
    },
  ],
  "scouts.health": { scouts: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: [], older: [] },
  "questions.list": { questions: [], partial: [], unreadable: [], shape: [] },
});

const open = async () => {
  fireEvent.click(
    await screen.findByRole("button", { name: /Sleep and memory/ })
  );
  await screen.findByRole("heading", { name: "Sleep and memory" });
};

describe("the Scout Queue — the counterweight slot", () => {
  it("labels the slot's card in the list of what comes next", async () => {
    renderApp(
      answers([
        card(1, "First"),
        card(2, "Outside one", { counterweight: true }),
        card(3, "Third"),
      ])
    );
    await open();

    const next = await screen.findByRole("list", { name: "New finds" });
    const [, second, third] = within(next).getAllByRole("listitem");
    expect(second?.textContent).toContain("Outside one");
    expect(second?.textContent).toContain("outside the usual");
    expect(third?.textContent).not.toContain("outside the usual");
  });

  it("labels the card once it is the one in hand", async () => {
    renderApp(answers([card(2, "Outside one", { counterweight: true })]));
    await open();

    const article = await screen.findByRole("article", { name: "Outside one" });
    expect(article.textContent).toContain("outside the usual");
  });

  it("says nothing on a card that is not the slot's", async () => {
    renderApp(answers([card(1, "First")]));
    await open();

    const article = await screen.findByRole("article", { name: "First" });
    expect(article.textContent).not.toContain("outside the usual");
  });
});
