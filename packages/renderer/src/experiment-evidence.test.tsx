import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CriteriaToAttach, ExperimentPage, WriteResult } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, scrollsInto, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Attaching a run as Evidence from its page (#367; spec #362 stories 22–24,
// 45, 47–49, 55): *attach as evidence* opens a keyboard list of every
// Hypothesis's Criteria, grouped by Hypothesis with falsifying ones first
// (not the Picker, whose rows are files), then the required note; the rail
// lists every Criterion the run is Evidence for, each opening its
// Hypothesis, and says plainly when there are none.

const PATH = "experiments/prereg-exclusions/prereg-exclusions.md";
const HASH = "#/experiment/experiments/prereg-exclusions/prereg-exclusions.md";
const H1 = "hypotheses/Preregistered reanalysis shrinks the effect.md";
const H2 = "hypotheses/Harmonising removes between-lab variance.md";
const CLAIM_1 = "Preregistered reanalysis will shrink the pooled effect.";
const CLAIM_2 = "Harmonising the density definition removes variance.";

type Readable = Extract<ExperimentPage, { readable: true }>;

const complete: Readable = {
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: {
    id: "ex9q2w7m4k",
    name: "prereg-exclusions",
    status: "complete",
    statusUnreadable: null,
    created: "2026-09-09T10:00:00+02:00",
    tags: [],
  },
  sections: {
    purpose: { present: true, text: "See whether it survives." },
    design: { present: true, text: "" },
    whereItRan: { present: true, text: "", lines: [] },
    artifacts: { present: true, text: "", items: [] },
    observations: { present: true, text: "" },
    positionHistory: { present: true, text: "", entries: [] },
  },
  cameFrom: null,
  evidence: [],
  problems: [],
};

const criteria: CriteriaToAttach = {
  groups: [
    {
      path: H2,
      claim: CLAIM_2,
      hash: "h2",
      criteria: [
        {
          id: "c1",
          label: "C1",
          text: "Variance drops once harmonised",
          relationship: "confirming",
          outcome: null,
        },
      ],
    },
    {
      path: H1,
      claim: CLAIM_1,
      hash: "h1",
      criteria: [
        {
          id: "c2",
          label: "F2",
          text: "The effect survives the exclusion rule",
          relationship: "falsifying",
          outcome: null,
        },
        {
          id: "c1",
          label: "C1",
          text: "The pooled effect drops below d = 0.20",
          relationship: "confirming",
          outcome: "met",
        },
      ],
    },
  ],
  problems: [],
};

const written = (): WriteResult => ({
  written: true,
  hash: "new",
  content: "",
  shape: [],
});

const answers = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": {
    indexing: null,
    watching: { ok: true },
    current: { ok: true },
  },
  "looseEnds.rows": { groups: [], problems: [] },
  "experiments.criteria": () => criteria,
};

function open(page: () => ExperimentPage, more: Record<string, unknown> = {}) {
  window.location.hash = HASH;
  return renderApp({ ...answers, "experiments.page": page, ...more });
}

async function region() {
  const page = await screen.findByRole("region", { name: "Experiment view" });
  await within(page).findByRole("radiogroup", { name: "Status" });
  return page;
}

/** *attach as evidence* opened, its list landed. */
async function openAttach() {
  const page = await region();
  const button = within(page).getByRole("button", {
    name: "attach as evidence",
  });
  // A click focuses a button in a browser; jsdom's does not.
  button.focus();
  fireEvent.click(button);
  const dialog = await screen.findByRole("dialog", {
    name: "Attach as evidence",
  });
  const list = within(dialog).getByRole("listbox");
  await within(list).findAllByRole("option");
  return { page, dialog, list };
}

describe("attach as evidence, from the Experiment page", () => {
  it("lists every Hypothesis's Criteria, grouped by Hypothesis, falsifying first", async () => {
    open(() => complete);
    const { list } = await openAttach();
    const groups = within(list).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      CLAIM_2,
      CLAIM_1,
    ]);
    expect(
      within(groups[1]!)
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual([
      "F2falsifying · awaiting evidenceThe effect survives the exclusion rule",
      "C1confirming · metThe pooled effect drops below d = 0.20",
    ]);
    // Its own keyboard list, with the keyboard on it: not the Picker.
    expect(document.activeElement).toBe(list);
    expect(screen.queryByRole("combobox", { name: "Find" })).toBeNull();
  });

  it("moves the choice with the arrows and j/k, keeping it in view", async () => {
    open(() => complete);
    const { list } = await openAttach();
    const scrolled = scrollsInto();
    const options = within(list).getAllByRole("option");
    const chosen = () =>
      document.getElementById(list.getAttribute("aria-activedescendant")!);
    expect(chosen()).toBe(options[0]);
    fireEvent.keyDown(list, { key: "j" });
    expect(chosen()).toBe(options[1]);
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    // Across the group's edge, and no further than the last row.
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(chosen()).toBe(options[2]);
    expect(scrolled.at(-1)).toEqual({ row: options[2], block: "nearest" });
    fireEvent.keyDown(list, { key: "k" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(chosen()).toBe(options[0]);
    expect(scrolled.at(-1)).toEqual({ row: options[0], block: "nearest" });
  });

  it("asks for the note, refuses a blank one without writing, and attaches with it", async () => {
    const asked: unknown[] = [];
    open(() => complete, {
      "experiments.attachEvidence": (input: unknown) => {
        asked.push(input);
        return { ...written(), revision: "2026-09-28T10:00:00+02:00" };
      },
    });
    const { list } = await openAttach();
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "Enter" });
    const form = await screen.findByRole("dialog", {
      name: "Evidence for F2",
    });
    expect(form.textContent).toContain(CLAIM_1);
    expect(form.textContent).toContain(
      "The effect survives the exclusion rule"
    );
    const note = within(form).getByRole("textbox", {
      name: "What this run shows for F2",
    });
    await waitFor(() => expect(document.activeElement).toBe(note));
    const attach = within(form).getByRole("button", { name: "attach" });
    expect((attach as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(note, { target: { value: "   " } });
    fireEvent.keyDown(note, { key: "Enter" });
    expect(asked).toEqual([]);
    expect(form.textContent).toContain("the note is required");

    fireEvent.change(note, {
      target: { value: "d = 0.41 — the effect did not move" },
    });
    fireEvent.keyDown(note, { key: "Enter" });
    await waitFor(() =>
      expect(asked).toEqual([
        {
          hypothesis: H1,
          criterion: "c2",
          experiment: PATH,
          note: "d = 0.41 — the effect did not move",
          basedOn: "h1",
        },
      ])
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Evidence for/ })).toBeNull()
    );
  });

  it("keeps the note and says why when the write is refused", async () => {
    open(() => complete, {
      "experiments.attachEvidence": () => ({
        written: false,
        reason: "changedAndUnreapplyable",
        detail: "no criterion carries ^c2",
      }),
    });
    const { list } = await openAttach();
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "Enter" });
    const form = await screen.findByRole("dialog", {
      name: "Evidence for F2",
    });
    const note = within(form).getByRole("textbox");
    fireEvent.change(note, { target: { value: "did not move" } });
    fireEvent.click(within(form).getByRole("button", { name: "attach" }));
    expect((await within(form).findByRole("status")).textContent).toContain(
      "no criterion carries ^c2"
    );
    expect((note as HTMLInputElement).value).toBe("did not move");
  });

  it("leaves on esc, with the keyboard back where it was", async () => {
    open(() => complete);
    const { page, list } = await openAttach();
    fireEvent.keyDown(list, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Attach as evidence" })
    ).toBeNull();
    expect(document.activeElement).toBe(
      within(page).getByRole("button", { name: "attach as evidence" })
    );
  });

  it("says so when there is no Hypothesis to attach to", async () => {
    open(() => complete, {
      "experiments.criteria": (): CriteriaToAttach => ({
        groups: [],
        problems: [],
      }),
    });
    const page = await region();
    fireEvent.click(
      within(page).getByRole("button", { name: "attach as evidence" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Attach as evidence",
    });
    expect(
      await within(dialog).findByText(/No Hypothesis in the vault yet/)
    ).toBeTruthy();
  });
});

describe("the rail's attached as evidence", () => {
  it("lists every Criterion the run is Evidence for, each opening its Hypothesis", async () => {
    open(() => ({
      ...complete,
      evidence: [
        {
          hypothesis: { path: H1, claim: CLAIM_1 },
          criterion: {
            id: "c2",
            label: "F2",
            text: "The effect survives the exclusion rule",
            relationship: "falsifying",
            outcome: "met",
          },
          note: "the effect did not move",
        },
        {
          hypothesis: { path: H2, claim: CLAIM_2 },
          criterion: {
            id: "c1",
            label: "C1",
            text: "Variance drops once harmonised",
            relationship: "confirming",
            outcome: null,
          },
          note: "only incidental here",
        },
      ],
    }));
    const page = await region();
    const rail = within(page).getByRole("region", {
      name: "Attached as evidence",
    });
    const items = within(rail).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      `F2falsifying · met${CLAIM_1}the effect did not move`,
      `C1confirming · awaiting evidence${CLAIM_2}only incidental here`,
    ]);
    const link = within(items[0]!).getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "#/hypothesis/hypotheses/Preregistered%20reanalysis%20shrinks%20the%20effect.md"
    );
  });

  it("says plainly that a run is Evidence for nothing, not as a fault", async () => {
    open(() => complete);
    const page = await region();
    const rail = within(page).getByRole("region", {
      name: "Attached as evidence",
    });
    expect(rail.textContent).toContain(
      "Nothing. Most runs never bear on a claim, and a run that doesn’t is not unfinished."
    );
    expect(within(rail).queryByRole("listitem")).toBeNull();
  });
});
