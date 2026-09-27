import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  Candidate,
  Candidates,
  ResearchQuestionPage,
  Revision,
} from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The why (#216; brief § Position history, "detailed when it matters";
// spec #206 stories 33–36; prompt 3): `⌥↵` saves the working answer and
// opens one line for what changed the mind, `[[` names the thing that did,
// and `esc` declines to explain a Revision that is already recorded. The
// same line reaches any past Revision from the history, months later.

const PATH = "questions/Does slow-wave density predict recall gain (RQ).md";
const RECORDED = "2026-09-21T10:00:00+02:00";

const CANDIDATES: Candidate[] = [
  {
    path: "sources/cordi2021.md",
    name: "cordi2021",
    kind: "source",
    title: "No evidence for a benefit of TMR",
    pdf: true,
  },
  {
    path: "experiments/power-calculation/power-calculation.md",
    name: "power-calculation",
    kind: "experiment",
  },
];

const matching = (input: unknown): Candidates => {
  const { query } = input as { query: string };
  const rows = CANDIDATES.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );
  return { rows, total: rows.length };
};

const entry = (date: string, why: string | null, from: string): Revision => ({
  at: `${date}T10:00:00+02:00`,
  field: "working answer",
  why,
  from,
});

const page = (
  answer: string,
  entries: Revision[],
  hash = "abc"
): ResearchQuestionPage => ({
  readable: true,
  path: PATH,
  hash,
  frontmatter: {
    question: "Does slow-wave density predict recall gain?",
    status: "open",
    promoted: "2026-09-20T10:00:00+02:00",
    context: "reading",
    from: "[[Rasch & Born 2013]]",
    tags: [],
  },
  sections: {
    workingAnswer: { present: true, text: answer },
    supporting: { present: true, lines: [] },
    opposing: { present: true, lines: [] },
    related: { present: true, text: "", lines: [] },
    openThreads: { present: true, text: "", threads: [] },
    positionHistory: { present: true, text: "…", entries },
  },
  problems: [],
});

/** The save reply: the write's result, plus the Revision it recorded (#216). */
const saved = {
  written: true,
  hash: "def",
  shape: [],
  revision: RECORDED,
};

const open = (
  current: () => ResearchQuestionPage,
  more: Record<string, unknown> = {}
) => {
  window.location.hash = `#/questions/${encodeURIComponent("questions")}/${encodeURIComponent("Does slow-wave density predict recall gain (RQ).md")}`;
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "researchQuestions.page": current,
    "researchQuestions.saveWorkingAnswer": () => saved,
    "picker.candidates": matching,
    ...more,
  });
};

const region = () =>
  screen.findByRole("region", { name: "Research Question view" });

const answerField = async () =>
  within(await region()).findByRole("textbox", { name: "Working answer" });

/** The one line, once it is open. */
const whyField = () => screen.findByRole("textbox", { name: "Why" });

/** Type into the working answer and press ⌥↵. */
async function saveWithAWhy(text = "Encoding strength, mostly.") {
  const box = await answerField();
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter", altKey: true });
  return box;
}

describe("⌥↵ in the working answer", () => {
  it("saves at once and opens the line for why, which writes onto the Revision that save recorded", async () => {
    const save = vi.fn(() => saved);
    const explain = vi.fn(() => ({ written: true, hash: "ghi", shape: [] }));
    open(() => page("Probably both.", []), {
      "researchQuestions.saveWorkingAnswer": save,
      "researchQuestions.explainRevision": explain,
    });
    await saveWithAWhy();

    // The save goes first and on its own: the why never blocks it, which
    // is the whole reason escaping the line is not a cancel.
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      path: PATH,
      text: "Encoding strength, mostly.",
      basedOn: "abc",
      was: "Probably both.",
    });

    const line = await whyField();
    fireEvent.change(line, {
      target: { value: "Cordi's funnel plot — mostly small-study bias." },
    });
    fireEvent.keyDown(line, { key: "Enter" });
    await waitFor(() =>
      // Named by the entry's timestamp, and based on the file as that save
      // left it — an entry has no id, and the page's hash is now stale.
      expect(explain).toHaveBeenCalledWith({
        path: PATH,
        at: RECORDED,
        why: "Cordi's funnel plot — mostly small-study bias.",
        basedOn: "def",
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Why" })).toBeNull()
    );
  });

  it("esc on the line keeps the Revision and merely declines to explain it", async () => {
    const save = vi.fn(() => saved);
    const explain = vi.fn(() => ({ written: true, hash: "ghi", shape: [] }));
    open(() => page("Probably both.", []), {
      "researchQuestions.saveWorkingAnswer": save,
      "researchQuestions.explainRevision": explain,
    });
    await saveWithAWhy();
    const line = await whyField();
    fireEvent.change(line, { target: { value: "Half a thought." } });
    fireEvent.keyDown(line, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Why" })).toBeNull()
    );
    expect(explain).not.toHaveBeenCalled();
    // The save still happened: escaping declined the explanation, not the
    // change of mind.
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for a line left empty: ↵ over nothing is the same decline as esc", async () => {
    const explain = vi.fn(() => ({ written: true, hash: "ghi", shape: [] }));
    open(() => page("Probably both.", []), {
      "researchQuestions.explainRevision": explain,
    });
    await saveWithAWhy();
    fireEvent.keyDown(await whyField(), { key: "Enter" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Why" })).toBeNull()
    );
    expect(explain).not.toHaveBeenCalled();
  });

  it("a why the core would not write is a line with its reason, and the typing stays", async () => {
    open(() => page("Probably both.", []), {
      "researchQuestions.explainRevision": () => ({
        written: false,
        reason: "changedAndUnreapplyable",
        detail:
          "no revision in ## Position history is stamped 2026-09-21T10:00:00+02:00",
      }),
    });
    await saveWithAWhy();
    const line = await whyField();
    fireEvent.change(line, { target: { value: "Cordi's funnel plot." } });
    fireEvent.keyDown(line, { key: "Enter" });

    expect(
      await screen.findByText(/no revision in ## Position history is stamped/)
    ).toBeTruthy();
    expect((line as HTMLInputElement).value).toBe("Cordi's funnel plot.");
  });

  it("opens no line when there was nothing to save: there is no Revision to explain", async () => {
    const save = vi.fn(() => saved);
    open(() => page("Probably both.", []), {
      "researchQuestions.saveWorkingAnswer": save,
    });
    const box = await answerField();
    fireEvent.keyDown(box, { key: "Enter", altKey: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Why" })).toBeNull();
  });
});

describe("[[ inside the why line", () => {
  it("opens the one picker over everything in the vault and completes the link inline", async () => {
    const candidates = vi.fn(matching);
    const explain = vi.fn(() => ({ written: true, hash: "ghi", shape: [] }));
    open(() => page("Probably both.", []), {
      "picker.candidates": candidates,
      "researchQuestions.explainRevision": explain,
    });
    await saveWithAWhy();
    const line = (await whyField()) as HTMLInputElement;
    // As typed: the caret is at the end, right after the two brackets.
    fireEvent.change(line, {
      target: { value: "Mostly small-study bias. [[" },
    });

    // A why may name anything that changed a mind — a paper, an
    // experiment, another question — so the picker is narrowed to nothing.
    const picker = await screen.findByRole("dialog", { name: /why/i });
    await waitFor(() => expect(candidates).toHaveBeenCalledWith({ query: "" }));
    fireEvent.click(await within(picker).findByText("cordi2021"));

    await waitFor(() =>
      expect(line.value).toBe("Mostly small-study bias. [[cordi2021]]")
    );
    fireEvent.keyDown(line, { key: "Enter" });
    await waitFor(() =>
      expect(explain).toHaveBeenCalledWith({
        path: PATH,
        at: RECORDED,
        why: "Mostly small-study bias. [[cordi2021]]",
        basedOn: "def",
      })
    );
  });
});

describe("+ why on a past Revision", () => {
  const quiet = [
    entry("2026-07-02", null, "Mostly consolidation."),
    entry("2026-06-20", null, "Consolidation, surely."),
  ];

  const history = async () =>
    within(await region()).findByRole("region", { name: "Position history" });

  /** Expand the trail and take the *+ why* on the entry at `index`. */
  async function plusWhy(index: number) {
    const section = await history();
    fireEvent.click(
      within(section).getByRole("button", { name: /quiet revisions/ })
    );
    const buttons = within(section).getAllByRole("button", { name: "+ why" });
    fireEvent.click(buttons[index] as HTMLElement);
    return section;
  }

  it("explains a quiet Revision by its own timestamp, and the entry comes back at full width", async () => {
    const explain = vi.fn(() => ({ written: true, hash: "def", shape: [] }));
    let current = page("A third the size claimed.", quiet);
    open(() => current, { "researchQuestions.explainRevision": explain });
    const section = await plusWhy(1);

    const line = await whyField();
    fireEvent.change(line, {
      target: { value: "The power calculation, run myself." },
    });
    // The page's own hash: this Revision is months old and no save of the
    // page's stands between the read and the write.
    current = page("A third the size claimed.", [
      quiet[0] as Revision,
      entry(
        "2026-06-20",
        "The power calculation, run myself.",
        "Consolidation, surely."
      ),
    ]);
    fireEvent.keyDown(line, { key: "Enter" });
    await waitFor(() =>
      expect(explain).toHaveBeenCalledWith({
        path: PATH,
        at: "2026-06-20T10:00:00+02:00",
        why: "The power calculation, run myself.",
        basedOn: "abc",
      })
    );

    // The trail is one shorter and the entry now reads as a story: its why
    // beside what the answer became and what it moved from.
    await waitFor(() =>
      expect(section.textContent).toContain(
        "The power calculation, run myself."
      )
    );
    expect(
      within(section).getByRole("button", { name: /quiet revision/ })
        .textContent
    ).toContain("1 quiet revision");
  });

  it("esc leaves the Revision quiet, and the entry is still offered a why", async () => {
    const explain = vi.fn(() => ({ written: true, hash: "def", shape: [] }));
    open(() => page("A third the size claimed.", quiet), {
      "researchQuestions.explainRevision": explain,
    });
    const section = await plusWhy(0);
    fireEvent.keyDown(await whyField(), { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Why" })).toBeNull()
    );
    expect(explain).not.toHaveBeenCalled();
    expect(
      within(section).getAllByRole("button", { name: "+ why" })
    ).toHaveLength(2);
  });

  it("offers no + why on a Revision that already carries one", async () => {
    open(() =>
      page("A third the size claimed.", [
        entry("2026-08-05", "Cordi's funnel plot.", "Mostly consolidation."),
      ])
    );
    const section = await history();
    expect(section.textContent).toContain("Cordi's funnel plot.");
    expect(within(section).queryAllByRole("button", { name: "+ why" })).toEqual(
      []
    );
  });
});
