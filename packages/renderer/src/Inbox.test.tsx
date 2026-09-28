import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  empty,
  question as q,
  renderApp,
  rows,
  scrollsInto,
  vault,
} from "./fake-core";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const newest = q(
  "Does time-of-day confound every nap comparison?",
  "2026-09-19T08:00:00Z"
);
const middle = q(
  "Is theta during REM detectable in a single session?",
  "2026-07-19T12:00:00Z"
);
const oldest = q(
  "Who first reported reward-based memory triage?",
  "2025-01-19T12:00:00Z",
  {
    status: "answered",
  }
);

function renderInbox(listing: Record<string, unknown>) {
  vi.useFakeTimers({ now: new Date("2026-09-19T12:00:00Z"), toFake: ["Date"] });
  return renderApp({
    "vault.current": vault,
    "questions.list": (input: unknown) => {
      const { order } = input as { order: "newest" | "oldest" };
      const questions = [...(listing.questions as (typeof newest)[])].sort(
        (a, b) =>
          (order === "oldest" ? 1 : -1) *
          (Date.parse(a.captured) - Date.parse(b.captured))
      );
      return { ...empty, ...listing, questions };
    },
  });
}

describe("the Inbox list", () => {
  it("counts what exists and dates the oldest, and that is the only number in the chrome", async () => {
    renderInbox({ questions: [newest, middle, oldest] });
    await rows();
    const inbox = screen.getByRole("region", { name: "Question Inbox" });
    expect(inbox.textContent).toContain("3 questions · since Jan 2025");
    expect(document.title).not.toMatch(/\d/);
    expect(screen.getByRole("navigation").textContent).not.toMatch(/\d/);
  });

  it("shows each row's text, Provenance, and age, newest first", async () => {
    renderInbox({ questions: [oldest, newest, middle] });
    const items = await rows();
    expect(items.map((r) => r.textContent)).toEqual([
      "◆Does time-of-day confound every nap comparison?Unattachedtoday",
      "◆Is theta during REM detectable in a single session?Unattached2mo",
      "●Who first reported reward-based memory triage?Unattached · answered1y 8mo",
    ]);
  });

  it("reorders when the sort control is switched to oldest", async () => {
    renderInbox({ questions: [newest, middle, oldest] });
    await rows();
    fireEvent.click(screen.getByRole("button", { name: "oldest" }));
    await vi.waitFor(() => {
      expect(screen.getAllByRole("option")[0]?.textContent).toContain(
        "Who first reported"
      );
    });
    expect(
      screen
        .getByRole("button", { name: "oldest" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "newest" })
        .getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("shows a Question from a paper with its source and page", async () => {
    renderInbox({
      questions: [
        q("Would this hold for sparse inputs?", "2026-09-01T12:00:00Z", {
          context: "reading",
          from: "[[olafsdottir2018]]",
          page: 11,
          annotation: "h7",
        }),
      ],
    });
    const [row] = await rows();
    expect(row?.textContent).toContain("[[olafsdottir2018]] · p.11");
    expect(row?.textContent).not.toContain("Unattached");
  });
});

describe("selection", () => {
  it("starts with nothing selected and an empty detail pane", async () => {
    renderInbox({ questions: [newest, middle] });
    const items = await rows();
    expect(items.every((r) => r.getAttribute("aria-selected") !== "true")).toBe(
      true
    );
    expect(screen.getByRole("complementary").textContent).toBe("");
  });

  it("selects on click and shows the full text, status, and Provenance", async () => {
    renderInbox({ questions: [newest, middle] });
    const items = await rows();
    fireEvent.click(items[1]!);
    expect(items[1]?.getAttribute("aria-selected")).toBe("true");
    const detail = screen.getByRole("complementary");
    expect(within(detail).getByRole("heading").textContent).toBe(
      "Is theta during REM detectable in a single session?"
    );
    expect(detail.textContent).toContain("◆");
    expect(detail.textContent).toContain("open");
    expect(detail.textContent).toContain("Provenance");
    expect(detail.textContent).toContain("Unattached");
    expect(detail.textContent).toContain("19 July 2026 · 12:00");
    expect(within(detail).queryAllByRole("button")).toHaveLength(0);
  });

  it("moves with j/k and the arrow keys, and selects with ↵", async () => {
    renderInbox({ questions: [newest, middle, oldest] });
    const items = await rows();
    const list = screen.getByRole("listbox", { name: "Questions" });
    list.focus();
    fireEvent.keyDown(list, { key: "Enter" });
    expect(items[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "j" });
    expect(items[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(items[2]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(items[2]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "k" });
    expect(items[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(items[0]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("complementary").textContent).toContain(
      "Does time-of-day confound"
    );
  });

  it("shows an answered Question's status as glyph and label, never colour alone", async () => {
    renderInbox({ questions: [oldest] });
    const [row] = await rows();
    fireEvent.click(row!);
    const detail = screen.getByRole("complementary");
    expect(detail.textContent).toContain("●");
    expect(detail.textContent).toContain("answered");
  });
});

describe("what cannot be shown whole", () => {
  // A failed read is `voices.test.tsx`'s: it is the *wrong* Voice.

  it("names each row's status for assistive technology, not by colour alone", async () => {
    renderInbox({ questions: [newest, oldest] });
    const items = await rows();
    expect(within(items[0]!).getByRole("img", { name: "open" })).toBeDefined();
    expect(
      within(items[1]!).getByRole("img", { name: "answered" })
    ).toBeDefined();
  });

  it("lists a partial file by its name, marked partial, aged by its mtime", async () => {
    renderInbox({
      questions: [newest],
      partial: [
        {
          path: "/v/consolidation-vault/Half a thought.md",
          name: "Half a thought",
          mtime: "2026-09-16T12:00:00Z",
        },
      ],
    });
    const items = await rows();
    expect(items).toHaveLength(2);
    expect(items[1]?.textContent).toContain("Half a thought");
    expect(items[1]?.textContent).toMatch(/partial/i);
    expect(items[1]?.textContent).toContain("3d");
    // The header counts Questions; a Partial file is listed, not counted.
    const inbox = screen.getByRole("region", { name: "Question Inbox" });
    expect(inbox.textContent).toContain("1 question · since Sep 2026");

    fireEvent.click(items[1]!);
    const detail = screen.getByRole("complementary");
    expect(within(detail).getByRole("heading").textContent).toBe(
      "Half a thought"
    );
    expect(detail.textContent).toMatch(/partial/i);
    expect(detail.textContent).toContain("16 September 2026 · 12:00");
    expect(detail.textContent).not.toContain("/v/consolidation-vault");
  });

  it("has no footer line when every file could be read", async () => {
    renderInbox({ questions: [newest] });
    await rows();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it("counts unreadable files in a footer line that opens to paths and reasons", async () => {
    renderInbox({
      questions: [newest],
      unreadable: [
        {
          path: "/v/consolidation-vault/Garbled.md",
          reason: "frontmatter is not a map of keys",
        },
        {
          path: "/v/consolidation-vault/Locked.md",
          reason: "EACCES: permission denied",
        },
      ],
    });
    await rows();
    const summary = screen.getByText("2 files could not be read");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(details.textContent).toContain("/v/consolidation-vault/Garbled.md");
    expect(details.textContent).toContain("frontmatter is not a map of keys");
    expect(details.textContent).toContain("EACCES: permission denied");
  });
});

/**
 * The selected row stays inside the list's window (#320). This is the longest
 * list in the app — every Question in the vault, which the brief's own
 * realistic scale puts at a few hundred — so `j` held down walks the
 * selection off the bottom of a pane that would otherwise sit still, leaving
 * the keyboard acting on a row nobody can see. jsdom lays nothing out, so
 * what a test can see is the call and the `block` that decides how far the
 * list moves.
 */
describe("the selected row stays in view", () => {
  // Twelve, newest first: more than the pane shows at any plausible height.
  const MANY = Array.from({ length: 12 }, (_, i) =>
    q(
      `Is the ${i}th night the one that matters?`,
      `2026-09-${12 - i}T08:00:00Z`
    )
  );

  it("follows the selection down as j walks it, and back up on k — the arrows alike", async () => {
    renderInbox({ questions: MANY });
    const items = await rows();
    const list = screen.getByRole("listbox", { name: "Questions" });
    list.focus();
    const scrolled = scrollsInto();

    fireEvent.keyDown(list, { key: "Enter" });
    for (let i = 0; i < 10; i++) fireEvent.keyDown(list, { key: "j" });
    expect(items[10]?.getAttribute("aria-selected")).toBe("true");
    expect(scrolled.at(-1)).toEqual({ row: items[10], block: "nearest" });

    for (let i = 0; i < 10; i++) fireEvent.keyDown(list, { key: "k" });
    expect(items[0]?.getAttribute("aria-selected")).toBe("true");
    expect(scrolled.at(-1)).toEqual({ row: items[0], block: "nearest" });

    // The arrows share j/k's case rather than a case of their own, and the
    // claim in the name is about both of them.
    for (let i = 0; i < 10; i++) fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(items[10]?.getAttribute("aria-selected")).toBe("true");
    expect(scrolled.at(-1)).toEqual({ row: items[10], block: "nearest" });
    for (let i = 0; i < 10; i++) fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(scrolled.at(-1)).toEqual({ row: items[0], block: "nearest" });
  });

  it("scrolls nothing when j has nowhere left to take the selection", async () => {
    renderInbox({ questions: MANY });
    const items = await rows();
    const list = screen.getByRole("listbox", { name: "Questions" });
    list.focus();
    fireEvent.click(items.at(-1)!);
    const scrolled = scrollsInto();

    fireEvent.keyDown(list, { key: "j" });

    // The selection did not move, so neither does the list: the mechanism is
    // keyed on where the choice is, not on the key that was pressed.
    expect(items.at(-1)?.getAttribute("aria-selected")).toBe("true");
    expect(scrolled).toEqual([]);
  });

  it("follows a selection that moved for a reason that was not a key", async () => {
    renderInbox({ questions: MANY });
    const items = await rows();
    const scrolled = scrollsInto();

    fireEvent.click(items[9]!);

    expect(scrolled.at(-1)).toEqual({ row: items[9], block: "nearest" });
  });
});
