import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Destination, Destinations, ResearchQuestionPage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  empty,
  pressGlobalChord,
  question,
  renderApp,
  vault,
} from "./fake-core";
import { matchKey, strength } from "./match";

afterEach(cleanup);
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

// Unnamed here: the list's own name is what it is before anything is
// typed and what it is after, which is a thing to assert on rather than a
// thing to find it by.
const listOf = (dialog: HTMLElement) => within(dialog).findByRole("listbox");

const nameOfList = async (dialog: HTMLElement) =>
  (await listOf(dialog)).getAttribute("aria-label");

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

/**
 * What both web storages hold — where a visit history would have to land
 * if one were kept — emptied first, so what comes back is this flow's own
 * writing and not another test's.
 */
function storedAfterClearing(): () => string[] {
  for (const store of [localStorage, sessionStorage]) store.clear();
  return () =>
    [localStorage, sessionStorage].flatMap((store) =>
      Array.from(
        { length: store.length },
        (_, at) => `${store.key(at)}=${store.getItem(String(store.key(at)))}`
      )
    );
}

/**
 * The whole list with nothing typed, opened from the Inbox: the Surfaces
 * and Dashboards, then the objects newest first (#304). Two suites assert
 * it — the one that opens the command, and the one that comes back to it —
 * and they must be asserting the same list.
 */
const RECENT = [
  row("▪", "Question Inbox", "surface", true),
  row("▦", "Loose Ends", "dashboard"),
  row("■", "Does slow-wave density predict recall gain?", "research question"),
  row("◆", "Is replay necessary for consolidation?", "question"),
  row("◆", "What counts as a reactivation event here?", "question"),
];

describe("⌘K opens one list over whatever the window was doing", () => {
  it("opens from the Inbox and lists the Surfaces, the Dashboards and the objects", async () => {
    const dialog = await openCommand();
    expect(said(await settled(dialog, 5))).toEqual(RECENT);
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
    type(dialog, "slow wave");
    await settled(dialog, 1);
    expect(
      await within(dialog).findByText("1 of 312 — keep typing")
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

describe("before a character is typed, the list is what changed most recently", () => {
  // #304; ADR 0027 decision 6. The most common thing after ⌘K is going
  // back to what was just being done, so an empty query is worth more than
  // the first fifty files of the vault in name order.

  it("says the rows are the recent set rather than counting them as matches", async () => {
    const dialog = await openCommand();
    expect(said(await settled(dialog, 5))).toEqual(RECENT);
    expect(
      await within(dialog).findByText("recent · type to narrow")
    ).toBeDefined();
  });

  it("still says how long a cut recent set is, inside naming it rather than instead of it", async () => {
    // A cut list says its length whichever list it is, and a bare "5 of
    // 314" here would be a count of what a query nobody typed had found.
    const dialog = await openCommand({
      "globalCommand.destinations": (): Destinations => ({
        rows: OBJECTS,
        total: 312,
      }),
    });
    await settled(dialog, 5);
    expect(
      await within(dialog).findByText("recent · 5 of 314 · type to narrow")
    ).toBeDefined();
  });

  it("calls the list what it is, so it is not announced as matches for nothing", async () => {
    // The count line says which list this is, and it is read by whoever can
    // see it; the list's own name is what says it to whoever cannot.
    const dialog = await openCommand();
    await settled(dialog, 5);
    expect(await nameOfList(dialog)).toBe("Recent");

    type(dialog, "loose");
    await settled(dialog, 1);
    expect(await nameOfList(dialog)).toBe("Destinations");
  });

  it("counts matches while there is a query, and returns to the recent set when it is cleared", async () => {
    const dialog = await openCommand();
    type(dialog, "loose");
    await settled(dialog, 1);
    expect(await within(dialog).findByText("1 matching")).toBeDefined();

    type(dialog, "");
    expect(said(await settled(dialog, 5))).toEqual(RECENT);
    expect(
      await within(dialog).findByText("recent · type to narrow")
    ).toBeDefined();
  });

  it("remembers nothing between openings: recent is what changed on disk, not where the user has been", async () => {
    const stored = storedAfterClearing();
    const dialog = await openCommand();
    await settled(dialog, 5);
    type(dialog, "loose");
    await settled(dialog, 1);
    fireEvent.keyDown(queryBox(dialog), { key: "Enter" });
    expect(window.location.hash).toBe("#/loose-ends");

    pressGlobalChord();
    const reopened = await screen.findByRole("dialog", {
      name: "Global command",
    });
    // Nothing the last opening was typing, and the same order as before:
    // the Dashboard just visited has not risen to the top, because a visit
    // is not recorded anywhere (ADR 0021 refused the store).
    expect((queryBox(reopened) as HTMLInputElement).value).toBe("");
    const rows = await settled(reopened, 5);
    expect(said(rows)).toEqual([
      row("▪", "Question Inbox", "surface"),
      row("▦", "Loose Ends", "dashboard", true),
      ...RECENT.slice(2),
    ]);
    // Marked as where the window is, and still not what ↵ would take.
    expect(chosenIn(rows)).toBe(0);
    // The order alone cannot say a history was not written — one could be
    // written and not yet read — so what was stored is asserted on too.
    expect(stored()).toEqual([]);
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

  it("puts an exact hit at the top whatever its Kind", async () => {
    const dialog = await openCommand({
      "globalCommand.destinations": answering(COLLIDING),
    });
    type(dialog, "loose threads in the replay account");
    expect(said(await settled(dialog, 1))).toEqual([
      row("■", "Loose threads in the replay account?", "research question"),
    ]);
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
