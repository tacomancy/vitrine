import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ResearchQuestionPage, Revision } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Research Question view's first state (#209; brief § Surfaces, prompt 3
// "freshly promoted"): the question, its provenance, its status, and six
// quiet outlines. Read-only; the page follows its file under external change
// as the Inbox's selection does.

const PATH = "questions/Does slow-wave density predict recall gain (RQ).md";

const fresh: ResearchQuestionPage = {
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: {
    id: "rq7m2p9q4w",
    question:
      "Does slow-wave density predict recall gain, or is it a proxy for encoding strength at learning?",
    status: "open",
    promotedFrom: "[[Does slow-wave density predict recall gain]]",
    promoted: "2026-09-20T10:00:00+02:00",
    captured: "2026-08-14T09:12:00Z",
    context: "reading",
    from: "[[Rasch & Born 2013]]",
    page: 699,
    tags: ["memory/consolidation"],
  },
  sections: {
    workingAnswer: { present: true, text: "" },
    supporting: { present: true, lines: [] },
    opposing: { present: true, lines: [] },
    related: { present: true, lines: [] },
    openThreads: { present: true, threads: [] },
    positionHistory: { present: true, text: "", entries: [] },
  },
  problems: [],
};

const answers = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": {
    indexing: null,
    watching: { ok: true },
    current: { ok: true },
  },
};

const open = (page: () => ResearchQuestionPage) => {
  window.location.hash = `#/questions/${encodeURIComponent("questions")}/${encodeURIComponent("Does slow-wave density predict recall gain (RQ).md")}`;
  const asked: string[] = [];
  const rendered = renderApp({
    ...answers,
    "researchQuestions.page": (input: { path: string }) => {
      asked.push(input.path);
      return page();
    },
  });
  return { ...rendered, asked };
};

const region = () =>
  screen.findByRole("region", { name: "Research Question view" });

describe("the freshly promoted state", () => {
  it("leads with the question in the serif, the provenance line, and the status glyph with its label", async () => {
    open(() => fresh);
    const page = await region();
    const heading = await within(page).findByRole("heading", { level: 1 });
    expect(heading.textContent).toBe(fresh.frontmatter.question);
    expect(page.textContent).toContain(
      "first wondered 14 August 2026 · 09:12 · while reading Rasch & Born 2013 · p.699"
    );
    const status = within(page).getByRole("img", { name: "open" });
    expect(status.textContent).toBe("◆");
    expect(page.textContent).toContain("open");
    // No count of anything is owed here: the page has no badge and no number
    // that is not a date or a page.
    expect(page.textContent).not.toMatch(/\b0 (sources|threads|questions)/);
  });

  it("draws the six sections as outlines, each with one sentence on what belongs there", async () => {
    open(() => fresh);
    const page = await region();
    const names = [
      "Working answer",
      "Supporting sources",
      "Opposing sources",
      "Related questions",
      "Open threads",
      "Position history",
    ];
    for (const name of names) {
      const section = await within(page).findByRole("region", { name });
      // The sentence is prose, one full stop at least, and never a heading.
      const sentence = within(section).getByText(/\.\s*$/);
      expect(sentence.textContent?.length).toBeGreaterThan(20);
    }
    // The history's base line is derived from the frontmatter, never an entry.
    const history = within(page).getByRole("region", {
      name: "Position history",
    });
    expect(history.textContent).toContain(
      "promoted from a capture made while reading Rasch & Born 2013 · p.699, 20 September 2026"
    );
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });

  it("renders what parsed, and a section with content is drawn as content, not an outline", async () => {
    open(() => ({
      ...fresh,
      sections: {
        ...fresh.sections,
        workingAnswer: {
          present: true,
          text: "Probably both.\n\nA second paragraph.",
        },
        supporting: {
          present: true,
          lines: [
            {
              text: "[[rasch2013#^h4]] — TMR effects survive encoding controls.",
              link: {
                target: "rasch2013",
                blockId: "h4",
                resolution: "resolved",
                resolvedPath: "sources/rasch2013.md",
              },
              note: "TMR effects survive encoding controls.",
            },
          ],
        },
        opposing: {
          present: true,
          lines: [
            {
              text: "[[wamsley2019]]",
              link: {
                target: "wamsley2019",
                blockId: null,
                resolution: "ambiguous",
                resolvedPath: null,
              },
              note: "",
            },
          ],
        },
        related: {
          present: true,
          lines: [
            {
              text: "[[Nowhere]] — a note",
              link: {
                target: "Nowhere",
                blockId: null,
                resolution: "unresolved",
                resolvedPath: null,
              },
              note: "a note",
            },
            { text: "just prose", link: null, note: "just prose" },
          ],
        },
        openThreads: {
          present: true,
          threads: [
            { text: "Have not read Cordi & Rasch 2021.", done: false },
            { text: "Is TMR orthogonal to encoding?", done: true },
          ],
        },
      },
    }));
    const page = await region();
    const answer = await within(page).findByRole("textbox", {
      name: "Working answer",
    });
    expect((answer as HTMLTextAreaElement).value).toBe(
      "Probably both.\n\nA second paragraph."
    );
    const supporting = within(page).getByRole("region", {
      name: "Supporting sources",
    });
    expect(supporting.textContent).toContain("rasch2013#^h4");
    expect(supporting.textContent).toContain(
      "TMR effects survive encoding controls."
    );
    // A link that lands nowhere, or on two files, says so rather than vanishing.
    const opposing = within(page).getByRole("region", {
      name: "Opposing sources",
    });
    expect(opposing.textContent).toContain("wamsley2019");
    expect(opposing.textContent).toContain("ambiguous");
    const related = within(page).getByRole("region", {
      name: "Related questions",
    });
    expect(related.textContent).toContain("Nowhere");
    expect(related.textContent).toContain("unresolved");
    expect(related.textContent).toContain("just prose");
    const threads = within(page).getByRole("region", { name: "Open threads" });
    const boxes = within(threads).getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);
  });

  it("a file with a shape problem renders what parsed with a footer line saying what did not", async () => {
    open(() => ({
      ...fresh,
      sections: {
        ...fresh.sections,
        workingAnswer: { present: false, text: "" },
      },
      problems: [
        {
          path: PATH,
          kind: "research-question",
          problem: "ownedSectionDuplicated",
          block: "Position history",
        },
        {
          path: PATH,
          kind: "research-question",
          problem: "sectionMissing",
          block: "Working answer",
        },
      ],
    }));
    const page = await region();
    expect(
      (await within(page).findByRole("heading", { level: 1 })).textContent
    ).toBe(fresh.frontmatter.question);
    const footer = within(page).getByRole("contentinfo");
    expect(footer.textContent).toContain(
      "could not show: Position history is in the file twice · Working answer is not in the file"
    );
    const answer = within(page).getByRole("region", {
      name: "Working answer",
    });
    expect(answer.textContent).toContain("not in the file");
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

  it("follows its path through renamed: the hash moves to `to` and the page re-reads there", async () => {
    const { stream, asked } = open(() => fresh);
    await region();
    await waitFor(() => expect(asked).toContain(PATH));
    const to = "questions/Renamed in Obsidian (RQ).md";
    act(() => {
      stream.push(changed({ renamed: [{ from: PATH, to }] }));
    });
    await waitFor(() => expect(asked).toContain(to));
    expect(window.location.hash).toBe(
      "#/questions/questions/Renamed%20in%20Obsidian%20(RQ).md"
    );
    expect(
      (await within(await region()).findByRole("heading", { level: 1 }))
        .textContent
    ).toBe(fresh.frontmatter.question);
  });

  it("clears quietly with an absence line when its path is in removed", async () => {
    let page: ResearchQuestionPage = fresh;
    const { stream } = open(() => page);
    const before = await region();
    await within(before).findByRole("heading", { level: 1 });
    page = { readable: false, path: PATH, reason: "not in the vault" };
    act(() => {
      stream.push(changed({ removed: [PATH] }));
    });
    const after = await region();
    await waitFor(() => {
      expect(within(after).queryByRole("heading", { level: 1 })).toBeNull();
    });
    expect(after.textContent).toContain(`${PATH} — removed from the vault`);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("re-reads when its path is in changed, so an Obsidian edit appears", async () => {
    let page: ResearchQuestionPage = fresh;
    const { stream } = open(() => page);
    const region1 = await region();
    await within(region1).findByRole("heading", { level: 1 });
    page = {
      ...fresh,
      sections: {
        ...fresh.sections,
        workingAnswer: { present: true, text: "Typed in Obsidian." },
      },
    };
    act(() => {
      stream.push(changed({ changed: [PATH] }));
    });
    await waitFor(() => {
      expect(
        within(region1).getByRole("region", { name: "Working answer" })
          .textContent
      ).toContain("Typed in Obsidian.");
    });
  });

  it("renders the not-found line with the reason for a path the core cannot read as a page", async () => {
    open(() => ({
      readable: false,
      path: PATH,
      reason: "not a Research Question: kind is question",
    }));
    const page = await region();
    expect(
      (
        await within(page).findByText(
          `${PATH} — not a Research Question: kind is question`
        )
      ).textContent
    ).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a path the core refuses as an alert, never a quiet line", async () => {
    window.location.hash = "#/questions/notes/plan.txt";
    renderApp({
      ...answers,
      "researchQuestions.page": () => {
        throw new Error("notes/plan.txt is not a Markdown file.");
      },
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "notes/plan.txt is not a Markdown file."
    );
  });
});

// Editing the working answer (#213; spec #206 stories 14, 18, 31): a plain
// text field — autosave on blur, ⌘↵ saves now, esc reverts — every save
// `basedOn` the hash the page was given; the header derives "revision N of
// M · held since" from the entries. The Revision itself is the core's.
describe("editing the working answer", () => {
  const withAnswer = (
    text: string,
    entries: Revision[],
    hash = "abc"
  ): ResearchQuestionPage => ({
    ...fresh,
    hash,
    sections: {
      ...fresh.sections,
      workingAnswer: { present: true, text },
      positionHistory: { present: true, text: "", entries },
    },
  });

  type Saved = { path: string; text: string; basedOn: string };

  const editable = (
    page: () => ResearchQuestionPage,
    answer: (input: Saved) => unknown = () => ({
      written: true,
      hash: "def",
    })
  ) => {
    const saves: Saved[] = [];
    window.location.hash = `#/questions/${encodeURIComponent("questions")}/${encodeURIComponent("Does slow-wave density predict recall gain (RQ).md")}`;
    renderApp({
      ...answers,
      "researchQuestions.page": page,
      "researchQuestions.saveWorkingAnswer": (input: Saved) => {
        saves.push(input);
        return answer(input);
      },
    });
    return { saves };
  };

  const field = async () =>
    within(await region()).findByRole("textbox", { name: "Working answer" });

  it("saves on blur with the text typed and the page's hash as basedOn, then shows the page as re-read", async () => {
    let page = withAnswer("Probably both.", []);
    const { saves } = editable(() => page);
    const box = await field();
    expect((box as HTMLTextAreaElement).value).toBe("Probably both.");
    page = withAnswer(
      "Encoding strength, mostly.",
      [
        {
          at: "2026-09-21T10:00:00+02:00",
          field: "working answer",
          why: null,
          from: "Probably both.",
        },
      ],
      "def"
    );
    fireEvent.change(box, { target: { value: "Encoding strength, mostly." } });
    fireEvent.blur(box);
    await waitFor(() =>
      expect(saves).toEqual([
        { path: PATH, text: "Encoding strength, mostly.", basedOn: "abc" },
      ])
    );
    const page1 = await region();
    await waitFor(() => expect(page1.textContent).toContain("revision 1 of 1"));
    expect((box as HTMLTextAreaElement).value).toBe(
      "Encoding strength, mostly."
    );
  });

  it("⌘↵ saves now; a blur that follows does not save again", async () => {
    const { saves } = editable(() => withAnswer("", []));
    const box = await field();
    fireEvent.change(box, { target: { value: "Typed." } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(saves.length).toBe(1));
    fireEvent.blur(box);
    await new Promise((r) => setTimeout(r, 10));
    expect(saves.length).toBe(1);
  });

  it("esc reverts unsaved typing and saves nothing; blur over unchanged text saves nothing", async () => {
    const { saves } = editable(() => withAnswer("Probably both.", []));
    const box = await field();
    fireEvent.change(box, { target: { value: "Probably not." } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect((box as HTMLTextAreaElement).value).toBe("Probably both.");
    fireEvent.blur(box);
    await new Promise((r) => setTimeout(r, 10));
    expect(saves).toEqual([]);
  });

  it("a refused save is a line in the section with the reason, and the typing stays", async () => {
    editable(
      () => withAnswer("Probably both.", []),
      () => ({
        written: false,
        reason: "changedAndUnreapplyable",
        detail: "the file is no longer there",
      })
    );
    const box = await field();
    fireEvent.change(box, { target: { value: "Probably not." } });
    fireEvent.blur(box);
    const section = within(await region()).getByRole("region", {
      name: "Working answer",
    });
    await waitFor(() =>
      expect(section.textContent).toContain(
        "not saved — the file is no longer there"
      )
    );
    expect((box as HTMLTextAreaElement).value).toBe("Probably not.");
  });

  it("the header reads revision N of M · held since the newest entry, and 'no revisions yet' before any", async () => {
    editable(() => withAnswer("", []));
    await within(await region()).findByText("no revisions yet");
    cleanup();
    editable(() =>
      withAnswer("Third.", [
        {
          at: "2026-09-08T10:00:00+02:00",
          field: "working answer",
          why: null,
          from: "Second.",
        },
        {
          at: "2026-08-05T10:00:00+02:00",
          field: "working answer",
          why: "explained",
          from: "First.",
        },
        {
          at: "2026-07-02T10:00:00+02:00",
          field: "working answer",
          why: null,
          from: "",
        },
      ])
    );
    await within(await region()).findByText(
      "revision 3 of 3 · held since 8 September 2026"
    );
  });
});
