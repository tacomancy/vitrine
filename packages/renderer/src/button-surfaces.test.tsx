import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ListedQuestion, Revision } from "core";
import { afterEach, describe, expect, it } from "vitest";
import candidateStyles from "./CandidateReview.module.css";
import { Detail } from "./Detail";
import detailStyles from "./Detail.module.css";
import { renderApp } from "./fake-core";
import { FirstRun } from "./FirstRun";
import form from "./Form.module.css";
import { moduleRules } from "./module-rules";
import { Origins } from "./Origins";
import { PositionHistory } from "./PositionHistory";
import historyStyles from "./PositionHistory.module.css";
import { ReadingsStrip } from "./Readings";
import readingsStyles from "./Readings.module.css";
import { DroppedLine } from "./ScoutDropped";
import droppedStyles from "./ScoutDropped.module.css";

afterEach(cleanup);

// #822 moved these surfaces' buttons onto `Button`, and the rules it deleted
// carried layout and type that `Button`'s own tier does not (#919). jsdom
// lays nothing out, so each test asks what it can see: which tier the button
// wears, and that the surface rule giving the rest back reaches it. The
// overlaps, the 0 px rule and the 1130 px button were measured over CDP.
const rules = (name: string, styles: Record<string, string>) =>
  moduleRules(`${__dirname}/${name}.module.css`, styles);

describe("First run", () => {
  it("draws its one action as the filled primary, as prototype 12 does", () => {
    renderApp({}, <FirstRun />);
    expect(screen.getByRole("button", { name: "Open a vault" }).className).toBe(
      form.primary
    );
  });
});

describe("a word inside a line of smaller type", () => {
  it("is Origins' *show all*, set in the line's own type", async () => {
    const row = {
      label: "a",
      kind: "source",
      path: null,
      questions: 1,
      material: 0,
    };
    renderApp(
      { "questionMap.origins": { rows: Array(10).fill(row), total: 13 } },
      <Origins />
    );
    const all = await screen.findByRole("button", { name: "show all 13" });
    expect(all.className).toBe(form.inline);
  });

  it("is the dropped line's every act, at the line's size", () => {
    render(
      <DroppedLine
        dropped={[{ id: "s", name: "Odour cueing" }]}
        refused={{}}
        onRestore={() => {}}
        onErase={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "1 dropped" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Odour cueing: erase" })
    );
    const css = rules("ScoutDropped", droppedStyles);
    expect(css.declarations(".line button")).toMatch(/font-size:\s*inherit;/);
    const acts = screen.getAllByRole("button");
    expect(acts.map((b) => b.textContent)).toEqual([
      "1 dropped",
      "restore",
      "erase",
      "erase it",
      "keep it",
    ]);
    for (const act of acts) expect(css.reaches(act, ".line button")).toBe(true);
  });
});

describe("the link review", () => {
  const QUESTIONS = ["Why many?", "Why few?"].map((question, at) => ({
    kind: "question" as const,
    path: `q/${at}.md`,
    id: `q-${at}`,
    question,
    captured: "2026-09-01T10:00:00Z",
    candidates: [
      {
        path: `s/${at}.md`,
        kind: "source" as const,
        display: `paper ${at}`,
        shared: ["sleep"],
        terms: [],
        rejection: { subject: `q-${at}`, kind: `inferred-link:${at}` },
      },
    ],
  }));

  it("keeps *next question* to its own width and *Undo reject* in the keys line's type", async () => {
    const { CandidateReview } = await import("./CandidateReview");
    renderApp(
      {
        "questionMap.candidates": QUESTIONS,
        "looseEnds.dismiss": () => {},
      },
      <CandidateReview />
    );
    await screen.findByRole("listbox");
    fireEvent.keyDown(document, { key: "R" });
    const undo = await screen.findByRole("button", { name: "Undo reject" });
    expect(undo.className).toBe(form.inline);

    const next = await screen.findByRole("button", { name: "next question" });
    const css = rules("CandidateReview", candidateStyles);
    // The review is a flex column, which stretches a bare `Button` across it.
    expect(css.reaches(next, ".review > button")).toBe(true);
    expect(css.declarations(".review > button")).toMatch(
      /align-self:\s*flex-start;/
    );
  });
});

describe("*review links* on an unanchored question", () => {
  it("stands apart from the question it follows, in the row's quiet type", () => {
    const empty = { count: 0, items: [] };
    const item = {
      kind: "question",
      path: "q/a.md",
      question: "Is the overnight benefit consolidation?",
      material: 0,
      unresolved: [],
    };
    render(
      <ReadingsStrip
        readings={
          {
            depth: 1,
            wellSupported: empty,
            unanchored: { count: 1, items: [item] },
            unquestionedKnowledge: empty,
            clockedButUnquestioned: empty,
          } as never
        }
        reviewable={new Set(["q/a.md"])}
        onReview={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unanchored/ }));
    const review = screen.getByRole("button", {
      name: `review links for ${item.question}`,
    });
    const css = rules("Readings", readingsStyles);
    expect(css.reaches(review, ".list li > button")).toBe(true);
    expect(css.declarations(".list li > button")).toMatch(
      /margin-left:\s*var\(--space-3\);/
    );
    // Nothing else in a row is a button the rule would also move.
    expect(within(review.closest("li")!).getAllByRole("button")).toEqual([
      review,
    ]);
  });
});

describe("a Position history's quiet trail", () => {
  const ENTRIES: Revision[] = [
    { at: "2026-09-25T10:00:00+01:00", field: "claim", why: null, from: "b" },
    { at: "2026-09-21T10:00:00+01:00", field: "claim", why: null, from: "a" },
  ];
  const history = () =>
    render(
      <PositionHistory
        entries={ENTRIES}
        current={{ claim: "c" }}
        whyLine={() => <p>why line</p>}
      />
    );

  it("runs its rule into the count, in the history's mono", () => {
    history();
    const trail = screen.getByRole("button", { name: /quiet revisions/ });
    const css = rules("PositionHistory", historyStyles);
    expect(css.reaches(trail, ".body > button")).toBe(true);
    expect(css.declarations(".body > button")).toMatch(/display:\s*flex;/);
    expect(trail.querySelector(`.${historyStyles.rule}`)).not.toBeNull();
  });

  it("keeps each *+ why* quiet until its entry is hovered, focused or opened", () => {
    history();
    fireEvent.click(screen.getByRole("button", { name: /quiet revisions/ }));
    const whys = screen.getAllByRole("button", { name: "+ why" });
    expect(whys).toHaveLength(2);
    const css = rules("PositionHistory", historyStyles);
    expect(css.declarations(".quietWhen button")).toMatch(/opacity:\s*0;/);
    for (const why of whys) {
      expect(css.reaches(why, ".quietWhen button")).toBe(true);
      expect(css.reaches(why, ".body > button")).toBe(false);
      expect(css.reaches(why, ".quiet:hover .quietWhen button")).toBe(true);
    }
    expect(css.declarations(".quiet:hover .quietWhen button")).toMatch(
      /opacity:\s*1;/
    );
    fireEvent.click(whys[0]!);
    expect(
      css.reaches(whys[0]!, '.quietWhen button[aria-expanded="true"]')
    ).toBe(true);
  });
});

describe("the rest of a sitting in Detail", () => {
  const q = (n: number): ListedQuestion => ({
    id: `q${n}`,
    path: `/v/q${n}.md`,
    question: `Question ${n}?`,
    status: "open",
    captured: `2026-10-20T09:${10 + n}:00Z`,
    context: "other",
  });

  it("sets each other Question over its time, behind the train-of-thought rule", () => {
    const questions = [q(1), q(2), q(3)];
    render(
      <Detail
        row={{
          kind: "question",
          path: "/v/q1.md",
          question: questions[0]!,
          when: questions[0]!.captured,
        }}
        questions={questions}
        onSelect={() => {}}
      />
    );
    const others = screen
      .getAllByRole("button")
      .filter((b) => /Question [23]\?/.test(b.textContent ?? ""));
    expect(others).toHaveLength(2);
    const css = rules("Detail", detailStyles);
    const declared = css.declarations(".sitting button");
    expect(declared).toMatch(/flex-direction:\s*column;/);
    expect(declared).toMatch(/border-left:\s*2px solid var\(--color-line\);/);
    for (const other of others) {
      expect(other.className).toBe(form.listRow);
      expect(css.reaches(other, ".sitting button")).toBe(true);
    }
  });
});
