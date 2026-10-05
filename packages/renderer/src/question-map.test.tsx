import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Coverage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Question Map's frame (#483; ADR 0041; ADR 0032): a Dashboard at its
// own Address with a named slot per reading, and a page-wide *not yet* in
// front of every slot until the vault has been read in full.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const COVERAGE: Coverage = { depth: 1, deepest: 1, rows: [], tags: [] };

const empty0 = { count: 0, items: [] };
const NO_READINGS = {
  depth: 1,
  wellSupported: empty0,
  unanchored: empty0,
  unquestionedKnowledge: empty0,
  clockedButUnquestioned: empty0,
};

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = "#/question-map";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "questionMap.coverage": COVERAGE,
    "questionMap.readings": NO_READINGS,
    ...more,
  });
};

const page = () => screen.findByRole("region", { name: "Question Map" });
const SLOTS = ["matrix", "readings", "origins", "review"];
const slots = (view: HTMLElement) =>
  SLOTS.filter((name) => view.querySelector(`[data-slot="${name}"]`) !== null);

describe("the Question Map", () => {
  it("opens at its Address with an empty frame: one named slot for each reading, and the Sidebar entry lit", async () => {
    open();
    const view = await page();
    expect(view.querySelector("h1")?.textContent).toBe("Question Map");
    expect(screen.getByRole("link", { current: "page" }).textContent).toBe(
      "Question Map"
    );
    await vi.waitFor(() => expect(slots(view)).toEqual(SLOTS));
  });

  it("is reached from the Sidebar", async () => {
    window.location.hash = "#/inbox";
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": READ,
      "questionMap.coverage": COVERAGE,
      "questionMap.readings": NO_READINGS,
    });
    await screen.findByRole("region", { name: "Question Inbox" });
    fireEvent.click(screen.getByRole("link", { name: "Question Map" }));
    expect(await page()).toBeDefined();
    expect(window.location.hash).toBe("#/question-map");
  });

  it.each([
    [
      "the vault is still being read",
      {
        indexing: { done: 3, total: 10 },
        watching: { ok: true },
        current: { ok: false, reason: "a sweep has not completed" },
      },
      "◐ reading the vault · 3 of 10 files",
    ],
    [
      "the watcher is down",
      {
        indexing: null,
        watching: { ok: false, reason: "the watch gave no sign of life" },
        current: { ok: false, reason: "not watching" },
      },
      "‖ not watching — the watch gave no sign of life · retry",
    ],
    [
      "a settled batch is not yet applied",
      {
        indexing: null,
        watching: { ok: true },
        current: { ok: false, reason: "a settled batch is not yet applied" },
      },
      null,
    ],
  ])(
    "says not yet in place of every slot while %s",
    async (_, status, line) => {
      open({ "vault.status": status });
      const view = await page();
      await within(view).findByText(/not read yet|not known/);
      expect(slots(view)).toEqual([]);
      if (line !== null) expect(view.textContent).toContain(line);
    }
  );

  it("shows the slots once the Index is Current", async () => {
    open();
    const view = await page();
    await vi.waitFor(() => expect(slots(view)).toEqual(SLOTS));
    expect(view.textContent).not.toMatch(/not read yet/);
  });
});

// The four readings (#485; ADR 0041 decision 4): a count per kind that
// names a decision, never summed, collapsed away when empty and opened to
// its full list only on request.

const none = { count: 0, items: [] };
const row = (question: string, path: string, material = 0) => ({
  kind: "question" as const,
  path,
  id: null,
  question,
  material,
  unresolved: 0,
});
const READINGS = {
  depth: 1,
  wellSupported: {
    count: 1,
    items: [row("Does sleep help?", "q/Sleep.md", 4)],
  },
  unanchored: {
    count: 2,
    items: [row("Why now?", "q/Now.md"), row("Why then?", "q/Then.md")],
  },
  unquestionedKnowledge: {
    count: 1,
    items: [
      {
        tag: "ml/probing",
        display: "ml/probing",
        material: [{ path: "s/rasch.md", display: "Rasch" }],
      },
    ],
  },
  clockedButUnquestioned: {
    count: 2,
    items: [
      {
        tag: "memory",
        display: "memory",
        stubs: [
          { path: "s/a.md", display: "Stub A" },
          { path: "s/b.md", display: "Stub B" },
        ],
      },
    ],
  },
};

describe("the four readings", () => {
  const readings = async (data: unknown = READINGS) => {
    open({ "questionMap.readings": data });
    const view = await page();
    return await vi.waitFor(() => {
      const slot = view.querySelector<HTMLElement>('[data-slot="readings"]')!;
      expect(slot.textContent).not.toBe("");
      return slot;
    });
  };

  it("shows each reading's count and no list until asked", async () => {
    const slot = await readings();
    for (const name of [
      /2 unanchored/,
      /1 well-supported/,
      /1 tag.*unquestioned knowledge/,
      /2.*clocked but unquestioned/,
    ])
      expect(within(slot).getByRole("button", { name })).toBeDefined();
    expect(within(slot).queryByRole("list")).toBeNull();
    expect(slot.textContent).not.toMatch(/Why now/);
  });

  it("opens one reading's full list on request, and closes it again", async () => {
    const slot = await readings();
    const button = within(slot).getByRole("button", { name: /2 unanchored/ });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const link = within(slot).getByRole("link", { name: "Why now?" });
    expect(link.getAttribute("href")).toBe("#/question/q/Now.md");
    expect(slot.textContent).not.toMatch(/Does sleep help/);
    fireEvent.click(button);
    expect(within(slot).queryByRole("link", { name: "Why now?" })).toBeNull();
  });

  it("leaves an empty reading out of the page", async () => {
    const slot = await readings({ ...READINGS, unanchored: none });
    expect(slot.textContent).not.toMatch(/unanchored/);
    expect(within(slot).getAllByRole("button")).toHaveLength(3);
  });

  it("draws nothing at all when every reading is empty", async () => {
    open({
      "questionMap.readings": {
        ...READINGS,
        wellSupported: none,
        unanchored: none,
        unquestionedKnowledge: none,
        clockedButUnquestioned: none,
      },
    });
    const view = await page();
    await vi.waitFor(() => expect(slots(view)).toEqual(SLOTS));
    expect(view.querySelector('[data-slot="readings"]')!.textContent).toBe("");
  });

  it("names a stub kept from a Scout and never says Skim, and opens what has an Address only", async () => {
    const slot = await readings();
    fireEvent.click(
      within(slot).getByRole("button", { name: /clocked but unquestioned/ })
    );
    expect(slot.textContent).toMatch(/kept from a Scout/);
    expect(slot.textContent).not.toMatch(/skim/i);
    expect(slot.textContent).toMatch(/Stub A/);
    expect(within(slot).queryByRole("link", { name: "Stub A" })).toBeNull();

    fireEvent.click(
      within(slot).getByRole("button", { name: /unquestioned knowledge/ })
    );
    expect(
      within(slot).getByRole("link", { name: "Rasch" }).getAttribute("href")
    ).toBe("#/source/s/rasch.md");
  });

  it("shows no total across the readings", async () => {
    const slot = await readings();
    expect(slot.textContent).not.toMatch(/\b6\b|of \d+/);
  });
});
