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

  it("says the vault is tidy once, without a cheerful zero state, when nothing is loose", async () => {
    open();
    const view = await dashboard();
    await within(view).findByText(/Nothing to tidy/);
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
      "#/questions/questions/What%20would%20falsify%20the%20active%20systems%20account%20(RQ).md"
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
      "#/questions/questions/What%20would%20falsify%20the%20active%20systems%20account%20(RQ).md"
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

  it("calls dismiss with the row's subject and kind, and the row leaves", async () => {
    const dismiss = vi.fn<(input: unknown) => void>();
    let rows: LooseEnds = stalled();
    open({
      "looseEnds.rows": () => rows,
      "looseEnds.dismiss": (input: unknown) => {
        dismiss(input);
        rows = { groups: [], problems: [] };
        return undefined;
      },
    });
    const view = await dashboard();

    fireEvent.click(
      await within(view).findByRole("button", { name: "mark deliberate" })
    );

    expect(await screen.findByText(/Nothing to tidy/)).toBeDefined();
    expect(dismiss).toHaveBeenCalledWith({
      subject: "rq0000001",
      kind: "stalled-research-question",
    });
  });

  it("says so when dismissals could not be read, rather than silently showing everything", async () => {
    open({
      "looseEnds.rows": {
        ...stalled(),
        problems: [
          ".vitrine/dismissals.json could not be read, so nothing is silenced",
        ],
      },
    });
    const view = await dashboard();
    expect((await within(view).findByRole("alert")).textContent).toMatch(
      /dismissals\.json/
    );
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
      "#/questions/questions/What%20would%20falsify%20the%20active%20systems%20account%20(RQ).md";
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

  it("calls dismiss with the linking file and this row kind, and the row leaves", async () => {
    const dismiss = vi.fn<(input: unknown) => void>();
    let rows: LooseEnds = ambiguous();
    open({
      "looseEnds.rows": () => rows,
      "looseEnds.dismiss": (input: unknown) => {
        dismiss(input);
        rows = { groups: [], problems: [] };
        return undefined;
      },
    });
    const view = await dashboard();

    fireEvent.click(
      await within(view).findByRole("button", { name: "mark deliberate" })
    );

    expect(await screen.findByText(/Nothing to tidy/)).toBeDefined();
    expect(dismiss).toHaveBeenCalledWith({
      subject: "notes/Reading list.md",
      kind: "ambiguous-link",
    });
  });
});
