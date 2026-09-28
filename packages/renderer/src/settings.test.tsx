import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import type { PdfFolder, VaultStatus } from "core";
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

/** A plain `sources/pdf` with nothing in it: a fresh vault. */
const fresh: PdfFolder = {
  exists: true,
  link: null,
  resolves: { path: `${vault.path}/sources/pdf`, known: null },
  holds: { count: 0, bytes: 0 },
  lastArrived: null,
};

const answers = (status: unknown = watched, pdfFolder: unknown = fresh) => ({
  "vault.current": vault,
  "vault.status": status,
  "vault.pdfFolder": pdfFolder,
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
    const reveal = vi.fn<(input: unknown) => null>(() => null);
    window.location.hash = "#/settings";
    renderApp({ ...answers(), "vault.reveal": reveal });
    const section = within(await settings()).getByRole("region", {
      name: "Where the vault is",
    });
    fireEvent.click(
      within(section).getByRole("button", { name: "Reveal in Finder" })
    );
    await vi.waitFor(() =>
      expect(reveal).toHaveBeenCalledWith({ folder: "vault" })
    );
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
    expect(headings).toEqual(["Where the vault is", "Where the PDFs are"]);
    expect(page.textContent).not.toMatch(/credential|what it talks to/i);
  });
});

// *Where the PDFs are* (#378; spec #363 stories 18–27; prototype 13 states
// 1 and 2). Every row is a fact the researcher can check in Finder; the
// one row that can say *nothing is there* says it as a claim, with its
// Warrant (ADR 0032).
describe("Settings: where the PDFs are", () => {
  /** The PDF section, once Settings has rendered. */
  async function pdfSection() {
    return within(await settings()).getByRole("region", {
      name: "Where the PDFs are",
    });
  }

  it("states a link into iCloud Drive: where it points, what it resolves to, what it holds, and the last arrival", async () => {
    const icloud =
      "/Users/r/Library/Mobile Documents/com~apple~CloudDocs/Papers";
    window.location.hash = "#/settings";
    renderApp(
      answers(watched, {
        exists: true,
        link: icloud,
        resolves: { path: icloud, known: "iCloud Drive › Papers" },
        holds: { count: 412, bytes: 1_843_200_000 },
        lastArrived: {
          at: new Date(2026, 8, 27, 16, 40).toISOString(),
          name: "walker-2017-spindle-coupling.pdf",
        },
      } satisfies PdfFolder)
    );
    const section = await pdfSection();
    await vi.waitFor(() =>
      expect(row(section, "Resolves to")).toBe("iCloud Drive › Papers")
    );
    expect(row(section, "Folder")).toContain("consolidation-vault/sources/pdf");
    expect(row(section, "Folder")).toContain(`a link, pointing at ${icloud}`);
    expect(row(section, "Holds")).toBe("412 PDFs · 1.84 GB");
    expect(row(section, "Last arrived")).toContain("27 Sep 2026, 16:40");
    expect(row(section, "Last arrived")).toContain(
      "walker-2017-spindle-coupling.pdf"
    );
  });

  it("prints a link's resolved path in full when it is under no known root", async () => {
    window.location.hash = "#/settings";
    renderApp(
      answers(watched, {
        ...fresh,
        link: "../../papers",
        resolves: { path: "/Volumes/Archive/papers", known: null },
        holds: { count: 1, bytes: 812_000 },
        lastArrived: { at: new Date(2026, 8, 1).toISOString(), name: "a.pdf" },
      } satisfies PdfFolder)
    );
    const section = await pdfSection();
    await vi.waitFor(() =>
      expect(row(section, "Resolves to")).toBe("/Volumes/Archive/papers")
    );
    expect(row(section, "Holds")).toBe("1 PDF · 812 KB");
  });

  it("says a fresh, plain, empty folder has had nothing arrive, as a claim with its Warrant", async () => {
    window.location.hash = "#/settings";
    renderApp(answers());
    const section = await pdfSection();
    await vi.waitFor(() =>
      expect(row(section, "Holds")).toBe(
        "Nothing has arrived yet.read in full · watching"
      )
    );
    expect(row(section, "Resolves to")).toBe(
      "itself — a plain folder in the vault"
    );
    expect(row(section, "Folder")).not.toContain("a link");
    // Nothing has arrived, so there is no last arrival to state.
    expect(within(section).queryByText("Last arrived")).toBeNull();
    // Not a fault: no warning glyph anywhere in the section.
    expect(section.textContent).not.toContain("‖");
  });

  it("says not yet for what depends on the read while the vault is being read", async () => {
    window.location.hash = "#/settings";
    renderApp(
      answers({
        indexing: { done: 10, total: 400 },
        watching: { ok: true, since: SINCE.toISOString() },
        current: { ok: false, reason: "the index is being built" },
      })
    );
    const section = await pdfSection();
    await vi.waitFor(() => expect(row(section, "Holds")).toBe("not yet"));
    expect(row(section, "Resolves to")).toBe("not yet");
    expect(section.textContent).not.toContain("Nothing has arrived yet.");
  });

  it("gives a vault with no sources/pdf its own true sentence, not a fault", async () => {
    window.location.hash = "#/settings";
    renderApp(answers(watched, { exists: false } satisfies PdfFolder));
    const section = await pdfSection();
    await vi.waitFor(() =>
      expect(row(section, "Folder")).toContain(
        "This vault has no sources/pdf yet."
      )
    );
    expect(within(section).queryByText("Resolves to")).toBeNull();
    expect(within(section).queryByText("Holds")).toBeNull();
    expect(section.textContent).not.toContain("‖");
    // Nothing to show in Finder, and nothing here offers to make it.
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
  });

  it("offers Reveal in Finder as its only control, and says the arrangement is changed in Finder", async () => {
    const reveal = vi.fn<(input: unknown) => null>(() => null);
    window.location.hash = "#/settings";
    renderApp({ ...answers(), "vault.reveal": reveal });
    const section = await pdfSection();
    const buttons = await within(section).findAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Reveal in Finder"]);
    expect(section.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(section.textContent).toContain(
      "The app never moves a file here and has no sync setting: whatever syncs your files syncs this folder. Change the arrangement in Finder."
    );
    fireEvent.click(buttons[0]!);
    await vi.waitFor(() =>
      expect(reveal).toHaveBeenCalledWith({ folder: "pdfs" })
    );
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
