import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Candidates, CriterionRead, HypothesisPage } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Attaching evidence from a Criterion (#371; spec #362 stories 7–8, 46):
// *attach evidence* on a criterion opens the Picker narrowed to
// Experiments, with *new experiment named …* when nothing matches; the
// run chosen or made then takes the same required note, and the same
// write, as the Experiment page's door (#367).

const PATH = "hypotheses/Slow-wave density predicts recall gain.md";
const HASH =
  "#/hypothesis/hypotheses/Slow-wave%20density%20predicts%20recall%20gain.md";
const CLAIM = "Density predicts gain.";
const RUN = "experiments/sweep-7/sweep-7.md";

type Readable = Extract<HypothesisPage, { readable: true }>;

const criterion: CriterionRead = {
  id: "c2",
  label: "F2",
  text: "No gain when the labels are shuffled",
  relationship: "falsifying",
  outcome: null,
  outcomeUnreadable: null,
  evidence: [],
  editedAfterEvidence: [],
};

const page: Readable = {
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: { context: "reading", tags: [] },
  sections: {
    claim: { present: true, text: CLAIM },
    criteria: { present: true, criteria: [criterion] },
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
    census: { met: 0, notMet: 0, inconclusive: 0, awaiting: 1 },
  },
  overridable: false,
  related: { promotedFrom: null, questions: [] },
  loop: {
    status: "none",
    refusal:
      "A criterion still awaits evidence: not yet tested is not an answer.",
    result: "inconclusive",
  },
  problems: [],
};

const attached = {
  written: true,
  hash: "def",
  shape: [],
  revision: "2026-09-28T10:00:00+02:00",
};

/** Candidates as the core answers them: the one run, when its name matches. */
const runs =
  (asked: unknown[] = []) =>
  (input: { query: string; kinds?: string[] }): Candidates => {
    asked.push(input);
    return "sweep-7".includes(input.query)
      ? {
          rows: [{ path: RUN, name: "sweep-7", kind: "experiment" }],
          total: 1,
        }
      : { rows: [], total: 0 };
  };

function open(more: Record<string, unknown> = {}) {
  window.location.hash = HASH;
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "hypotheses.page": () => page,
    "picker.candidates": runs(),
    ...more,
  });
}

/** *attach evidence* on F2 opened, the Picker landed. */
async function openAttach() {
  const card = await screen.findByRole("article", { name: "Criterion F2" });
  const button = within(card).getByRole("button", { name: "attach evidence" });
  // A click focuses a button in a browser; jsdom's does not.
  button.focus();
  fireEvent.click(button);
  const picker = await screen.findByRole("dialog", {
    name: "Evidence for F2",
  });
  return { card, button, picker, find: within(picker).getByRole("combobox") };
}

async function noteFor(run: string) {
  const form = await screen.findByRole("dialog", {
    name: "Evidence for F2",
  });
  await within(form).findByRole("textbox", {
    name: "What this run shows for F2",
  });
  expect(form.textContent).toContain(run);
  return form;
}

describe("attach evidence, from a Criterion", () => {
  it("offers the Experiments by name, then the note, then #367's write", async () => {
    const candidates: unknown[] = [];
    const asked: unknown[] = [];
    open({
      "picker.candidates": runs(candidates),
      "experiments.attachEvidence": (input: unknown) => {
        asked.push(input);
        return attached;
      },
    });
    const { find, picker } = await openAttach();
    await within(picker).findByRole("option", { name: /sweep-7/ });
    // Narrowed to runs: a Criterion's Evidence is an Experiment.
    expect(candidates.at(-1)).toMatchObject({ kinds: ["experiment"] });
    fireEvent.keyDown(find, { key: "Enter" });

    const form = await noteFor("sweep-7");
    const note = within(form).getByRole("textbox");
    await waitFor(() => expect(document.activeElement).toBe(note));
    fireEvent.change(note, { target: { value: "gain gone once shuffled" } });
    fireEvent.keyDown(note, { key: "Enter" });
    await waitFor(() =>
      expect(asked).toEqual([
        {
          hypothesis: PATH,
          criterion: "c2",
          experiment: RUN,
          note: "gain gone once shuffled",
          basedOn: "abc",
        },
      ])
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Evidence for/ })).toBeNull()
    );
  });

  it("checks the chosen run's linked Artifacts beside the note, as the page's door does (TEST-13)", async () => {
    open({
      // Answered for the chosen run only, so the row proves which was checked.
      "experiments.checkArtifacts": (input: { path: string }) =>
        input.path !== RUN
          ? { checks: [] }
          : {
              checks: [
                {
                  file: "step-4000.ckpt",
                  target: "/Volumes/Scratch/step-4000.ckpt",
                  machine: "Laptop",
                  outcome: "elsewhere",
                },
              ],
            },
    });
    const { find, picker } = await openAttach();
    await within(picker).findByRole("option", { name: /sweep-7/ });
    fireEvent.keyDown(find, { key: "Enter" });
    const form = await noteFor("sweep-7");
    expect(
      await within(form).findByText("on another machine — linked on Laptop")
    ).toBeTruthy();
  });

  it("offers *new experiment named …* only for a name nothing has", async () => {
    open();
    const { find, picker } = await openAttach();
    await within(picker).findByRole("option", { name: /sweep-7/ });
    expect(
      within(picker).queryByRole("button", { name: /new experiment/ })
    ).toBeNull();
    fireEvent.change(find, { target: { value: "shuffle-labels" } });
    expect(
      await within(picker).findByRole("button", {
        name: "new experiment named shuffle-labels",
      })
    ).toBeTruthy();
  });

  it("makes the run from the Hypothesis, and attaches it only once the note is written", async () => {
    const made: unknown[] = [];
    const asked: unknown[] = [];
    open({
      "experiments.create": (input: unknown) => {
        made.push(input);
        return { path: "experiments/shuffle-labels/shuffle-labels.md" };
      },
      "experiments.attachEvidence": (input: unknown) => {
        asked.push(input);
        return attached;
      },
    });
    const { find, picker } = await openAttach();
    fireEvent.change(find, { target: { value: "shuffle-labels" } });
    await within(picker).findByRole("button", { name: /new experiment/ });
    fireEvent.keyDown(find, { key: "Enter" });

    await waitFor(() =>
      expect(made).toEqual([{ name: "shuffle-labels", from: PATH }])
    );
    const form = await noteFor("shuffle-labels");
    expect(asked).toEqual([]);
    const note = within(form).getByRole("textbox");
    fireEvent.change(note, { target: { value: "designed to kill F2" } });
    fireEvent.click(within(form).getByRole("button", { name: "attach" }));
    await waitFor(() =>
      expect(asked).toEqual([
        {
          hypothesis: PATH,
          criterion: "c2",
          experiment: "experiments/shuffle-labels/shuffle-labels.md",
          note: "designed to kill F2",
          basedOn: "abc",
        },
      ])
    );
  });

  it("leaving the note attaches nothing, with the keyboard back on the criterion", async () => {
    const asked: unknown[] = [];
    open({
      "experiments.attachEvidence": (input: unknown) => {
        asked.push(input);
        return attached;
      },
    });
    const { find, button, picker } = await openAttach();
    await within(picker).findByRole("option", { name: /sweep-7/ });
    fireEvent.keyDown(find, { key: "Enter" });
    const form = await noteFor("sweep-7");
    fireEvent.keyDown(within(form).getByRole("textbox"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Evidence for/ })).toBeNull()
    );
    expect(asked).toEqual([]);
    expect(document.activeElement).toBe(button);
  });

  it("says why a run could not be made, and never reaches the note", async () => {
    open({
      "experiments.create": () => {
        throw new Error(
          "An Experiment named shuffle-labels is already in the vault; the name is its folder, so pick another."
        );
      },
    });
    const { find, picker, card } = await openAttach();
    fireEvent.change(find, { target: { value: "shuffle-labels" } });
    await within(picker).findByRole("button", { name: /new experiment/ });
    fireEvent.keyDown(find, { key: "Enter" });
    expect((await within(card).findByRole("status")).textContent).toContain(
      "already in the vault"
    );
    expect(
      screen.queryByRole("textbox", { name: /What this run shows/ })
    ).toBeNull();
  });
});
