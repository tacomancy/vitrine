import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CriterionRead, HypothesisPage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Criteria written from the page (#334; spec #327 stories 21, 26, 29–31):
// add one with a Relationship that must be chosen, record its Outcome,
// relabel it, reword it, delete it while nothing tests it. Every write is
// the core's — the page sends what it read and shows a refusal as a line on
// the criterion it was about.

const PATH = "hypotheses/Slow-wave density predicts recall gain.md";
const HASH =
  "#/hypothesis/hypotheses/Slow-wave%20density%20predicts%20recall%20gain.md";

type Readable = Extract<HypothesisPage, { readable: true }>;

const criterion = (over: Partial<CriterionRead> = {}): CriterionRead => ({
  id: "c1",
  label: "C1",
  text: "Recall gain tracks density across the sample",
  relationship: "confirming",
  outcome: null,
  outcomeUnreadable: null,
  evidence: [],
  editedAfterEvidence: [],
  ...over,
});

const page = (criteria: CriterionRead[] = [criterion()]): Readable => ({
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: { context: "reading", tags: [] },
  sections: {
    claim: { present: true, text: "Density predicts gain." },
    criteria: { present: true, criteria },
    designNotes: { present: true, text: "" },
    positionHistory: { present: true, text: "", entries: [] },
  },
  derivation: {
    state: "inconclusive",
    effective: "inconclusive",
    override: null,
    unlanded: [],
    clause: "nothingTested",
    named: [],
    census: { met: 0, notMet: 0, inconclusive: 0, awaiting: criteria.length },
  },
  overridable: false,
  loop: { status: "none", closable: false, result: "inconclusive" },
  problems: [],
});

const wrote = {
  written: true,
  hash: "def",
  shape: [],
  revision: "2026-09-29T10:00:00+02:00",
};

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
    "picker.candidates": { rows: [], total: 0 },
    ...more,
  });
};

const card = async (label: string) =>
  screen.findByRole("article", { name: `Criterion ${label}` });

describe("adding a criterion", () => {
  it("asks for the text and a relationship with none chosen, and will not add until one is (TEST-1)", async () => {
    const add = vi.fn(() => wrote);
    open(() => page([]), { "hypotheses.addCriterion": add });
    fireEvent.click(await screen.findByRole("button", { name: "+ criterion" }));

    const form = screen.getByRole("form", { name: "New criterion" });
    const text = within(form).getByRole("textbox", { name: "Criterion" });
    const radios = within(form).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      "confirming",
      "falsifying",
      "diagnostic",
    ]);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);

    fireEvent.change(text, { target: { value: "No gain when shuffled" } });
    const submit = within(form).getByRole("button", { name: "add" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(text, { key: "Enter" });
    expect(add).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByRole("radio", { name: "falsifying" }));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(text, { key: "Enter" });
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        path: PATH,
        text: "No gain when shuffled",
        relationship: "falsifying",
        basedOn: "abc",
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "New criterion" })).toBeNull()
    );
  });

  it("esc closes the form and writes nothing", async () => {
    const add = vi.fn(() => wrote);
    open(() => page([]), { "hypotheses.addCriterion": add });
    fireEvent.click(await screen.findByRole("button", { name: "+ criterion" }));
    const text = screen.getByRole("textbox", { name: "Criterion" });
    fireEvent.keyDown(text, { key: "Escape" });
    expect(screen.queryByRole("form", { name: "New criterion" })).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it("keeps the form and the typing when the core refuses, saying why", async () => {
    open(() => page([]), {
      "hypotheses.addCriterion": () => ({
        written: false,
        reason: "verificationFailed",
        detail: "shape problem introduced",
        revision: null,
      }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "+ criterion" }));
    const text = screen.getByRole("textbox", { name: "Criterion" });
    fireEvent.change(text, { target: { value: "Kept" } });
    fireEvent.click(screen.getByRole("radio", { name: "diagnostic" }));
    fireEvent.click(screen.getByRole("button", { name: "add" }));
    expect(
      await screen.findByText(
        /could not add the criterion: .*shape problem introduced/
      )
    ).toBeTruthy();
    expect((text as HTMLInputElement).value).toBe("Kept");
  });
});

describe("recording an outcome and changing a relationship", () => {
  it("records an outcome from the criterion's own control", async () => {
    const set = vi.fn(() => wrote);
    open(() => page(), { "hypotheses.setCriterionField": set });
    const c1 = await card("C1");
    const outcome = within(c1).getByRole("radiogroup", { name: "Outcome" });
    fireEvent.click(within(outcome).getByRole("radio", { name: "met" }));
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({
        path: PATH,
        id: "c1",
        field: "outcome",
        value: "met",
        basedOn: "abc",
      })
    );
  });

  it("shows the recorded outcome as the checked one, and none checked while awaiting evidence", async () => {
    open(() =>
      page([
        criterion(),
        criterion({ id: "c2", label: "C2", outcome: "not met" }),
      ])
    );
    const awaiting = within(await card("C1")).getByRole("radiogroup", {
      name: "Outcome",
    });
    expect(within(awaiting).queryByRole("radio", { checked: true })).toBeNull();
    const recorded = within(await card("C2")).getByRole("radiogroup", {
      name: "Outcome",
    });
    expect(
      within(recorded)
        .getByRole("radio", { checked: true })
        .getAttribute("value")
    ).toBe("not met");
  });

  it("changes the relationship", async () => {
    const set = vi.fn(() => wrote);
    open(() => page(), { "hypotheses.setCriterionField": set });
    const group = within(await card("C1")).getByRole("radiogroup", {
      name: "Relationship",
    });
    fireEvent.click(within(group).getByRole("radio", { name: "falsifying" }));
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({
        path: PATH,
        id: "c1",
        field: "relationship",
        value: "falsifying",
        basedOn: "abc",
      })
    );
  });

  it("shows a refusal as a line on the criterion it was about", async () => {
    open(() => page(), {
      "hypotheses.setCriterionField": () => ({
        written: false,
        reason: "changedAndUnreapplyable",
        detail: "no criterion carries ^c1",
        revision: null,
      }),
    });
    const c1 = await card("C1");
    fireEvent.click(
      within(within(c1).getByRole("radiogroup", { name: "Outcome" })).getByRole(
        "radio",
        { name: "inconclusive" }
      )
    );
    expect(
      await within(c1).findByText(
        /could not record it: .*no criterion carries \^c1/
      )
    ).toBeTruthy();
  });
});

describe("rewording a criterion", () => {
  it("edit opens the text; ↵ saves it against the text the page read", async () => {
    const edit = vi.fn(() => wrote);
    open(() => page(), { "hypotheses.editCriterion": edit });
    const c1 = await card("C1");
    fireEvent.click(within(c1).getByRole("button", { name: "edit" }));
    const box = within(c1).getByRole("textbox", { name: "Criterion C1" });
    expect((box as HTMLInputElement).value).toBe(
      "Recall gain tracks density across the sample"
    );
    fireEvent.change(box, {
      target: { value: "Gain tracks density within subjects" },
    });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith({
        path: PATH,
        id: "c1",
        text: "Gain tracks density within subjects",
        was: "Recall gain tracks density across the sample",
        basedOn: "abc",
      })
    );
  });

  it("esc puts the text back and writes nothing", async () => {
    const edit = vi.fn(() => wrote);
    open(() => page(), { "hypotheses.editCriterion": edit });
    const c1 = await card("C1");
    fireEvent.click(within(c1).getByRole("button", { name: "edit" }));
    const box = within(c1).getByRole("textbox", { name: "Criterion C1" });
    fireEvent.change(box, { target: { value: "Half a thought" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(within(c1).queryByRole("textbox")).toBeNull();
    expect(
      within(c1).getByText("Recall gain tracks density across the sample")
    ).toBeTruthy();
    expect(edit).not.toHaveBeenCalled();
  });
});

describe("deleting a criterion", () => {
  it("is offered while nothing tests the criterion, and deletes it", async () => {
    const del = vi.fn(() => wrote);
    open(() => page(), { "hypotheses.deleteCriterion": del });
    fireEvent.click(
      within(await card("C1")).getByRole("button", { name: "delete" })
    );
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith({ path: PATH, id: "c1", basedOn: "abc" })
    );
  });

  it("is not offered once evidence is under it", async () => {
    open(() =>
      page([
        criterion({
          evidence: [
            {
              text: "[[run-14]] — gain tracked density",
              link: {
                target: "run-14",
                blockId: null,
                resolution: "unresolved",
              },
              note: "gain tracked density",
            },
          ] as CriterionRead["evidence"],
        }),
      ])
    );
    const c1 = await card("C1");
    expect(within(c1).queryByRole("button", { name: "delete" })).toBeNull();
  });
});

// Edited after evidence (#335; TEST-5; spec #327 stories 32, 47–50): a
// tested criterion can still be reworded or relabelled, but the page says
// at the moment of editing that the change will be marked, and offers the
// honest alternative — a new criterion beside the old one. Once tested,
// *delete* gives way to *make diagnostic*. The mark, once written, stays on
// the criterion with the wording it replaced.
describe("a criterion with evidence under it", () => {
  const RUN = {
    text: "[[run-14]] — gain tracked density",
    link: { target: "run-14", blockId: null, resolution: "unresolved" },
    note: "gain tracked density",
  } as CriterionRead["evidence"][number];
  const tested = (over: Partial<CriterionRead> = {}) =>
    criterion({ evidence: [RUN], ...over });

  it("warns, when edit is opened, that the change will be marked — and neither blur nor the warning's alternative saves", async () => {
    const edit = vi.fn(() => wrote);
    open(() => page([tested()]), { "hypotheses.editCriterion": edit });
    const c1 = await card("C1");
    fireEvent.click(within(c1).getByRole("button", { name: "edit" }));
    const warning = within(c1).getByRole("note", {
      name: "Edited after evidence",
    });
    expect(warning.textContent).toMatch(/one line of evidence/);
    expect(warning.textContent).toMatch(
      /recorded as edited after evidence and shown on the criterion permanently/
    );
    const box = within(c1).getByRole("textbox", { name: "Criterion C1" });
    fireEvent.change(box, { target: { value: "Moved bar" } });
    fireEvent.blur(box);
    expect(edit).not.toHaveBeenCalled();

    fireEvent.click(
      within(warning).getByRole("button", { name: "save the edit" })
    );
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith({
        path: PATH,
        id: "c1",
        text: "Moved bar",
        was: "Recall gain tracks density across the sample",
        basedOn: "abc",
      })
    );
  });

  it("offers a new criterion instead: the edit closes unsaved and the new-criterion form opens with the typing, no relationship chosen", async () => {
    const edit = vi.fn(() => wrote);
    open(() => page([tested()]), { "hypotheses.editCriterion": edit });
    const c1 = await card("C1");
    fireEvent.click(within(c1).getByRole("button", { name: "edit" }));
    const box = within(c1).getByRole("textbox", { name: "Criterion C1" });
    fireEvent.change(box, { target: { value: "Gain within subjects" } });
    fireEvent.click(
      within(c1).getByRole("button", { name: "add a new criterion instead" })
    );

    expect(within(c1).queryByRole("textbox")).toBeNull();
    const form = screen.getByRole("form", { name: "New criterion" });
    const text = within(form).getByRole("textbox", { name: "Criterion" });
    expect((text as HTMLInputElement).value).toBe("Gain within subjects");
    expect(within(form).queryByRole("radio", { checked: true })).toBeNull();
    expect(edit).not.toHaveBeenCalled();
  });

  it("warns before relabelling it, writing only when the change is confirmed", async () => {
    const set = vi.fn(() => wrote);
    open(() => page([tested()]), { "hypotheses.setCriterionField": set });
    const c1 = await card("C1");
    fireEvent.click(
      within(
        within(c1).getByRole("radiogroup", { name: "Relationship" })
      ).getByRole("radio", { name: "falsifying" })
    );
    expect(set).not.toHaveBeenCalled();
    const warning = within(c1).getByRole("note", {
      name: "Edited after evidence",
    });
    fireEvent.click(
      within(warning).getByRole("button", { name: "make it falsifying" })
    );
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({
        path: PATH,
        id: "c1",
        field: "relationship",
        value: "falsifying",
        basedOn: "abc",
      })
    );
  });

  it("records an outcome without a warning — that is what evidence is for", async () => {
    const set = vi.fn(() => wrote);
    open(() => page([tested()]), { "hypotheses.setCriterionField": set });
    const c1 = await card("C1");
    fireEvent.click(
      within(within(c1).getByRole("radiogroup", { name: "Outcome" })).getByRole(
        "radio",
        { name: "met" }
      )
    );
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(within(c1).queryByRole("note")).toBeNull();
  });

  it("offers make diagnostic in place of delete, which takes it out of the rule by relabelling", async () => {
    const set = vi.fn(() => wrote);
    open(() => page([tested()]), { "hypotheses.setCriterionField": set });
    const c1 = await card("C1");
    expect(within(c1).queryByRole("button", { name: "delete" })).toBeNull();
    fireEvent.click(
      within(c1).getByRole("button", { name: "make diagnostic" })
    );
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({
        path: PATH,
        id: "c1",
        field: "relationship",
        value: "diagnostic",
        basedOn: "abc",
      })
    );
  });

  it("offers neither delete nor make diagnostic on a tested criterion that is already diagnostic", async () => {
    open(() => page([tested({ label: "D1", relationship: "diagnostic" })]));
    const d1 = await card("D1");
    expect(within(d1).queryByRole("button", { name: "delete" })).toBeNull();
    expect(
      within(d1).queryByRole("button", { name: "make diagnostic" })
    ).toBeNull();
  });

  it("carries the mark permanently, with the wording and relationship it replaced and the why when there is one", async () => {
    open(() =>
      page([
        tested({
          editedAfterEvidence: [
            {
              at: "2026-09-29T10:00:00+02:00",
              why: "the size distribution is bimodal",
              was: {
                text: "The effect shrinks monotonically",
                relationship: "confirming",
              },
            },
          ],
        }),
      ])
    );
    const mark = within(await card("C1")).getByRole("note", {
      name: "Edited after evidence",
    });
    expect(mark.textContent).toMatch(
      /edited 29 September 2026, after evidence/
    );
    expect(mark.textContent).toMatch(
      /was — “The effect shrinks monotonically” · confirming/
    );
    expect(mark.textContent).toMatch(/the size distribution is bimodal/);
  });
});

describe("the history of a criterion edited after evidence", () => {
  it("never collapses the entry into the quiet trail: it stands on its own, says no why was written, and offers one", async () => {
    const readable = page([criterion()]);
    readable.sections.positionHistory.entries = [
      {
        at: "2026-09-29T10:05:00+02:00",
        field: "criterion C1",
        why: null,
        from: "### Reworded ^c1",
      },
      {
        at: "2026-09-29T10:00:00+02:00",
        field: "criterion C1 · edited after evidence",
        why: null,
        from: "### The effect shrinks monotonically ^c1",
      },
    ];
    open(() => readable);
    const history = await screen.findByRole("region", {
      name: "Position history",
    });
    const loud = within(history).getByRole("listitem", {
      name: "Edited after evidence",
    });
    expect(loud.textContent).toMatch(/no why written/);
    expect(loud.textContent).toMatch(/The effect shrinks monotonically/);
    expect(within(loud).getByRole("button", { name: "+ why" })).toBeTruthy();
    // The quiet one beside it is still a trail of one.
    expect(
      within(history).getByRole("button", { name: /1 quiet revision/ })
    ).toBeTruthy();
  });
});

describe("the history of a criterion deleted after evidence", () => {
  it("stands on its own as loudly as an edit, naming what was deleted (#336, spec #327 story 52)", async () => {
    const readable = page([criterion()]);
    readable.sections.positionHistory.entries = [
      {
        at: "2026-09-29T10:00:00+02:00",
        field: "criterion F4 · deleted after evidence",
        why: null,
        from: "### Gain vanishes with shuffled labels ^c4\n\nrelationship:: falsifying\n\n- [[sweep-14]] — flat",
      },
    ];
    open(() => readable);
    const history = await screen.findByRole("region", {
      name: "Position history",
    });
    const loud = within(history).getByRole("listitem", {
      name: "Deleted after evidence",
    });
    expect(loud.textContent).toMatch(/deleted after evidence/);
    expect(loud.textContent).toMatch(/no why written/);
    expect(loud.textContent).toMatch(/Gain vanishes with shuffled labels/);
    expect(within(loud).getByRole("button", { name: "+ why" })).toBeTruthy();
  });
});
