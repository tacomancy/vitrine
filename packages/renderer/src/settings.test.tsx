import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import type { VaultStatus } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, pressGlobalChord, renderApp, vault } from "./fake-core";

// Settings' first section, *Where the vault is* (#376; spec #363 stories
// 1–11, 37–39; prototype 13), and every way in: the Address, ⌘,, the
// application menu's *Settings…*, the rail's gear and ⌘K — none of which
// reaches it from First run (ADR 0025 decision 5).

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Local time, so the row's clock reads the same in every time zone.
const SINCE = new Date(2026, 8, 28, 8, 40);
const NOW = new Date(2026, 8, 28, 11, 2);

const watched: VaultStatus = {
  indexing: null,
  watching: { ok: true, since: SINCE.toISOString() },
  current: { ok: true },
};

const answers = (status: unknown = watched) => ({
  "vault.current": vault,
  "vault.status": status,
  "vault.kinds": [],
  "questions.list": empty,
  "globalCommand.destinations": { rows: [] },
});

/** Settings, once its section has rendered. */
async function settings() {
  return screen.findByRole("region", { name: "Settings" });
}

/** The value a row of the section states, by the row's label. */
function row(within_: HTMLElement, label: string): string {
  const term = within(within_).getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

/** ⌘,, from anywhere in the window. */
const pressSettingsChord = () =>
  fireEvent.keyDown(window, { key: ",", metaKey: true });

/** App ▸ Settings…, as the preload delivers it. */
const chooseSettingsFromMenu = () =>
  act(() => {
    window.dispatchEvent(new Event("vitrine:settings"));
  });

describe("Settings at #/settings: where the vault is", () => {
  it("states the folder, the App state folder, and since when outside changes have been seen", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    window.location.hash = "#/settings";
    renderApp(answers());
    const page = await settings();
    expect(page.querySelector("h1")?.textContent).toBe("Settings");
    expect(page.textContent).toContain("how consolidation-vault is arranged");
    const section = within(page).getByRole("region", {
      name: "Where the vault is",
    });
    expect(row(section, "Folder")).toContain(vault.path);
    expect(row(section, "App state")).toBe(
      "consolidation-vault/.vitrine — the one folder the app keeps for itself"
    );
    await vi.waitFor(() =>
      expect(row(section, "Outside changes")).toBe(
        "seen — watching since 08:40 today"
      )
    );
  });

  it("dates a watch that began on an earlier day", async () => {
    vi.useFakeTimers({
      now: new Date(2026, 8, 30, 9, 0),
      toFake: ["Date"],
    });
    window.location.hash = "#/settings";
    renderApp(answers());
    const section = within(await settings()).getByRole("region", {
      name: "Where the vault is",
    });
    await vi.waitFor(() =>
      expect(row(section, "Outside changes")).toBe(
        "seen — watching since 28 Sep 2026, 08:40"
      )
    );
  });

  it("states not watching without a second alarm: the footer sounds it, once", async () => {
    window.location.hash = "#/settings";
    renderApp(
      answers({
        indexing: null,
        watching: { ok: false, reason: "EMFILE: too many open files" },
        current: { ok: false, reason: "not watching: EMFILE" },
      })
    );
    const page = await settings();
    const section = within(page).getByRole("region", {
      name: "Where the vault is",
    });
    await vi.waitFor(() =>
      expect(row(section, "Outside changes")).toBe("not watching")
    );
    // The fact, with no glyph and no warm colour: the footer is where it is
    // raised, and a second alarm here would be two places that can drift.
    expect(section.textContent).not.toContain("‖");
    expect(section.querySelectorAll('[role="status"]')).toHaveLength(0);
    const footer = within(page).getByRole("contentinfo");
    expect(footer.textContent).toContain(
      "‖ not watching — EMFILE: too many open files · retry"
    );
    // Once in the whole window: the footer's line and nowhere else.
    expect(
      screen
        .getAllByRole("status")
        .filter((line) => line.textContent?.includes("not watching"))
    ).toHaveLength(1);
  });

  it("says the watch is not yet known while the core has not answered", async () => {
    window.location.hash = "#/settings";
    renderApp({
      ...answers(),
      "vault.status": () => new Promise(() => {}),
    });
    const section = within(await settings()).getByRole("region", {
      name: "Where the vault is",
    });
    expect(row(section, "Outside changes")).toBe("not yet");
  });

  it("reveals the vault's folder in Finder through the core", async () => {
    const reveal = vi.fn(() => null);
    window.location.hash = "#/settings";
    renderApp({ ...answers(), "vault.reveal": reveal });
    const page = await settings();
    fireEvent.click(
      within(page).getByRole("button", { name: "Reveal in Finder" })
    );
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledTimes(1));
  });

  it("holds no preference and no Credentials heading", async () => {
    window.location.hash = "#/settings";
    renderApp(answers());
    const page = await settings();
    // Every line is a statement: nothing here sets a value.
    expect(
      page.querySelectorAll("input, select, textarea, [role='switch']")
    ).toHaveLength(0);
    const headings = [...page.querySelectorAll("h2")].map((h) => h.textContent);
    expect(headings).toEqual(["Where the vault is"]);
    expect(page.textContent).not.toMatch(/credential|what it talks to/i);
  });
});

describe("the ways into Settings", () => {
  it("⌘, opens it from another surface, and back returns there", async () => {
    renderApp(answers());
    await screen.findByRole("region", { name: "Question Inbox" });
    pressSettingsChord();
    await settings();
    expect(window.location.hash).toBe("#/settings");
    act(() => window.history.back());
    await screen.findByRole("region", { name: "Question Inbox" });
  });

  it("the application menu's Settings… opens it", async () => {
    renderApp(answers());
    await screen.findByRole("region", { name: "Question Inbox" });
    chooseSettingsFromMenu();
    await settings();
    expect(window.location.hash).toBe("#/settings");
  });

  it("⌘, on Settings stays put rather than stacking another entry", async () => {
    renderApp(answers());
    await screen.findByRole("region", { name: "Question Inbox" });
    pressSettingsChord();
    await settings();
    const depth = window.history.length;
    // The menu's accelerator and the window's own chord can both fire for
    // one keypress in the shell; the second must be a no-op.
    pressSettingsChord();
    chooseSettingsFromMenu();
    expect(window.history.length).toBe(depth);
  });

  it("the gear on the vault's name opens it, and is drawn as current while it is open", async () => {
    renderApp(answers());
    const rail = await screen.findByRole("navigation", { name: "Surfaces" });
    expect(rail.textContent).toContain(vault.name);
    expect(rail.textContent).toContain(vault.path);
    const gear = within(rail).getByRole("link", { name: "Settings" });
    expect(gear.getAttribute("href")).toBe("#/settings");
    expect(gear.getAttribute("aria-current")).toBeNull();
    fireEvent.click(gear);
    window.location.hash = "#/settings";
    await settings();
    expect(
      within(rail)
        .getByRole("link", { name: "Settings" })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  it("⌘K offers Settings as a destination", async () => {
    renderApp(answers());
    await screen.findByRole("region", { name: "Question Inbox" });
    pressGlobalChord();
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "settings" } });
    // The capture row names what was typed too; the destination is the one
    // wearing the gear.
    await vi.waitFor(() =>
      expect(
        screen
          .getAllByRole("option")
          .some((o) => o.textContent?.startsWith("⚙"))
      ).toBe(true)
    );
    const option = screen
      .getAllByRole("option")
      .find((o) => o.textContent?.startsWith("⚙"))!;
    expect(option.textContent).toBe("⚙Settingssettings");
    fireEvent.mouseDown(option);
    await settings();
    expect(window.location.hash).toBe("#/settings");
  });

  it("nothing opens Settings on First run", async () => {
    renderApp({ ...answers(), "vault.current": null });
    await screen.findByRole("button", { name: "Open a vault" });
    pressSettingsChord();
    chooseSettingsFromMenu();
    expect(window.location.hash).not.toBe("#/settings");
    expect(screen.queryByRole("region", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});
