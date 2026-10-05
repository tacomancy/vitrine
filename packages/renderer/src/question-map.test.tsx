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

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = "#/question-map";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "questionMap.coverage": COVERAGE,
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
