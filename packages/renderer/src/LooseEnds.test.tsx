import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { AmbiguousLinks, LooseEnds, ResearchQuestionPage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Loose Ends dashboard (brief § Loose Ends; prompt 9; spec #206 stories
// 47, 48, 50, 52): a punch list, not a metrics grid. Counts per group and
// never a total, an empty group not drawn at all, and every row a link to
// the object it names with a resolution beside it.

const PATH = "questions/What would falsify the active systems account (RQ).md";

// *Mark deliberate* is the one click on this dashboard that changes state,
// and #266 makes it undoable for as long as the row is on screen: the row
// stays put, says what happened, and offers the way back. The dismissal is in
// the vault from the click onward — the undo is for the moment after it, not
// a history.
const NOTHING_LOOSE = "Nothing is loose that the app can see.";

const MARKED =
  /marked deliberate — permanently out of this list, still in the vault/;

const stalled = (path = PATH, title = "What would falsify it?"): LooseEnds => ({
  groups: [
    {
      group: "Stalled questions",
      rows: [
        {
          kind: "stalled-research-question",
          subject: "rq0000001",
          path,
          title,
          since: "2026-06-21T10:00:00+01:00",
        },
      ],
    },
  ],
  problems: [],
});

/** Two rows in one group: enough for a count to drop by one and still read. */
const pair = (): LooseEnds => ({
  problems: [],
  groups: [
    {
      group: "Stalled questions",
      rows: [
        stalled().groups[0]!.rows[0]!,
        {
          ...stalled().groups[0]!.rows[0]!,
          subject: "rq0000002",
          title: "And does it hold at scale?",
        },
      ],
    },
  ],
});

const page: ResearchQuestionPage = {
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: {
    question: "What would falsify it?",
    status: "open",
    context: "other",
    tags: [],
  },
  sections: {
    workingAnswer: { present: true, text: "" },
    supporting: { present: true, lines: [] },
    opposing: { present: true, lines: [] },
    related: { present: true, text: "", lines: [] },
    openThreads: { present: true, text: "", threads: [] },
    positionHistory: { present: true, text: "", entries: [] },
  },
  problems: [],
};

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = "#/loose-ends";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "researchQuestions.page": () => page,
    "picker.candidates": { rows: [], total: 0 },
    "looseEnds.rows": { groups: [], problems: [] },
    ...more,
  });
};

const dashboard = () => screen.findByRole("region", { name: "Loose Ends" });

describe("the Loose Ends dashboard", () => {
  it("draws the four groups in the brief's order, counting each and totalling nothing", async () => {
    const rows: LooseEnds = {
      problems: [],
      groups: [
        {
          group: "Broken plumbing",
          rows: [
            { ...stalled().groups[0]!.rows[0]!, subject: "a" },
            { ...stalled().groups[0]!.rows[0]!, subject: "b" },
          ],
        },
        stalled().groups[0]!,
      ],
    };
    open({ "looseEnds.rows": rows });

    const view = await dashboard();
    const groups = await within(view).findAllByRole("region");
    expect(
      groups.map(
        (g) => within(g).getByRole("heading", { level: 2 }).textContent
      )
    ).toEqual(["Broken plumbing", "Stalled questions"]);
    expect(within(groups[0]!).getByText("2 items")).toBeDefined();
    expect(within(groups[1]!).getByText("1 item")).toBeDefined();
    // Never a total: the only numbers on the page are the per-group counts.
    expect(view.textContent?.match(/\d+ items?/g)).toEqual([
      "2 items",
      "1 item",
    ]);
  });

  it("draws no group at all when a group has no rows", async () => {
    open({ "looseEnds.rows": stalled() });
    const view = await dashboard();
    const groups = await within(view).findAllByRole("region");
    expect(groups).toHaveLength(1);
    expect(
      within(groups[0]!).getByRole("heading", { level: 2 }).textContent
    ).toBe("Stalled questions");
    expect(view.textContent).not.toMatch(/Unfinished reading/);
  });

  it("says nothing is loose once, without a cheerful zero state, when nothing is loose", async () => {
    open();
    const view = await dashboard();
    await within(view).findByText(NOTHING_LOOSE);
    expect(within(view).queryAllByRole("region")).toHaveLength(0);
    expect(view.textContent).not.toMatch(/\d/);
  });

  it("makes each row a link to the page it names", async () => {
    open({ "looseEnds.rows": stalled() });
    const view = await dashboard();
    const link = await within(view).findByRole("link", {
      name: "What would falsify it?",
    });
    expect(link.getAttribute("href")).toBe(
      "#/research-question/questions/What%20would%20falsify%20the%20active%20systems%20account%20(RQ).md"
    );
  });

  it("opens the page with its attach form on *attach a source*", async () => {
    open({ "looseEnds.rows": stalled() });
    const view = await dashboard();

    fireEvent.click(
      await within(view).findByRole("button", { name: "attach a source" })
    );

    expect(
      await screen.findByRole("dialog", { name: /attach a source/i })
    ).toBeDefined();
    expect(window.location.hash).toBe(
      "#/research-question/questions/What%20would%20falsify%20the%20active%20systems%20account%20(RQ).md"
    );
  });

  it("leaves the attach form shut on an ordinary visit to the same page", async () => {
    open({ "looseEnds.rows": stalled() });
    const view = await dashboard();
    fireEvent.click(
      await within(view).findByRole("button", { name: "attach a source" })
    );
    await screen.findByRole("dialog", { name: /attach a source/i });

    // Back to the dashboard and in again: the intent was spent by the first
    // arrival, so the second is a plain visit.
    fireEvent.click(screen.getByRole("link", { name: "Loose Ends" }));
    const again = await dashboard();
    fireEvent.click(
      await within(again).findByRole("link", { name: "What would falsify it?" })
    );

    await screen.findByRole("region", { name: "Research Question view" });
    expect(
      screen.queryByRole("dialog", { name: /attach a source/i })
    ).toBeNull();
  });

  const rows = async () => {
    const view = await dashboard();
    const [first, second] = await within(view).findAllByRole("listitem");
    return { view, first: first!, second: second! };
  };

  it("leaves a row marked in place on *mark deliberate*, with undo its only way out", async () => {
    const dismiss = vi.fn<(input: unknown) => void>();
    open({
      "looseEnds.rows": pair(),
      "looseEnds.dismiss": (input: unknown) => {
        dismiss(input);
        return undefined;
      },
    });
    const { view, first, second } = await rows();

    fireEvent.click(
      within(first).getByRole("button", { name: "mark deliberate" })
    );

    await within(first).findByText(MARKED);
    expect(dismiss).toHaveBeenCalledWith({
      subject: "rq0000001",
      kind: "stalled-research-question",
    });
    // In place and still a link, its detail replaced by what happened, and
    // *undo* the only thing left to click.
    expect(
      within(first).getByRole("link", { name: "What would falsify it?" })
    ).toBeDefined();
    expect(within(first).queryByText(/No source on either side/)).toBeNull();
    expect(
      within(first).queryByRole("button", { name: "attach a source" })
    ).toBeNull();
    expect(
      within(first).queryByRole("button", { name: "mark deliberate" })
    ).toBeNull();
    expect(within(first).getByRole("button", { name: "undo" })).toBeDefined();
    // The other row is untouched, and the count counts the open ones — still
    // per group, still never a total.
    expect(
      within(second).getByRole("button", { name: "mark deliberate" })
    ).toBeDefined();
    expect(view.textContent?.match(/\d+ items?/g)).toEqual(["1 item"]);
  });

  it("reads a group whose last row is resolved as clear rather than as a zero", async () => {
    open({ "looseEnds.rows": stalled() });
    const view = await dashboard();
    fireEvent.click(
      await within(view).findByRole("button", { name: "mark deliberate" })
    );

    await within(view).findByText(MARKED);
    expect(within(view).getByText("clear")).toBeDefined();
    expect(view.textContent).not.toMatch(/0 items/);
  });

  it("gives the row its own resolutions and the count back on undo", async () => {
    const undismiss = vi.fn<(input: unknown) => void>();
    open({
      "looseEnds.rows": pair(),
      "looseEnds.undismiss": (input: unknown) => {
        undismiss(input);
        return undefined;
      },
    });
    const { view, first } = await rows();
    fireEvent.click(
      within(first).getByRole("button", { name: "mark deliberate" })
    );
    await within(first).findByText(MARKED);

    fireEvent.click(within(first).getByRole("button", { name: "undo" }));

    await within(first).findByText(/No source on either side/);
    expect(undismiss).toHaveBeenCalledWith({
      subject: "rq0000001",
      kind: "stalled-research-question",
    });
    expect(
      within(first).getByRole("button", { name: "attach a source" })
    ).toBeDefined();
    expect(
      within(first).getByRole("button", { name: "mark deliberate" })
    ).toBeDefined();
    expect(within(first).queryByText(MARKED)).toBeNull();
    expect(view.textContent?.match(/\d+ items?/g)).toEqual(["2 items"]);
  });

  it("says so on the row when the undo is refused, rather than leaving it marked in silence", async () => {
    open({
      "looseEnds.rows": pair(),
      "looseEnds.undismiss": () => {
        throw new Error(".vitrine/dismissals.json could not be read");
      },
    });
    const { first } = await rows();
    fireEvent.click(
      within(first).getByRole("button", { name: "mark deliberate" })
    );
    await within(first).findByText(MARKED);

    fireEvent.click(within(first).getByRole("button", { name: "undo" }));

    expect((await within(first).findByRole("alert")).textContent).toMatch(
      /dismissals\.json/
    );
    // The dismissal is still in the file, so the row is still marked — and
    // still offers the undo, which is what the user is now told failed.
    expect(within(first).getByText(MARKED)).toBeDefined();
    expect(within(first).getByRole("button", { name: "undo" })).toBeDefined();
  });

  it("says so on the row when *mark deliberate* is refused, and leaves the row open", async () => {
    open({
      "looseEnds.rows": pair(),
      "looseEnds.dismiss": () => {
        throw new Error(".vitrine/dismissals.json could not be read");
      },
    });
    const { view, first } = await rows();

    fireEvent.click(
      within(first).getByRole("button", { name: "mark deliberate" })
    );

    expect((await within(first).findByRole("alert")).textContent).toMatch(
      /dismissals\.json/
    );
    expect(within(first).queryByText(MARKED)).toBeNull();
    expect(
      within(first).getByRole("button", { name: "mark deliberate" })
    ).toBeDefined();
    expect(view.textContent?.match(/\d+ items?/g)).toEqual(["2 items"]);
  });

  it("does not show a row resolved earlier on the dashboard's next read", async () => {
    let listed: LooseEnds = stalled();
    open({
      "looseEnds.rows": () => listed,
      "looseEnds.dismiss": () => {
        listed = { groups: [], problems: [] };
        return undefined;
      },
    });
    const view = await dashboard();
    fireEvent.click(
      await within(view).findByRole("button", { name: "mark deliberate" })
    );
    await within(view).findByText(MARKED);

    // Away to the page and back: the dashboard reads again, and what it was
    // told to silence is gone. The undo was for the moment after the click.
    fireEvent.click(
      within(view).getByRole("link", { name: "What would falsify it?" })
    );
    await screen.findByRole("region", { name: "Research Question view" });
    fireEvent.click(screen.getByRole("link", { name: "Loose Ends" }));

    expect(await screen.findByText(NOTHING_LOOSE)).toBeDefined();
  });

  it("ends the undo where every other read of the dashboard does, when the vault changes", async () => {
    // The undo lasts while the row is on screen, and a vaultChanged is a read
    // of the dashboard like any other, so the row goes then rather than at
    // the next visit. Pinned because the row leaving is what the resolution
    // asked for, not a refetch quietly dropping something.
    let listed: LooseEnds = stalled();
    const { stream } = open({
      "looseEnds.rows": () => listed,
      "looseEnds.dismiss": () => {
        listed = { groups: [], problems: [] };
        return undefined;
      },
    });
    const view = await dashboard();
    fireEvent.click(
      await within(view).findByRole("button", { name: "mark deliberate" })
    );
    await within(view).findByText(MARKED);

    stream.push({
      type: "vaultChanged",
      changed: [PATH],
      removed: [],
      renamed: [],
    });

    expect(await screen.findByText(NOTHING_LOOSE)).toBeDefined();
  });

  it("says so in the footer when dismissals could not be read, politely, rather than silently showing everything", async () => {
    open({
      "looseEnds.rows": {
        ...stalled(),
        problems: [
          ".vitrine/dismissals.json could not be read, so nothing is silenced",
        ],
      },
    });
    const view = await dashboard();
    // A state the app is in, not a refusal of the user's act (ADR 0033).
    const footer = await within(view).findByRole("contentinfo");
    expect(within(footer).getByRole("status").textContent).toMatch(
      /dismissals\.json/
    );
    expect(screen.queryByRole("alert")).toBeNull();
    // The rows are still drawn: the problem speaks beside them, not instead.
    expect(within(view).getByText("1 item")).toBeDefined();
  });

  it("re-reads the rows when the vault changes", async () => {
    const query = vi.fn(() => stalled());
    const { stream } = open({ "looseEnds.rows": query });
    await dashboard();
    const before = query.mock.calls.length;

    stream.push({
      type: "vaultChanged",
      changed: [PATH],
      removed: [],
      renamed: [],
    });

    await screen.findByRole("region", { name: "Loose Ends" });
    await vi.waitFor(() =>
      expect(query.mock.calls.length).toBeGreaterThan(before)
    );
  });
});

// The ambiguous link (spec #206 story 49; `docs/architecture.md` § Loose
// Ends): a bare `[[name]]` matching several files resolves to nothing, and
// the row is where that nothing becomes a decision. One row per linking
// file, because that is what a dismissal is keyed by.
const ambiguous = (over: Partial<AmbiguousLinks> = {}): LooseEnds => ({
  problems: [],
  groups: [
    {
      group: "Disconnected material",
      rows: [
        {
          kind: "ambiguous-link",
          subject: "notes/Reading list.md",
          path: "notes/Reading list.md",
          title: "Reading list",
          linkingKind: null,
          links: [
            {
              target: "Klinzing 2019",
              candidates: ["a/Klinzing 2019.md", "b/Klinzing 2019.md"],
            },
          ],
          ...over,
        },
      ],
    },
  ],
});

describe("the ambiguous link row", () => {
  it("names the linking file and every candidate the name reached", async () => {
    open({ "looseEnds.rows": ambiguous() });
    const view = await dashboard();

    const group = await within(view).findByRole("region", {
      name: "Disconnected material",
    });
    expect(group.textContent).toContain("notes/Reading list.md");
    expect(group.textContent).toContain("[[Klinzing 2019]]");
    expect(group.textContent).toContain("a/Klinzing 2019.md");
    expect(group.textContent).toContain("b/Klinzing 2019.md");
  });

  it("offers *open* for a linking file with a surface, and names the file without one for a Note", async () => {
    open({ "looseEnds.rows": ambiguous() });
    const view = await dashboard();

    // A Note has no address yet (beat 11): the row names it and stops.
    await within(view).findByText("Reading list");
    expect(within(view).queryByRole("link", { name: "open" })).toBeNull();
    expect(
      within(view).queryByRole("link", { name: "Reading list" })
    ).toBeNull();
    expect(view.textContent).toContain("notes/Reading list.md");

    cleanup();
    open({
      "looseEnds.rows": ambiguous({
        subject: "rq0000001",
        path: PATH,
        title: "What would falsify it (RQ)",
        linkingKind: "research-question",
      }),
    });
    const again = await dashboard();
    const hash =
      "#/research-question/questions/What%20would%20falsify%20the%20active%20systems%20account%20(RQ).md";
    expect(
      (await within(again).findByRole("link", { name: "open" })).getAttribute(
        "href"
      )
    ).toBe(hash);
    expect(
      within(again)
        .getByRole("link", { name: "What would falsify it (RQ)" })
        .getAttribute("href")
    ).toBe(hash);
  });

  it("opens a linking Question at its own Address, which is the Inbox on that row", async () => {
    open({
      "looseEnds.rows": ambiguous({
        subject: "k7m2p9q4wx",
        path: "reading/Does slow-wave density predict recall gain.md",
        title: "Does slow-wave density predict recall gain?",
        linkingKind: "question",
      }),
    });
    const view = await dashboard();
    // A Question has an Address of its own from #300, so the row opens it
    // rather than naming the file and stopping.
    const hash =
      "#/question/reading/Does%20slow-wave%20density%20predict%20recall%20gain.md";
    expect(
      (await within(view).findByRole("link", { name: "open" })).getAttribute(
        "href"
      )
    ).toBe(hash);
    expect(view.textContent).toContain(
      "question · reading/Does slow-wave density predict recall gain.md"
    );
  });

  it("shows a kind: the app does not know verbatim, rather than passing it off as a note", async () => {
    open({
      "looseEnds.rows": ambiguous({ linkingKind: "lab-notebook" }),
    });
    const view = await dashboard();
    await within(view).findByText("Reading list");
    expect(view.textContent).toContain("lab-notebook · notes/Reading list.md");
  });

  it("calls dismiss with the linking file and this row kind, and puts the row's matches away", async () => {
    // The undo the shell carries (#266) reaches this row too, and the names
    // it was listing go with the decision: the question *which two?* is
    // answered once the row is marked.
    const dismiss = vi.fn<(input: unknown) => void>();
    open({
      "looseEnds.rows": ambiguous(),
      "looseEnds.dismiss": (input: unknown) => {
        dismiss(input);
        return undefined;
      },
    });
    const view = await dashboard();

    fireEvent.click(
      await within(view).findByRole("button", { name: "mark deliberate" })
    );

    await within(view).findByText(MARKED);
    expect(dismiss).toHaveBeenCalledWith({
      subject: "notes/Reading list.md",
      kind: "ambiguous-link",
    });
    expect(view.textContent).not.toContain("[[Klinzing 2019]]");
    expect(view.textContent).not.toContain("a/Klinzing 2019.md");
    expect(within(view).getByRole("button", { name: "undo" })).toBeDefined();
    expect(
      within(view).queryByRole("button", { name: "mark deliberate" })
    ).toBeNull();
  });
});

// A Hypothesis gone quiet with criteria untested (#341; spec #327 stories
// 81–85): named by its current claim, quiet counted in open days, and
// resolved by *open* or *mark deliberate* with the shell's undo.
describe("the stalled Hypothesis row", () => {
  const HYPOTHESIS =
    "hypotheses/The pooled effect is mostly small-study bias.md";
  const quiet = (
    more: Partial<{
      quietOpenDays: number;
      criteria: number;
      awaiting: number;
    }> = {}
  ): LooseEnds => ({
    problems: [],
    groups: [
      {
        group: "Stalled questions",
        rows: [
          {
            kind: "stalled-hypothesis",
            subject: "hy00000001",
            path: HYPOTHESIS,
            title: "The pooled effect is mostly publication bias.",
            quietOpenDays: 16,
            criteria: 3,
            awaiting: 2,
            ...more,
          },
        ],
      },
    ],
  });
  const ADDRESS =
    "#/hypothesis/hypotheses/The%20pooled%20effect%20is%20mostly%20small-study%20bias.md";

  it("names the current claim as a link to the Hypothesis, how long it has been quiet in open days, and what is untested", async () => {
    open({ "looseEnds.rows": quiet() });
    const view = await dashboard();
    const link = await within(view).findByRole("link", {
      name: "The pooled effect is mostly publication bias.",
    });
    expect(link.getAttribute("href")).toBe(ADDRESS);
    expect(view.textContent).toContain(
      "hypothesis · inconclusive, quiet 16 open days"
    );
    expect(view.textContent).toContain("2 of 3 criteria awaiting evidence.");
  });

  it("says when no criteria are written at all, and a single open day in the singular", async () => {
    open({
      "looseEnds.rows": quiet({ quietOpenDays: 1, criteria: 0, awaiting: 0 }),
    });
    const view = await dashboard();
    await within(view).findByText(/No criteria written yet\./);
    expect(view.textContent).toContain("quiet 1 open day");
    expect(view.textContent).not.toContain("1 open days");
  });

  it("opens the Hypothesis in one click", async () => {
    open({ "looseEnds.rows": quiet() });
    const view = await dashboard();
    const openLink = await within(view).findByRole("link", { name: "open" });
    expect(openLink.getAttribute("href")).toBe(ADDRESS);
  });

  it("is marked deliberate by its own row kind, with undo right after", async () => {
    const dismiss = vi.fn<(input: unknown) => void>();
    const undismiss = vi.fn<(input: unknown) => void>();
    open({
      "looseEnds.rows": quiet(),
      "looseEnds.dismiss": (input: unknown) => {
        dismiss(input);
        return undefined;
      },
      "looseEnds.undismiss": (input: unknown) => {
        undismiss(input);
        return undefined;
      },
    });
    const view = await dashboard();

    fireEvent.click(
      await within(view).findByRole("button", { name: "mark deliberate" })
    );
    await within(view).findByText(MARKED);
    const row = { subject: "hy00000001", kind: "stalled-hypothesis" };
    expect(dismiss).toHaveBeenCalledWith(row);
    expect(within(view).queryByRole("link", { name: "open" })).toBeNull();

    fireEvent.click(within(view).getByRole("button", { name: "undo" }));
    await within(view).findByText(/2 of 3 criteria awaiting evidence/);
    expect(undismiss).toHaveBeenCalledWith(row);
  });
});

// The two Experiment rows (#374; spec #362 stories 73–78): a run's result
// never read, and a linked Artifact gone from where it was linked — loud,
// under Broken plumbing, when a falsification rested on it.
describe("the Experiment rows", () => {
  const RUN = "experiments/prereg-exclusions/prereg-exclusions.md";
  const ADDRESS =
    "#/experiment/experiments/prereg-exclusions/prereg-exclusions.md";
  const quiet = (more: { quietOpenDays?: number; artifacts?: number } = {}) =>
    ({
      kind: "stalled-experiment",
      subject: "ex-prereg",
      path: RUN,
      title: "prereg-exclusions",
      quietOpenDays: 16,
      artifacts: 2,
      ...more,
    }) as const;
  const gone = (
    falsifying: Array<{
      path: string;
      claim: string;
      criterion: string | null;
    }> = []
  ) =>
    ({
      kind: "missing-artifact",
      subject: "ex-prereg",
      path: RUN,
      title: "prereg-exclusions",
      missing: [
        { file: "step-1000.ckpt", target: "/Volumes/Scratch/step-1000.ckpt" },
        { file: "step-2000.ckpt", target: "/Volumes/Scratch/step-2000.ckpt" },
      ],
      falsifying,
    }) as const;

  it("names a quiet run as a link, how long it has been quiet in open days, and that nothing is written about its Artifacts", async () => {
    open({
      "looseEnds.rows": {
        problems: [],
        groups: [{ group: "Stalled questions", rows: [quiet()] }],
      },
    });
    const view = await dashboard();
    const link = await within(view).findByRole("link", {
      name: "prereg-exclusions",
    });
    expect(link.getAttribute("href")).toBe(ADDRESS);
    expect(view.textContent).toContain(
      "experiment · complete, quiet 16 open days"
    );
    expect(view.textContent).toContain(
      "2 Artifacts and no observations written."
    );
    expect(
      within(view).getByRole("link", { name: "open" }).getAttribute("href")
    ).toBe(ADDRESS);
  });

  it("words one Artifact and one open day in the singular", async () => {
    open({
      "looseEnds.rows": {
        problems: [],
        groups: [
          {
            group: "Stalled questions",
            rows: [quiet({ quietOpenDays: 1, artifacts: 1 })],
          },
        ],
      },
    });
    const view = await dashboard();
    await within(view).findByText(/1 Artifact and no observations written\./);
    expect(view.textContent).toContain("quiet 1 open day");
    expect(view.textContent).not.toContain("1 open days");
  });

  it("names each missing file and where it was linked, in one row for the run", async () => {
    open({
      "looseEnds.rows": {
        problems: [],
        groups: [{ group: "Stalled questions", rows: [gone()] }],
      },
    });
    const view = await dashboard();
    await within(view).findByRole("link", { name: "prereg-exclusions" });
    expect(within(view).getAllByRole("listitem")).toHaveLength(1 + 2);
    expect(view.textContent).toContain("step-1000.ckpt");
    expect(view.textContent).toContain("/Volumes/Scratch/step-2000.ckpt");
    expect(view.querySelector("[data-loud]")).toBeNull();
  });

  it("draws the falsifying case loud, naming the Criterion it rested on", async () => {
    const claim = "Preregistered reanalysis will shrink the pooled effect.";
    open({
      "looseEnds.rows": {
        problems: [],
        groups: [
          {
            group: "Broken plumbing",
            rows: [gone([{ path: "hypotheses/H.md", claim, criterion: "F1" }])],
          },
        ],
      },
    });
    const view = await dashboard();
    const group = await within(view).findByRole("region", {
      name: "Broken plumbing",
    });
    const row = group.querySelector("[data-loud]");
    expect(row).not.toBeNull();
    expect(row!.textContent).toMatch(/a falsification rests on it/i);
    expect(row!.textContent).toContain(`F1 · ${claim}`);
  });

  it.each([
    ["stalled-experiment", quiet(), /2 Artifacts and no observations/],
    ["missing-artifact", gone(), /step-1000\.ckpt/],
  ] as const)(
    "marks a %s row deliberate by its own kind, with undo right after",
    async (kind, row, reason) => {
      const dismiss = vi.fn<(input: unknown) => void>();
      const undismiss = vi.fn<(input: unknown) => void>();
      open({
        "looseEnds.rows": {
          problems: [],
          groups: [{ group: "Stalled questions", rows: [row] }],
        },
        "looseEnds.dismiss": (input: unknown) => {
          dismiss(input);
          return undefined;
        },
        "looseEnds.undismiss": (input: unknown) => {
          undismiss(input);
          return undefined;
        },
      });
      const view = await dashboard();
      fireEvent.click(
        await within(view).findByRole("button", { name: "mark deliberate" })
      );
      await within(view).findByText(MARKED);
      expect(dismiss).toHaveBeenCalledWith({ subject: "ex-prereg", kind });
      expect(within(view).queryByText(reason)).toBeNull();

      fireEvent.click(within(view).getByRole("button", { name: "undo" }));
      await within(view).findAllByText(reason);
      expect(undismiss).toHaveBeenCalledWith({ subject: "ex-prereg", kind });
    }
  );
});
