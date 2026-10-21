import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Home's Waiting section (spec #728, ticket #731): Review depth rendered as
// the core derived it, and a Skim line that says a feed has no depth. The
// figure is `scouts.depth`, which is Scout Activity's header figure, so every
// number here is one the test hands in and asserts is passed through whole.

const watched = {
  indexing: null,
  watching: { ok: true },
  current: { ok: true },
};

const nothing = {
  pending: 0,
  pastWindow: 0,
  deferred: 0,
  median: null,
  oldest: null,
};

const answers = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": watched,
  "vault.kinds": ["question"],
  "vault.tree": [{ path: "questions/a.md", kind: "question" }],
  "looseEnds.rows": { groups: [], problems: [] },
  "home.away": { since: null },
  "scouts.activity": { rows: [] },
  "scouts.health": {
    scouts: [
      {
        id: "density-watch",
        health: { voice: "claim", sentence: "ok", warrant: null },
        lastCostUsd: null,
      },
    ],
    unreadable: [],
  },
  "scouts.fleet": {
    claim:
      "1 scout watching · all parsed cleanly · newest run 3 h ago · last new proposal 14 Sep",
    naming: [],
  },
  "scouts.depth": {
    pending: 14,
    pastWindow: 3,
    deferred: 2,
    median: { at: "2026-10-14T00:00:00Z", ago: "6 days ago" },
    oldest: { at: "2026-10-01T00:00:00Z", ago: "19 days ago" },
  },
};

// The first render in a cold worker is slow; the section itself is not.
const waiting = async () =>
  screen.findByRole("region", { name: "Waiting" }, { timeout: 4000 });

describe("Waiting — Review depth", () => {
  it("states the core's figure with the median and oldest age as plain facts", async () => {
    renderApp(answers);
    const section = await waiting();
    expect(section.textContent).toContain("14 in Review");
    expect(section.textContent).toContain("median 6 days ago");
    expect(section.textContent).toContain("oldest 19 days ago");
  });

  it("keeps deferred apart from the headline, and says aged ones are inside it", async () => {
    renderApp(answers);
    const section = await waiting();
    expect(section.textContent).toContain("14 in Review");
    expect(section.textContent).not.toContain("16");
    expect(section.textContent).toContain("2 deferred");
    expect(section.textContent).toMatch(/3 .*older.*included/);
  });

  it("leaves age uncoloured: no element in the section carries a style or a state", async () => {
    renderApp(answers);
    const section = await waiting();
    for (const el of section.querySelectorAll("*")) {
      expect(el.getAttribute("style")).toBeNull();
      expect(el.getAttribute("role")).not.toBe("alert");
    }
  });

  it("leads to the Queue's Review lane", async () => {
    renderApp(answers);
    const section = await waiting();
    const link = within(section).getByRole("link", { name: "open review" });
    expect(link.getAttribute("href")).toBe("#/scouts");
  });

  it("says an empty Review as a claim with the fleet's Warrant, not a bare zero", async () => {
    renderApp({ ...answers, "scouts.depth": nothing });
    const section = await waiting();
    expect(section.textContent).toContain("Review is empty");
    expect(section.textContent).toContain("1 scout watching");
    expect(section.textContent).toContain("last new proposal 14 Sep");
    expect(section.textContent).not.toMatch(/\b0\b/);
  });

  it("makes no claim that Review is empty while a Scout is broken", async () => {
    renderApp({
      ...answers,
      "scouts.depth": nothing,
      "scouts.health": {
        scouts: [
          {
            id: "density-watch",
            health: { voice: "wrong", sentence: "x", warrant: null },
            lastCostUsd: null,
          },
        ],
        unreadable: [],
      },
      "scouts.fleet": { claim: null, naming: ["density-watch"] },
    });
    const section = await waiting();
    expect(section.textContent).not.toContain("Review is empty");
    expect(section.textContent).not.toContain("watching");
    expect(section.textContent).toContain("no claim that the field is quiet");
    // The Scout is named once, by the first sentence, and not again here.
    expect(section.textContent).not.toContain("density-watch");
  });

  it("draws no section when there are no Scouts", async () => {
    renderApp({
      ...answers,
      "scouts.depth": nothing,
      "scouts.health": { scouts: [], unreadable: [] },
      "scouts.fleet": { claim: null, naming: [] },
    });
    await screen.findByText("no scouts yet");
    expect(screen.queryByRole("region", { name: "Waiting" })).toBeNull();
  });

  it("says it could not tell when the depth could not be read, never a bare zero", async () => {
    renderApp({
      ...answers,
      "scouts.depth": () => {
        throw new Error("the queue cannot be read");
      },
    });
    const section = await waiting();
    await within(section).findByText(/could not tell/);
    expect(section.textContent).toContain("the queue cannot be read");
    expect(section.textContent).not.toContain("Review is empty");
  });
});

describe("Waiting — Skim", () => {
  it("says a feed has no depth, so it is not counted, and never claims it flows", async () => {
    renderApp(answers);
    const section = await waiting();
    expect(section.textContent).toContain(
      "Skim is a feed with no depth, so it is not counted here"
    );
    expect(document.body.textContent).not.toMatch(/flowing as usual/i);
    expect(document.body.textContent).not.toMatch(/nothing is broken/i);
  });

  it("leads to the Skim feed, and the Queue opens on that lane", async () => {
    renderApp({
      ...answers,
      "scouts.queue": [],
      "scouts.groups": [],
      "scouts.list": { scouts: [], unreadable: [] },
      "scouts.skim": { recent: [], older: [] },
      "scouts.muted": { rules: [], problem: null, items: [] },
    });
    const section = await waiting();
    const link = within(section).getByRole("link", { name: "glance" });
    expect(link.getAttribute("href")).toBe("#/scouts?view=skim");
    fireEvent.click(link);
    const queue = await screen.findByRole("region", { name: "Scout Queue" });
    expect(
      within(queue)
        .getByRole("button", { name: "Skim" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(window.location.hash).toBe("#/scouts?view=skim");
  });
});
