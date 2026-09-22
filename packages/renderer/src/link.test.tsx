import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Candidate, Candidates } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, question as q, renderApp, rows, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Link from the Inbox (#211; spec #206 story 4): one key opens the one
// picker over the index's files, the choice is one write through the
// protocol, and leaving writes nothing.

const open = q(
  "Does slow-wave density predict recall gain?",
  "2026-09-19T08:00:00Z"
);

const CANDIDATES: Candidate[] = [
  {
    path: "notes/Sleep and consolidation.md",
    name: "Sleep and consolidation",
    kind: "note",
  },
  {
    path: "questions/Is the overnight benefit (RQ).md",
    name: "Is the overnight benefit (RQ)",
    kind: "research-question",
  },
  {
    path: "sources/rasch2013.md",
    name: "rasch2013",
    kind: "source",
    pdf: true,
  },
  { path: "sources/born2010.md", name: "born2010", kind: "source", pdf: false },
  {
    path: "sources/klinzing2019.md",
    name: "klinzing2019",
    kind: "source-stub",
    pdf: false,
  },
];

const well = { indexing: null, watching: { ok: true }, current: { ok: true } };

/** The fake core answers the picker by name-contains, as the real query does. */
const matching = (input: unknown): Candidates => {
  const { query } = input as { query: string };
  const rows = CANDIDATES.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );
  return { rows, total: rows.length };
};

function renderInbox({
  link = (input: unknown) => ({
    ...(input as { path: string }),
    target: "[[Sleep and consolidation]]",
    linked: true,
  }),
  candidates = matching,
}: {
  link?: (input: unknown) => unknown;
  candidates?: (input: unknown) => unknown;
} = {}) {
  vi.useFakeTimers({ now: new Date("2026-09-19T12:00:00Z"), toFake: ["Date"] });
  return renderApp({
    "vault.current": vault,
    "vault.status": well,
    "questions.list": { ...empty, questions: [open] },
    "picker.candidates": candidates,
    "questions.link": link,
  });
}

/** Select the one row, give the list the keyboard, and open the picker with `l`. */
async function openPicker() {
  const [first] = await rows();
  fireEvent.click(first!);
  const list = screen.getByRole("listbox", { name: "Questions" });
  list.focus();
  fireEvent.keyDown(list, { key: "l" });
  const picker = await screen.findByRole("dialog", { name: /link/i });
  return { first: first!, list, picker };
}

/** Every picker row as it reads, once the list has settled on `expected`. */
async function expectShown(expected: string[]) {
  await vi.waitFor(async () => {
    const list = screen.getByRole("listbox", { name: /link/i });
    const found =
      expected.length === 0 ? [] : await within(list).findAllByRole("option");
    expect(found.map((row) => row.textContent)).toEqual(expected);
  });
}

/** The rows as they stand now. */
const shown = async () =>
  (
    await within(screen.getByRole("listbox", { name: /link/i })).findAllByRole(
      "option"
    )
  ).map((row) => row.textContent);

describe("link from the Inbox", () => {
  it("opens the picker over the index's files, each row with its Kind glyph and a Source's PDF", async () => {
    const candidates = vi.fn(matching);
    renderInbox({ candidates });
    const { picker } = await openPicker();

    expect(document.activeElement).toBe(
      within(picker).getByRole("combobox", { name: /find/i })
    );
    // Narrowed to what Link offers — a Hypothesis is not among them — and
    // the Question being linked is not offered as its own target.
    expect(candidates).toHaveBeenCalledWith({
      query: "",
      kinds: ["question", "research-question", "note", "source", "source-stub"],
      exclude: [`questions/${open.question}.md`],
    });
    await expectShown([
      "·Sleep and consolidation",
      "■Is the overnight benefit (RQ)",
      "●rasch2013pdf",
      "●born2010no pdf",
      "○klinzing2019no pdf",
    ]);
    const list = within(picker).getByRole("listbox", { name: /link/i });
    expect(
      within(list).getByRole("img", { name: "research question" })
    ).toBeDefined();
    expect(within(list).getAllByRole("img", { name: "source" })).toHaveLength(
      2
    );
    expect(
      within(list).getByRole("img", { name: "source stub" })
    ).toBeDefined();
    expect(within(list).getByRole("img", { name: "note" })).toBeDefined();
  });

  it("filters as the user types and keeps the choice on the first row", async () => {
    renderInbox();
    const { picker } = await openPicker();
    const find = within(picker).getByRole("combobox", { name: /find/i });

    fireEvent.change(find, { target: { value: "2013" } });

    await expectShown(["●rasch2013pdf"]);
    const [row] = await within(
      screen.getByRole("listbox", { name: /link/i })
    ).findAllByRole("option");
    expect(row!.getAttribute("aria-selected")).toBe("true");
  });

  it("↵ links the selected Question to the chosen file, re-reads the row, and gives the list back the keyboard", async () => {
    const link = vi.fn(() => ({
      path: open.path,
      target: "[[rasch2013]]",
      linked: true,
    }));
    const listed = vi.fn(() => ({ ...empty, questions: [open] }));
    vi.useFakeTimers({
      now: new Date("2026-09-19T12:00:00Z"),
      toFake: ["Date"],
    });
    renderApp({
      "vault.current": vault,
      "vault.status": well,
      "questions.list": listed,
      "picker.candidates": matching,
      "questions.link": link,
    });
    const { list, picker } = await openPicker();
    const reads = listed.mock.calls.length;
    const find = within(picker).getByRole("combobox", { name: /find/i });

    fireEvent.change(find, { target: { value: "2013" } });
    await expectShown(["●rasch2013pdf"]);
    fireEvent.keyDown(find, { key: "Enter" });

    await vi.waitFor(() =>
      expect(link).toHaveBeenCalledWith({
        path: open.path,
        target: "sources/rasch2013.md",
      })
    );
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /link/i })).toBeNull()
    );
    await vi.waitFor(() =>
      expect(listed.mock.calls.length).toBeGreaterThan(reads)
    );
    expect(document.activeElement).toBe(list);
    expect(window.location.hash).toBe("#/inbox");
  });

  it("the arrows move the choice, and ↵ takes the row they are on", async () => {
    const link = vi.fn(() => ({
      path: open.path,
      target: "[[x]]",
      linked: true,
    }));
    renderInbox({ link });
    const { picker } = await openPicker();
    const find = within(picker).getByRole("combobox", { name: /find/i });
    await shown();

    fireEvent.keyDown(find, { key: "ArrowDown" });
    fireEvent.keyDown(find, { key: "ArrowDown" });
    fireEvent.keyDown(find, { key: "ArrowUp" });
    fireEvent.keyDown(find, { key: "Enter" });

    await vi.waitFor(() =>
      expect(link).toHaveBeenCalledWith({
        path: open.path,
        target: "questions/Is the overnight benefit (RQ).md",
      })
    );
  });

  it("esc leaves without writing and puts the keyboard back on the list", async () => {
    const link = vi.fn();
    renderInbox({ link });
    const { list, picker } = await openPicker();
    const find = within(picker).getByRole("combobox", { name: /find/i });

    fireEvent.keyDown(find, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: /link/i })).toBeNull();
    expect(link).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(list);
  });

  it("says when nothing matches rather than showing an empty box", async () => {
    renderInbox();
    const { picker } = await openPicker();
    const find = within(picker).getByRole("combobox", { name: /find/i });

    fireEvent.change(find, { target: { value: "no such file" } });

    expect(await within(picker).findByText(/nothing/i)).toBeDefined();
    await expectShown([]);
  });

  it("says how many matched when the list was cut, so a long list is never silently short", async () => {
    renderInbox({
      candidates: () => ({ rows: CANDIDATES, total: 312 }),
    });
    const { picker } = await openPicker();

    expect(await within(picker).findByText(/5 of 312/)).toBeDefined();
  });

  it("a refused link shows its reason on the row, and the picker is gone", async () => {
    renderInbox({
      link: () => {
        throw new Error("questions/… : related is not a list of links");
      },
    });
    const { first, picker } = await openPicker();
    const find = within(picker).getByRole("combobox", { name: /find/i });
    await shown();

    fireEvent.keyDown(find, { key: "Enter" });

    const line = await within(first).findByRole("alert");
    expect(line.textContent).toContain("related is not a list of links");
    expect(screen.queryByRole("dialog", { name: /link/i })).toBeNull();
  });

  it("does nothing when no row is selected, and lists the key in the footer channel", async () => {
    const candidates = vi.fn(matching);
    renderInbox({ candidates });
    await rows();
    const list = screen.getByRole("listbox", { name: "Questions" });

    fireEvent.keyDown(list, { key: "l" });

    expect(screen.queryByRole("dialog", { name: /link/i })).toBeNull();
    expect(candidates).not.toHaveBeenCalled();
    expect(screen.getByRole("contentinfo").textContent).toContain("l link");
  });
});
