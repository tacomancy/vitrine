import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  empty,
  question as q,
  renderApp,
  scrollsInto,
  vault,
} from "./fake-core";

afterEach(cleanup);
// Each test starts where a fresh window does: no hash at all.
beforeEach(() => window.history.replaceState(null, "", "/"));

const answers = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": {
    indexing: null,
    watching: { ok: true },
    current: { ok: true },
  },
  "looseEnds.rows": { groups: [], problems: [] },
};

describe("the window's location is the URL hash", () => {
  it("renders the Inbox with no hash and makes the hash read #/inbox", async () => {
    renderApp(answers);
    expect(
      await screen.findByRole("region", { name: "Question Inbox" })
    ).toBeDefined();
    expect(window.location.hash).toBe("#/inbox");
  });

  it("treats a hash it does not know as the Inbox", async () => {
    window.location.hash = "#/scouts";
    renderApp(answers);
    expect(
      await screen.findByRole("region", { name: "Question Inbox" })
    ).toBeDefined();
    expect(window.location.hash).toBe("#/inbox");
  });

  it("renders the Loose Ends shell at #/loose-ends: the heading, one quiet line, no groups", async () => {
    window.location.hash = "#/loose-ends";
    renderApp(answers);
    const dashboard = await screen.findByRole("region", { name: "Loose Ends" });
    expect(dashboard.querySelector("h1")?.textContent).toBe("Loose Ends");
    await within(dashboard).findByText(/Nothing to tidy/);
    expect(dashboard.querySelectorAll("p")).toHaveLength(1);
    expect(dashboard.querySelectorAll("section, h2, ul, table")).toHaveLength(
      0
    );
    expect(dashboard.textContent).not.toMatch(/\d/);
    expect(screen.queryByRole("region", { name: "Question Inbox" })).toBeNull();
    const current = screen.getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Loose Ends");
  });

  it("navigates from the Sidebar by hash and back again", async () => {
    renderApp(answers);
    await screen.findByRole("region", { name: "Question Inbox" });
    fireEvent.click(screen.getByRole("link", { name: "Loose Ends" }));
    expect(
      await screen.findByRole("region", { name: "Loose Ends" })
    ).toBeDefined();
    expect(window.location.hash).toBe("#/loose-ends");
    fireEvent.click(screen.getByRole("link", { name: "Question Inbox" }));
    expect(
      await screen.findByRole("region", { name: "Question Inbox" })
    ).toBeDefined();
    expect(window.location.hash).toBe("#/inbox");
    expect(screen.getByRole("link", { current: "page" }).textContent).toBe(
      "Question Inbox"
    );
  });
});

// A Kind-addressed object takes its Kind's own singular name (ADR 0026,
// #299). The old `#/questions/` prefix addressed a *Research* Question, so it
// is left unrecognised rather than redefined: a link saved under it must fail
// where the user can see it instead of quietly opening something else.
describe("an Address takes its Kind's name", () => {
  const PAGE = "questions/Does slow-wave density predict recall gain (RQ).md";
  const ADDRESS = `#/research-question/questions/${encodeURIComponent("Does slow-wave density predict recall gain (RQ).md")}`;
  const RETIRED = `#/questions/questions/${encodeURIComponent("Does slow-wave density predict recall gain (RQ).md")}`;
  const UNRESOLVED = `${RETIRED} — no longer an Address this app uses`;

  it("lands an Address whose file is gone on the Inbox, naming the Address and what came back", async () => {
    window.location.hash = ADDRESS;
    const asked: string[] = [];
    renderApp({
      ...answers,
      "researchQuestions.page": (input: { path: string }) => {
        asked.push(input.path);
        return {
          readable: false,
          path: input.path,
          reason: "missing from the vault",
        };
      },
    });
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(
      await within(inbox).findByText(`${ADDRESS} — missing from the vault`)
    ).toBeDefined();
    // The separator between segments survives the trip and the spaces in the
    // name do not: the core is asked about the path the Address decodes to,
    // and the line names the Address exactly as it was written.
    expect(asked).toEqual([PAGE]);
    expect(window.location.hash).toBe("#/inbox");
  });

  it("lands a retired #/questions/ Address on the Inbox, naming the Address that did not resolve", async () => {
    window.location.hash = RETIRED;
    renderApp(answers);
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(await within(inbox).findByText(UNRESOLVED)).toBeDefined();
    expect(
      screen.queryByRole("region", { name: "Research Question view" })
    ).toBeNull();
    // The canonicalising replace still happens: back never lands on a hash
    // that named nothing, and the line outlives it.
    expect(window.location.hash).toBe("#/inbox");
  });

  it("says nothing about a hash nobody ever wrote", async () => {
    window.location.hash = "#/scouts";
    renderApp(answers);
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(window.location.hash).toBe("#/inbox");
    expect(inbox.textContent).not.toMatch(/Address/);
  });

  it("drops the line once the window has been somewhere else", async () => {
    window.location.hash = RETIRED;
    renderApp(answers);
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    await within(inbox).findByText(UNRESOLVED);
    fireEvent.click(screen.getByRole("link", { name: "Loose Ends" }));
    await screen.findByRole("region", { name: "Loose Ends" });
    fireEvent.click(screen.getByRole("link", { name: "Question Inbox" }));
    const back = await screen.findByRole("region", { name: "Question Inbox" });
    expect(within(back).queryByText(UNRESOLVED)).toBeNull();
  });
});

/**
 * A Question — the app's primary object — has an Address of its own (#300):
 * `#/question/<path>`, which opens the Inbox on that row. The Address is
 * where to *arrive*, not a cursor (ADR 0027 decision 7): nothing the user
 * does afterwards writes back to it.
 */
describe("a Question has an Address", () => {
  const asked = q(
    "Does slow-wave density predict recall gain?",
    "2026-09-19T08:00:00Z"
  );
  const other = q("Is theta during REM detectable?", "2026-07-19T12:00:00Z");
  const third = q(
    "Who first reported reward-based triage?",
    "2025-01-19T12:00:00Z"
  );
  const RELATIVE = "questions/Does slow-wave density predict recall gain?.md";
  const ADDRESS = `#/question/questions/${encodeURIComponent("Does slow-wave density predict recall gain?.md")}`;

  /** The window opened at `ADDRESS`, over a listing the test hands in. */
  function arrive(listing: Record<string, unknown> = {}) {
    window.location.hash = ADDRESS;
    return open(listing);
  }

  /** The window opened wherever the hash already stands. */
  function open(listing: Record<string, unknown> = {}) {
    return renderApp({
      ...answers,
      "questions.list": () => ({
        ...empty,
        questions: [asked, other],
        ...listing,
      }),
    });
  }

  const list = () => screen.getByRole("listbox", { name: "Questions" });
  const selection = () =>
    screen
      .getAllByRole("option")
      .map((row) => row.getAttribute("aria-selected"));

  it("opens the Inbox on that row, with the Detail pane on it, and keeps the Address it was asked for", async () => {
    arrive();
    await screen.findByRole("region", { name: "Question Inbox" });
    await vi.waitFor(() => expect(selection()).toEqual(["true", "false"]));
    expect(screen.getByRole("complementary").textContent).toContain(
      "Does slow-wave density predict recall gain?"
    );
    // Copyable: the canonicalising replace leaves an Address that resolved
    // alone, so reloading on it arrives at the same row.
    expect(window.location.hash).toBe(ADDRESS);
  });

  it("lands the keyboard on the list, and moving the selection leaves the Address where it is", async () => {
    arrive();
    await screen.findByRole("region", { name: "Question Inbox" });
    await vi.waitFor(() => expect(selection()).toEqual(["true", "false"]));
    expect(document.activeElement).toBe(list());

    fireEvent.keyDown(list(), { key: "j" });
    expect(selection()).toEqual(["false", "true"]);
    // A hash that rewrote on every j would fill the back stack with rows.
    expect(window.location.hash).toBe(ADDRESS);
  });

  it("returns to the same row when the Address is copied and opened again", async () => {
    arrive();
    await screen.findByRole("region", { name: "Question Inbox" });
    await vi.waitFor(() => expect(selection()).toEqual(["true", "false"]));
    fireEvent.keyDown(list(), { key: "j" });
    // What the window is showing now is a different row from the one the
    // Address names, and the Address is what a copy would take.
    const copied = window.location.hash;
    expect(copied).toBe(ADDRESS);

    cleanup();
    window.location.hash = copied;
    open();
    await screen.findByRole("region", { name: "Question Inbox" });
    await vi.waitFor(() => expect(selection()).toEqual(["true", "false"]));
  });

  it("brings the row it landed on into view, however far down the list it is", async () => {
    // The arrival is the case an Address makes most: nothing the user did
    // moved the selection, and the row it names can be anywhere in a list of
    // hundreds. ADR 0010's rule gives the list the keyboard, and a keyboard
    // on a row nobody can see is the landing not happening (#320).
    const newer = Array.from({ length: 11 }, (_, i) =>
      q(
        `Is the ${i}th night the one that matters?`,
        `2026-09-${20 + i}T08:00:00Z`
      )
    );
    const scrolled = scrollsInto();
    arrive({ questions: [...newer, asked] });
    await screen.findByRole("region", { name: "Question Inbox" });

    await vi.waitFor(() => expect(selection().at(-1)).toBe("true"));
    expect(scrolled.at(-1)).toEqual({
      row: screen.getAllByRole("option").at(-1),
      block: "nearest",
    });
  });

  it("lands an Address whose Question is not in the vault on the Inbox, naming the Address", async () => {
    arrive({ questions: [other] });
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(
      await within(inbox).findByText(
        `${ADDRESS} — not a Question in this vault`
      )
    ).toBeDefined();
    expect(window.location.hash).toBe("#/inbox");
  });

  it("carries the vault's own reason when the file is there but could not be read", async () => {
    arrive({
      questions: [other],
      unreadable: [{ path: asked.path, reason: "frontmatter did not parse" }],
    });
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(
      await within(inbox).findByText(`${ADDRESS} — frontmatter did not parse`)
    ).toBeDefined();
    expect(window.location.hash).toBe("#/inbox");
  });

  it("follows a rename under the open Address as any selection is followed, and says nothing", async () => {
    window.location.hash = ADDRESS;
    let listing = { ...empty, questions: [asked, other, third] };
    const { stream } = renderApp({
      ...answers,
      "questions.list": () => listing,
    });
    await screen.findByRole("region", { name: "Question Inbox" });
    await vi.waitFor(() =>
      expect(selection()).toEqual(["true", "false", "false"])
    );

    // One batch: the arrived-at file renamed, another removed — the removal
    // is what makes the re-query visible, so the assertion lands on the new
    // list rather than the old one.
    const moved = { ...asked, path: `${vault.path}/questions/Renamed.md` };
    listing = { ...empty, questions: [moved, other] };
    act(() => {
      stream.push({
        type: "vaultChanged",
        changed: [],
        removed: ["questions/Who first reported reward-based triage?.md"],
        renamed: [{ from: RELATIVE, to: "questions/Renamed.md" }],
      });
    });
    await vi.waitFor(() => expect(selection()).toHaveLength(2));
    expect(selection()).toEqual(["true", "false"]);
    expect(screen.queryByRole("status")).toBeNull();
    expect(window.location.hash).toBe(ADDRESS);
  });

  it("clears the selection when the arrived-at Question is removed, without a word about the Address", async () => {
    window.location.hash = ADDRESS;
    let listing = { ...empty, questions: [asked, other] };
    const { stream } = renderApp({
      ...answers,
      "questions.list": () => listing,
    });
    await screen.findByRole("region", { name: "Question Inbox" });
    await vi.waitFor(() => expect(selection()).toEqual(["true", "false"]));

    listing = { ...empty, questions: [other] };
    act(() => {
      stream.push({
        type: "vaultChanged",
        changed: [],
        removed: [RELATIVE],
        renamed: [],
      });
    });
    await vi.waitFor(() => expect(selection()).toEqual(["false"]));
    // The arrival is spent: a Question that goes away under the reader is
    // the Inbox's own absence, not an Address that failed to resolve.
    expect(screen.queryByRole("status")).toBeNull();
    expect(window.location.hash).toBe(ADDRESS);
  });
});
