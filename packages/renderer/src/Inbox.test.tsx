import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const vault = { name: "consolidation-vault", path: "/v/consolidation-vault" };

const q = (
  question: string,
  captured: string,
  rest: Record<string, unknown> = {}
) => ({
  id: question.slice(0, 10),
  path: `/v/consolidation-vault/questions/${question}.md`,
  question,
  status: "open",
  captured,
  context: "other",
  ...rest,
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

const empty = { questions: [], partial: [], unreadable: [] };

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

async function rows() {
  const list = await screen.findByRole("listbox", { name: "Questions" });
  return within(list).findAllByRole("option");
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
      "●Who first reported reward-based memory triage?Unattached1y 8mo",
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
  it("states a failed read in place of the list, never as zero questions", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": () => {
        throw new Error("No vault is open.");
      },
    });
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(await within(inbox).findByRole("alert")).toBeDefined();
    expect(inbox.textContent).toContain("No vault is open.");
    expect(inbox.textContent).not.toContain("0 questions");
  });

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
