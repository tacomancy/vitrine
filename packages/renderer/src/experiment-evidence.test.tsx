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
    artifacts: { present: true, text: "", items: [], inFolder: [] },
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

// The check before the line is written (#370; TEST-13; stories 52–54): each
// linked Artifact reported beside the note in one of four ways, and none of
// them — nor a check still out, nor one that failed — holding up the attach.
describe("the check beside the attach", () => {
  const LINKED = "/Volumes/Scratch/prereg/step-4000.ckpt";
  const checks = {
    checks: [
      {
        file: "step-4000.ckpt",
        target: LINKED,
        machine: "Studio Mac",
        outcome: "unchanged",
      },
      {
        file: "pooled.parquet",
        target: "/Users/me/pooled.parquet",
        machine: "Laptop",
        outcome: "elsewhere",
      },
      {
        file: "sweep.tar",
        target: "/tmp/sweep.tar",
        machine: "Studio Mac",
        outcome: "changed",
      },
      {
        file: "model.ckpt",
        target: "https://wandb.ai/lab/prereg/model.ckpt",
        machine: "Studio Mac",
        outcome: "notChecked",
      },
    ],
  };

  /** The note for F2, reached from the page's door. */
  async function noteFor() {
    const { list } = await openAttach();
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "Enter" });
    return screen.findByRole("dialog", { name: "Evidence for F2" });
  }

  it("says what each linked Artifact is, checked now, before anything is written", async () => {
    // Answered for this run only, so the rows on screen prove which run
    // was checked.
    open(() => complete, {
      "experiments.checkArtifacts": (input: { path: string }) =>
        input.path === PATH ? checks : { checks: [] },
    });
    const form = await noteFor();
    const list = await within(form).findByRole("list", {
      name: "Linked artifacts, checked now",
    });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => row.textContent)
    ).toEqual([
      "step-4000.ckpthere and unchanged — same size, date and ends",
      "pooled.parqueton another machine — linked on Laptop",
      "sweep.tarchanged or gone since it was linked",
      "model.ckpta URL — not checked here",
    ]);
  });

  it("never shows a check from an earlier opening while this one is out", async () => {
    let answered = 0;
    open(() => complete, {
      "experiments.checkArtifacts": () =>
        answered++ === 0 ? checks : new Promise(() => undefined),
    });
    let form = await noteFor();
    await within(form).findByRole("list", {
      name: "Linked artifacts, checked now",
    });
    fireEvent.keyDown(within(form).getByRole("textbox"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Evidence for/ })).toBeNull()
    );

    form = await noteFor();
    expect(
      await within(form).findByText("checking the linked artifacts…")
    ).toBeTruthy();
    expect(within(form).queryByRole("list")).toBeNull();
  });

  it("attaches whatever the check says", async () => {
    const asked: unknown[] = [];
    open(() => complete, {
      "experiments.checkArtifacts": () => ({
        checks: [
          {
            file: "sweep.tar",
            target: "/tmp/sweep.tar",
            machine: "Studio Mac",
            outcome: "changed",
          },
        ],
      }),
      "experiments.attachEvidence": (input: unknown) => {
        asked.push(input);
        return { ...written(), revision: "2026-09-28T10:00:00+02:00" };
      },
    });
    const form = await noteFor();
    await within(form).findByText("changed or gone since it was linked");
    fireEvent.change(within(form).getByRole("textbox"), {
      target: { value: "d = 0.41" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "attach" }));
    await waitFor(() => expect(asked).toHaveLength(1));
  });

  it("attaches without waiting on a check still out", async () => {
    const asked: unknown[] = [];
    open(() => complete, {
      "experiments.checkArtifacts": () => new Promise(() => undefined),
      "experiments.attachEvidence": (input: unknown) => {
        asked.push(input);
        return { ...written(), revision: "2026-09-28T10:00:00+02:00" };
      },
    });
    const form = await noteFor();
    expect(
      await within(form).findByText("checking the linked artifacts…")
    ).toBeTruthy();
    fireEvent.change(within(form).getByRole("textbox"), {
      target: { value: "d = 0.41" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "attach" }));
    await waitFor(() => expect(asked).toHaveLength(1));
  });

  it("says a check that failed failed, rather than showing nothing, and still attaches", async () => {
    const asked: unknown[] = [];
    open(() => complete, {
      "experiments.checkArtifacts": () => {
        throw new Error("the vault is not open");
      },
      "experiments.attachEvidence": (input: unknown) => {
        asked.push(input);
        return { ...written(), revision: "2026-09-28T10:00:00+02:00" };
      },
    });
    const form = await noteFor();
    expect(
      await within(form).findByText(
        "could not check the linked artifacts: the vault is not open"
      )
    ).toBeTruthy();
    fireEvent.change(within(form).getByRole("textbox"), {
      target: { value: "d = 0.41" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "attach" }));
    await waitFor(() => expect(asked).toHaveLength(1));
  });

  it("shows no check for a run with nothing linked", async () => {
    open(() => complete, {
      "experiments.checkArtifacts": () => ({ checks: [] }),
    });
    const form = await noteFor();
    await waitFor(() =>
      expect(within(form).queryByText(/checking the linked/)).toBeNull()
    );
    expect(within(form).queryByRole("list")).toBeNull();
  });
});
