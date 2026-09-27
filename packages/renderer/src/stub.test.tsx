import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Candidates, ResearchQuestionPage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// A stub made by hand from the attach form (#220; spec #206 story 26; ADR
// 0020 decision 7): when nothing in the vault matches, four fields and one
// `↵` make the paper and attach it, so a fresh vault does not leave the
// page dead weight until Scouts land.

const PATH = "questions/Does slow-wave density predict recall gain (RQ).md";

/** A vault with one paper in it, so *new stub* is the no-match state and nothing else. */
const matching = (input: unknown): Candidates => {
  const { query } = input as { query: string };
  const rows =
    "rasch2013".includes(query.toLowerCase()) && query !== ""
      ? [
          {
            path: "sources/rasch2013.md",
            name: "rasch2013",
            kind: "source",
            title: "About sleep's role in memory",
            pdf: true,
          },
        ]
      : [];
  return { rows, total: rows.length };
};

const page = (): ResearchQuestionPage => ({
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: {
    question: "Does slow-wave density predict recall gain?",
    status: "open",
    promoted: "2026-09-20T10:00:00+02:00",
    context: "reading",
    from: "[[Rasch & Born 2013]]",
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
});

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = `#/questions/${encodeURIComponent("questions")}/${encodeURIComponent("Does slow-wave density predict recall gain (RQ).md")}`;
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "researchQuestions.page": page,
    "picker.candidates": matching,
    ...more,
  });
};

/** The stub the core answers with, filed under the citekey rule. */
const created = { path: "sources/cordi2021.md", citekey: "cordi2021" };

/** The page, the attach picker, and a query nothing in the vault matches. */
async function noMatch() {
  const view = await screen.findByRole("region", {
    name: "Research Question view",
  });
  await within(view).findByRole("heading", { level: 1 });
  view.focus();
  fireEvent.keyDown(view, { key: "A", metaKey: true, shiftKey: true });
  const picker = await screen.findByRole("dialog", {
    name: /attach a source/i,
  });
  const find = within(picker).getByRole("combobox", { name: /find/i });
  fireEvent.change(find, { target: { value: "cordi" } });
  await within(picker).findByText(/nothing in the vault matches/i);
  return { picker, find };
}

/** The no-match state, then the stub form `↵` opens from it. */
async function stubForm() {
  const { find } = await noMatch();
  fireEvent.keyDown(find, { key: "Enter" });
  return screen.findByRole("dialog", { name: /new stub/i });
}

describe("a stub made by hand", () => {
  it("offers *new stub* only where there is nothing to choose", async () => {
    open();
    const { picker, find } = await noMatch();
    expect(
      within(picker).getByRole("button", { name: /new stub/i })
    ).toBeTruthy();

    // A query with a paper behind it has something to attach, and the form
    // stays out of the way of choosing it.
    fireEvent.change(find, { target: { value: "rasch" } });
    await within(picker).findByRole("option", { name: /rasch2013/i });
    expect(
      within(picker).queryByRole("button", { name: /new stub/i })
    ).toBeNull();
  });

  it("creates the paper and attaches it to the side chosen, in one flow", async () => {
    const createStub = vi.fn(() => created);
    const attach = vi.fn(() => ({ written: true, hash: "def", shape: [] }));
    open({
      "sources.createStub": createStub,
      "researchQuestions.attachSource": attach,
    });
    const form = await stubForm();

    fireEvent.change(within(form).getByRole("textbox", { name: /title/i }), {
      target: { value: "Sleep deprivation and memory" },
    });
    fireEvent.change(within(form).getByRole("textbox", { name: /authors/i }), {
      target: { value: "Cordi, Maren J." },
    });
    fireEvent.change(within(form).getByRole("textbox", { name: /year/i }), {
      target: { value: "2021" },
    });
    fireEvent.change(within(form).getByRole("textbox", { name: /url/i }), {
      target: { value: "https://example.org/cordi2021" },
    });
    fireEvent.keyDown(within(form).getByRole("textbox", { name: /url/i }), {
      key: "Enter",
    });

    await waitFor(() =>
      expect(createStub).toHaveBeenCalledWith({
        title: "Sleep deprivation and memory",
        authors: "Cordi, Maren J.",
        year: "2021",
        url: "https://example.org/cordi2021",
      })
    );

    // Straight on to the side, which is still the judgement nobody else can
    // make: the new paper has landed, but not yet on a side.
    const side = await screen.findByRole("dialog", { name: /cordi2021/i });
    expect(attach).not.toHaveBeenCalled();
    fireEvent.click(within(side).getByRole("radio", { name: "supporting" }));
    fireEvent.click(within(side).getByRole("button", { name: /attach/i }));

    await waitFor(() =>
      expect(attach).toHaveBeenCalledWith({
        path: PATH,
        target: "sources/cordi2021.md",
        side: "supporting",
        note: "",
        basedOn: "abc",
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("will not make a paper with no title, and says which field it wants", async () => {
    const createStub = vi.fn(() => created);
    open({ "sources.createStub": createStub });
    const form = await stubForm();

    fireEvent.keyDown(within(form).getByRole("textbox", { name: /title/i }), {
      key: "Enter",
    });
    expect(createStub).not.toHaveBeenCalled();
    expect(
      within(form).getByText(/a title is what names the paper/i)
    ).toBeTruthy();
  });

  it("leaves on esc with nothing written", async () => {
    const createStub = vi.fn(() => created);
    open({ "sources.createStub": createStub });
    const form = await stubForm();

    fireEvent.change(within(form).getByRole("textbox", { name: /title/i }), {
      target: { value: "Sleep deprivation and memory" },
    });
    fireEvent.keyDown(form, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(createStub).not.toHaveBeenCalled();
  });

  it("keeps the typing and says so when the write is refused", async () => {
    const createStub = vi.fn(() => {
      throw new Error("sources/ is read-only");
    });
    open({ "sources.createStub": createStub });
    const form = await stubForm();

    fireEvent.change(within(form).getByRole("textbox", { name: /title/i }), {
      target: { value: "Sleep deprivation and memory" },
    });
    fireEvent.keyDown(within(form).getByRole("textbox", { name: /title/i }), {
      key: "Enter",
    });

    expect((await within(form).findByRole("status")).textContent).toMatch(
      /read-only/i
    );
    expect(
      within(form).getByRole<HTMLInputElement>("textbox", { name: /title/i })
        .value
    ).toBe("Sleep deprivation and memory");
  });
});
