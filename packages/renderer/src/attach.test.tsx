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
    title: "About sleep's role in memory",
    pdf: true,
  },
  {
    path: "sources/klinzing2019.md",
    name: "klinzing2019",
    kind: "source-stub",
    // A stub with no `title:` yet: the row is its citekey and nothing more.
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
    // The citekey, then the paper's title beside it — `rasch2013` is not a
    // name anyone recognises a paper by — then whether its PDF is there.
    expect(
      (await within(picker).findAllByRole("option")).map(
        (row) => row.textContent
      )
    ).toEqual([
      "●rasch2013About sleep's role in memorypdf",
      "○klinzing2019no pdf",
    ]);
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

// Moving a source to the other side and detaching one (#219; spec #206
// story 27), and what a line whose link lands nowhere — or on two files —
// says in place of the paper it meant (story 30).
describe("moving and detaching a source", () => {
  /** The page, from a holder the test rewrites the way a re-read would. */
  const openHolding = (
    holder: { current: ResearchQuestionPage },
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
      "researchQuestions.page": () => holder.current,
      "picker.candidates": matching,
      ...more,
    });
  };

  const column = async (name: string) =>
    within(await region()).getByRole("region", { name });

  it("moves a line to the other side with the page's hash, and the columns and the strip follow", async () => {
    const supporting = sourceLine("rasch2013", "TMR survives encoding.");
    const holder = { current: page([supporting], []) };
    const move = vi.fn(() => {
      holder.current = page([], [supporting]);
      return { written: true, hash: "def", shape: [] };
    });
    openHolding(holder, { "researchQuestions.moveSource": move });

    expect(
      (await screen.findByRole("region", { name: /balance/i })).textContent
    ).toContain("1 supporting · nothing opposing");
    fireEvent.click(
      within(await column("Supporting sources")).getByRole("button", {
        name: /move to opposing/i,
      })
    );
    await waitFor(() =>
      expect(move).toHaveBeenCalledWith({
        path: PATH,
        from: "supporting",
        text: "[[rasch2013]] — TMR survives encoding.",
        basedOn: "abc",
      })
    );
    // The write's re-read is what redraws: both columns and the strip above
    // them come from the same page read.
    await waitFor(async () =>
      expect(
        (await screen.findByRole("region", { name: /balance/i })).textContent
      ).toContain("nothing supporting · 1 opposing")
    );
    expect(
      within(await column("Opposing sources")).getByRole("button", {
        name: /move to supporting/i,
      })
    ).toBeTruthy();
  });

  it("detaches a line, and the side it left says it is empty again", async () => {
    const opposing = sourceLine("wamsley2019", "Waking rest does as well.");
    const holder = { current: page([], [opposing]) };
    const detach = vi.fn(() => {
      holder.current = page([], []);
      return { written: true, hash: "def", shape: [] };
    });
    openHolding(holder, { "researchQuestions.detachSource": detach });

    fireEvent.click(
      within(await column("Opposing sources")).getByRole("button", {
        name: /detach/i,
      })
    );
    await waitFor(() =>
      expect(detach).toHaveBeenCalledWith({
        path: PATH,
        side: "opposing",
        text: "[[wamsley2019]] — Waking rest does as well.",
        basedOn: "abc",
      })
    );
    await waitFor(async () =>
      expect(
        (await screen.findByRole("region", { name: /balance/i })).textContent
      ).toContain("nothing attached on either side")
    );
  });

  it("shows a refused move as a line in the column rather than a silent no-op", async () => {
    const holder = { current: page([sourceLine("rasch2013", "")], []) };
    openHolding(holder, {
      "researchQuestions.moveSource": () => ({
        written: false,
        reason: "changedAndUnreapplyable",
        detail: 'no supporting source reads "[[rasch2013]]"',
      }),
    });
    fireEvent.click(
      within(await column("Supporting sources")).getByRole("button", {
        name: /move to opposing/i,
      })
    );
    expect((await screen.findByRole("status")).textContent).toContain(
      'no supporting source reads "[[rasch2013]]"'
    );
  });

  it("offers neither verb on a line under the heading that is not a source", async () => {
    const prose: LinkLine = {
      text: "a line that is not a source",
      link: null,
      note: "a line that is not a source",
    };
    openHolding({ current: page([prose], []) });
    const supporting = await column("Supporting sources");
    expect(supporting.textContent).toContain("a line that is not a source");
    expect(within(supporting).queryByRole("button")).toBeNull();
  });

  it("names the two files an ambiguous link is caught between, and says what an unresolved one found", async () => {
    const ambiguous: LinkLine = {
      text: "[[wamsley2019]]",
      link: {
        target: "wamsley2019",
        blockId: null,
        resolution: "ambiguous",
        resolvedPath: null,
        candidates: ["a/wamsley2019.md", "sources/wamsley2019.md"],
        resolvedKind: null,
      },
      note: "",
    };
    const mistyped: LinkLine = {
      text: "[[rasch213]] — a citekey with a digit dropped",
      link: {
        target: "rasch213",
        blockId: null,
        resolution: "unresolved",
        resolvedPath: null,
        resolvedKind: null,
      },
      note: "a citekey with a digit dropped",
    };
    openHolding({ current: page([mistyped], [ambiguous]) });

    const opposing = await column("Opposing sources");
    expect(opposing.textContent).toContain("ambiguous");
    expect(opposing.textContent).toContain("a/wamsley2019.md");
    expect(opposing.textContent).toContain("sources/wamsley2019.md");
    // Still a line the user can act on: a mistyped citekey is fixed by
    // detaching it and attaching the paper that was meant.
    const supporting = await column("Supporting sources");
    expect(supporting.textContent).toContain("unresolved");
    expect(supporting.textContent).toMatch(/nothing in the vault/i);
    expect(
      within(supporting).getByRole("button", { name: /detach/i })
    ).toBeTruthy();
  });

  it("says which file has no such block when the citekey landed and the #^id did not", async () => {
    // The common breakage: an Ingest renumbered the Source's annotations,
    // so `rasch2013` is right and `^h99` is not. Telling the reader that
    // nothing carries the name would send them to fix the half that works.
    const renumbered: LinkLine = {
      text: "[[rasch2013#^h99]] — the block an Ingest renumbered",
      link: {
        target: "rasch2013",
        blockId: "h99",
        resolution: "unresolved",
        resolvedPath: null,
        candidates: ["sources/rasch2013.md"],
        resolvedKind: null,
      },
      note: "the block an Ingest renumbered",
    };
    openHolding({ current: page([renumbered], []) });
    const supporting = await column("Supporting sources");
    expect(supporting.textContent).toContain(
      "sources/rasch2013.md has no ^h99"
    );
    expect(supporting.textContent).not.toMatch(/nothing in the vault/i);
  });
});
