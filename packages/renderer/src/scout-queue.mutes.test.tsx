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
  "scouts.batches": [],
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
    fireEvent.click(await screen.findByRole("tab", { name: /^Skim/ }));
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

describe("M on a card from OpenAlex (#806, ADR 0051 decision 8)", () => {
  const published = card({
    venueId: "S1",
    publisher: { id: "P1", name: "Sleep Press" },
  });

  it("mutes the venue by its ID, keeps the name beside it, and offers the publisher", async () => {
    const reach = vi.fn(() => ({ count: 2 }));
    const mute = vi.fn(() => null);
    renderApp(
      answers({
        "scouts.queue": [published],
        "scouts.muteReach": reach,
        "scouts.mute": mute,
      })
    );
    fireEvent.keyDown(await inHand(), { key: "m" });
    const offer = await screen.findByRole("group", { name: "Mute" });
    expect(
      within(offer).getByRole("button", { name: "Mute publisher Sleep Press" })
    ).toBeDefined();

    fireEvent.click(
      within(offer).getByRole("button", { name: "Mute venue Journal of Sleep" })
    );
    expect(
      await screen.findByText(
        /Mute venue “Journal of Sleep” \(by ID S1\)\. Saving it would mute 2 pending items/
      )
    ).toBeDefined();
    const rule = { kind: "venue", value: "Journal of Sleep", id: "S1" };
    expect(reach).toHaveBeenCalledWith(rule);

    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(mute).toHaveBeenCalledWith(rule));
  });

  it("mutes the publisher by ID with its name, and says it is by ID", async () => {
    const mute = vi.fn(() => null);
    renderApp(
      answers({
        "scouts.queue": [published],
        "scouts.muteReach": () => ({ count: 1 }),
        "scouts.mute": mute,
      })
    );
    fireEvent.keyDown(await inHand(), { key: "m" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Mute publisher Sleep Press" })
    );
    expect(
      await screen.findByText(/Mute publisher “Sleep Press” \(by ID P1\)\./)
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() =>
      expect(mute).toHaveBeenCalledWith({
        kind: "publisher",
        value: "Sleep Press",
        id: "P1",
      })
    );
  });

  it("names a publisher OpenAlex gave no name by its ID", async () => {
    const mute = vi.fn(() => null);
    renderApp(
      answers({
        "scouts.queue": [
          card({ venueId: "S1", publisher: { id: "P1", name: null } }),
        ],
        "scouts.muteReach": () => ({ count: 1 }),
        "scouts.mute": mute,
      })
    );
    fireEvent.keyDown(await inHand(), { key: "m" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Mute publisher P1" })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Save rule" }));
    await waitFor(() =>
      expect(mute).toHaveBeenCalledWith({
        kind: "publisher",
        value: "P1",
        id: "P1",
      })
    );
  });

  it("offers no publisher for a card without one, and the venue stays by name", async () => {
    const reach = vi.fn(() => ({ count: 1 }));
    renderApp(answers({ "scouts.muteReach": reach }));
    fireEvent.keyDown(await inHand(), { key: "m" });
    const offer = await screen.findByRole("group", { name: "Mute" });
    expect(
      within(offer).queryByRole("button", { name: /publisher/ })
    ).toBeNull();
    fireEvent.click(
      within(offer).getByRole("button", { name: "Mute venue Journal of Sleep" })
    );
    await waitFor(() =>
      expect(reach).toHaveBeenCalledWith({
        kind: "venue",
        value: "Journal of Sleep",
      })
    );
  });

  it("shows an ID rule as by ID in the muted view, and deletes it with its ID", async () => {
    const unmute = vi.fn(() => null);
    const rule = {
      kind: "publisher" as const,
      value: "Sleep Press",
      id: "P1",
    };
    renderApp(
      answers({
        "scouts.muted": {
          rules: [rule, { kind: "venue", value: "Journal of Sleep" }],
          problem: null,
          items: [
            {
              id: 1,
              title: "Held by publisher",
              authors: ["A"],
              venue: null,
              url: "http://x.example",
              lane: "review",
              state: "pending",
              rule,
            },
          ],
        },
        "scouts.unmute": unmute,
      })
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Muted 1" }));
    const rules = await screen.findByRole("list", { name: "Mute rules" });
    const rows = within(rules).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain(
      "publisher “Sleep Press” (by ID P1)"
    );
    expect(rows[1]!.textContent).not.toContain("by ID");
    fireEvent.click(
      within(rows[0]!).getByRole("button", { name: /Delete rule/ })
    );
    await waitFor(() => expect(unmute).toHaveBeenCalledWith(rule));
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
    venueType: null,
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
    expect(await screen.findByRole("tab", { name: "Muted 2" })).toBeDefined();
    cleanup();

    renderApp(answers());
    await inHand();
    expect(screen.getByRole("tab", { name: "Muted 0" })).toBeDefined();
  });

  it("lists each item with the rule that caught it", async () => {
    renderApp(answers({ "scouts.muted": some }));
    fireEvent.click(await screen.findByRole("tab", { name: "Muted 2" }));

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
    fireEvent.click(await screen.findByRole("tab", { name: "Muted 2" }));
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
              venueType: null,
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
      (await screen.findByRole("tab", { name: "Muted 1" })).getAttribute(
        "aria-selected"
      )
    ).toBe("true");
    const list = await screen.findByRole("list", { name: "Muted" });
    expect(list.textContent).toContain("Held by author");
  });
});

describe("Mute by name (#807, ADR 0051 decision 9)", () => {
  const venues = {
    outcome: "found" as const,
    creditsLeft: 900,
    results: [
      {
        id: "S1",
        name: "Journal of Sleep",
        publisher: "Sleep Press",
        issn: "0000-0001",
        worksCount: 12345,
      },
      {
        id: "S2",
        name: "Journal of Sleep",
        publisher: "Other House",
        issn: "0000-0002",
        worksCount: 87,
      },
    ],
  };

  const opened = async (more: Record<string, unknown>) => {
    renderApp(answers(more));
    await inHand();
    fireEvent.click(screen.getByRole("button", { name: "Mute by name" }));
    return await screen.findByRole("group", { name: "Mute by name" });
  };
  // A disclosure, not an on/off chip: closed must not read as struck through
  // or switched off (the toggle tier draws aria-pressed=false that way).
  it("is a disclosure that says whether it is open", async () => {
    renderApp(answers({}));
    await inHand();
    const button = screen.getByRole("button", { name: "Mute by name" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  const typeName = (form: HTMLElement, value: string) =>
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), {
      target: { value },
    });

  it("searches only on a press of the button or enter, never as the name is typed", async () => {
    const search = vi.fn(() => venues);
    const form = await opened({ "scouts.searchNames": search });
    typeName(form, "sle");
    typeName(form, "sleep");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(search).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByRole("button", { name: "Search" }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith({ kind: "venue", name: "sleep" });

    fireEvent.submit(within(form).getByRole("textbox", { name: "Name" }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  });

  it("shows each result's publisher, ISSN and works count, so near-identical names can be told apart", async () => {
    const form = await opened({ "scouts.searchNames": () => venues });
    typeName(form, "sleep");
    fireEvent.click(within(form).getByRole("button", { name: "Search" }));

    const list = await within(form).findByRole("list", { name: "Results" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("Sleep Press");
    expect(rows[0]!.textContent).toContain("ISSN 0000-0001");
    expect(rows[0]!.textContent).toContain("12,345 works");
    expect(rows[1]!.textContent).toContain("Other House");
    expect(rows[1]!.textContent).toContain("ISSN 0000-0002");
    expect(rows[1]!.textContent).toContain("87 works");
    expect(form.textContent).toContain("900 credits left");
  });

  it("stores the venue's ID and name together once the rule is saved", async () => {
    const reach = vi.fn(() => ({ count: 4 }));
    const mute = vi.fn(() => null);
    const form = await opened({
      "scouts.searchNames": () => venues,
      "scouts.muteReach": reach,
      "scouts.mute": mute,
    });
    typeName(form, "sleep");
    fireEvent.click(within(form).getByRole("button", { name: "Search" }));
    const rows = within(
      await within(form).findByRole("list", { name: "Results" })
    ).getAllByRole("listitem");
    fireEvent.click(within(rows[1]!).getByRole("button", { name: /Mute/ }));

    expect(
      await screen.findByText(
        /Mute venue “Journal of Sleep” \(by ID S2\)\. Saving it would mute 4 pending items/
      )
    ).toBeDefined();
    const rule = { kind: "venue", value: "Journal of Sleep", id: "S2" };
    expect(reach).toHaveBeenCalledWith(rule);
    expect(mute).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(mute).toHaveBeenCalledWith(rule));
    expect(await screen.findByRole("status")).toBeDefined();
  });

  it("searches publishers when asked to, and stores a publisher rule with its ID", async () => {
    const search = vi.fn(() => ({
      outcome: "found",
      creditsLeft: null,
      results: [
        {
          id: "P9",
          name: "MDPI",
          publisher: null,
          issn: null,
          worksCount: 500000,
        },
      ],
    }));
    const mute = vi.fn(() => null);
    const form = await opened({
      "scouts.searchNames": search,
      "scouts.muteReach": () => ({ count: 0 }),
      "scouts.mute": mute,
    });
    fireEvent.click(within(form).getByRole("radio", { name: "Publisher" }));
    typeName(form, "mdpi");
    fireEvent.click(within(form).getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith({ kind: "publisher", name: "mdpi" })
    );
    fireEvent.click(
      await within(form).findByRole("button", { name: "Mute MDPI" })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Save rule" }));
    await waitFor(() =>
      expect(mute).toHaveBeenCalledWith({
        kind: "publisher",
        value: "MDPI",
        id: "P9",
      })
    );
  });

  it("says a failed or spent search as such and not as no results", async () => {
    const sentence =
      "OpenAlex's daily budget is used up, so this Scout is waiting. It resets at midnight UTC.";
    const form = await opened({
      "scouts.searchNames": () => ({ outcome: "failed", sentence }),
    });
    typeName(form, "sleep");
    fireEvent.click(within(form).getByRole("button", { name: "Search" }));

    expect((await within(form).findByRole("alert")).textContent).toContain(
      sentence
    );
    expect(form.textContent).not.toMatch(/no (venues|publishers|results)/i);
  });

  it("says when nothing was found", async () => {
    const form = await opened({
      "scouts.searchNames": () => ({
        outcome: "found",
        results: [],
        creditsLeft: 500,
      }),
    });
    typeName(form, "zzzz");
    fireEvent.click(within(form).getByRole("button", { name: "Search" }));
    expect(await within(form).findByText(/No venues found/)).toBeDefined();
  });

  it("will not search for an empty name", async () => {
    const search = vi.fn(() => venues);
    const form = await opened({ "scouts.searchNames": search });
    const button = within(form).getByRole("button", { name: "Search" });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.submit(within(form).getByRole("textbox", { name: "Name" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(search).not.toHaveBeenCalled();
  });
});
