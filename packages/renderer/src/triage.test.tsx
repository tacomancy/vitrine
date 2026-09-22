import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, question as q, renderApp, rows, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Answer in place, drop, reopen (#212; spec #206 stories 5–10): the last
// three triage keys, each one write, each showing as the row's glyph and
// label. Never a badge, never a count of what is still open.

const open = q(
  "Does slow-wave density predict recall gain?",
  "2026-09-19T08:00:00Z"
);
const dropped = q("Is theta during REM detectable?", "2026-07-19T12:00:00Z", {
  status: "abandoned",
});
const answered = q(
  "Who first reported reward-based triage?",
  "2025-01-19T12:00:00Z",
  { status: "answered" }
);

const ANSWER = "Only above 1.5 Hz, and only in the first cycle.";

const well = { indexing: null, watching: { ok: true }, current: { ok: true } };

function renderInbox(
  questions: unknown[],
  procedures: Record<string, unknown> = {}
) {
  vi.useFakeTimers({ now: new Date("2026-09-19T12:00:00Z"), toFake: ["Date"] });
  return renderApp({
    "vault.current": vault,
    "vault.status": well,
    "questions.list": { ...empty, questions },
    "questions.answer": () => ({ path: "x", status: "answered" }),
    "questions.drop": () => ({ path: "x", status: "abandoned" }),
    "questions.reopen": () => ({ path: "x", status: "open" }),
    ...procedures,
  });
}

/** Select row `index` and leave the list focused, as the keys need it. */
async function select(index: number) {
  const items = await rows();
  fireEvent.click(items[index]!);
  const list = screen.getByRole("listbox", { name: "Questions" });
  list.focus();
  return { row: items[index]!, list };
}

const answerInput = () => screen.getByRole("textbox", { name: "Answer" });

describe("answer in place", () => {
  it("a opens one line on the row, ↵ sends the typed line with the selected path, and the line closes with the list back in hand", async () => {
    const answer = vi.fn(() => ({ path: open.path, status: "answered" }));
    renderInbox([open], { "questions.answer": answer });
    const { row, list } = await select(0);

    fireEvent.keyDown(list, { key: "a" });

    const input = within(row).getByRole("textbox", { name: "Answer" });
    expect(document.activeElement).toBe(input);
    // The question stays legible while its answer is typed.
    expect(row.textContent).toContain(open.question);

    fireEvent.change(input, { target: { value: ANSWER } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith({ path: open.path, line: ANSWER })
    );
    expect(screen.queryByRole("textbox", { name: "Answer" })).toBeNull();
    expect(document.activeElement).toBe(list);
  });

  it("esc reverts: nothing is written, the line closes, and the selection is where it was", async () => {
    const answer = vi.fn(() => ({ path: open.path, status: "answered" }));
    renderInbox([open], { "questions.answer": answer });
    const { row, list } = await select(0);

    fireEvent.keyDown(list, { key: "a" });
    fireEvent.change(answerInput(), { target: { value: ANSWER } });
    fireEvent.keyDown(answerInput(), { key: "Escape" });

    expect(answer).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Answer" })).toBeNull();
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(list);

    // Reopening the line starts empty: esc discarded the typing.
    fireEvent.keyDown(list, { key: "a" });
    expect((answerInput() as HTMLInputElement).value).toBe("");
  });

  it("an empty line writes nothing, and the triage keys typed into it are text", async () => {
    const answer = vi.fn(() => ({ path: open.path, status: "answered" }));
    const drop = vi.fn(() => ({ path: open.path, status: "abandoned" }));
    renderInbox([open], { "questions.answer": answer, "questions.drop": drop });
    const { list } = await select(0);

    fireEvent.keyDown(list, { key: "a" });
    fireEvent.keyDown(answerInput(), { key: "Enter" });
    expect(answer).not.toHaveBeenCalled();

    fireEvent.change(answerInput(), { target: { value: "d and r" } });
    fireEvent.keyDown(answerInput(), { key: "d" });
    fireEvent.keyDown(answerInput(), { key: "r" });
    expect(drop).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Answer" })).toBeDefined();
  });

  it("a refused answer shows its reason on the row and keeps the typing", async () => {
    renderInbox([open], {
      "questions.answer": () => {
        throw new Error("the file changed underneath");
      },
    });
    const { row, list } = await select(0);

    fireEvent.keyDown(list, { key: "a" });
    fireEvent.change(answerInput(), { target: { value: ANSWER } });
    fireEvent.keyDown(answerInput(), { key: "Enter" });

    const line = await within(row).findByRole("alert");
    expect(line.textContent).toContain("the file changed underneath");
    expect((answerInput() as HTMLInputElement).value).toBe(ANSWER);
  });

  it("is offered on an open row only", async () => {
    const answer = vi.fn(() => ({ path: open.path, status: "answered" }));
    renderInbox([open, dropped], { "questions.answer": answer });
    const { list } = await select(1);
    fireEvent.keyDown(list, { key: "a" });
    expect(screen.queryByRole("textbox", { name: "Answer" })).toBeNull();
    expect(answer).not.toHaveBeenCalled();
  });
});

describe("drop and reopen", () => {
  it("d drops the selected open row with no dialog", async () => {
    const drop = vi.fn(() => ({ path: open.path, status: "abandoned" }));
    renderInbox([open], { "questions.drop": drop });
    const { list } = await select(0);

    fireEvent.keyDown(list, { key: "d" });

    await waitFor(() => expect(drop).toHaveBeenCalledWith({ path: open.path }));
    expect(window.location.hash).toBe("#/inbox");
  });

  it("r reopens a dropped row and an answered one, and does nothing on an open one", async () => {
    const reopen = vi.fn(() => ({ path: dropped.path, status: "open" }));
    renderInbox([open, dropped, answered], { "questions.reopen": reopen });

    const { list } = await select(1);
    fireEvent.keyDown(list, { key: "r" });
    await waitFor(() =>
      expect(reopen).toHaveBeenLastCalledWith({ path: dropped.path })
    );

    await select(2);
    fireEvent.keyDown(list, { key: "r" });
    await waitFor(() =>
      expect(reopen).toHaveBeenLastCalledWith({ path: answered.path })
    );

    await select(0);
    fireEvent.keyDown(list, { key: "r" });
    expect(reopen).toHaveBeenCalledTimes(2);
  });

  it("d does nothing on a row that is not open", async () => {
    const drop = vi.fn(() => ({ path: dropped.path, status: "abandoned" }));
    renderInbox([open, dropped], { "questions.drop": drop });
    const { list } = await select(1);
    fireEvent.keyDown(list, { key: "d" });
    expect(drop).not.toHaveBeenCalled();
  });

  it("a refused drop shows its reason on the row", async () => {
    renderInbox([open], {
      "questions.drop": () => {
        throw new Error("the file changed underneath");
      },
    });
    const { row, list } = await select(0);
    fireEvent.keyDown(list, { key: "d" });
    const line = await within(row).findByRole("alert");
    expect(line.textContent).toContain("the file changed underneath");
  });
});

describe("the row and the footer", () => {
  it("shows each triaged status as its glyph and the label the triage verb gives, and no number but the age", async () => {
    renderInbox([open, dropped, answered]);
    const [first, second, third] = await rows();
    expect(within(first!).getByRole("img", { name: "open" })).toBeDefined();
    expect(within(second!).getByRole("img", { name: "dropped" })).toBeDefined();
    expect(within(third!).getByRole("img", { name: "answered" })).toBeDefined();
    expect(second!.textContent).toBe(
      "×Is theta during REM detectable?Unattached · dropped2mo"
    );
    expect(third!.textContent).toBe(
      "●Who first reported reward-based triage?Unattached · answered1y 8mo"
    );
  });

  it("lists the five keys once, quietly, and nothing that counts what is still open", async () => {
    renderInbox([open, dropped, answered]);
    await rows();
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toBe("j/k movep promotea answerd dropr reopen");
    expect(footer.querySelector("[role=alert]")).toBeNull();
  });
});
