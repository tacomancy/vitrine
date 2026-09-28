import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import type { CriterionRead, Derivation, HypothesisPage } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Hypothesis view as it reads its file (#330; brief § Testing, prompt 4;
// ADR 0031): the claim, its provenance, the Derived state with the rule
// printed beside it, the criteria as read, design notes and the history.
// Editing the claim and design notes is `hypothesis-edit.test.tsx`'s.

const PATH = "hypotheses/Slow-wave density predicts recall gain.md";
const HASH =
  "#/hypothesis/hypotheses/Slow-wave%20density%20predicts%20recall%20gain.md";

type Readable = Extract<HypothesisPage, { readable: true }>;

const census = { met: 0, notMet: 0, inconclusive: 0, awaiting: 0 };

const fresh: Readable = {
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: {
    id: "hy4k8m2p9q",
    promotedFrom: "[[Does slow-wave density predict recall gain]]",
    promoted: "2026-09-28T10:00:00+02:00",
    captured: "2026-08-14T09:12:00Z",
    context: "reading",
    from: "[[Rasch & Born 2013]]",
    page: 699,
    tags: [],
  },
  sections: {
    claim: {
      present: true,
      text: "Slow-wave density during the nap predicts next-day recall gain.",
    },
    criteria: { present: true, criteria: [] },
    designNotes: { present: true, text: "" },
    positionHistory: {
      present: true,
      text: "",
      entries: [
        {
          at: "2026-09-28T10:00:00+02:00",
          field: "claim",
          why: null,
          from: "",
        },
      ],
    },
  },
  derivation: {
    state: "inconclusive",
    effective: "inconclusive",
    override: null,
    unlanded: [],
    clause: "noCriteria",
    named: [],
    census,
  },
  overridable: false,
  related: { promotedFrom: null, questions: [] },
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
};

const criterion = (
  over: Partial<CriterionRead> & { id: string }
): CriterionRead => ({
  label: null,
  text: `criterion ${over.id}`,
  relationship: null,
  outcome: null,
  outcomeUnreadable: null,
  evidence: [],
  editedAfterEvidence: [],
  ...over,
});

/** What the rule says, without an Override: the effective state is the derived one. */
type Rule = Omit<Derivation, "effective" | "override" | "unlanded">;

const withCriteria = (
  criteria: CriterionRead[],
  rule: Rule | Derivation,
  overridable = false
): Readable => ({
  ...fresh,
  sections: { ...fresh.sections, criteria: { present: true, criteria } },
  derivation: { effective: rule.state, override: null, unlanded: [], ...rule },
  overridable,
});

const answers = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": {
    indexing: null,
    watching: { ok: true },
    current: { ok: true },
  },
};

const open = (page: () => HypothesisPage) => {
  window.location.hash = HASH;
  const asked: string[] = [];
  const rendered = renderApp({
    ...answers,
    "hypotheses.page": (input: { path: string }) => {
      asked.push(input.path);
      return page();
    },
  });
  return { ...rendered, asked };
};

const region = () => screen.findByRole("region", { name: "Hypothesis view" });

describe("the Address and the map", () => {
  it("renders the file at #/hypothesis/<path>, and the Sidebar's Hypothesis view lights while it is on screen", async () => {
    const { asked } = open(() => fresh);
    await region();
    expect(asked).toContain(PATH);
    const nav = screen.getByRole("navigation", { name: "Surfaces" });
    const entry = within(nav).getByRole("link", { name: "Hypothesis view" });
    expect(entry.getAttribute("aria-current")).toBe("page");
    expect(entry.getAttribute("href")).toBe(HASH);
  });

  it("leaves the Sidebar's entry inert anywhere else", async () => {
    window.location.hash = "#/inbox";
    renderApp(answers);
    const nav = await screen.findByRole("navigation", { name: "Surfaces" });
    expect(
      within(nav).queryByRole("link", { name: "Hypothesis view" })
    ).toBeNull();
    expect(within(nav).getByText("Hypothesis view")).toBeTruthy();
  });
});

describe("the freshly promoted page", () => {
  it("leads with the claim in the serif and the provenance line beneath it", async () => {
    open(() => fresh);
    const page = await region();
    const claim = await within(page).findByRole("textbox", { name: "Claim" });
    expect((claim as HTMLTextAreaElement).value).toBe(
      fresh.sections.claim.text
    );
    expect(page.textContent).toContain(
      "first wondered 14 August 2026 · 09:12 · while reading Rasch & Born 2013 · p.699"
    );
  });

  it("looks complete with a claim and nothing else: empty sections are quiet outlines saying what belongs there", async () => {
    open(() => fresh);
    const page = await region();
    for (const name of ["Criteria", "Design notes"]) {
      const section = await within(page).findByRole("region", { name });
      const sentence = within(section).getByText(/\.\s*$/);
      expect(sentence.textContent?.length).toBeGreaterThan(20);
    }
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });

  it("says nothing has been tested yet, prints the rule, and offers no status control", async () => {
    open(() => fresh);
    const page = await region();
    const state = await within(page).findByRole("region", {
      name: "Derived state",
    });
    expect(state.textContent).toContain("inconclusive");
    expect(state.textContent).toContain("nothing has been tested yet");
    expect(state.textContent).toContain("diagnostic criteria never decide");
    // ADR 0031 decision 1's last condition: without it an all-diagnostic
    // page would read, against the printed rule, as supported.
    expect(state.textContent).toContain("at least one of either → supported");
    expect(state.textContent).toContain(
      "any falsifying criterion met → falsified"
    );
    expect(within(page).queryByRole("combobox")).toBeNull();
    expect(within(page).queryByRole("listbox")).toBeNull();
    expect(within(page).queryByRole("radio")).toBeNull();
    // The only buttons on the page are the history's own — its filter and
    // its trail — which read the history, never set a state, and *+
    // criterion*, which writes a criterion the state is computed from; the
    // claim and design notes are text fields, which are not a state either.
    const history = within(page).getByRole("region", {
      name: "Position history",
    });
    const outside = within(page)
      .queryAllByRole("button")
      .filter((b) => !history.contains(b));
    expect(outside.map((b) => b.textContent)).toEqual(["+ criterion"]);
  });
});

describe("the criteria as read", () => {
  const criteria = [
    criterion({
      id: "c2",
      label: "C2",
      text: "Density predicts gain",
      relationship: "confirming",
      outcome: "met",
    }),
    criterion({
      id: "c1",
      label: "F1",
      text: "Gain vanishes when encoding is controlled",
      relationship: "falsifying",
    }),
    criterion({
      id: "c5",
      label: "D5",
      text: "Sleep staging agrees",
      relationship: "diagnostic",
      outcome: "inconclusive",
      evidence: [
        {
          text: "[[nap-run-3]] — staging matched",
          link: {
            target: "nap-run-3",
            blockId: null,
            resolution: "resolved",
            resolvedPath: "experiments/nap-run-3/nap-run-3.md",
            resolvedKind: "experiment",
            resolvedDisplay: null,
          },
          note: "staging matched",
        },
        {
          text: "[[nowhere-run]] — mistyped",
          link: {
            target: "nowhere-run",
            blockId: null,
            resolution: "unresolved",
            resolvedPath: null,
            resolvedKind: null,
            resolvedDisplay: null,
          },
          note: "mistyped",
        },
      ],
    }),
    criterion({ id: "c7", text: "Replication cohort", outcome: "met" }),
    criterion({
      id: "c8",
      label: "C8",
      text: "Spindles scored",
      relationship: "confirming",
      outcomeUnreadable: "mett",
    }),
  ];
  const page = withCriteria(criteria, {
    state: "inconclusive",
    clause: "awaitingEvidence",
    named: ["F1", "C8"],
    census: { met: 2, notMet: 0, inconclusive: 1, awaiting: 2 },
  });

  const card = async (text: string) => {
    const found = await within(await region()).findByText(text);
    return found.closest("article") as HTMLElement;
  };

  it("labels each criterion by letter and number, none without a relationship, and draws falsifying ones in their own band above", async () => {
    open(() => page);
    const view = await region();
    const band = await within(view).findByRole("group", {
      name: "Falsifying criteria",
    });
    expect(
      within(band).getByText("Gain vanishes when encoding is controlled")
    ).toBeTruthy();
    expect(within(band).queryByText("Density predicts gain")).toBeNull();
    const rest = within(view).getByRole("group", { name: "Other criteria" });
    // The band comes first in the document.
    expect(
      band.compareDocumentPosition(rest) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      (await card("Gain vanishes when encoding is controlled")).textContent
    ).toContain("F1");
    expect((await card("Density predicts gain")).textContent).toContain("C2");
    expect((await card("Sleep staging agrees")).textContent).toContain("D5");
    const unlabelled = await card("Replication cohort");
    expect(unlabelled.textContent).not.toMatch(/\b[CFD]7\b/);
  });

  it("chips: awaiting evidence, no run named, does not count yet, outcome unreadable — and inconclusive is not awaiting", async () => {
    open(() => page);
    expect(
      (await card("Gain vanishes when encoding is controlled")).textContent
    ).toContain("awaiting evidence");
    const met = await card("Density predicts gain");
    expect(met.textContent).toContain("met");
    expect(met.textContent).toContain("no run named");
    const tested = await card("Sleep staging agrees");
    expect(tested.textContent).toContain("inconclusive");
    expect(tested.textContent).not.toContain("awaiting evidence");
    expect(tested.textContent).not.toContain("no run named");
    expect((await card("Replication cohort")).textContent).toContain(
      "does not count yet"
    );
    const typo = await card("Spindles scored");
    expect(typo.textContent).toContain("outcome unreadable");
    expect(typo.textContent).toContain("mett");
    expect(typo.textContent).not.toContain("awaiting evidence");
  });

  it("shows evidence lines with their notes, and says so of one whose link does not resolve", async () => {
    open(() => page);
    const tested = await card("Sleep staging agrees");
    expect(tested.textContent).toContain("nap-run-3");
    expect(tested.textContent).toContain("staging matched");
    expect(tested.textContent).toContain("nowhere-run");
    expect(tested.textContent).toContain("unresolved");
    expect(tested.textContent).toContain("mistyped");
  });

  it("names the clause and counts the census in words", async () => {
    open(() => page);
    const state = await within(await region()).findByRole("region", {
      name: "Derived state",
    });
    expect(state.textContent).toContain("awaiting evidence on F1 and C8");
    expect(state.textContent).toContain(
      "two met · nothing not met · one inconclusive · two awaiting evidence"
    );
  });
});

describe("the derived state", () => {
  const because: Array<[Rule, string]> = [
    [
      { state: "inconclusive", clause: "mixed", named: ["C2"], census },
      "the criteria disagree: C2",
    ],
    [
      { state: "falsified", clause: "falsifyingMet", named: ["F1"], census },
      "F1 met",
    ],
    [
      { state: "supported", clause: "allLanded", named: ["F1", "C2"], census },
      "every deciding criterion landed: F1, C2",
    ],
    [
      {
        state: "inconclusive",
        clause: "noRelationship",
        named: ["^c7"],
        census,
      },
      "^c7 has no relationship",
    ],
    [
      { state: "inconclusive", clause: "onlyDiagnostic", named: [], census },
      "no criterion decides",
    ],
    [
      { state: "inconclusive", clause: "nothingTested", named: [], census },
      "nothing has been tested yet",
    ],
  ];
  for (const [derivation, line] of because) {
    it(`${derivation.clause} says “${line}”`, async () => {
      open(() => withCriteria([], derivation));
      const state = await within(await region()).findByRole("region", {
        name: "Derived state",
      });
      expect(state.textContent).toContain(derivation.state);
      expect(state.textContent).toContain(line);
    });
  }

  it("renders falsified as solid and finished as supported — never greyed or struck (TEST-7)", async () => {
    const drawn = async (derivation: Rule) => {
      const { unmount } = open(() => withCriteria([], derivation));
      const state = await within(await region()).findByRole("region", {
        name: "Derived state",
      });
      const word = within(state).getByText(derivation.state);
      const shape = {
        className: word.className,
        struck: word.closest("s, del, strike") !== null,
        disabled: word.closest("[aria-disabled='true']") !== null,
      };
      unmount();
      return shape;
    };
    const falsified = await drawn({
      state: "falsified",
      clause: "falsifyingMet",
      named: ["F1"],
      census,
    });
    const supported = await drawn({
      state: "supported",
      clause: "allLanded",
      named: ["C1"],
      census,
    });
    expect(falsified).toEqual(supported);
    expect(falsified.struck).toBe(false);
    expect(falsified.disabled).toBe(false);
  });
});

describe("a file the app cannot read fully", () => {
  it("shows what parses plus a footer line naming what did not", async () => {
    open(() => ({
      ...fresh,
      sections: {
        ...fresh.sections,
        designNotes: { present: false, text: "" },
      },
      problems: [
        {
          path: PATH,
          kind: "hypothesis",
          problem: "criterionWithoutId",
          block: "A criterion with no id",
        },
        {
          path: PATH,
          kind: "hypothesis",
          problem: "sectionMissing",
          block: "Design notes",
        },
        {
          path: PATH,
          kind: "hypothesis",
          problem: "historyEntryUnparsed",
          block: "- a note",
        },
      ],
    }));
    const page = await region();
    await within(page).findByRole("textbox", { name: "Claim" });
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toContain("A criterion with no id");
    expect(footer.textContent).toContain("Design notes is not in the file");
    expect(footer.textContent).toContain(
      "a line under Position history is not a revision"
    );
  });
});

describe("the page under external change", () => {
  const changed = (over: {
    changed?: string[];
    removed?: string[];
    renamed?: Array<{ from: string; to: string }>;
  }) => ({
    type: "vaultChanged" as const,
    changed: [],
    removed: [],
    renamed: [],
    ...over,
  });

  it("follows a rename of its file", async () => {
    const { stream, asked } = open(() => fresh);
    await region();
    await waitFor(() => expect(asked).toContain(PATH));
    const to = "hypotheses/Renamed in Obsidian.md";
    act(() => stream.push(changed({ renamed: [{ from: PATH, to }] })));
    await waitFor(() => expect(asked).toContain(to));
    expect(window.location.hash).toBe(
      "#/hypothesis/hypotheses/Renamed%20in%20Obsidian.md"
    );
  });

  it("clears quietly if the file is removed", async () => {
    let page: HypothesisPage = fresh;
    const { stream } = open(() => page);
    const before = await region();
    await within(before).findByRole("textbox", { name: "Claim" });
    page = { readable: false, path: PATH, reason: "missing from the vault" };
    act(() => stream.push(changed({ removed: [PATH] })));
    const after = await region();
    await waitFor(() =>
      expect(within(after).queryByRole("textbox", { name: "Claim" })).toBeNull()
    );
    expect(after.textContent).toContain(`${PATH} — removed from the vault`);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lands on the Inbox naming the Address when the file is not a Hypothesis", async () => {
    open(() => ({
      readable: false,
      path: PATH,
      reason: "not a Hypothesis: kind is question",
    }));
    await waitFor(() => expect(window.location.hash).toBe("#/inbox"));
  });
});
