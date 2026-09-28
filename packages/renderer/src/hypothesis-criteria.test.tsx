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
    clause: "nothingTested",
    named: [],
    census: { met: 0, notMet: 0, inconclusive: 0, awaiting: criteria.length },
  },
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
