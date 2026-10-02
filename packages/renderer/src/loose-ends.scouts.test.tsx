import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { LooseEnds } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The three rows beat 6 adds (#453; spec #447 stories 82–89): a failed
// Scout and an unreadable Scout file under Broken plumbing, a stub with no
// PDF under Unfinished reading.

const SENTENCE = "arXiv could not be reached, so nothing was checked.";

const FAILED = {
  kind: "failed-scout" as const,
  subject: "sleep",
  path: ".vitrine/scouts/sleep.yaml",
  title: "Sleep and memory",
  errorKind: "network" as const,
  sentence: SENTENCE,
};
const FILE = {
  kind: "unreadable-scout" as const,
  subject: "broken.yaml",
  path: ".vitrine/scouts/broken.yaml",
  title: "broken.yaml",
  sentence: "This file could not be read: line 1 is not valid YAML.",
};
const STUB = {
  kind: "stub-without-pdf" as const,
  subject: "sources/klinzing2019.md",
  path: "sources/klinzing2019.md",
  title: "Mechanisms of systems memory consolidation during sleep",
};

const ends = (): LooseEnds => ({
  problems: [],
  groups: [
    { group: "Broken plumbing", rows: [FAILED, FILE] },
    { group: "Unfinished reading", rows: [STUB] },
  ],
});

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = "#/loose-ends";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "looseEnds.rows": ends(),
    ...more,
  });
};

const rowFor = async (title: string) => {
  const view = await screen.findByRole("region", { name: "Loose Ends" });
  const items = await within(view).findAllByRole("listitem");
  return items.find((li) => within(li).queryByText(title) !== null)!;
};

describe("the failed Scout row", () => {
  it("shows the core's sentence and the error kind, with run now, pause and open", async () => {
    open();
    const item = await rowFor("Sleep and memory");
    expect(within(item).getByText(SENTENCE)).toBeDefined();
    expect(within(item).getByText("scout · network")).toBeDefined();
    for (const name of ["run now", "pause"]) {
      expect(within(item).getByRole("button", { name })).toBeDefined();
    }
    expect(within(item).getByRole("link", { name: "open" })).toBeDefined();
    expect(
      within(item).queryByRole("button", { name: "mark deliberate" })
    ).toBeNull();
  });

  it("runs the Scout and pauses it by id", async () => {
    const run = vi.fn<(input: unknown) => unknown>(() => ({}));
    const pause = vi.fn<(input: unknown) => unknown>(() => undefined);
    open({ "scouts.runNow": run, "scouts.pause": pause });
    const item = await rowFor("Sleep and memory");
    fireEvent.click(within(item).getByRole("button", { name: "run now" }));
    fireEvent.click(within(item).getByRole("button", { name: "pause" }));
    await vi.waitFor(() => expect(pause).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ scoutId: "sleep" });
    expect(pause).toHaveBeenCalledWith({ scoutId: "sleep" });
  });
});

describe("the unreadable Scout file row", () => {
  it("names the file and offers open only", async () => {
    open();
    const item = await rowFor("broken.yaml");
    expect(within(item).getByText(FILE.sentence)).toBeDefined();
    expect(within(item).queryAllByRole("button")).toEqual([]);
    expect(within(item).getByRole("link", { name: "open" })).toBeDefined();
  });
});

describe("the stub without a PDF row", () => {
  it("offers attach to a stub and mark deliberate, and counts per group", async () => {
    open();
    const item = await rowFor(STUB.title);
    expect(
      within(item).getByRole("button", { name: "attach to a stub" })
    ).toBeDefined();
    expect(
      within(item).getByRole("button", { name: "mark deliberate" })
    ).toBeDefined();
    const group = screen.getByRole("region", { name: "Unfinished reading" });
    expect(within(group).getByText("1 item")).toBeDefined();
  });

  it("attaches the chosen PDF to this stub", async () => {
    const attach = vi.fn<(input: unknown) => unknown>(() => ({}));
    open({
      "sources.unnamedPdfs": ["sources/pdf/Klinzing 2019.pdf"],
      "sources.attachToStub": attach,
    });
    const item = await rowFor(STUB.title);
    fireEvent.click(
      within(item).getByRole("button", { name: "attach to a stub" })
    );
    fireEvent.click(
      await within(item).findByRole("button", { name: "Klinzing 2019.pdf" })
    );
    await vi.waitFor(() =>
      expect(attach).toHaveBeenCalledWith({
        pdf: "sources/pdf/Klinzing 2019.pdf",
        stub: "sources/klinzing2019.md",
      })
    );
  });
});
