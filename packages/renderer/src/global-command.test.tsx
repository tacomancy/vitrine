import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Destination, Destinations, ResearchQuestionPage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  empty,
  pressGlobalChord,
  question,
  renderApp,
  scrollsInto,
  vault,
} from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// ⌘K opens, lists and goes (#302; ADR 0027 decisions 2, 4, 6 and 7). The
// navigation half: one keyboard list over whatever the window was doing,
// spanning the Surfaces and Dashboards the renderer holds and the objects
// the core answers with, and `↵` is one push of the route.

const RQ_PATH = "questions/Does slow-wave density predict recall gain (RQ).md";
const Q_PATH = "questions/Is replay necessary for consolidation.md";

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

/**
 * Deliberately not `match.ts`'s: the fake stands in for the *core*, and a
 * fake that reached for the code under test would score a wrong rung
 * wrongly on both sides and still pass. Spelled out here, once.
 */
const asTyped = (text: string) =>
  text
    .toLowerCase()
    .replace(/['\u2019]+/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

/**
 * The core's half of the list, as the procedure contract describes it: a
 * contains on the Display name, answered in the order the core would have
 * put them in — declaration order, which is this fixture's recency. The
 * renderer is what decides where the Surfaces and Dashboards land among
 * them, and that is what the suite is watching.
 */
const answering =
  (objects: Destination[] = OBJECTS) =>
  (input: unknown): Destinations => {
    const { query } = input as { query: string };
    const wanted = asTyped(query);
    const rows = objects.filter((row) => asTyped(row.display).includes(wanted));
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
  within(dialog).findByRole("listbox", { name: "Destinations" });

async function rowsOf(dialog: HTMLElement) {
  const list = await listOf(dialog);
  return within(list).getAllByRole("option");
}

/** What a row says, glyph and Kind label included, as one string. */
const said = (rows: HTMLElement[]) => rows.map((row) => row.textContent);

const row = (glyph: string, name: string, kind: string, current = false) =>
  `${glyph}${name}${kind}${current ? "current" : ""}`;

/** The list once the core's half of it has arrived beside the renderer's. */
async function settled(dialog: HTMLElement, rows: number) {
  await vi.waitFor(async () => expect(await rowsOf(dialog)).toHaveLength(rows));
  return rowsOf(dialog);
}

const chosenIn = (rows: HTMLElement[]) =>
  rows.findIndex((r) => r.getAttribute("aria-selected") === "true");

const queryBox = (dialog: HTMLElement) =>
  within(dialog).getByRole("combobox", { name: "Go to something" });

function type(dialog: HTMLElement, text: string) {
  fireEvent.change(queryBox(dialog), { target: { value: text } });
}

const verbOf = (dialog: HTMLElement) =>
  within(dialog).getByRole("status").textContent ?? "";

describe("⌘K opens one list over whatever the window was doing", () => {
  it("opens from the Inbox and lists the Surfaces, the Dashboards and the objects", async () => {
    const dialog = await openCommand();
    expect(said(await settled(dialog, 5))).toEqual([
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
    const rows = await settled(dialog, 5);
    expect(said(rows)[1]).toBe(row("▦", "Loose Ends", "dashboard", true));
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
  });
});

describe("typing narrows the list, and each row says why it is here", () => {
  it("marks the run that matched, spanning the punctuation a query typed across it does not have", async () => {
    const dialog = await openCommand();
    type(dialog, "slow wave density");
    expect(said(await settled(dialog, 1))).toEqual([
      row(
        "■",
        "Does slow-wave density predict recall gain?",
        "research question"
      ),
    ]);
    const [only] = await rowsOf(dialog);
    expect(only?.querySelector("mark")?.textContent).toBe("slow-wave density");
  });

  it("puts an exact hit above everything, and a Surface above an object that merely contains the word", async () => {
    const dialog = await openCommand();
    type(dialog, "question inbox");
    expect(said(await settled(dialog, 1))).toEqual([
      row("▪", "Question Inbox", "surface", true),
    ]);
    type(dialog, "loose");
    expect(said(await settled(dialog, 1))).toEqual([
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
    // The screens are still reachable and still listed — but counting them
    // as the whole answer would say the vault holds two things.
    expect(await rowsOf(dialog)).toHaveLength(2);
    expect(
      within(dialog).getByText("the Surfaces and Dashboards only")
    ).toBeDefined();
    expect(within(dialog).queryByText(/matching/)).toBeNull();
  });
});

describe("the choice, and where ↵ takes it", () => {
  it("starts on the first row that is not where the window already is", async () => {
    const dialog = await openCommand();
    const rows = await settled(dialog, 5);
    expect(rows[0]?.getAttribute("aria-current")).toBe("page");
    expect(chosenIn(rows)).toBe(1);
    expect(verbOf(dialog)).toBe("↵Go toLoose Ends");
  });

  it("moves with the arrows, onto the current Address included", async () => {
    const dialog = await openCommand();
    await settled(dialog, 5);
    const input = queryBox(dialog);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(chosenIn(await rowsOf(dialog))).toBe(2);
    expect(verbOf(dialog)).toBe(
      "↵Go toDoes slow-wave density predict recall gain?"
    );
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(chosenIn(await rowsOf(dialog))).toBe(0);
    expect(verbOf(dialog)).toBe("↵Go toQuestion Inbox");
  });

  it("never points past the list a new query returned", async () => {
    const dialog = await openCommand();
    await settled(dialog, 5);
    const input = queryBox(dialog);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(chosenIn(await rowsOf(dialog))).toBe(4);
    type(dialog, "loose");
    expect(chosenIn(await settled(dialog, 1))).toBe(0);
  });

  it("does not call the one row a stranger when it is where the window already is", async () => {
    const dialog = await openCommand();
    type(dialog, "question inbox");
    const rows = await settled(dialog, 1);
    expect(said(rows)).toEqual([row("▪", "Question Inbox", "surface", true)]);
    expect(chosenIn(rows)).toBe(-1);
    expect(verbOf(dialog)).toBe("↵Go toyou are already here");
  });

  it("says so when nothing goes by that name, rather than going quiet", async () => {
    const dialog = await openCommand();
    type(dialog, "dendritic spikes");
    await vi.waitFor(() =>
      expect(verbOf(dialog)).toBe("↵Go tonothing here goes by that name")
    );
    expect(within(dialog).getByText("no destination matches")).toBeDefined();
  });

  it("goes with one push of the route, so back returns where the user was", async () => {
    window.location.hash = "#/loose-ends";
    const dialog = await openCommand();
    type(dialog, "slow wave");
    await settled(dialog, 1);
    fireEvent.keyDown(queryBox(dialog), { key: "Enter" });
    expect(window.location.hash).toBe(
      `#/research-question/${RQ_PATH.split("/").map(encodeURIComponent).join("/")}`
    );
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
    fireEvent.keyDown(queryBox(dialog), { key: "Enter" });

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("listbox", { name: "Questions" })
      )
    );
    expect(
      screen.getAllByRole("option").map((r) => r.getAttribute("aria-selected"))
    ).toEqual(["true"]);
  });

  it("keeps the keyboard inside the overlay, so esc is never out of reach", async () => {
    renderApp(base);
    const away = await screen.findByRole("link", { name: "Loose Ends" });
    away.focus();
    pressGlobalChord();
    const dialog = await screen.findByRole("dialog", {
      name: "Global command",
    });
    // One tab stop: ⇥ walking out would leave the key handler behind the
    // scrim, and the command would have no way left to dismiss it. jsdom
    // never moves focus on Tab, so what is asserted is the key being
    // taken — the only thing standing between the two.
    const taken = !fireEvent.keyDown(queryBox(dialog), { key: "Tab" });
    expect(taken).toBe(true);
    expect(document.activeElement).toBe(queryBox(dialog));
    fireEvent.keyDown(queryBox(dialog), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(away);
  });

  it("opens whatever case the chord arrives in, so caps lock is not a dead key", async () => {
    renderApp(base);
    await screen.findByRole("banner");
    fireEvent.keyDown(window, { key: "K", metaKey: true });
    expect(
      await screen.findByRole("dialog", { name: "Global command" })
    ).toBeDefined();
  });

  it("goes to a Dashboard and leaves the keyboard where the command found it", async () => {
    renderApp(base);
    const away = await screen.findByRole("link", { name: "Question Inbox" });
    away.focus();
    pressGlobalChord();
    const dialog = await screen.findByRole("dialog", {
      name: "Global command",
    });
    type(dialog, "loose");
    await settled(dialog, 1);
    fireEvent.keyDown(queryBox(dialog), { key: "Enter" });
    expect(window.location.hash).toBe("#/loose-ends");
    expect(screen.queryByRole("dialog")).toBeNull();
    // Loose Ends takes no keyboard of its own, so the restore stands.
    expect(document.activeElement).toBe(away);
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
    fireEvent.keyDown(queryBox(dialog), { key: "Escape" });
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
    expect(said(await settled(dialog, 2))).toEqual([
      row("◆", "Inbox triage: what belongs here?", "question"),
      row("▪", "Question Inbox", "surface", true),
    ]);
    // Both are prefix hits, and now the Dashboard leads: Kind is what a
    // tie is broken by, never what beats a better answer.
    type(dialog, "loose");
    expect(said(await settled(dialog, 2))).toEqual([
      row("▦", "Loose Ends", "dashboard"),
      row("■", "Loose threads in the replay account?", "research question"),
    ]);
  });

  it("puts an exact hit at the top, and the choice lands on it", async () => {
    const dialog = await openCommand({
      "globalCommand.destinations": answering(COLLIDING),
    });
    type(dialog, "loose threads in the replay account");
    const rows = await settled(dialog, 1);
    expect(said(rows)).toEqual([
      row("■", "Loose threads in the replay account?", "research question"),
    ]);
    expect(chosenIn(rows)).toBe(0);
    expect(verbOf(dialog)).toBe("↵Go toLoose threads in the replay account?");
  });
});

describe("the command opens over a page as it does over a list", () => {
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

  it("opens from a Research Question's page, with that page marked current", async () => {
    window.location.hash = `#/research-question/${RQ_PATH.split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const dialog = await openCommand({ "researchQuestions.page": page });
    const rows = await settled(dialog, 5);
    expect(said(rows)[2]).toBe(
      row(
        "■",
        "Does slow-wave density predict recall gain?",
        "research question",
        true
      )
    );
    // Still not the default choice: ↵ is never a no-op by accident.
    expect(chosenIn(rows)).toBe(0);
  });
});

/**
 * The row the keyboard is on stays inside the list's window (#320). The
 * overlay gives the list 300px — about nine rows — and the core answers with
 * up to fifty, so the choice walks out of sight long before it runs out of
 * rows. jsdom lays nothing out, so what a test can see is the call the
 * browser does the scrolling from: which row it was made on, and the `block`
 * that decides how far the list moves.
 */
describe("the row the keyboard is on stays in view", () => {
  // Twelve objects and the two screens: fourteen rows in room for nine.
  const MANY: Destination[] = Array.from({ length: 12 }, (_, i) => ({
    kind: "question",
    path: `questions/Is the ${i}th night the one that matters.md`,
    display: `Is the ${i}th night the one that matters?`,
  }));

  const many = () =>
    openCommand({ "globalCommand.destinations": answering(MANY) });

  it("follows the choice down past the bottom of the window", async () => {
    const dialog = await many();
    const rows = await settled(dialog, 14);
    const scrolled = scrollsInto();
    // From the default choice — row 1, the first that is not where the
    // window already is — to row 10, five rows below the fold.
    for (let i = 0; i < 9; i++)
      fireEvent.keyDown(queryBox(dialog), { key: "ArrowDown" });

    expect(chosenIn(await rowsOf(dialog))).toBe(10);
    expect(scrolled.at(-1)?.row).toBe(rows[10]);
  });

  it("follows it back up past the top", async () => {
    const dialog = await many();
    const rows = await settled(dialog, 14);
    for (let i = 0; i < 9; i++)
      fireEvent.keyDown(queryBox(dialog), { key: "ArrowDown" });
    const scrolled = scrollsInto();
    for (let i = 0; i < 10; i++)
      fireEvent.keyDown(queryBox(dialog), { key: "ArrowUp" });

    expect(chosenIn(await rowsOf(dialog))).toBe(0);
    expect(scrolled.at(-1)?.row).toBe(rows[0]);
  });

  it("moves the list by as little as it can, so the rows already read stay put", async () => {
    const dialog = await many();
    await settled(dialog, 14);
    const scrolled = scrollsInto();
    fireEvent.keyDown(queryBox(dialog), { key: "ArrowDown" });

    // `nearest` is also what makes an already-visible row cost no scroll at
    // all, which is why opening the command does not jolt.
    expect(scrolled.map(({ block }) => block)).toEqual(["nearest"]);
  });

  it("brings the row a narrowed list re-chose into view", async () => {
    const dialog = await many();
    await settled(dialog, 14);
    for (let i = 0; i < 9; i++)
      fireEvent.keyDown(queryBox(dialog), { key: "ArrowDown" });
    const scrolled = scrollsInto();
    type(dialog, "11th night");

    const rows = await settled(dialog, 1);
    await vi.waitFor(() => expect(scrolled.at(-1)?.row).toBe(rows[0]));
  });
});
