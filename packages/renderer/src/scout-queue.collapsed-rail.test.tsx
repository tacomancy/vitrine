import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// The collapsed rail (#870; ADR 0054 decision 4): a strip of an initial per
// Scout that still filters and still carries the attention marker (ADR 0053
// decision 3), opens on hover or a key, and is named for a screen reader.

const scout = (id: string, name: string, paused = false) => ({
  id,
  name,
  assigned: [],
  paused,
  dropped: null,
});
const WRONG = {
  voice: "wrong",
  kind: "network",
  sentence: "arXiv could not be reached, so nothing was checked.",
};
const WAITING = {
  voice: "not yet",
  sentence: "waiting for a key",
  kind: "credentials",
};
const PAUSED = { voice: "not yet", sentence: "paused since 2 Oct" };
const FIRST = { voice: "not yet", sentence: "first check due now" };
const QUIET = { voice: "claim", warrant: null };

const FLEET: [string, unknown, "not working" | "waiting for a key" | null][] = [
  ["Failing", WRONG, "not working"],
  ["Waiting", WAITING, "waiting for a key"],
  ["Paused", PAUSED, null],
  ["Never ran", FIRST, null],
  ["Quiet", QUIET, null],
];
const idOf = (name: string) => name.toLowerCase().replace(/ /g, "-");

const card = (id: number, scoutId: string, name: string) => ({
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
  scouts: [{ id: scoutId, name, dropped: false, assigned: [] }],
  retroactive: false,
  signals: [],
  moved: null,
  pastWindow: false,
  counterweight: false,
});

const answers = (): Record<string, unknown> => ({
  "vault.current": vault,
  "scouts.list": {
    scouts: FLEET.map(([name]) => scout(idOf(name), name, name === "Paused")),
    dropped: [],
    unreadable: [{ file: "broken.md", sentence: "Line 3 is not a field." }],
  },
  "scouts.queue": [card(1, "quiet", "Quiet"), card(2, "waiting", "Waiting")],
  "scouts.batches": [],
  "scouts.groups": [],
  "scouts.health": {
    scouts: FLEET.map(([name, health]) => ({
      id: idOf(name),
      lastCostUsd: null,
      health,
    })),
  },
  "scouts.activity": { rows: [] },
  "scouts.muted": { rules: [], problem: null, items: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: [], older: [] },
  "questions.list": { questions: [], partial: [], unreadable: [], shape: [] },
});

const rail = () => screen.findByRole("list", { name: "Scouts" });
const collapse = async () => {
  await rail();
  fireEvent.click(screen.getByRole("button", { name: /collapse the rail/i }));
  return rail();
};
const markers = (el: HTMLElement) =>
  within(el)
    .queryAllByRole("img")
    .map((img) => img.getAttribute("aria-label"));

describe("the collapsed rail", () => {
  it("shows a marker for a wrong or credential-blocked Scout and for no other", async () => {
    renderApp(answers());
    const strip = await collapse();

    for (const [name, , marked] of FLEET) {
      const button = within(strip).getByRole("button", {
        name: new RegExp(name),
      });
      expect(
        markers(button),
        `${name} ${marked === null ? "carries no marker" : "is marked"}`
      ).toEqual(marked === null ? [] : [marked]);
    }
  });

  it("draws an initial for each Scout and no names or Voice lines", async () => {
    renderApp(answers());
    const strip = await collapse();

    const failing = within(strip).getByRole("button", { name: /Failing/ });
    expect(failing.textContent).toContain("F");
    expect(strip.textContent).not.toContain("arXiv could not be reached");
  });

  it("names every button for a screen reader, the Scout and what is wrong with it", async () => {
    renderApp(answers());
    const strip = await collapse();

    expect(
      within(strip).getByRole("button", { name: "Never ran" })
    ).toBeTruthy();
    expect(
      within(strip).getByRole("button", { name: "Failing not working" })
    ).toBeTruthy();
  });

  it("keeps a file that will not parse in the strip, marked", async () => {
    renderApp(answers());
    const strip = await collapse();

    const broken = within(strip).getByText("B").closest("li")!;
    expect(markers(broken)).toEqual(["not working"]);
    expect(broken.textContent).toContain("broken.md");
  });

  it("filters from the strip, and clearing restores the list", async () => {
    renderApp(answers());
    const strip = await collapse();
    await screen.findAllByText("Paper 1");

    fireEvent.click(within(strip).getByRole("button", { name: /Waiting/ }));
    expect(screen.queryAllByText("Paper 1")).toEqual([]);
    expect(screen.getAllByText("Paper 2").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "show all" }));
    expect(screen.getAllByText("Paper 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paper 2").length).toBeGreaterThan(0);
  });

  it("keeps the markers under Group by Question", async () => {
    renderApp(answers());
    const strip = await collapse();

    fireEvent.click(screen.getByRole("button", { name: "group: scout" }));
    await screen.findByRole("button", { name: "group: question" });
    expect(markers(strip).sort()).toEqual([
      "not working",
      "not working",
      "waiting for a key",
    ]);
  });

  it("opens on the key and closes on it again, without taking the key from a field", async () => {
    renderApp(answers());
    const strip = await collapse();
    expect(within(strip).queryByText("paused since 2 Oct")).toBeNull();

    fireEvent.keyDown(document, { key: "[" });
    expect(within(await rail()).getByText("paused since 2 Oct")).toBeTruthy();

    fireEvent.keyDown(document, { key: "[" });
    expect(within(await rail()).queryByText("paused since 2 Oct")).toBeNull();
  });

  it("opens while the pointer is over it and shuts when it leaves", async () => {
    renderApp(answers());
    const strip = await collapse();

    fireEvent.mouseEnter(strip.parentElement!);
    expect(within(await rail()).getByText("paused since 2 Oct")).toBeTruthy();

    fireEvent.mouseLeave(strip.parentElement!);
    expect(within(await rail()).queryByText("paused since 2 Oct")).toBeNull();
  });

  it("announces whether it is open on a button the keyboard reaches", async () => {
    renderApp(answers());
    await collapse();

    const toggle = screen.getByRole("button", { name: /open the rail/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(
      screen
        .getByRole("button", { name: /collapse the rail/i })
        .getAttribute("aria-expanded")
    ).toBe("true");
  });
});
