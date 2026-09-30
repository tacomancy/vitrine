import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import type { CoreEvent, LooseEnds, UnmatchedAnnotation } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearIngest } from "./ingest-line";
import { empty, renderApp, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  clearIngest();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Unmatched annotations in Loose Ends and the panel (#421; spec #416 stories
// 45–58), against the fake core: what the researcher reads on a row, the
// calls each resolution makes, and that the panel is the dashboard's rows.

const one = (
  block: string,
  quote: string,
  more: Partial<UnmatchedAnnotation> = {}
): UnmatchedAnnotation => ({
  kind: "unmatched-annotation",
  subject: `src-1/${block}`,
  path: "sources/rasch2013.md",
  title: "Odor cues during slow-wave sleep",
  annotation: `id-${block}`,
  block,
  page: 3,
  quote,
  links: [
    {
      path: "questions/why.md",
      title: "Why does the cue help?",
      kind: "question",
    },
    { path: "notes/plan.md", title: "plan", kind: null },
  ],
  candidates: [
    { ref: "held:0", page: 3, quote: "the odor cue helped" },
    { ref: "entry:x", page: 5, quote: "another passage" },
  ],
  ...more,
});

const H2 = one("h2", "the effect was reliable");

const ends = (...rows: LooseEnds["groups"][number]["rows"]): LooseEnds => ({
  problems: [],
  groups: [{ group: "Broken plumbing", rows }],
});

const answers = (more: Record<string, unknown> = {}) => ({
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
  "looseEnds.rows": ends(H2),
  ...more,
});

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = "#/loose-ends";
  return renderApp(answers(more));
};

const list = async () => {
  const view = await screen.findByRole("region", { name: "Loose Ends" });
  return await within(view).findAllByRole("listitem");
};

describe("an Unmatched annotation row", () => {
  it("shows the quote as it was, the page and what linked to it, under Broken plumbing", async () => {
    open();
    const [row] = await list();
    expect(within(row!).getByText("“the effect was reliable”")).toBeDefined();
    expect(row!.textContent).toContain("p.3");
    expect(
      within(row!).getByRole("link", { name: "Why does the cue help?" })
    ).toBeDefined();
    // A Note has no Address yet: named, not linked.
    expect(row!.textContent).toContain("plan");
    expect(within(row!).queryByRole("link", { name: "plan" })).toBeNull();
    expect(
      screen.getByRole("region", { name: "Broken plumbing" })
    ).toBeDefined();
    expect(screen.queryByText(/total/i)).toBeNull();
  });

  it.each([
    ["drop the links", "unmatched.dropLinks", /^Gone/],
    ["treat as new", "unmatched.treatAsNew", /^Treated as new/],
  ])(
    "%s calls the core with the annotation and says what it did",
    async (name, procedure, said) => {
      const call = vi.fn<(input: unknown) => unknown>(() => undefined);
      open({ [procedure]: call });
      const [row] = await list();
      fireEvent.click(within(row!).getByRole("button", { name }));
      await within(row!).findByText(said);
      expect(call).toHaveBeenCalledWith({
        source: "sources/rasch2013.md",
        annotations: ["id-h2"],
      });
      // Resolved: nothing left to press, and no undo to offer.
      expect(within(row!).queryByRole("button")).toBeNull();
    }
  );

  it("relink offers the candidates in the order the core ranked them and names the chosen one", async () => {
    const call = vi.fn<(input: unknown) => unknown>(() => undefined);
    open({ "unmatched.relink": call });
    const [row] = await list();
    fireEvent.click(within(row!).getByRole("button", { name: "relink" }));
    const choices = within(row!).getAllByRole("button", { name: /^p\.\d · “/ });
    expect(choices.map((c) => c.textContent)).toEqual([
      "p.3 · “the odor cue helped”",
      "p.5 · “another passage”",
    ]);
    fireEvent.click(choices[1]!);
    await within(row!).findByText(/^Relinked/);
    expect(call).toHaveBeenCalledWith({
      source: "sources/rasch2013.md",
      annotation: "id-h2",
      candidate: "entry:x",
    });
  });

  it("cannot relink when the file offers nothing, and says why it is here when nothing links to it", async () => {
    open({
      "looseEnds.rows": ends(one("h2", "twin", { links: [], candidates: [] })),
    });
    const [row] = await list();
    expect(
      within(row!)
        .getByRole("button", { name: "relink" })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(within(row!).getByText(/could not be told apart/)).toBeDefined();
  });

  it("shows a refusal as a line on its row and keeps the choices", async () => {
    open({
      "unmatched.dropLinks": () => {
        throw new Error("That annotation is no longer waiting for a decision.");
      },
    });
    const [row] = await list();
    fireEvent.click(
      within(row!).getByRole("button", { name: "drop the links" })
    );
    expect((await within(row!).findByRole("alert")).textContent).toContain(
      "no longer waiting"
    );
    expect(
      within(row!).getByRole("button", { name: "drop the links" })
    ).toBeDefined();
  });

  it("mark deliberate removes it from the count and offers undo while on screen", async () => {
    const dismiss = vi.fn<(input: unknown) => unknown>(() => undefined);
    const undismiss = vi.fn<(input: unknown) => unknown>(() => undefined);
    open({ "looseEnds.dismiss": dismiss, "looseEnds.undismiss": undismiss });
    const [row] = await list();
    fireEvent.click(
      within(row!).getByRole("button", { name: "mark deliberate" })
    );
    await within(row!).findByText(/marked deliberate/);
    expect(dismiss).toHaveBeenCalledWith({
      subject: "src-1/h2",
      kind: "unmatched-annotation",
    });
    fireEvent.click(within(row!).getByRole("button", { name: "undo" }));
    await within(row!).findByRole("button", { name: "mark deliberate" });
    expect(undismiss).toHaveBeenCalledTimes(1);
  });
});

describe("a document-changed group", () => {
  const group = {
    kind: "document-changed" as const,
    subject: "src-1/document-changed/2026-09-29T10:00:00Z",
    path: "sources/rasch2013.md",
    title: "Odor cues during slow-wave sleep",
    at: "2026-09-29T10:00:00Z",
    annotations: [H2, one("h4", "a second passage")],
  };
  const openGroup = (more: Record<string, unknown> = {}) =>
    open({ "looseEnds.rows": ends(group), ...more });

  it("is one row with a count, its annotations beneath it", async () => {
    openGroup();
    const rows = await list();
    const [head] = rows;
    expect(head!.textContent).toContain(
      "document changed · 2 could not be re-matched"
    );
    expect(
      within(head!).getByText(/p\.3 · “the effect was reliable”/)
    ).toBeDefined();
    expect(within(head!).getByText(/p\.3 · “a second passage”/)).toBeDefined();
  });

  it("asks once, then applies a batch to the whole group in one call", async () => {
    const call = vi.fn<(input: unknown) => unknown>(() => undefined);
    openGroup({ "unmatched.dropLinks": call });
    const [head] = await list();
    // The group's own button comes after its annotations' in the row.
    fireEvent.click(
      within(head!).getAllByRole("button", { name: "drop the links" }).at(-1)!
    );
    // Nothing has been done: the question is the only thing that happened.
    expect(call).not.toHaveBeenCalled();
    expect(within(head!).getByText(/drop the links on all 2\?/)).toBeDefined();
    fireEvent.click(within(head!).getByRole("button", { name: "yes, all 2" }));
    await within(head!).findByText(/^Gone/);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith({
      source: "sources/rasch2013.md",
      annotations: ["id-h2", "id-h4"],
    });
  });

  it("can be called off before it is asked", async () => {
    const call = vi.fn<(input: unknown) => unknown>(() => undefined);
    openGroup({ "unmatched.treatAsNew": call });
    const [head] = await list();
    fireEvent.click(
      within(head!).getAllByRole("button", { name: "treat as new" }).at(-1)!
    );
    fireEvent.click(within(head!).getByRole("button", { name: "cancel" }));
    expect(call).not.toHaveBeenCalled();
  });

  it("offers relink only on each annotation, never for the group", async () => {
    openGroup();
    const [head] = await list();
    // One per annotation, none at the group's own level.
    expect(
      within(head!).getAllByRole("button", { name: "relink" })
    ).toHaveLength(2);
    const groupActions = head!.querySelector(":scope > div:last-child")!;
    expect(
      within(groupActions as HTMLElement).queryByRole("button", {
        name: "relink",
      })
    ).toBeNull();
  });
});

describe("the panel", () => {
  const landed = (unmatched: number): CoreEvent => ({
    type: "ingestLanded",
    runId: "r1",
    summary: { new: 1, questions: 0, removed: 0, unmatched },
    sources: [],
  });

  it("opens from the footer line when something could not be re-matched, over the same rows", async () => {
    const { stream } = renderApp(answers());
    await screen.findByRole("region", { name: "Question Inbox" });
    act(() => stream.push(landed(1)));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "1 new · 0 questions · 0 removed · 1 could not be re-matched",
      })
    );
    const panel = await screen.findByRole("dialog", {
      name: "Could not be re-matched",
    });
    const item = await within(panel).findByText("“the effect was reliable”");
    expect(item).toBeDefined();
    // The same resolutions the dashboard has.
    for (const name of [
      "relink",
      "drop the links",
      "treat as new",
      "mark deliberate",
    ]) {
      expect(within(panel).getByRole("button", { name })).toBeDefined();
    }
    fireEvent.click(within(panel).getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has nothing to open when the run left nothing unmatched", async () => {
    const { stream } = renderApp(answers());
    await screen.findByRole("region", { name: "Question Inbox" });
    act(() => stream.push(landed(0)));
    await screen.findByText(
      "1 new · 0 questions · 0 removed · 0 could not be re-matched"
    );
    expect(
      screen.queryByRole("button", { name: /could not be re-matched/ })
    ).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape", async () => {
    const { stream } = renderApp(answers());
    await screen.findByRole("region", { name: "Question Inbox" });
    act(() => stream.push(landed(1)));
    fireEvent.click(
      await screen.findByRole("button", { name: /could not be re-matched/ })
    );
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
