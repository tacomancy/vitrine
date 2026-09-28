import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { HypothesisPage, Revision } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The claim and design notes edited in place (#333; spec #327 stories 16,
// 17, 19, 53, 54, 86, 88, 90): each a plain text field like the Working
// answer — blur saves, ⌘↵ saves, ⌥↵ saves and opens a why, esc reverts —
// saved through the core, which records the Revision; a save landing on a
// section changed underneath is the *changed on disk* line, and any other
// refusal is a line with its reason.

const PATH = "hypotheses/Slow-wave density predicts recall gain.md";
const HASH =
  "#/hypothesis/hypotheses/Slow-wave%20density%20predicts%20recall%20gain.md";
const CLAIM = "Slow-wave density during the nap predicts next-day recall gain.";
const RECORDED = "2026-09-29T10:00:00+02:00";

type Readable = Extract<HypothesisPage, { readable: true }>;

const revision = (
  at: string,
  field: string,
  why: string | null = null
): Revision => ({ at, field, why, from: "" });

const page = (
  over: {
    claim?: string;
    notes?: string;
    entries?: Revision[];
    hash?: string;
  } = {}
): Readable => ({
  readable: true,
  path: PATH,
  hash: over.hash ?? "abc",
  frontmatter: {
    id: "hy4k8m2p9q",
    promotedFrom: "[[Does slow-wave density predict recall gain]]",
    promoted: "2026-09-28T10:00:00+02:00",
    context: "reading",
    tags: [],
  },
  sections: {
    claim: { present: true, text: over.claim ?? CLAIM },
    criteria: { present: true, criteria: [] },
    designNotes: { present: true, text: over.notes ?? "" },
    positionHistory: {
      present: true,
      text: "…",
      entries: over.entries ?? [revision("2026-09-28T10:00:00+02:00", "claim")],
    },
  },
  derivation: {
    state: "inconclusive",
    effective: "inconclusive",
    override: null,
    unlanded: [],
    clause: "noCriteria",
    named: [],
    census: { met: 0, notMet: 0, inconclusive: 0, awaiting: 0 },
  },
  overridable: false,
  loop: {
    status: "open",
    parent: {
      path: "questions/Does slow-wave density predict recall gain.md",
      kind: "question",
    },
    refusal:
      "A criterion still awaits evidence: not yet tested is not an answer.",
    result: "inconclusive",
  },
  problems: [],
});

const saved = { written: true, hash: "def", shape: [], revision: RECORDED };

const open = (
  current: () => HypothesisPage,
  more: Record<string, unknown> = {}
) => {
  window.location.hash = HASH;
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "hypotheses.page": current,
    "hypotheses.savePosition": () => saved,
    "picker.candidates": { rows: [], total: 0 },
    ...more,
  });
};

const region = () => screen.findByRole("region", { name: "Hypothesis view" });
const claimField = async () =>
  within(await region()).findByRole("textbox", { name: "Claim" });
const notesField = async () =>
  within(await region()).findByRole("textbox", { name: "Design notes" });

describe("the claim, edited in place", () => {
  it("shows the claim as a field, and blur saves it with the hash and the text the page read", async () => {
    const save = vi.fn(() => saved);
    open(() => page(), { "hypotheses.savePosition": save });
    const box = await claimField();
    expect((box as HTMLTextAreaElement).value).toBe(CLAIM);

    fireEvent.change(box, { target: { value: "Density predicts gain." } });
    fireEvent.blur(box);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        path: PATH,
        field: "claim",
        text: "Density predicts gain.",
        basedOn: "abc",
        was: CLAIM,
      })
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("⌘↵ saves at once, and a blur right after is the same save, not a second", async () => {
    const save = vi.fn(() => saved);
    open(() => page(), { "hypotheses.savePosition": save });
    const box = await claimField();
    fireEvent.change(box, { target: { value: "Density predicts gain." } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    fireEvent.blur(box);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it("esc reverts unsaved typing and saves nothing", async () => {
    const save = vi.fn(() => saved);
    open(() => page(), { "hypotheses.savePosition": save });
    const box = await claimField();
    fireEvent.change(box, { target: { value: "Half a thought." } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect((box as HTMLTextAreaElement).value).toBe(CLAIM);
    fireEvent.blur(box);
    await new Promise((r) => setTimeout(r, 10));
    expect(save).not.toHaveBeenCalled();
  });

  it("names its keys while it has the keyboard, and only then", async () => {
    open(() => page());
    const box = await claimField();
    const view = await region();
    expect(view.textContent).not.toContain("esc reverts");
    fireEvent.focus(box);
    expect(view.textContent).toContain("⌥↵ save with a note on what changed");
    fireEvent.blur(box);
    expect(view.textContent).not.toContain("esc reverts");
  });

  it("⌥↵ saves and opens the line for why, which writes onto the Revision that save recorded", async () => {
    const explain = vi.fn(() => ({ written: true, hash: "ghi", shape: [] }));
    open(() => page(), { "hypotheses.explainRevision": explain });
    const box = await claimField();
    fireEvent.change(box, { target: { value: "Density predicts gain." } });
    fireEvent.keyDown(box, { key: "Enter", altKey: true });

    const line = await screen.findByRole("textbox", { name: "Why" });
    fireEvent.change(line, { target: { value: "Encoding was the confound." } });
    fireEvent.keyDown(line, { key: "Enter" });
    await waitFor(() =>
      expect(explain).toHaveBeenCalledWith({
        path: PATH,
        at: RECORDED,
        field: "claim",
        why: "Encoding was the confound.",
        basedOn: "def",
      })
    );
  });

  it("a claim the core refuses is a line with its reason, and the typing stays", async () => {
    open(() => page(), {
      "hypotheses.savePosition": () => {
        throw new Error(
          "The claim is empty; a Hypothesis is never without one."
        );
      },
    });
    const box = await claimField();
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    const line = await within(await region()).findByText(
      /not saved — The claim is empty/
    );
    expect(line.getAttribute("role")).toBe("status");
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("a write the protocol refuses is a line with the reason", async () => {
    open(() => page(), {
      "hypotheses.savePosition": () => ({
        written: false,
        reason: "unreadable",
        detail: "missing from the vault",
        revision: null,
      }),
    });
    const box = await claimField();
    fireEvent.change(box, { target: { value: "Density predicts gain." } });
    fireEvent.blur(box);
    expect(
      await within(await region()).findByText(
        "not saved — missing from the vault"
      )
    ).toBeTruthy();
  });
});

describe("the design notes, edited the same way", () => {
  it("blur saves the design notes as their own field, and an empty section still says what belongs there", async () => {
    const save = vi.fn(() => saved);
    open(() => page(), { "hypotheses.savePosition": save });
    const view = await region();
    const section = await within(view).findByRole("region", {
      name: "Design notes",
    });
    expect(section.textContent).toContain("a paragraph, not a form");

    const box = await notesField();
    fireEvent.change(box, { target: { value: "Nap length held at 90." } });
    fireEvent.blur(box);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        path: PATH,
        field: "design notes",
        text: "Nap length held at 90.",
        basedOn: "abc",
        was: "",
      })
    );
  });
});

describe("changed on disk", () => {
  const conflict = {
    written: false,
    reason: "changedAndUnreapplyable",
    detail: "the section changed on disk since the page read it",
    revision: null,
  };

  it("shows keep mine and take the disk copy inside the section, suspends autosave, and keep mine saves over the disk copy", async () => {
    let current = page();
    const save = vi.fn((input: unknown) =>
      (input as { basedOn: string }).basedOn === "abc" ? conflict : saved
    );
    open(() => current, { "hypotheses.savePosition": save });
    const box = await claimField();
    fireEvent.change(box, { target: { value: "Typed." } });
    fireEvent.blur(box);

    const section = within(await region()).getByRole("region", {
      name: "Claim",
    });
    const line = await within(section).findByText("changed on disk");
    expect(line).toBeTruthy();
    // Autosave is suspended until one of the two is chosen.
    fireEvent.focus(box);
    fireEvent.blur(box);
    await new Promise((r) => setTimeout(r, 10));
    expect(save).toHaveBeenCalledTimes(1);

    current = page({ claim: "Obsidian narrowed this.", hash: "obs" });
    fireEvent.click(within(section).getByRole("button", { name: "keep mine" }));
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({
        path: PATH,
        field: "claim",
        text: "Typed.",
        basedOn: "obs",
        was: "Obsidian narrowed this.",
      })
    );
    await waitFor(() =>
      expect(within(section).queryByText("changed on disk")).toBeNull()
    );
  });

  it("take the disk copy lets the typing go and shows the file", async () => {
    let current = page();
    open(() => current, { "hypotheses.savePosition": () => conflict });
    const box = await notesField();
    fireEvent.change(box, { target: { value: "Typed." } });
    fireEvent.blur(box);
    const section = within(await region()).getByRole("region", {
      name: "Design notes",
    });
    await within(section).findByText("changed on disk");

    current = page({ notes: "Held: nap length.", hash: "obs" });
    fireEvent.click(
      within(section).getByRole("button", { name: "take the disk copy" })
    );
    await waitFor(() =>
      expect((box as HTMLTextAreaElement).value).toBe("Held: nap length.")
    );
    expect(within(section).queryByText("changed on disk")).toBeNull();
  });
});

describe("the history on the page", () => {
  it("the header says how many times the claim has been revised and since when, derived from the history", async () => {
    open(() =>
      page({
        entries: [
          revision("2026-09-29T11:00:00+02:00", "design notes"),
          revision("2026-09-29T10:00:00+02:00", "claim"),
          revision("2026-09-28T10:00:00+02:00", "claim"),
        ],
      })
    );
    await claimField();
    expect((await region()).textContent).toContain(
      "claim revision 2 of 2 · held since 29 September 2026"
    );
  });

  it("claim and design-note revisions read in one timeline, each named by its field", async () => {
    open(() =>
      page({
        entries: [
          revision(
            "2026-09-29T11:00:00+02:00",
            "design notes",
            "Montage fixed."
          ),
          revision("2026-09-28T10:00:00+02:00", "claim", "Promoted."),
        ],
      })
    );
    const history = await within(await region()).findByRole("region", {
      name: "Position history",
    });
    const text = history.textContent ?? "";
    expect(text.indexOf("Montage fixed.")).toBeLessThan(
      text.indexOf("Promoted.")
    );
    expect(text).toContain("design notes");
    expect(text).toContain("claim");
  });

  it("+ why on a quiet entry writes through the Hypothesis's own procedure, with [[ offered for a link", async () => {
    const explain = vi.fn(() => ({ written: true, hash: "ghi", shape: [] }));
    open(() => page(), { "hypotheses.explainRevision": explain });
    const history = await within(await region()).findByRole("region", {
      name: "Position history",
    });
    fireEvent.click(
      await within(history).findByRole("button", { name: /quiet/ })
    );
    fireEvent.click(within(history).getByRole("button", { name: "+ why" }));
    const line = await screen.findByRole("textbox", { name: "Why" });
    fireEvent.change(line, { target: { value: "[[" } });
    expect(await screen.findByRole("dialog", { name: /why/i })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog", { name: /why/i }), {
      key: "Escape",
    });
    fireEvent.change(line, { target: { value: "Sharpened after the pilot." } });
    fireEvent.keyDown(line, { key: "Enter" });
    await waitFor(() =>
      expect(explain).toHaveBeenCalledWith({
        path: PATH,
        at: "2026-09-28T10:00:00+02:00",
        field: "claim",
        why: "Sharpened after the pilot.",
        basedOn: "abc",
      })
    );
  });
});

describe("two fields stamped the same second", () => {
  it("+ why opens only the entry asked for, and names it by its field as well as its timestamp", async () => {
    const same = "2026-09-29T10:00:00+02:00";
    const explain = vi.fn(() => ({ written: true, hash: "ghi", shape: [] }));
    open(
      () =>
        page({
          entries: [revision(same, "design notes"), revision(same, "claim")],
        }),
      { "hypotheses.explainRevision": explain }
    );
    const history = await within(await region()).findByRole("region", {
      name: "Position history",
    });
    fireEvent.click(
      await within(history).findByRole("button", { name: /quiet/ })
    );
    const [, claimWhy] = within(history).getAllByRole("button", {
      name: "+ why",
    });
    fireEvent.click(claimWhy!);
    expect(screen.getAllByRole("textbox", { name: "Why" })).toHaveLength(1);
    const line = screen.getByRole("textbox", { name: "Why" });
    fireEvent.change(line, { target: { value: "Narrowed after the pilot." } });
    fireEvent.keyDown(line, { key: "Enter" });
    await waitFor(() =>
      expect(explain).toHaveBeenCalledWith({
        path: PATH,
        at: same,
        field: "claim",
        why: "Narrowed after the pilot.",
        basedOn: "abc",
      })
    );
  });
});

describe("an edit made in Obsidian", () => {
  it("appears in the field on the re-read the index's event prompts", async () => {
    let current = page();
    const { stream } = open(() => current);
    const box = await claimField();
    current = page({ claim: "Obsidian narrowed the claim.", hash: "obs" });
    act(() =>
      stream.push({
        type: "vaultChanged",
        changed: [PATH],
        removed: [],
        renamed: [],
      })
    );
    await waitFor(() =>
      expect((box as HTMLTextAreaElement).value).toBe(
        "Obsidian narrowed the claim."
      )
    );
  });
});
