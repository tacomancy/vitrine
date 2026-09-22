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
  LinkLine,
  ResearchQuestionPage,
} from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Attaching a source to a side (#218; spec #206 stories 23–25, 28; ADR 0020
// decision 5): one shortcut from anywhere on the page, the picker narrowed
// to Sources and stubs, the side required, the note optional — and a balance
// strip over the two columns that says in words what the shape of the
// evidence is.

const PATH = "questions/Does slow-wave density predict recall gain (RQ).md";

const CANDIDATES: Candidate[] = [
  {
    path: "sources/rasch2013.md",
    name: "rasch2013",
    kind: "source",
    pdf: true,
  },
  {
    path: "sources/klinzing2019.md",
    name: "klinzing2019",
    kind: "source-stub",
    pdf: false,
  },
];

const matching = (input: unknown): Candidates => {
  const { query } = input as { query: string };
  const rows = CANDIDATES.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );
  return { rows, total: rows.length };
};

const sourceLine = (target: string, note: string): LinkLine => ({
  text: note === "" ? `[[${target}]]` : `[[${target}]] — ${note}`,
  link: {
    target,
    blockId: null,
    resolution: "resolved",
    resolvedPath: `sources/${target}.md`,
    resolvedKind: "source",
  },
  note,
});

const page = (
  supporting: LinkLine[],
  opposing: LinkLine[]
): ResearchQuestionPage => ({
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
    workingAnswer: { present: true, text: "Probably both." },
    supporting: { present: true, lines: supporting },
    opposing: { present: true, lines: opposing },
    related: { present: true, text: "", lines: [] },
    openThreads: { present: true, text: "", threads: [] },
    positionHistory: { present: true, text: "", entries: [] },
  },
  problems: [],
});

const open = (
  current: ResearchQuestionPage,
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
    "researchQuestions.page": () => current,
    "picker.candidates": matching,
    ...more,
  });
};

/** The page, once its read has landed: the shortcut needs a hash to write against. */
async function region() {
  const view = await screen.findByRole("region", {
    name: "Research Question view",
  });
  await within(view).findByRole("heading", { level: 1 });
  return view;
}

/** ⌘⇧A on `from`, then the picker it opens. */
async function attachFrom(from: HTMLElement) {
  from.focus();
  fireEvent.keyDown(from, { key: "A", metaKey: true, shiftKey: true });
  return screen.findByRole("dialog", { name: /attach a source/i });
}

/** Open the form, take a candidate, and come back with the side-and-note step. */
async function chooseSource(name = "rasch2013") {
  const page = await region();
  const picker = await attachFrom(page);
  fireEvent.click(await within(picker).findByText(name));
  return screen.findByRole("dialog", { name: new RegExp(name, "i") });
}

describe("attaching a source", () => {
  it("opens the picker over Sources and stubs from any focus on the page", async () => {
    const candidates = vi.fn(matching);
    open(page([], []), { "picker.candidates": candidates });
    const view = await region();

    // From the page itself, which is where the keyboard lands on arrival.
    const picker = await attachFrom(view);
    expect(candidates).toHaveBeenCalledWith({
      query: "",
      kinds: ["source", "source-stub"],
      // The page can hardly be evidence for itself.
      exclude: [PATH],
    });
    expect(await within(picker).findByText("rasch2013")).toBeTruthy();
    // PDF presence per row, as the one picker shows it everywhere.
    expect(picker.textContent).toContain("pdf");
    expect(picker.textContent).toContain("no pdf");
    fireEvent.keyDown(within(picker).getByRole("combobox", { name: /find/i }), {
      key: "Escape",
    });

    // And from a field on it: the shortcut is a chord so that typing in the
    // working answer is never the shortcut.
    const answer = await within(view).findByRole("textbox", {
      name: "Working answer",
    });
    await attachFrom(answer);
  });

  it("says so when nothing in the vault matches, rather than offering a way to make one", async () => {
    open(page([], []));
    const view = await region();
    const picker = await attachFrom(view);
    fireEvent.change(within(picker).getByRole("combobox", { name: /find/i }), {
      target: { value: "cordi2021" },
    });
    // *New stub* arrives with the hand-made-stub ticket (ADR 0020 decision
    // 7); until then the form is honest about having nothing to offer.
    expect(
      await within(picker).findByText(/nothing in the vault matches/i)
    ).toBeTruthy();
  });

  it("asks for the side before it will attach, and writes the note with it", async () => {
    const attach = vi.fn(() => ({ written: true, hash: "def", shape: [] }));
    open(page([], []), { "researchQuestions.attachSource": attach });
    const form = await chooseSource();

    // Nothing lands unjudged: the side has no default, and until one is
    // chosen there is nothing to attach.
    const submit = within(form).getByRole("button", { name: /attach/i });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.click(submit);
    expect(attach).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByRole("radio", { name: "opposing" }));
    fireEvent.change(within(form).getByRole("textbox", { name: /why/i }), {
      target: { value: "Table 2 reverses once preregistered studies are out." },
    });
    fireEvent.click(within(form).getByRole("button", { name: /attach/i }));

    await waitFor(() =>
      expect(attach).toHaveBeenCalledWith({
        path: PATH,
        target: "sources/rasch2013.md",
        side: "opposing",
        note: "Table 2 reverses once preregistered studies are out.",
        basedOn: "abc",
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("attaches with no note at all, and there is no third side to pick", async () => {
    const attach = vi.fn(() => ({ written: true, hash: "def", shape: [] }));
    open(page([], []), { "researchQuestions.attachSource": attach });
    const form = await chooseSource("klinzing2019");

    expect(
      within(form)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value"))
    ).toEqual(["supporting", "opposing"]);

    fireEvent.click(within(form).getByRole("radio", { name: "supporting" }));
    fireEvent.click(within(form).getByRole("button", { name: /attach/i }));
    await waitFor(() =>
      expect(attach).toHaveBeenCalledWith({
        path: PATH,
        target: "sources/klinzing2019.md",
        side: "supporting",
        note: "",
        basedOn: "abc",
      })
    );
  });

  it("leaves on esc without writing, and gives the keyboard back where it was", async () => {
    const attach = vi.fn(() => ({ written: true, hash: "def", shape: [] }));
    open(page([], []), { "researchQuestions.attachSource": attach });
    const view = await region();
    const answer = await within(view).findByRole("textbox", {
      name: "Working answer",
    });
    answer.focus();
    fireEvent.keyDown(answer, { key: "A", metaKey: true, shiftKey: true });
    const picker = await screen.findByRole("dialog", {
      name: /attach a source/i,
    });
    fireEvent.click(await within(picker).findByText("rasch2013"));
    const form = await screen.findByRole("dialog", { name: /rasch2013/i });

    fireEvent.keyDown(form, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(attach).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(answer);
  });

  it("shows a refused attach as a line rather than a silent no-op", async () => {
    open(page([], []), {
      "researchQuestions.attachSource": () => ({
        written: false,
        reason: "changedAndUnreapplyable",
        detail: "the file changed underneath",
      }),
    });
    const form = await chooseSource();
    fireEvent.click(within(form).getByRole("radio", { name: "supporting" }));
    fireEvent.click(within(form).getByRole("button", { name: /attach/i }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "the file changed underneath"
    );
  });
});

describe("the balance strip", () => {
  /** The strip's words, whatever the page holds. */
  const strip = async () =>
    (await screen.findByRole("region", { name: /balance/i })).textContent ?? "";

  it("states both sides in words when both have sources, and says nothing more", async () => {
    open(
      page(
        [
          sourceLine("rasch2013", "TMR survives encoding controls."),
          sourceLine("klinzing2019", ""),
        ],
        [sourceLine("wamsley2019", "Waking rest does as well.")]
      )
    );
    expect(await strip()).toContain("2 supporting · 1 opposing");
    expect(await strip()).not.toMatch(/one-sided/i);
  });

  it("raises its voice when one side is empty and the other is not", async () => {
    open(page([sourceLine("rasch2013", "")], []));
    const balance = await screen.findByRole("region", { name: /balance/i });
    expect(balance.textContent).toContain("1 supporting · nothing opposing");
    // Law 6: the conspicuous state ships with a glyph and a label, and says
    // in prose what a one-sided literature means.
    expect(
      within(balance).getByRole("img", { name: /one-sided/i })
    ).toBeTruthy();
    expect(balance.textContent).toMatch(/your reading/i);

    cleanup();
    open(page([], [sourceLine("wamsley2019", "")]));
    expect(await strip()).toContain("nothing supporting · 1 opposing");
  });

  it("is quiet on a page with nothing on either side, which still shows the two outlines", async () => {
    open(page([], []));
    const view = await region();
    expect(await strip()).toContain("nothing attached on either side");
    expect(screen.queryByRole("img", { name: /one-sided/i })).toBeNull();
    for (const name of ["Supporting sources", "Opposing sources"]) {
      const section = within(view).getByRole("region", { name });
      expect(
        within(section).getByText(/\.\s*$/).textContent?.length
      ).toBeGreaterThan(20);
    }
  });
});
