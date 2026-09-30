import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ConflictCopy, LooseEnds, LooseEndRow } from "core";
import type { PdfMissing, UnlinkedAnnotations } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearIngest } from "./ingest-line";
import { empty, renderApp, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  clearIngest();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// The PDF folder's later rows in Loose Ends (#423; spec #416 stories 59–64,
// 68–69), against the fake core: what each row says, the call each
// resolution makes, and that a refusal is the core's own plain words.

const COPY: ConflictCopy = {
  kind: "conflict-copy",
  subject: "sources/pdf/rasch2013 2.pdf",
  path: "sources/pdf/rasch2013 2.pdf",
  title: "rasch2013 2.pdf",
  source: "sources/rasch2013.md",
  sourceTitle: "Odor cues during slow-wave sleep",
};

const MISSING: PdfMissing = {
  kind: "pdf-missing",
  subject: "src-1",
  path: "sources/rasch2013.md",
  title: "Odor cues during slow-wave sleep",
  file: "rasch2013.pdf",
  candidates: [
    { path: "sources/pdf/found.pdf", title: "found.pdf" },
    { path: "sources/pdf/other.pdf", title: "other.pdf" },
  ],
};

const UNLINKED: UnlinkedAnnotations = {
  kind: "unlinked-annotations",
  subject: "src-1",
  path: "sources/rasch2013.md",
  title: "Odor cues during slow-wave sleep",
  annotations: 4,
};

const ends = (group: LooseEnds["groups"][number]["group"], row: LooseEndRow) =>
  ({ problems: [], groups: [{ group, rows: [row] }] }) as LooseEnds;

const open = (rows: LooseEnds, more: Record<string, unknown> = {}) => {
  window.location.hash = "#/loose-ends";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "vault.pdfFault": null,
    "vault.kinds": [],
    "globalCommand.destinations": { rows: [] },
    "looseEnds.rows": rows,
    ...more,
  });
};

const row = async () => {
  const view = await screen.findByRole("region", { name: "Loose Ends" });
  return (await within(view).findAllByRole("listitem"))[0]!;
};

describe("a conflict copy row", () => {
  const openCopy = (more: Record<string, unknown> = {}) =>
    open(ends("Broken plumbing", COPY), more);

  it("names the copy and the Source it is a copy of, under Broken plumbing", async () => {
    openCopy();
    const r = await row();
    expect(within(r).getByText("rasch2013 2.pdf")).toBeDefined();
    expect(r.textContent).toContain("Odor cues during slow-wave sleep");
    expect(
      screen.getByRole("region", { name: "Broken plumbing" })
    ).toBeDefined();
  });

  it.each([
    ["use this copy", "use", /^The copy is the PDF now/],
    ["discard", "discard", /^The copy is in the Trash/],
  ])(
    "%s asks the core and says what it did",
    async (name, resolution, said) => {
      const call = vi.fn<(input: unknown) => unknown>(() => undefined);
      openCopy({ "sources.resolveConflict": call });
      const r = await row();
      fireEvent.click(within(r).getByRole("button", { name }));
      await within(r).findByText(said);
      expect(call).toHaveBeenCalledWith({
        copy: "sources/pdf/rasch2013 2.pdf",
        resolution,
      });
      expect(within(r).queryByRole("button")).toBeNull();
    }
  );

  it("shows a refusal on its row and keeps the choices", async () => {
    openCopy({
      "sources.resolveConflict": () => {
        throw new Error("That file is no longer a copy of a Source's PDF.");
      },
    });
    const r = await row();
    fireEvent.click(within(r).getByRole("button", { name: "discard" }));
    expect((await within(r).findByRole("alert")).textContent).toContain(
      "no longer a copy"
    );
    expect(within(r).getByRole("button", { name: "discard" })).toBeDefined();
  });

  it("can be marked deliberate", async () => {
    const dismiss = vi.fn<(input: unknown) => unknown>(() => undefined);
    openCopy({ "looseEnds.dismiss": dismiss });
    const r = await row();
    fireEvent.click(within(r).getByRole("button", { name: "mark deliberate" }));
    await within(r).findByText(/marked deliberate/);
    expect(dismiss).toHaveBeenCalledWith({
      subject: "sources/pdf/rasch2013 2.pdf",
      kind: "conflict-copy",
    });
  });
});

describe("a PDF missing row", () => {
  const openMissing = (more: Record<string, unknown> = {}) =>
    open(ends("Broken plumbing", MISSING), more);

  it("names the file and the Source, and the Source is a link", async () => {
    openMissing();
    const r = await row();
    expect(r.textContent).toContain("rasch2013.pdf");
    expect(
      within(r).getByRole("link", { name: "Odor cues during slow-wave sleep" })
    ).toBeDefined();
  });

  it("offers the PDFs no Source names to locate, and sends the chosen one", async () => {
    const call = vi.fn<(input: unknown) => unknown>(() => undefined);
    openMissing({ "sources.locate": call });
    const r = await row();
    fireEvent.click(within(r).getByRole("button", { name: "locate" }));
    const choices = within(r).getAllByRole("button", { name: /\.pdf$/ });
    expect(choices.map((c) => c.textContent)).toEqual([
      "found.pdf",
      "other.pdf",
    ]);
    fireEvent.click(choices[0]!);
    await within(r).findByText(/^Located/);
    expect(call).toHaveBeenCalledWith({
      source: "sources/rasch2013.md",
      pdf: "sources/pdf/found.pdf",
    });
  });

  it("says the core's plain refusal when the file is not the same document, and keeps the choices", async () => {
    openMissing({
      "sources.locate": () => {
        throw new Error("That file is not the same document.");
      },
    });
    const r = await row();
    fireEvent.click(within(r).getByRole("button", { name: "locate" }));
    fireEvent.click(within(r).getByRole("button", { name: "other.pdf" }));
    expect((await within(r).findByRole("alert")).textContent).toContain(
      "not the same document"
    );
    expect(within(r).getByRole("button", { name: "detach" })).toBeDefined();
  });

  it("cannot locate when the folder holds nothing to offer", async () => {
    open(ends("Broken plumbing", { ...MISSING, candidates: [] }));
    const r = await row();
    expect(
      within(r).getByRole("button", { name: "locate" }).hasAttribute("disabled")
    ).toBe(true);
  });

  it("detaches, and says the annotations and links are kept", async () => {
    const call = vi.fn<(input: unknown) => unknown>(() => undefined);
    openMissing({ "sources.detach": call });
    const r = await row();
    fireEvent.click(within(r).getByRole("button", { name: "detach" }));
    await within(r).findByText(/every link to them still resolves/);
    expect(call).toHaveBeenCalledWith({ source: "sources/rasch2013.md" });
  });
});

describe("an annotated Source that nothing links to", () => {
  const openUnlinked = (more: Record<string, unknown> = {}) =>
    open(ends("Disconnected material", UNLINKED), more);

  it("is under Disconnected material, counts its annotations and opens in the Reader", async () => {
    openUnlinked();
    const r = await row();
    expect(r.textContent).toContain("4 annotations");
    expect(
      screen.getByRole("region", { name: "Disconnected material" })
    ).toBeDefined();
    expect(
      within(r)
        .getByRole("link", { name: "open in the Reader" })
        .getAttribute("href")
    ).toBe("#/source/sources/rasch2013.md");
  });

  it("says a single annotation in the singular", async () => {
    open(ends("Disconnected material", { ...UNLINKED, annotations: 1 }));
    expect((await row()).textContent).toContain("One annotation");
  });

  it("can be marked deliberate", async () => {
    const dismiss = vi.fn<(input: unknown) => unknown>(() => undefined);
    openUnlinked({ "looseEnds.dismiss": dismiss });
    const r = await row();
    fireEvent.click(within(r).getByRole("button", { name: "mark deliberate" }));
    await within(r).findByText(/marked deliberate/);
    expect(dismiss).toHaveBeenCalledWith({
      subject: "src-1",
      kind: "unlinked-annotations",
    });
  });
});
