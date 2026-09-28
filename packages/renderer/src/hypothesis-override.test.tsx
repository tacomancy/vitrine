import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CriterionRead, Derivation, HypothesisPage, Revision } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Override on the page (#337; spec #327 stories 50, 55–59, 63; TEST-6;
// prototype 04, *overriding inconclusive — a written act*): reached from a
// line under the rule only when the core says it can be made, listing what
// it overrules, refusing to complete without a why; the page afterwards
// reads *supported · overrides inconclusive* with the derived state beside
// it. And the history it lands in: loud entries, and three filters.

const PATH = "hypotheses/Slow-wave density predicts recall gain.md";
const HASH =
  "#/hypothesis/hypotheses/Slow-wave%20density%20predicts%20recall%20gain.md";

type Readable = Extract<HypothesisPage, { readable: true }>;

const criterion = (over: Partial<CriterionRead> & { id: string }) => ({
  label: null,
  text: `criterion ${over.id}`,
  relationship: null,
  outcome: null,
  outcomeUnreadable: null,
  evidence: [],
  editedAfterEvidence: [],
  ...over,
});

const CRITERIA: CriterionRead[] = [
  criterion({
    id: "c1",
    label: "C1",
    text: "Recall gain tracks density",
    relationship: "confirming",
    outcome: "met",
  }),
  criterion({
    id: "c2",
    label: "F2",
    text: "No gain when density is shuffled",
    relationship: "falsifying",
  }),
  criterion({
    id: "c3",
    label: "C3",
    text: "The effect shrinks monotonically with sample size",
    relationship: "confirming",
    outcome: "not met",
  }),
  criterion({
    id: "c4",
    label: "D4",
    text: "Spindles are detected",
    relationship: "diagnostic",
    outcome: "not met",
  }),
];

const inconclusive: Derivation = {
  state: "inconclusive",
  effective: "inconclusive",
  override: null,
  clause: "mixed",
  named: ["C3"],
  unlanded: ["F2", "C3"],
  census: { met: 1, notMet: 2, inconclusive: 0, awaiting: 1 },
};

const page = (
  over: Partial<Readable> = {},
  entries: Revision[] = []
): Readable => ({
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: { context: "reading", tags: [] },
  sections: {
    claim: { present: true, text: "Density predicts gain." },
    criteria: { present: true, criteria: CRITERIA },
    designNotes: { present: true, text: "" },
    positionHistory: { present: true, text: "", entries },
  },
  derivation: inconclusive,
  overridable: true,
  problems: [],
  ...over,
});

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

const stateRegion = () =>
  screen.findByRole("region", { name: "Derived state" });

const OFFER = "disagree with this? override…";

describe("the offer", () => {
  it("is a line under the rule when the core says an Override can be made", async () => {
    open(() => page());
    const state = await stateRegion();
    expect(within(state).getByRole("button", { name: OFFER })).toBeTruthy();
  });

  it("is absent when it cannot — no Outcome recorded, or one already live", async () => {
    open(() => page({ overridable: false }));
    const state = await stateRegion();
    expect(within(state).queryByRole("button", { name: OFFER })).toBeNull();
  });

  it("says a falsified page is a result, and offers nothing — there is no override to falsified, nor of it", async () => {
    open(() =>
      page({
        overridable: false,
        derivation: {
          ...inconclusive,
          state: "falsified",
          effective: "falsified",
          clause: "falsifyingMet",
          named: ["F2"],
        },
      })
    );
    const state = await stateRegion();
    expect(state.textContent).toContain(
      "not overridable — a met falsifying criterion is a result"
    );
    expect(within(state).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("the form", () => {
  const opened = async (
    answer: unknown = {
      written: true,
      hash: "def",
      shape: [],
      revision: "2026-09-29T10:00:00+02:00",
    }
  ) => {
    const override = vi.fn(() => answer);
    open(() => page(), { "hypotheses.override": override });
    fireEvent.click(
      within(await stateRegion()).getByRole("button", { name: OFFER })
    );
    const form = screen.getByRole("form", {
      name: "Override the derived state",
    });
    return { override, form };
  };

  it("lists the criteria it overrules — not the ones that landed, nor diagnostic ones — and takes the keyboard", async () => {
    const { form } = await opened();
    const overruled = within(form).getByRole("list", {
      name: "What you are overruling",
    });
    const items = within(overruled).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringMatching(
        /F2.*awaiting evidence.*No gain when density is shuffled/
      ),
      expect.stringMatching(/C3.*not met.*The effect shrinks monotonically/),
    ]);
    expect(document.activeElement).toBe(
      within(form).getByRole("textbox", { name: "Why you are overriding" })
    );
  });

  it("will not complete without a why", async () => {
    const { form, override } = await opened();
    const record = within(form).getByRole<HTMLButtonElement>("button", {
      name: "override and record",
    });
    const why = within(form).getByRole("textbox", {
      name: "Why you are overriding",
    });
    expect(record.disabled).toBe(true);
    fireEvent.change(why, { target: { value: "   " } });
    expect(record.disabled).toBe(true);
    fireEvent.submit(form);
    expect(override).not.toHaveBeenCalled();

    fireEvent.change(why, {
      target: { value: "F2 cannot run on this sample" },
    });
    expect(record.disabled).toBe(false);
    fireEvent.click(record);
    await waitFor(() =>
      expect(override).toHaveBeenCalledWith({
        path: PATH,
        why: "F2 cannot run on this sample",
        basedOn: "abc",
      })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Override the derived state" })
      ).toBeNull()
    );
  });

  it("esc closes it and writes nothing", async () => {
    const { form, override } = await opened();
    const why = within(form).getByRole("textbox", {
      name: "Why you are overriding",
    });
    fireEvent.change(why, { target: { value: "half a thought" } });
    fireEvent.keyDown(why, { key: "Escape" });
    expect(
      screen.queryByRole("form", { name: "Override the derived state" })
    ).toBeNull();
    expect(override).not.toHaveBeenCalled();
  });

  it("keeps the why and says so when the core refuses", async () => {
    const override = vi.fn(() => {
      throw new Error(
        "An override is already live; it stands until something it judged changes, and a new one needs a new why."
      );
    });
    open(() => page(), { "hypotheses.override": override });
    fireEvent.click(
      within(await stateRegion()).getByRole("button", { name: OFFER })
    );
    const why = screen.getByRole("textbox", { name: "Why you are overriding" });
    fireEvent.change(why, { target: { value: "kept" } });
    fireEvent.click(
      screen.getByRole("button", { name: "override and record" })
    );
    expect(
      await screen.findByText(/could not record the override: .*already live/)
    ).toBeTruthy();
    expect((why as HTMLTextAreaElement).value).toBe("kept");
  });
});

describe("an overridden page", () => {
  it("reads supported · overrides inconclusive, with the derived state and its because beside it, and the why", async () => {
    open(() =>
      page({
        overridable: false,
        derivation: {
          ...inconclusive,
          effective: "supported",
          override: {
            at: "2026-09-12T10:00:00+02:00",
            why: "C3 is the wrong test for this sample",
          },
        },
      })
    );
    const state = await stateRegion();
    expect(within(state).getByText("supported")).toBeTruthy();
    expect(state.textContent).toContain("overrides inconclusive");
    expect(state.textContent).toMatch(
      /derived inconclusive.*because the criteria disagree: C3/
    );
    expect(state.textContent).toContain("C3 is the wrong test for this sample");
    expect(state.textContent).toContain("12 September 2026");
    expect(within(state).queryByRole("button", { name: OFFER })).toBeNull();
  });
});

describe("the history", () => {
  const at = (day: string) => `2026-09-${day}T10:00:00+02:00`;
  const entries: Revision[] = [
    { at: at("09"), field: "override voided", why: null, from: at("07") },
    { at: at("09"), field: "criterion F2", why: "ran it", from: "### F ^c2" },
    { at: at("08"), field: "state", why: "moved", from: "inconclusive" },
    {
      at: at("08"),
      field: "criterion C3",
      why: "it failed",
      from: "### C ^c3",
    },
    {
      at: at("07"),
      field: "override",
      why: "partial call",
      from: "inconclusive",
    },
    { at: at("05"), field: "claim", why: "narrowed", from: "Old claim." },
    { at: at("03"), field: "design notes", why: "held", from: "" },
  ];
  const history = async () => {
    open(() => page({}, entries));
    return screen.findByRole("region", { name: "Position history" });
  };
  const fieldsShown = (region: HTMLElement) =>
    within(within(region).getByRole("list"))
      .getAllByRole("listitem")
      .map((row) => row.querySelector("[class*=field]")?.textContent);

  it("draws an Override and its void as loud entries of their own, the void naming the Override it ends", async () => {
    const region = await history();
    const voided = within(region).getByRole("listitem", {
      name: "Override voided",
    });
    expect(voided.textContent).toMatch(
      /voids the override of 7 September 2026/
    );
    const override = within(region).getByRole("listitem", { name: "Override" });
    expect(override.textContent).toContain("partial call");
  });

  it("offers no why onto an override that has none — a why added later would make an Override nothing voided", async () => {
    open(() =>
      page({}, [
        { at: at("07"), field: "override", why: null, from: "inconclusive" },
      ])
    );
    const region = await screen.findByRole("region", {
      name: "Position history",
    });
    const override = within(region).getByRole("listitem", { name: "Override" });
    expect(override.textContent).toContain("no why written");
    expect(
      within(override).queryByRole("button", { name: "+ why" })
    ).toBeNull();
  });

  it("filters to the claim alone, criterion edits alone, or what decided the state", async () => {
    const region = await history();
    const choose = (label: string) =>
      fireEvent.click(within(region).getByRole("button", { name: label }));

    choose("claim");
    expect(fieldsShown(region)).toEqual(["claim"]);
    choose("criterion edits");
    expect(fieldsShown(region)).toEqual(["criterion F2", "criterion C3"]);
    choose("what decided it");
    expect(fieldsShown(region)).toEqual([
      "override voided",
      "state",
      "criterion C3",
      "override",
    ]);
    choose("everything");
    expect(fieldsShown(region)).toHaveLength(entries.length);
  });
});
