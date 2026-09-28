import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Destination, Destinations, ResearchQuestionPage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  empty,
  pressCaptureChord,
  pressGlobalChord,
  question,
  renderApp,
  vault,
} from "./fake-core";
import { matchKey, strength } from "./match";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// ⌘K opens, lists, goes — and captures (#302, #303; ADR 0027 decisions 1,
// 2, 4, 6, 7 and 8). One keyboard list over whatever the window was doing,
// spanning the Surfaces and Dashboards the renderer holds and the objects
// the core answers with, with the capture last in the same list. `↵` means
// one of two things, and the verb is what says which.

const RQ_PATH = "questions/Does slow-wave density predict recall gain (RQ).md";
const Q_PATH = "questions/Is replay necessary for consolidation.md";

const RQ_HASH = `#/research-question/${RQ_PATH.split("/")
  .map(encodeURIComponent)
  .join("/")}`;

// Declaration order is recency, newest first: the fake sorts by it where
// the core sorts by the index's modification time.
const OBJECTS: Destination[] = [
  {
    kind: "research-question",
    path: RQ_PATH,
    display: "Does slow-wave density predict recall gain?",
  },
  {
    kind: "question",
    path: Q_PATH,
    display: "Is replay necessary for consolidation?",
  },
  {
    kind: "question",
    path: "questions/What counts as a reactivation event here.md",
    display: "What counts as a reactivation event here?",
  },
];

const KIND_ORDER: Destination["kind"][] = ["research-question", "question"];

/**
 * The core's half of the list, as the procedure contract describes it:
 * contains on the Display name, ordered by strength then Kind then
 * recency, capped with the true total beside it. It scores with the
 * renderer's own rungs because ADR 0027 requires the two to agree — a fake
 * that scored differently would be testing a contract nothing implements.
 */
const answering =
  (objects: Destination[] = OBJECTS) =>
  (input: unknown): Destinations => {
    const { query } = input as { query: string };
    const wanted = matchKey(query);
    const rows = objects
      .map((row, recency) => ({ row, recency, key: matchKey(row.display) }))
      .filter(({ key }) => key.includes(wanted))
      .sort(
        (a, b) =>
          strength(wanted, b.key) - strength(wanted, a.key) ||
          KIND_ORDER.indexOf(a.row.kind) - KIND_ORDER.indexOf(b.row.kind) ||
          a.recency - b.recency
      )
      .map(({ row }) => row);
    return { rows, total: rows.length };
  };

const base = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": {
    indexing: null,
    watching: { ok: true },
    current: { ok: true },
  },
  "looseEnds.rows": { groups: [], problems: [] },
  "globalCommand.destinations": answering(),
};

/** The window, up and answering, with the command open over it. */
async function openCommand(answers: Record<string, unknown> = {}) {
  renderApp({ ...base, ...answers });
  await screen.findByRole("banner");
  pressGlobalChord();
  return screen.findByRole("dialog", { name: "Global command" });
}

const listOf = (dialog: HTMLElement) =>
  within(dialog).findByRole("listbox", { name: "Destinations and capture" });

/** Every row, the capture included — it is one list, and the capture is last. */
async function optionsOf(dialog: HTMLElement) {
  const list = await listOf(dialog);
  return within(list).getAllByRole("option");
}

/** What a row says, glyph and Kind label included, as one string. */
const said = (rows: HTMLElement[]) => rows.map((row) => row.textContent);

const row = (glyph: string, name: string, kind: string, current = false) =>
  `${glyph}${name}${kind}${current ? "current" : ""}`;

/**
 * The list once the core's half of it has arrived beside the renderer's.
 * The count is destinations; the capture row is always there beside them,
 * and comes back last.
 */
async function settled(dialog: HTMLElement, destinations: number) {
  await vi.waitFor(async () =>
    expect(await optionsOf(dialog)).toHaveLength(destinations + 1)
  );
  const options = await optionsOf(dialog);
  return {
    destinations: options.slice(0, -1),
    capture: options.at(-1)!,
    all: options,
  };
}

const chosenIn = (rows: HTMLElement[]) =>
  rows.findIndex((r) => r.getAttribute("aria-selected") === "true");

const queryBox = (dialog: HTMLElement) =>
  within(dialog).getByRole("combobox", {
    name: "Capture a question, or go to something",
  });

function type(dialog: HTMLElement, text: string) {
  fireEvent.change(queryBox(dialog), { target: { value: text } });
}

const press = (dialog: HTMLElement, key: string) =>
  fireEvent.keyDown(queryBox(dialog), { key });

const verbOf = (dialog: HTMLElement) =>
  within(dialog).getByRole("status").textContent ?? "";

describe("⌘K opens one list over whatever the window was doing", () => {
  it("opens from the Inbox and lists the Surfaces, the Dashboards and the objects", async () => {
    const dialog = await openCommand();
    expect(said((await settled(dialog, 5)).destinations)).toEqual([
      row("▪", "Question Inbox", "surface", true),
      row("▦", "Loose Ends", "dashboard"),
      row(
        "■",
        "Does slow-wave density predict recall gain?",
        "research question"
      ),
      row("◆", "Is replay necessary for consolidation?", "question"),
      row("◆", "What counts as a reactivation event here?", "question"),
    ]);
  });

  it("opens from a Dashboard too, with the window's own Address marked current", async () => {
    window.location.hash = "#/loose-ends";
    const dialog = await openCommand();
    const { destinations } = await settled(dialog, 5);
    expect(said(destinations)[1]).toBe(
      row("▦", "Loose Ends", "dashboard", true)
    );
  });

  it("offers nothing the app cannot reach: a Surface with no Address is not a row", async () => {
    const dialog = await openCommand();
    const list = await listOf(dialog);
    expect(list.textContent).not.toContain("Reader");
    expect(list.textContent).not.toContain("Scout Queue");
    expect(list.textContent).not.toContain("Home");
  });

  it("is not live when no vault is open, where First run has its single action", async () => {
    renderApp({ "vault.current": null });
    await screen.findByRole("button", { name: "Open a vault" });
    pressGlobalChord();
    expect(screen.queryByRole("dialog")).toBeNull();
    // Nor the other chord: neither is mounted before a vault is.
    pressCaptureChord();
    expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull();
  });
});

describe("typing narrows the list, and each row says why it is here", () => {
  it("marks the run that matched, spanning the punctuation a query typed across it does not have", async () => {
    const dialog = await openCommand();
    type(dialog, "slow wave density");
    const { destinations } = await settled(dialog, 1);
    expect(said(destinations)).toEqual([
      row(
        "■",
        "Does slow-wave density predict recall gain?",
        "research question"
      ),
    ]);
    expect(destinations[0]?.querySelector("mark")?.textContent).toBe(
      "slow-wave density"
    );
  });

  it("puts an exact hit above everything, and a Surface above an object that merely contains the word", async () => {
    const dialog = await openCommand();
    type(dialog, "question inbox");
    expect(said((await settled(dialog, 1)).destinations)).toEqual([
      row("▪", "Question Inbox", "surface", true),
    ]);
    type(dialog, "loose");
    expect(said((await settled(dialog, 1)).destinations)).toEqual([
      row("▦", "Loose Ends", "dashboard"),
    ]);
  });

  it("says how long a cut list really is", async () => {
    const dialog = await openCommand({
      "globalCommand.destinations": (): Destinations => ({
        rows: OBJECTS.slice(0, 1),
        total: 312,
      }),
    });
    expect(
      await within(dialog).findByText("3 of 314 — keep typing")
    ).toBeDefined();
  });

  it("never reads a failed read as an empty vault", async () => {
    const dialog = await openCommand({
      "globalCommand.destinations": () => {
        throw new Error("the index is not answering");
      },
    });
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "the index is not answering"
    );
  });
});

describe("the side ↵ belongs to, and the verb that names it", () => {
  it("starts on the capture, because nothing typed is nothing matched", async () => {
    const dialog = await openCommand();
    const { destinations, capture } = await settled(dialog, 5);
    expect(destinations[0]?.getAttribute("aria-current")).toBe("page");
    expect(chosenIn(destinations)).toBe(-1);
    expect(capture.getAttribute("aria-selected")).toBe("true");
    expect(verbOf(dialog)).toBe("↵Capturetype a question");
  });

  it("crosses to the destination on a prefix hit, and back to the capture on a weaker one", async () => {
    const dialog = await openCommand();
    // A prefix of the Dashboard's own name: strong enough to mean *go*.
    type(dialog, "loose");
    const strong = await settled(dialog, 1);
    expect(chosenIn(strong.destinations)).toBe(0);
    expect(verbOf(dialog)).toBe("↵Go toLoose Ends");
    // A word inside a Question's text: a match, but not one worth ↵.
    type(dialog, "replay");
    const weak = await settled(dialog, 1);
    expect(chosenIn(weak.destinations)).toBe(-1);
    expect(weak.capture.getAttribute("aria-selected")).toBe("true");
    expect(verbOf(dialog)).toBe("↵Capturereplay");
  });

  it("does not let the Address the window is on lend its strength to a weaker row", async () => {
    // *question inbox* is an exact hit on the Surface the window is
    // already on, and only a word start inside the Question. The rung
    // that decides the side is the best row ↵ could actually act on, so
    // the exact hit the user cannot go to does not send ↵ to the other.
    const dialog = await openCommand({
      "globalCommand.destinations": answering([
        {
          kind: "question",
          path: "questions/Why does the Question Inbox sort newest first.md",
          display: "Why does the Question Inbox sort newest first?",
        },
      ]),
    });
    type(dialog, "question inbox");
    const { destinations, capture } = await settled(dialog, 2);
    expect(said(destinations)).toEqual([
      row("▪", "Question Inbox", "surface", true),
      row("◆", "Why does the Question Inbox sort newest first?", "question"),
    ]);
    expect(chosenIn(destinations)).toBe(-1);
    expect(capture.getAttribute("aria-selected")).toBe("true");
    expect(verbOf(dialog)).toBe("↵Capturequestion inbox");
  });

  it("stays on the capture when the only thing that matched is where the window already is", async () => {
    const dialog = await openCommand();
    type(dialog, "question inbox");
    const { destinations, capture } = await settled(dialog, 1);
    expect(said(destinations)).toEqual([
      row("▪", "Question Inbox", "surface", true),
    ]);
    expect(capture.getAttribute("aria-selected")).toBe("true");
    expect(verbOf(dialog)).toBe("↵Capturequestion inbox");
  });

  it("reads as ordinary when nothing goes by that name, not as a failure", async () => {
    const dialog = await openCommand();
    type(dialog, "do dendritic spikes gate this at all");
    await vi.waitFor(() =>
      expect(verbOf(dialog)).toBe(
        "↵Capturedo dendritic spikes gate this at all"
      )
    );
    const { destinations, capture } = await settled(dialog, 0);
    expect(destinations).toHaveLength(0);
    expect(capture.getAttribute("aria-selected")).toBe("true");
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("⇥ swaps sides, and the overlay's one tab stop is the input, so the key costs nothing", async () => {
    const dialog = await openCommand();
    type(dialog, "loose");
    await settled(dialog, 1);
    expect(verbOf(dialog)).toBe("↵Go toLoose Ends");

    press(dialog, "Tab");
    expect(verbOf(dialog)).toBe("↵Captureloose");
    expect(
      (await settled(dialog, 1)).capture.getAttribute("aria-selected")
    ).toBe("true");

    press(dialog, "Tab");
    expect(verbOf(dialog)).toBe("↵Go toLoose Ends");

    // Nothing else in the overlay was ever going to take ⇥.
    expect(
      within(dialog)
        .getAllByRole("combobox")
        .concat(
          Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'a[href], button, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          )
        )
    ).toEqual([queryBox(dialog)]);
  });

  it("names the alternative key beside the count, in one muted run", async () => {
    const dialog = await openCommand();
    type(dialog, "loose");
    await settled(dialog, 1);
    expect(within(dialog).getByText("⇥ writes it down instead")).toBeDefined();
    press(dialog, "Tab");
    expect(within(dialog).getByText("⇥ goes to the top match")).toBeDefined();
  });

  it("moves with the arrows across both sides, the current Address included", async () => {
    const dialog = await openCommand();
    await settled(dialog, 5);
    // Starts on the capture, the last row: up walks back into the list.
    press(dialog, "ArrowUp");
    expect(verbOf(dialog)).toBe(
      "↵Go toWhat counts as a reactivation event here?"
    );
    press(dialog, "ArrowUp");
    press(dialog, "ArrowUp");
    press(dialog, "ArrowUp");
    press(dialog, "ArrowUp");
    expect(chosenIn((await settled(dialog, 5)).destinations)).toBe(0);
    expect(verbOf(dialog)).toBe("↵Go toQuestion Inbox");
    press(dialog, "ArrowUp");
    expect(chosenIn((await settled(dialog, 5)).destinations)).toBe(0);
  });

  it("never points past the list a new query returned", async () => {
    const dialog = await openCommand();
    await settled(dialog, 5);
    press(dialog, "ArrowUp");
    press(dialog, "ArrowUp");
    expect(chosenIn((await settled(dialog, 5)).destinations)).toBe(3);
    type(dialog, "loose");
    const { destinations, capture } = await settled(dialog, 1);
    expect(chosenIn(destinations)).toBe(0);
    expect(capture.getAttribute("aria-selected")).toBe("false");
  });
});

describe("the capture row", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 19, 7, 4, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("is last in the list, under every destination, and carries the Kind glyph and the Provenance", async () => {
    const dialog = await openCommand();
    const { all, capture } = await settled(dialog, 5);
    expect(all.at(-1)).toBe(capture);
    expect(capture.textContent).toContain("Unattached · 19 Sep 2026, 07:04");
    // The mark ships with a word, never alone (BRAND.md law 6).
    expect(
      within(capture).getByRole("img", { name: "question" })
    ).toBeDefined();
  });

  it("invites rather than sitting blank before a character is typed", async () => {
    const dialog = await openCommand();
    const { capture } = await settled(dialog, 5);
    expect(capture.textContent).toBe(
      "◆Write a question — it costs nothing and keeps where you wereUnattached · 19 Sep 2026, 07:04"
    );
  });

  it("goes bare when it is the only row, and keeps its text when destinations are there", async () => {
    const dialog = await openCommand();
    type(dialog, "do dendritic spikes gate this at all");
    const alone = await settled(dialog, 0);
    expect(alone.capture.textContent).toBe("◆Unattached · 19 Sep 2026, 07:04");
    type(dialog, "loose");
    const beside = await settled(dialog, 1);
    expect(beside.capture.textContent).toBe(
      "◆looseUnattached · 19 Sep 2026, 07:04"
    );
  });

  it("says what the Provenance will be from a Research Question's page", async () => {
    window.location.hash = RQ_HASH;
    const dialog = await openCommand({ "researchQuestions.page": page });
    const { capture } = await settled(dialog, 5);
    expect(capture.textContent).toContain(
      "Pursuing · Does slow-wave density predict recall gain (RQ)"
    );
  });
});

describe("what ↵ writes", () => {
  const captured = (text: string, rest: Record<string, unknown> = {}) => ({
    id: "k7m2p9q4wx",
    path: `${vault.path}/questions/${text}.md`,
    question: text,
    status: "open",
    captured: "2026-09-19T07:04:00+05:30",
    context: "other",
    ...rest,
  });

  it("captures Unattached from the Inbox and hands the keyboard to the row it landed as", async () => {
    const text = "Does this hold for sparse inputs?";
    const capture = vi.fn((input: unknown) =>
      captured((input as { text: string }).text)
    );
    const dialog = await openCommand({
      "questions.capture": capture,
      "questions.list": {
        ...empty,
        questions: [question(text, "2026-09-19T07:04:00+05:30")],
      },
    });
    type(dialog, text);
    await settled(dialog, 0);
    press(dialog, "Enter");

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(capture).toHaveBeenCalledExactlyOnceWith({
      text,
      provenance: { context: "other" },
    });
    // The Question landed as a row, so the row's list takes the keyboard
    // (ADR 0010), exactly as it does after ⌘'.
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("listbox", { name: "Questions" })
      )
    );
  });

  it("is the same call the Capture line makes from the same place, chord for chord", async () => {
    window.location.hash = RQ_HASH;
    const calls: unknown[] = [];
    const capture = vi.fn((input: unknown) => {
      calls.push(input);
      return captured("Does the effect survive a nap?", {
        context: "pursuing",
        from: "[[Does slow-wave density predict recall gain (RQ)]]",
      });
    });
    const dialog = await openCommand({
      "researchQuestions.page": page,
      "questions.capture": capture,
    });
    type(dialog, "Does the effect survive a nap?");
    await settled(dialog, 0);
    press(dialog, "Enter");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    pressCaptureChord();
    const line = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(line, {
      target: { value: "Does the effect survive a nap?" },
    });
    fireEvent.keyDown(line, { key: "Enter" });
    await vi.waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull()
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      text: "Does the effect survive a nap?",
      provenance: { context: "pursuing", researchQuestion: RQ_PATH },
    });
    expect(calls[0]).toEqual(calls[1]);
  });

  it("leaves the keyboard where it was when the Question did not land on this surface", async () => {
    window.location.hash = RQ_HASH;
    const capture = vi.fn(() =>
      captured("Does the effect survive a nap?", { context: "pursuing" })
    );
    renderApp({
      ...base,
      "researchQuestions.page": page,
      "questions.capture": capture,
    });
    // A page is not where a Question lands as a row, so nothing on it
    // takes the keyboard and it goes back where it came from (ADR 0010).
    const away = await screen.findByRole("link", { name: "Question Inbox" });
    away.focus();
    pressGlobalChord();
    const dialog = await screen.findByRole("dialog", {
      name: "Global command",
    });
    type(dialog, "Does the effect survive a nap?");
    await settled(dialog, 0);
    press(dialog, "Enter");

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(capture).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(away);
  });

  it("writes a Question that already exists anyway, with no check and no warning", async () => {
    const text = "Is replay necessary for consolidation?";
    const capture = vi.fn((input: unknown) =>
      captured((input as { text: string }).text)
    );
    const dialog = await openCommand({ "questions.capture": capture });
    type(dialog, text);
    // The exact hit is on the destination side, so ↵ would go there: the
    // one signal the design gives, and ⇥ overrules it.
    const hit = await settled(dialog, 1);
    expect(chosenIn(hit.destinations)).toBe(0);
    press(dialog, "Tab");
    press(dialog, "Enter");

    await vi.waitFor(() =>
      expect(capture).toHaveBeenCalledExactlyOnceWith({
        text,
        provenance: { context: "other" },
      })
    );
    // Written, not jumped to: the window is where it started.
    expect(window.location.hash).toBe("#/inbox");
  });

  it("captures nothing on an empty query, and no duplicate on a second ↵ mid-write", async () => {
    const capture = vi.fn(() => captured("Does this hold?"));
    const dialog = await openCommand({ "questions.capture": capture });
    await settled(dialog, 5);
    press(dialog, "Enter");
    expect(capture).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();

    type(dialog, "   ");
    press(dialog, "Enter");
    expect(capture).not.toHaveBeenCalled();

    type(dialog, "Does this hold?");
    await settled(dialog, 0);
    press(dialog, "Enter");
    press(dialog, "Enter");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("keeps the overlay open and says why when the write fails", async () => {
    const dialog = await openCommand({
      "questions.capture": () => {
        throw new Error(
          "Couldn't link the Question from the page: Related questions is missing"
        );
      },
    });
    type(dialog, "Does the effect survive a nap?");
    await settled(dialog, 0);
    press(dialog, "Enter");

    const message = await within(dialog).findByRole("alert");
    expect(message.textContent).toContain("Related questions is missing");
    expect(
      within(dialog).getByRole<HTMLInputElement>("combobox", {
        name: "Capture a question, or go to something",
      }).value
    ).toBe("Does the effect survive a nap?");
  });
});

describe("the choice, and where ↵ takes it", () => {
  it("goes with one push of the route, so back returns where the user was", async () => {
    window.location.hash = "#/loose-ends";
    const dialog = await openCommand();
    type(dialog, "does slow-wave");
    await settled(dialog, 1);
    expect(verbOf(dialog)).toBe(
      "↵Go toDoes slow-wave density predict recall gain?"
    );
    press(dialog, "Enter");
    expect(window.location.hash).toBe(RQ_HASH);
    expect(screen.queryByRole("dialog")).toBeNull();

    window.history.back();
    await vi.waitFor(() => expect(window.location.hash).toBe("#/loose-ends"));
  });

  it("lands the keyboard where the object landed, as a capture does", async () => {
    const asked = {
      ...question(
        "Is replay necessary for consolidation?",
        "2026-09-19T08:00:00Z"
      ),
      path: `${vault.path}/${Q_PATH}`,
    };
    const dialog = await openCommand({
      "questions.list": { ...empty, questions: [asked] },
    });
    type(dialog, "is replay");
    await settled(dialog, 1);
    press(dialog, "Enter");

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("listbox", { name: "Questions" })
      )
    );
    expect(
      screen.getAllByRole("option").map((r) => r.getAttribute("aria-selected"))
    ).toEqual(["true"]);
  });

  it("leaves on esc and puts focus back wherever it was", async () => {
    renderApp(base);
    const away = await screen.findByRole("link", { name: "Loose Ends" });
    away.focus();
    pressGlobalChord();
    const dialog = await screen.findByRole("dialog", {
      name: "Global command",
    });
    expect(document.activeElement).toBe(queryBox(dialog));
    press(dialog, "Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(away);
  });
});

describe("the ordering across the renderer's half and the core's", () => {
  // A vault where a screen's name and an object's collide, which is the
  // only place the two halves of the ordering can be seen deciding.
  const COLLIDING: Destination[] = [
    {
      kind: "question",
      path: "questions/Inbox triage.md",
      display: "Inbox triage: what belongs here?",
    },
    {
      kind: "research-question",
      path: "questions/Loose threads (RQ).md",
      display: "Loose threads in the replay account?",
    },
  ];

  it("puts a better match above a better Kind, and breaks a tie by Kind", async () => {
    const dialog = await openCommand({
      "globalCommand.destinations": answering(COLLIDING),
    });
    // The Question is a prefix hit and the Surface only a word start, so
    // the small fixed set does not win on being small.
    type(dialog, "inbox");
    expect(said((await settled(dialog, 2)).destinations)).toEqual([
      row("◆", "Inbox triage: what belongs here?", "question"),
      row("▪", "Question Inbox", "surface", true),
    ]);
    // Both are prefix hits, and now the Dashboard leads: Kind is what a
    // tie is broken by, never what beats a better answer.
    type(dialog, "loose");
    expect(said((await settled(dialog, 2)).destinations)).toEqual([
      row("▦", "Loose Ends", "dashboard"),
      row("■", "Loose threads in the replay account?", "research question"),
    ]);
  });

  it("puts an exact hit at the top whatever its Kind", async () => {
    const dialog = await openCommand({
      "globalCommand.destinations": answering(COLLIDING),
    });
    type(dialog, "loose threads in the replay account");
    expect(said((await settled(dialog, 1)).destinations)).toEqual([
      row("■", "Loose threads in the replay account?", "research question"),
    ]);
  });
});

const page: ResearchQuestionPage = {
  readable: true,
  path: RQ_PATH,
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
    supporting: { present: true, lines: [] },
    opposing: { present: true, lines: [] },
    related: { present: true, text: "", lines: [] },
    openThreads: { present: true, text: "", threads: [] },
    positionHistory: { present: true, text: "", entries: [] },
  },
  problems: [],
};

describe("the command opens over a page as it does over a list", () => {
  it("opens from a Research Question's page, with that page marked current", async () => {
    window.location.hash = RQ_HASH;
    const dialog = await openCommand({ "researchQuestions.page": page });
    const { destinations, capture } = await settled(dialog, 5);
    expect(said(destinations)[2]).toBe(
      row(
        "■",
        "Does slow-wave density predict recall gain?",
        "research question",
        true
      )
    );
    // Still not the default choice: ↵ is never a no-op by accident.
    expect(chosenIn(destinations)).toBe(-1);
    expect(capture.getAttribute("aria-selected")).toBe("true");
  });
});
