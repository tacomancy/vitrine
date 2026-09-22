import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  ResearchQuestionPage,
  ResearchQuestionSections,
  Revision,
} from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, pressCaptureChord, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Research Question view's first state (#209; brief § Surfaces, prompt 3
// "freshly promoted"): the question, its provenance, its status, and six
// quiet outlines. Read-only; the page follows its file under external change
// as the Inbox's selection does.

const PATH = "questions/Does slow-wave density predict recall gain (RQ).md";

/** The readable half of the page: what every fixture here varies. */
type Readable = Extract<ResearchQuestionPage, { readable: true }>;

const fresh: Readable = {
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

  it("draws the empty sections as outlines, each with one sentence on what belongs there", async () => {
    open(() => fresh);
    const page = await region();
    const names = [
      "Working answer",
      "Supporting sources",
      "Opposing sources",
      "Related questions",
      "Open threads",
    ];
    for (const name of names) {
      const section = await within(page).findByRole("region", { name });
      // The sentence is prose, one full stop at least, and never a heading.
      const sentence = within(section).getByText(/\.\s*$/);
      expect(sentence.textContent?.length).toBeGreaterThan(20);
    }
    // The sixth is the exception: a history with nothing in it is its base
    // line, which says where the page came from — an outline around that
    // would be an emptiness the line has already explained (#214).
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

  type Saved = {
    path: string;
    text: string;
    basedOn: string;
    was: string;
  };

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
        {
          path: PATH,
          text: "Encoding strength, mostly.",
          basedOn: "abc",
          was: "Probably both.",
        },
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
        reason: "verificationFailed",
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
  related: ResearchQuestionSections["related"],
  hash = fresh.hash
): Readable => ({
  ...fresh,
  hash,
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
        was: RELATED.text,
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
        was: THREADS.text,
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
        reason: "verificationFailed",
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
      "could not save: verificationFailed — the file is no longer there"
    );
    expect(
      within(related).getByRole<HTMLTextAreaElement>("textbox", {
        name: "Related questions",
      }).value
    ).toBe("- [[Nowhere]]");
  });
});

// A save that lands on a section changed underneath (#215; ADR 0015
// decision 5, ADR 0020 consequences): the refusal is the Vault editor's
// *changed on disk* line inside that section, never a lost edit on either
// side. `changedAndUnreapplyable` is the protocol's one word for "the file
// moved under this write", so on a section save it is always this line;
// every other refusal stays the plain one.
describe("changed on disk, inside the section", () => {
  const CONFLICT = {
    written: false,
    reason: "changedAndUnreapplyable",
    detail: "the section changed on disk since the page read it",
  };
  const DISK = "- [[Obsidian wrote this]]";
  const TYPED = RELATED.text + "\n- [[Nowhere]] — a neighbour";
  const vaultChanged = {
    type: "vaultChanged" as const,
    changed: [PATH],
    removed: [],
    renamed: [],
  };

  /** The field open on the section's text, with the typing in it. */
  const dirty = async (save: unknown, page: () => ResearchQuestionPage) => {
    const rendered = open(page, { "researchQuestions.saveSection": save });
    const related = await within(await region()).findByRole("region", {
      name: "Related questions",
    });
    fireEvent.click(within(related).getByRole("button", { name: "edit" }));
    const field = within(related).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Related questions",
    });
    fireEvent.change(field, { target: { value: TYPED } });
    return { ...rendered, related, field };
  };

  it("keep mine re-reads the hash and the disk copy, saves the typing again, and the line clears", async () => {
    let page = withRelated(RELATED);
    let refuse = true;
    const save = vi.fn((input: unknown) => {
      if (refuse) return CONFLICT;
      const { body } = input as { body: string };
      page = withRelated({ ...RELATED, text: body }, "ghi");
      return { written: true, hash: "ghi", content: "", shape: [] };
    });
    const { related, field } = await dirty(save, () => page);
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });

    const line = await within(related).findByRole("status");
    expect(line.textContent).toContain("changed on disk");
    // Autosave is suspended while the line is up: a blur must not keep
    // asking a question that has been answered with a refusal.
    fireEvent.blur(field);
    await new Promise((r) => setTimeout(r, 10));
    expect(save).toHaveBeenCalledTimes(1);
    expect(field.value).toBe(TYPED);

    // The file as Obsidian left it, which *keep mine* saves over.
    page = withRelated({ ...RELATED, text: DISK }, "xyz");
    refuse = false;
    fireEvent.click(within(related).getByRole("button", { name: "keep mine" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0]).toEqual({
      path: PATH,
      section: "Related questions",
      body: TYPED,
      basedOn: "xyz",
      was: DISK,
    });
    await waitFor(() =>
      expect(within(related).queryByRole("status")).toBeNull()
    );
  });

  it("take the disk copy replaces the field with the disk text, clears the line, and writes nothing", async () => {
    let page = withRelated(RELATED);
    const save = vi.fn(() => CONFLICT);
    const { related, field } = await dirty(save, () => page);
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await within(related).findByRole("status");

    page = withRelated({ ...RELATED, text: DISK }, "xyz");
    fireEvent.click(
      within(related).getByRole("button", { name: "take the disk copy" })
    );
    await waitFor(() => expect(field.value).toBe(DISK));
    expect(within(related).queryByRole("status")).toBeNull();
    // The typing is gone, so the blur that follows has nothing to save.
    fireEvent.blur(field);
    await new Promise((r) => setTimeout(r, 10));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("an edit to another section while the field is dirty raises no line: the save carries what the field opened on", async () => {
    let page = withRelated(RELATED);
    const save = vi.fn(() => ({
      written: true,
      hash: "xyz",
      content: "",
      shape: [],
    }));
    const { related, field, stream } = await dirty(save, () => page);
    // Obsidian touched the Working answer; the page re-reads under the
    // open field, and the field keeps the text and hash it opened on.
    const onDisk = withRelated(RELATED, "xyz");
    page = {
      ...onDisk,
      sections: {
        ...onDisk.sections,
        workingAnswer: { present: true, text: "Typed in Obsidian." },
      },
    };
    act(() => stream.push(vaultChanged));
    const view = await region();
    await waitFor(() =>
      expect(
        within(view).getByRole("region", { name: "Working answer" }).textContent
      ).toContain("Typed in Obsidian.")
    );
    fireEvent.blur(field);
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith({
        path: PATH,
        section: "Related questions",
        body: TYPED,
        basedOn: "abc",
        was: RELATED.text,
      })
    );
    expect(within(related).queryByRole("status")).toBeNull();
  });

  it("the working answer takes the same line, with the same two actions", async () => {
    let page: Readable = {
      ...fresh,
      sections: {
        ...fresh.sections,
        workingAnswer: { present: true, text: "Probably both." },
      },
    };
    let refuse = true;
    const saves: unknown[] = [];
    const save = vi.fn((input: unknown) => {
      saves.push(input);
      return refuse
        ? CONFLICT
        : { written: true, hash: "ghi", content: "", shape: [] };
    });
    open(() => page, { "researchQuestions.saveWorkingAnswer": save });
    const answer = await within(await region()).findByRole("region", {
      name: "Working answer",
    });
    const box = within(answer).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Working answer",
    });
    fireEvent.change(box, { target: { value: "Probably not." } });
    fireEvent.blur(box);
    const line = await within(answer).findByRole("status");
    expect(line.textContent).toContain("changed on disk");
    fireEvent.blur(box);
    await new Promise((r) => setTimeout(r, 10));
    expect(save).toHaveBeenCalledTimes(1);

    page = {
      ...fresh,
      hash: "xyz",
      sections: {
        ...fresh.sections,
        workingAnswer: { present: true, text: "Obsidian wrote this." },
      },
    };
    refuse = false;
    fireEvent.click(within(answer).getByRole("button", { name: "keep mine" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(saves[1]).toEqual({
      path: PATH,
      text: "Probably not.",
      basedOn: "xyz",
      was: "Obsidian wrote this.",
    });
    await waitFor(() =>
      expect(within(answer).queryByRole("status")).toBeNull()
    );
  });

  it("the working answer keeps what it opened on too: an edit to another section under a dirty field raises no line", async () => {
    let page: Readable = {
      ...fresh,
      sections: {
        ...fresh.sections,
        workingAnswer: { present: true, text: "Probably both." },
      },
    };
    const saves: unknown[] = [];
    const save = vi.fn((input: unknown) => {
      saves.push(input);
      return { written: true, hash: "ghi", content: "", shape: [] };
    });
    page = { ...page, sections: { ...page.sections, related: RELATED } };
    const { stream } = open(() => page, {
      "researchQuestions.saveWorkingAnswer": save,
    });
    const answer = await within(await region()).findByRole("region", {
      name: "Working answer",
    });
    const box = within(answer).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Working answer",
    });
    fireEvent.change(box, { target: { value: "Probably not." } });
    // Obsidian touched Related questions; the page re-reads under the
    // dirty field, which keeps the hash and the text it went dirty on.
    page = {
      ...fresh,
      hash: "xyz",
      sections: {
        ...fresh.sections,
        workingAnswer: { present: true, text: "Probably both." },
        related: { present: true, text: DISK, lines: [] },
      },
    };
    act(() => stream.push(vaultChanged));
    const view = await region();
    await waitFor(() =>
      expect(
        within(view).getByRole("region", { name: "Related questions" })
          .textContent
      ).toContain("Nothing linked")
    );
    fireEvent.blur(box);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(saves[0]).toEqual({
      path: PATH,
      text: "Probably not.",
      basedOn: "abc",
      was: "Probably both.",
    });
    expect(within(answer).queryByRole("status")).toBeNull();
  });

  it("keep mine over a file that can no longer be read says why and keeps the typing", async () => {
    let page: ResearchQuestionPage = withRelated(RELATED);
    const save = vi.fn(() => CONFLICT);
    const { related, field } = await dirty(save, () => page);
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await within(related).findByRole("status");

    // `changedAndUnreapplyable` covers a file that is gone as well as a
    // section that moved; *keep mine* has nothing to save over.
    page = { readable: false, path: PATH, reason: "not in the vault" };
    fireEvent.click(within(related).getByRole("button", { name: "keep mine" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "not in the vault"
      )
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("take the disk copy on the working answer shows what is on disk", async () => {
    let page: Readable = {
      ...fresh,
      sections: {
        ...fresh.sections,
        workingAnswer: { present: true, text: "Probably both." },
      },
    };
    const save = vi.fn(() => CONFLICT);
    open(() => page, { "researchQuestions.saveWorkingAnswer": save });
    const answer = await within(await region()).findByRole("region", {
      name: "Working answer",
    });
    const box = within(answer).getByRole<HTMLTextAreaElement>("textbox", {
      name: "Working answer",
    });
    fireEvent.change(box, { target: { value: "Probably not." } });
    fireEvent.blur(box);
    await within(answer).findByRole("status");
    page = {
      ...fresh,
      hash: "xyz",
      sections: {
        ...fresh.sections,
        workingAnswer: { present: true, text: "Obsidian wrote this." },
      },
    };
    fireEvent.click(
      within(answer).getByRole("button", { name: "take the disk copy" })
    );
    await waitFor(() => expect(box.value).toBe("Obsidian wrote this."));
    expect(within(answer).queryByRole("status")).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
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

// The history rendered in place as a narrative (#214; spec #206 stories
// 37–39; prompt 3 "a train of thought, not a diff log"): explained
// Revisions lead at full width, quiet ones collapse into a trail that
// expands, a filter puts the narrative on its own, and the base line under
// it all is derived from the frontmatter rather than written as an entry.
describe("the position history", () => {
  const entry = (
    date: string,
    why: string | null,
    from: string,
    field = "working answer"
  ): Revision => ({ at: `${date}T10:00:00+02:00`, field, why, from });

  const explained = entry(
    "2026-08-05",
    "Cordi's funnel plot — mostly small-study bias. [[cordi2021#^h12]], against [[wamsley2019|the 2019 null]]",
    "Probably both, but the designs are underpowered."
  );
  const quiet = [
    entry("2026-07-02", null, "Mostly consolidation."),
    entry("2026-06-20", null, "Consolidation, surely."),
  ];
  const first = entry("2026-02-19", "First real position.", "");

  const withHistory = (entries: Revision[]): ResearchQuestionPage => ({
    ...fresh,
    sections: {
      ...fresh.sections,
      workingAnswer: { present: true, text: "A third the size claimed." },
      positionHistory: { present: true, text: "…", entries },
    },
  });

  const history = async () =>
    within(await region()).findByRole("region", { name: "Position history" });

  it("leads with the explained Revisions at full width — what the answer became, the why with its links, and what it moved from", async () => {
    open(() => withHistory([explained, ...quiet, first]));
    const section = await history();
    const entries = within(section).getAllByRole("listitem");
    const lead = entries[0] as HTMLElement;
    expect(lead.textContent).toContain("5 August 2026");
    expect(lead.textContent).toContain("A third the size claimed.");
    expect(lead.textContent).toContain("Cordi's funnel plot");
    // The why's links read as links, through the same grammar the rest of
    // the page reads one with: the block id kept, an alias in place of its target.
    expect(within(lead).getByText("cordi2021#^h12")).toBeTruthy();
    expect(within(lead).getByText("the 2019 null")).toBeTruthy();
    expect(lead.textContent).toContain(
      "from — Probably both, but the designs are underpowered."
    );
    // The oldest entry moved the answer from nothing: it is the first position.
    const last = entries[entries.length - 1] as HTMLElement;
    expect(last.textContent).toContain("first position");
    expect(last.textContent).not.toContain("from —");
  });

  it("collapses a run of quiet Revisions into a count and a span that expands on demand", async () => {
    open(() => withHistory([explained, ...quiet, first]));
    const section = await history();
    const trail = within(section).getByRole("button", {
      name: /quiet revisions/,
    });
    expect(trail.textContent).toContain("2 quiet revisions over 12 days");
    expect(trail.getAttribute("aria-expanded")).toBe("false");
    expect(section.textContent).not.toContain("Mostly consolidation.");

    fireEvent.click(trail);
    expect(trail.getAttribute("aria-expanded")).toBe("true");
    expect(section.textContent).toContain("2 July 2026");
    expect(section.textContent).toContain("from — Mostly consolidation.");
  });

  it("the filter puts the narrative on its own, and everything brings the trail back", async () => {
    open(() => withHistory([explained, ...quiet, first]));
    const section = await history();
    const only = within(section).getByRole("button", {
      name: "explained only",
    });
    fireEvent.click(only);
    expect(only.getAttribute("aria-pressed")).toBe("true");
    expect(
      within(section).queryByRole("button", { name: /quiet revisions/ })
    ).toBeNull();
    expect(section.textContent).toContain("Cordi's funnel plot");

    fireEvent.click(
      within(section).getByRole("button", { name: "everything" })
    );
    expect(
      within(section).getByRole("button", { name: /quiet revisions/ })
    ).toBeTruthy();
  });

  it("a history with no entries is the base line alone — no filter, no trail, no empty section", async () => {
    open(() => withHistory([]));
    const section = await history();
    expect(section.textContent).toContain(
      "promoted from a capture made while reading Rasch & Born 2013 · p.699, 20 September 2026"
    );
    expect(within(section).queryAllByRole("listitem")).toEqual([]);
    expect(
      within(section).queryByRole("button", { name: "everything" })
    ).toBeNull();
    // Nothing else: no outline around an emptiness the base line already explains.
    expect(section.textContent).toBe(
      "Position historypromoted from a capture made while reading Rasch & Born 2013 · p.699, 20 September 2026"
    );
  });
});

// Resolving (#222; ADR 0020 decision 6): the working answer as it stands is
// the answer, so resolve and abandon are one button each and there is no
// second field. Resolving is a status, not an archive — the page keeps
// everything it had and offers to reopen.

// Inferred, not annotated as the union: a fixture built from another one
// has to keep its readable arm, or `.sections` cannot be read off it.
const ANSWERED = {
  ...fresh,
  frontmatter: {
    ...fresh.frontmatter,
    status: "answered" as const,
    answered: "2026-09-21T10:00:00+02:00",
  },
  sections: {
    ...fresh.sections,
    workingAnswer: { present: true, text: "Probably both." },
    positionHistory: {
      present: true,
      text: "- 2026-09-21T09:00:00+02:00 · working answer\n  from:",
      entries: [
        {
          at: "2026-09-21T09:00:00+02:00",
          field: "working answer",
          why: null,
          from: "",
        },
      ],
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
    // The Inbox is not mounted here, so the row's own glyph and label are
    // `Inbox.test.tsx`'s; what this asserts is the page's half.
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
    // Intact means the entry still reads, not that the section's bytes are
    // on screen: the history is rendered as a narrative now (#214).
    const history = within(view).getByRole("region", {
      name: "Position history",
    }).textContent;
    expect(history).toContain("21 September 2026");
    expect(history).toContain("1 quiet revision");
    // A status, not an archive: the Edited sections still open for editing.
    expect(
      within(
        within(view).getByRole("region", { name: "Open threads" })
      ).getByRole("button", { name: "edit" })
    ).toBeDefined();
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
    // The half that did not happen is what the line names: the page *was*
    // resolved, so "could not resolve" would be a lie about the other half.
    expect(line.textContent).toBe(
      "the Question was not marked: [[Does slow-wave density predict recall gain]] matches no file in the vault"
    );
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
    expect(line.textContent).toBe(
      "could not resolve: changedAndUnreapplyable — the file is no longer there"
    );
    expect(within(view).getByRole("img", { name: "open" })).toBeDefined();
  });
});
