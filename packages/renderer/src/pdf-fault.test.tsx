import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import type { PdfFault, PdfFolder, VaultStatus } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, question, renderApp, rows, vault } from "./fake-core";

// A PDF folder that does not resolve (#379; spec #363 stories 28–36;
// prototype 13, state 3): stated on Settings in the *wrong* Voice, sounded
// in the footer channel on every surface as *papers not arriving* with
// *check again*, and gone from both the moment it resolves.

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

const watched: VaultStatus = {
  indexing: null,
  watching: { ok: true, since: new Date(2026, 8, 28, 8, 40).toISOString() },
  current: { ok: true },
};

const targetGone: PdfFault = {
  kind: "target-gone",
  reason: "the PDF folder is a link to a folder that no longer exists",
  resolvesTo: "nothing — the link's target no longer exists",
};

const broken: PdfFolder = {
  exists: true,
  link: "~/Dropbox/Papers",
  resolves: null,
  holds: null,
  lastArrived: {
    at: new Date(2026, 8, 19, 8, 2).toISOString(),
    name: "ramirez-2024-glymphatic-flow.pdf",
    beforeFault: true,
  },
  fault: targetGone,
};

const resolved: PdfFolder = {
  exists: true,
  link: "~/Dropbox/Papers",
  resolves: { path: "/Users/r/Dropbox/Papers", known: "Dropbox › Papers" },
  holds: { count: 3, bytes: 3_000_000 },
  lastArrived: {
    at: new Date(2026, 8, 28, 9, 0).toISOString(),
    name: "lee-2019.pdf",
    beforeFault: false,
  },
  fault: null,
};

const answers = (
  pdfFolder: unknown,
  status: unknown = watched
): Record<string, unknown> => ({
  "vault.current": vault,
  "vault.status": status,
  "vault.pdfFolder": pdfFolder,
  "vault.kinds": [],
  "questions.list": empty,
  "globalCommand.destinations": { rows: [] },
});

function row(section: HTMLElement, label: string): string {
  const term = within(section).getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

async function pdfSection() {
  const settings = await screen.findByRole("region", { name: "Settings" });
  return within(settings).getByRole("region", { name: "Where the PDFs are" });
}

const FOOTER_LINE =
  "‖ papers not arriving — the PDF folder is a link to a folder that no longer exists · check again";

describe("Settings with a link whose target is gone", () => {
  it("states the fault on Resolves to, not known on Holds, and the last arrival before it stopped resolving", async () => {
    window.location.hash = "#/settings";
    renderApp(answers(broken));
    const section = await pdfSection();
    await vi.waitFor(() =>
      expect(row(section, "Resolves to")).toBe(
        "‖ nothing — the link's target no longer exists"
      )
    );
    expect(row(section, "Holds")).toBe("‖ not known");
    expect(row(section, "Last arrived")).toContain("19 Sep 2026, 08:02");
    expect(row(section, "Last arrived")).toContain(
      "ramirez-2024-glymphatic-flow.pdf · the last before it stopped resolving"
    );
    // The path stays a fact on the Folder row; the reason never carries it.
    expect(row(section, "Folder")).toContain(
      "a link, pointing at ~/Dropbox/Papers"
    );
    expect(row(section, "Resolves to")).not.toContain("Dropbox");
    // A state the app is in, never an interruption (ADR 0033).
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sounds it in the footer channel too, with check again", async () => {
    window.location.hash = "#/settings";
    renderApp(answers(broken));
    await pdfSection();
    const footer = await screen.findByRole("contentinfo");
    await vi.waitFor(() => expect(footer.textContent).toContain(FOOTER_LINE));
  });

  it("renders each fault's own words: a link to a file", async () => {
    window.location.hash = "#/settings";
    renderApp(
      answers({
        ...broken,
        lastArrived: null,
        fault: {
          kind: "not-a-folder",
          reason: "the PDF folder leads to a file, not a folder",
          resolvesTo: "a file, not a folder",
        },
      } satisfies PdfFolder)
    );
    const section = await pdfSection();
    await vi.waitFor(() =>
      expect(row(section, "Resolves to")).toBe("‖ a file, not a folder")
    );
    expect(within(section).queryByText("Last arrived")).toBeNull();
    expect((await screen.findByRole("contentinfo")).textContent).toContain(
      "‖ papers not arriving — the PDF folder leads to a file, not a folder"
    );
  });
});

describe("the footer channel on another surface", () => {
  it("shows papers not arriving when the fault is pushed, and removes it when it clears", async () => {
    let folder: PdfFolder = resolved;
    const { stream } = renderApp({
      ...answers(() => folder),
      "questions.list": {
        ...empty,
        questions: [question("A question", "2026-09-19T08:00:00Z")],
      },
    });
    // The Inbox, where the window opens: nothing here is about PDFs.
    await rows();
    expect(document.body.textContent).not.toContain("papers not arriving");

    folder = broken;
    act(() => stream.push({ type: "pdfFolder", fault: targetGone }));
    const footer = await screen.findByRole("contentinfo");
    await vi.waitFor(() => expect(footer.textContent).toContain(FOOTER_LINE));

    folder = resolved;
    act(() => stream.push({ type: "pdfFolder", fault: null }));
    await vi.waitFor(() =>
      expect(document.body.textContent).not.toContain("papers not arriving")
    );
  });

  it("check again runs the sweep, and the line goes once the link resolves", async () => {
    let folder: PdfFolder = broken;
    const sweep = vi.fn(() => {
      folder = resolved;
      return null;
    });
    renderApp({ ...answers(() => folder), "vault.sweep": sweep });
    const again = await screen.findByRole("button", { name: "check again" });
    fireEvent.click(again);
    await vi.waitFor(() => {
      expect(sweep).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).not.toContain("papers not arriving");
    });
  });

  it("stands beside Not watching when both are true", async () => {
    renderApp(
      answers(broken, {
        indexing: null,
        watching: { ok: false, reason: "EMFILE: too many open files" },
        current: { ok: false, reason: "not watching: EMFILE" },
      })
    );
    const footer = await screen.findByRole("contentinfo");
    await vi.waitFor(() => {
      expect(footer.textContent).toContain(
        "‖ not watching — EMFILE: too many open files · retry"
      );
      expect(footer.textContent).toContain(FOOTER_LINE);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
