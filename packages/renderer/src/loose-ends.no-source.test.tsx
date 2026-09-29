import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Candidates, LooseEnds } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The no-Source row (#417; spec #416 stories 4, 5, 69): a PDF nothing names,
// under Unfinished reading, resolved by attaching it to a stub — narrowed
// to stubs — or marked deliberate. Create-a-Source arrives with the engine.

const ROW = {
  kind: "no-source" as const,
  subject: "sources/pdf/Rasch 2013.pdf",
  path: "sources/pdf/Rasch 2013.pdf",
  title: "Rasch 2013.pdf",
};

const ends = (): LooseEnds => ({
  problems: [],
  groups: [{ group: "Unfinished reading", rows: [ROW] }],
});

const STUBS: Candidates = {
  total: 1,
  rows: [
    {
      path: "sources/rasch2013.md",
      name: "rasch2013",
      kind: "source-stub",
      title: "Odor cues during slow-wave sleep",
      pdf: false,
    },
  ],
};

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
    "picker.candidates": STUBS,
    "looseEnds.rows": ends(),
    ...more,
  });
};

const row = async () => {
  const view = await screen.findByRole("region", { name: "Loose Ends" });
  return (await within(view).findAllByRole("listitem"))[0]!;
};

describe("the no-Source row", () => {
  it("names the file under Unfinished reading and says nothing names it", async () => {
    open();
    const item = await row();
    expect(within(item).getByText("Rasch 2013.pdf")).toBeDefined();
    expect(within(item).getByText("PDF · no Source")).toBeDefined();
    const group = screen.getByRole("region", { name: "Unfinished reading" });
    expect(within(group).getByText("1 item")).toBeDefined();
  });

  it("offers attach to a stub and mark deliberate, and no create yet", async () => {
    open();
    const item = await row();
    expect(
      within(item).getByRole("button", { name: "attach to a stub" })
    ).toBeDefined();
    expect(
      within(item).getByRole("button", { name: "mark deliberate" })
    ).toBeDefined();
    expect(
      within(item).queryByRole("button", { name: /create a source/i })
    ).toBeNull();
  });

  it("opens a picker narrowed to stubs, and attaches the PDF to the one chosen", async () => {
    const attach = vi.fn<(input: unknown) => unknown>(() => ({
      path: "sources/rasch2013.md",
      id: "s1",
    }));
    const seen = vi.fn<(input: unknown) => void>();
    open({
      "sources.attachToStub": attach,
      "picker.candidates": (input: unknown) => {
        seen(input);
        return STUBS;
      },
    });
    const item = await row();
    fireEvent.click(
      within(item).getByRole("button", { name: "attach to a stub" })
    );

    const picker = await screen.findByRole("dialog", {
      name: /attach to a stub/i,
    });
    fireEvent.click(await within(picker).findByRole("option"));

    await within(item).findByText(/attached to rasch2013/i);
    expect(attach).toHaveBeenCalledWith({
      pdf: "sources/pdf/Rasch 2013.pdf",
      stub: "sources/rasch2013.md",
    });
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ["source-stub"] })
    );
    // Nothing left to click once it is done: the vault has moved on.
    expect(
      within(item).queryByRole("button", { name: "attach to a stub" })
    ).toBeNull();
  });

  it("says what the core refused, on the row, and leaves it to try again", async () => {
    open({
      "sources.attachToStub": () => {
        throw new Error("sources/other.md already names sources/pdf/x.pdf.");
      },
    });
    const item = await row();
    fireEvent.click(
      within(item).getByRole("button", { name: "attach to a stub" })
    );
    const picker = await screen.findByRole("dialog", {
      name: /attach to a stub/i,
    });
    fireEvent.click(await within(picker).findByRole("option"));

    expect(await within(item).findByRole("alert")).toBeDefined();
    expect(
      within(item).getByRole("button", { name: "attach to a stub" })
    ).toBeDefined();
  });

  it("is marked deliberate by the row shell, keyed by the PDF's path, and undoable", async () => {
    const dismiss = vi.fn<(input: unknown) => void>();
    const undismiss = vi.fn<(input: unknown) => void>();
    open({
      "looseEnds.dismiss": (input: unknown) => {
        dismiss(input);
        return undefined;
      },
      "looseEnds.undismiss": (input: unknown) => {
        undismiss(input);
        return undefined;
      },
    });
    const item = await row();
    fireEvent.click(
      within(item).getByRole("button", { name: "mark deliberate" })
    );
    await within(item).findByText(/marked deliberate/);
    expect(dismiss).toHaveBeenCalledWith({
      subject: "sources/pdf/Rasch 2013.pdf",
      kind: "no-source",
    });
    fireEvent.click(within(item).getByRole("button", { name: "undo" }));
    await within(item).findByRole("button", { name: "mark deliberate" });
    expect(undismiss).toHaveBeenCalled();
  });
});
