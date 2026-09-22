import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ResearchQuestionPage, ResearchQuestionSections } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, pressCaptureChord, renderApp, vault } from "./fake-core";

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
    related: { present: true, text: "", lines: [] },
    openThreads: { present: true, text: "", threads: [] },
    positionHistory: { present: true, text: "" },
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

const open = (
  page: () => ResearchQuestionPage,
  more: Record<string, unknown> = {}
) => {
  window.location.hash = `#/questions/${encodeURIComponent("questions")}/${encodeURIComponent("Does slow-wave density predict recall gain (RQ).md")}`;
  const asked: string[] = [];
  const rendered = renderApp({
    ...answers,
    "researchQuestions.page": (input: { path: string }) => {
      asked.push(input.path);
      return page();
    },
    ...more,
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
                resolvedKind: "source",
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
                resolvedKind: null,
              },
              note: "",
            },
          ],
        },
        related: {
          present: true,
          text: "- [[Nowhere]] — a note\n- just prose",
          lines: [
            {
              text: "[[Nowhere]] — a note",
              link: {
                target: "Nowhere",
                blockId: null,
                resolution: "unresolved",
                resolvedPath: null,
                resolvedKind: null,
              },
              note: "a note",
            },
            { text: "just prose", link: null, note: "just prose" },
          ],
        },
        openThreads: {
          present: true,
          text: "- [ ] Have not read Cordi & Rasch 2021.\n- [x] Is TMR orthogonal to encoding?",
          threads: [
            { text: "Have not read Cordi & Rasch 2021.", done: false },
            { text: "Is TMR orthogonal to encoding?", done: true },
          ],
        },
      },
    }));
    const page = await region();
    const answer = await within(page).findByRole("region", {
      name: "Working answer",
    });
    expect(answer.querySelectorAll("p").length).toBe(2);
    expect(answer.textContent).toContain("Probably both.");
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

// Editing on the page (#221; ADR 0020 decision 4): threads tick in place,
// the two Edited sections are plain text fields, a link to a Question opens
// it, and a capture made with the page on screen lands under related.

const THREADS: ResearchQuestionSections["openThreads"] = {
  present: true,
  text: "- [ ] Have not read Cordi & Rasch 2021.\n- [x] Is TMR orthogonal to encoding?",
  threads: [
    { text: "Have not read Cordi & Rasch 2021.", done: false },
    { text: "Is TMR orthogonal to encoding?", done: true },
  ],
};

const withThreads = (
  openThreads: ResearchQuestionSections["openThreads"]
): ResearchQuestionPage => ({
  ...fresh,
  sections: { ...fresh.sections, openThreads },
});

describe("open threads", () => {
  it("ticks a thread in place: the checkbox calls tickThread and the page re-reads it ticked", async () => {
    let page = withThreads(THREADS);
    const tick = vi.fn((input: unknown) => {
      const { text, done } = input as { text: string; done: boolean };
      page = withThreads({
        ...THREADS,
        threads: THREADS.threads.map((t) =>
          t.text === text ? { ...t, done } : t
        ),
      });
      return { written: true, hash: "def", content: "", shape: [] };
    });
    open(() => page, { "researchQuestions.tickThread": tick });
    const threads = await within(await region()).findByRole("region", {
      name: "Open threads",
    });
    const box = await within(threads).findByRole("checkbox", {
      name: "Have not read Cordi & Rasch 2021.",
    });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("true"));
    expect(tick).toHaveBeenCalledExactlyOnceWith({
      path: PATH,
      text: "Have not read Cordi & Rasch 2021.",
      done: true,
    });
    // Ticked, never removed: both threads are still there.
    expect(within(threads).getAllByRole("checkbox").length).toBe(2);
  });

  it("a refused tick is a line in the section, and the thread stays as it was", async () => {
    open(() => withThreads(THREADS), {
      "researchQuestions.tickThread": () => ({
        written: false,
        reason: "changedAndUnreapplyable",
        detail: 'no open thread reads "Have not read Cordi & Rasch 2021."',
      }),
    });
    const threads = await within(await region()).findByRole("region", {
      name: "Open threads",
    });
    fireEvent.click(
      await within(threads).findByRole("checkbox", {
        name: "Have not read Cordi & Rasch 2021.",
      })
    );
    const line = await within(threads).findByRole("status");
    expect(line.textContent).toContain("could not save");
    expect(line.textContent).toContain("no open thread reads");
    expect(
      within(threads)
        .getByRole("checkbox", { name: "Have not read Cordi & Rasch 2021." })
        .getAttribute("aria-checked")
    ).toBe("false");
  });
});

const RELATED: ResearchQuestionSections["related"] = {
  present: true,
  text: "- [[What counts as a reactivation event]] — shares 2 sources",
  lines: [
    {
      text: "[[What counts as a reactivation event]] — shares 2 sources",
      link: {
        target: "What counts as a reactivation event",
        blockId: null,
        resolution: "resolved" as const,
        resolvedPath: "questions/What counts as a reactivation event.md",
        resolvedKind: "question",
      },
      note: "shares 2 sources",
    },
  ],
};

const withRelated = (
  related: ResearchQuestionSections["related"]
): ResearchQuestionPage => ({
  ...fresh,
  sections: { ...fresh.sections, related },
});

describe("the Edited sections as plain text fields", () => {
  it("related links edit in place: the field holds the section's text, and ⌘↵ saves it basedOn the page's hash", async () => {
    let page = withRelated(RELATED);
    const save = vi.fn((input: unknown) => {
      const { body } = input as { body: string };
      page = withRelated({ ...RELATED, text: body });
      return { written: true, hash: "def", content: "", shape: [] };
    });
    open(() => page, { "researchQuestions.saveSection": save });
    const related = await within(await region()).findByRole("region", {
      name: "Related questions",
    });
    fireEvent.click(within(related).getByRole("button", { name: "edit" }));
    const field = within(related).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Related questions",
    });
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe(RELATED.text);
    const typed = RELATED.text + "\n- [[Nowhere]] — a neighbour";
    fireEvent.change(field, { target: { value: typed } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith({
        path: PATH,
        section: "Related questions",
        body: typed,
        basedOn: "abc",
      })
    );
    // Saved: the field closes and the section reads what was typed.
    await waitFor(() =>
      expect(
        within(related).queryByRole("textbox", { name: "Related questions" })
      ).toBeNull()
    );
    expect(within(related).getByRole("button", { name: "edit" })).toBeDefined();
  });

  it("open threads: blur saves, and esc reverts unsaved typing without a call", async () => {
    const save = vi.fn(() => ({
      written: true,
      hash: "def",
      content: "",
      shape: [],
    }));
    open(() => withThreads(THREADS), {
      "researchQuestions.saveSection": save,
    });
    const threads = await within(await region()).findByRole("region", {
      name: "Open threads",
    });
    fireEvent.click(within(threads).getByRole("button", { name: "edit" }));
    const field = within(threads).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Open threads",
    });
    fireEvent.change(field, { target: { value: "- [ ] typed and abandoned" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(
      within(threads).queryByRole("textbox", { name: "Open threads" })
    ).toBeNull();
    expect(save).not.toHaveBeenCalled();
    // The list is as it was, and the edit button has the keyboard back.
    expect(within(threads).getAllByRole("checkbox").length).toBe(2);
    expect(document.activeElement).toBe(
      within(threads).getByRole("button", { name: "edit" })
    );

    fireEvent.click(within(threads).getByRole("button", { name: "edit" }));
    const again = within(threads).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Open threads",
    });
    expect(again.value).toBe(THREADS.text);
    const typed = THREADS.text + "\n- [ ] Does the effect survive a nap?";
    fireEvent.change(again, { target: { value: typed } });
    fireEvent.blur(again);
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith({
        path: PATH,
        section: "Open threads",
        body: typed,
        basedOn: "abc",
      })
    );
  });

  it("a blur with nothing changed saves nothing", async () => {
    const save = vi.fn();
    open(() => withThreads(THREADS), {
      "researchQuestions.saveSection": save,
    });
    const threads = await within(await region()).findByRole("region", {
      name: "Open threads",
    });
    fireEvent.click(within(threads).getByRole("button", { name: "edit" }));
    fireEvent.blur(
      within(threads).getByRole("textbox", { name: "Open threads" })
    );
    expect(save).not.toHaveBeenCalled();
    expect(
      within(threads).queryByRole("textbox", { name: "Open threads" })
    ).toBeNull();
  });

  it("a refused save keeps the field open with the typing and says why in the section", async () => {
    open(() => withRelated(RELATED), {
      "researchQuestions.saveSection": () => ({
        written: false,
        reason: "changedAndUnreapplyable",
        detail: "the file is no longer there",
      }),
    });
    const related = await within(await region()).findByRole("region", {
      name: "Related questions",
    });
    fireEvent.click(within(related).getByRole("button", { name: "edit" }));
    const field = within(related).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Related questions",
    });
    fireEvent.change(field, { target: { value: "- [[Nowhere]]" } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    const line = await within(related).findByRole("status");
    expect(line.textContent).toContain(
      "could not save: changedAndUnreapplyable — the file is no longer there"
    );
    expect(
      within(related).getByRole<HTMLTextAreaElement>("textbox", {
        name: "Related questions",
      }).value
    ).toBe("- [[Nowhere]]");
  });
});

describe("links on the page", () => {
  const line = (
    target: string,
    resolvedKind: string | null,
    resolvedPath: string | null
  ) => ({
    text: `[[${target}]]`,
    link: {
      target,
      blockId: null,
      resolution:
        resolvedPath === null ? ("unresolved" as const) : ("resolved" as const),
      resolvedPath,
      resolvedKind,
    },
    note: "",
  });

  it("a link resolving to a Research Question opens it by hash; one resolving elsewhere — a Question has no address yet — is inert", async () => {
    open(() =>
      withRelated({
        present: true,
        text: "",
        lines: [
          line("Other (RQ)", "research-question", "questions/Other (RQ).md"),
          line("A capture", "question", "questions/A capture.md"),
          line("A note", null, "notes/A note.md"),
          line("A paper", "source", "sources/rasch2013.md"),
          line("Nowhere", null, null),
        ],
      })
    );
    const related = await within(await region()).findByRole("region", {
      name: "Related questions",
    });
    const links = within(related).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Other (RQ)"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "#/questions/questions/Other%20(RQ).md",
    ]);
    // The rest are text: nothing to click, nothing that pretends to open.
    expect(related.textContent).toContain("A capture");
    expect(related.textContent).toContain("A note");
    expect(related.textContent).toContain("A paper");
    expect(related.textContent).toContain("Nowhere");
    expect(related.textContent).toContain("unresolved");

    fireEvent.click(links[0]!);
    await waitFor(() =>
      expect(window.location.hash).toBe("#/questions/questions/Other%20(RQ).md")
    );
  });
});

describe("capturing from the page", () => {
  it("⌘' on the page captures pursuing this Research Question; the new Question lands under related and the keyboard goes back where it was", async () => {
    let page = withRelated(RELATED);
    const capture = vi.fn((input: unknown) => {
      const { text } = input as { text: string };
      page = withRelated({
        ...RELATED,
        text: RELATED.text + `\n- [[${text.replace("?", "")}]]`,
        lines: [
          ...RELATED.lines,
          {
            text: `[[${text.replace("?", "")}]]`,
            link: {
              target: text.replace("?", ""),
              blockId: null,
              resolution: "resolved" as const,
              resolvedPath: `questions/${text.replace("?", "")}.md`,
              resolvedKind: "question",
            },
            note: "",
          },
        ],
      });
      return {
        id: "k7m2p9q4wx",
        path: `${vault.path}/questions/${text.replace("?", "")}.md`,
        question: text,
        status: "open",
        captured: "2026-09-21T10:00:00+02:00",
        from: "[[Does slow-wave density predict recall gain (RQ)]]",
        context: "pursuing",
      };
    });
    open(() => page, { "questions.capture": capture });
    const related = await within(await region()).findByRole("region", {
      name: "Related questions",
    });
    const edit = within(related).getByRole("button", { name: "edit" });
    edit.focus();

    pressCaptureChord();
    const line = screen.getByRole("form", { name: "Capture" });
    expect(line.textContent).toContain(
      "Pursuing · Does slow-wave density predict recall gain (RQ)"
    );
    const input = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(input, {
      target: { value: "Does the effect survive a nap?" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull()
    );
    expect(capture).toHaveBeenCalledExactlyOnceWith({
      text: "Does the effect survive a nap?",
      provenance: { context: "pursuing", researchQuestion: PATH },
    });
    // Back where it was: the page is not where the Question landed as a row
    // (ADR 0010), so nothing on it takes the keyboard.
    expect(document.activeElement).toBe(edit);
    await waitFor(() =>
      expect(related.textContent).toContain("Does the effect survive a nap")
    );
  });
});

// Resolving (#222; ADR 0020 decision 6): the working answer as it stands is
// the answer, so resolve and abandon are one button each and there is no
// second field. Resolving is a status, not an archive — the page keeps
// everything it had and offers to reopen.

const ANSWERED: ResearchQuestionPage = {
  ...fresh,
  frontmatter: {
    ...fresh.frontmatter,
    status: "answered",
    answered: "2026-09-21T10:00:00+02:00",
  },
  sections: {
    ...fresh.sections,
    workingAnswer: { present: true, text: "Probably both." },
    positionHistory: {
      present: true,
      text: "- 2026-09-21T09:00:00+02:00 · working answer\n  from:",
    },
  },
};

describe("resolving, abandoning, and reopening", () => {
  it("resolves from the page: one call, and the page comes back answered with its history intact", async () => {
    let page: ResearchQuestionPage = {
      ...ANSWERED,
      frontmatter: { ...fresh.frontmatter },
    };
    const resolve = vi.fn(() => {
      page = ANSWERED;
      return { page: { written: true }, question: { written: true } };
    });
    open(() => page, { "researchQuestions.resolve": resolve });
    const view = await region();
    fireEvent.click(
      await within(view).findByRole("button", { name: "resolve" })
    );

    await waitFor(() =>
      expect(resolve).toHaveBeenCalledExactlyOnceWith({
        path: PATH,
        status: "answered",
      })
    );
    // The status line changes, and nothing else on the page is taken away.
    await waitFor(() =>
      expect(within(view).getByRole("img", { name: "answered" })).toBeDefined()
    );
    expect(view.textContent).toContain("Probably both.");
    expect(
      within(view).getByRole("region", { name: "Position history" }).textContent
    ).toContain("working answer");
  });

  it("abandons with the page's own word, and offers reopen once it is resolved", async () => {
    let page: ResearchQuestionPage = {
      ...fresh,
      sections: ANSWERED.sections,
    };
    const abandoned: ResearchQuestionPage = {
      ...page,
      frontmatter: { ...fresh.frontmatter, status: "abandoned" },
    };
    const resolve = vi.fn(() => {
      page = abandoned;
      return { page: { written: true }, question: { written: true } };
    });
    const reopen = vi.fn(() => {
      page = { ...abandoned, frontmatter: { ...fresh.frontmatter } };
      return { written: true, hash: "def", content: "", shape: [] };
    });
    open(() => page, {
      "researchQuestions.resolve": resolve,
      "researchQuestions.reopen": reopen,
    });
    const view = await region();
    // Nothing to reopen while it is open.
    expect(within(view).queryByRole("button", { name: "reopen" })).toBeNull();
    fireEvent.click(
      await within(view).findByRole("button", { name: "abandon" })
    );

    await waitFor(() =>
      expect(resolve).toHaveBeenCalledExactlyOnceWith({
        path: PATH,
        status: "abandoned",
      })
    );
    await waitFor(() =>
      expect(within(view).getByRole("img", { name: "abandoned" })).toBeDefined()
    );
    expect(within(view).queryByRole("button", { name: "resolve" })).toBeNull();

    fireEvent.click(within(view).getByRole("button", { name: "reopen" }));
    await waitFor(() =>
      expect(reopen).toHaveBeenCalledExactlyOnceWith({ path: PATH })
    );
    await waitFor(() =>
      expect(within(view).getByRole("img", { name: "open" })).toBeDefined()
    );
  });

  it("a write-back that reached no Question is a line on the page, which stays resolved", async () => {
    let page: ResearchQuestionPage = {
      ...fresh,
      sections: ANSWERED.sections,
    };
    open(() => page, {
      "researchQuestions.resolve": () => {
        page = ANSWERED;
        return {
          page: { written: true },
          question: {
            written: false,
            reason:
              "[[Does slow-wave density predict recall gain]] matches no file in the vault",
          },
        };
      },
    });
    const view = await region();
    fireEvent.click(
      await within(view).findByRole("button", { name: "resolve" })
    );

    const line = await within(view).findByRole("status");
    expect(line.textContent).toContain("matches no file in the vault");
    await waitFor(() =>
      expect(within(view).getByRole("img", { name: "answered" })).toBeDefined()
    );
  });

  it("a refused page write says so and leaves the page as it was", async () => {
    open(() => fresh, {
      "researchQuestions.resolve": () => ({
        page: {
          written: false,
          reason: "changedAndUnreapplyable",
          detail: "the file is no longer there",
        },
        question: { written: false, reason: "the page was not resolved" },
      }),
    });
    const view = await region();
    fireEvent.click(
      await within(view).findByRole("button", { name: "resolve" })
    );

    const line = await within(view).findByRole("status");
    expect(line.textContent).toContain("the file is no longer there");
    expect(within(view).getByRole("img", { name: "open" })).toBeDefined();
  });
});
