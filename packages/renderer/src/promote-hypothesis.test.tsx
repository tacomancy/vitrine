import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { HypothesisPage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, question as q, renderApp, rows, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Promote to Hypothesis from the Inbox (#331; spec #327 stories 1–6, 10, 11;
// ADR 0031 decision 9): `h` opens one typed line on the row for the claim —
// *answer in place*'s line — ↵ writes and lands on the page with the
// keyboard there (ADR 0010), esc writes nothing, and the row stays as its
// own row, marked promoted and pointing at the Hypothesis.

const open = q(
  "Does slow-wave density predict recall gain?",
  "2026-09-19T08:00:00Z"
);
const answered = q("Is theta during REM detectable?", "2026-07-19T12:00:00Z", {
  status: "answered",
});
const CLAIM = "Slow-wave density during the nap predicts next-day recall gain.";
const PAGE_PATH =
  "hypotheses/Slow-wave density during the nap predicts next-day recall gain..md";
const promoted = q(
  "Who first reported reward-based triage?",
  "2025-01-19T12:00:00Z",
  {
    status: "promoted",
    promotedTo: {
      link: "[[Reward-based triage predates 2010.]]",
      path: "hypotheses/Reward-based triage predates 2010..md",
      kind: "hypothesis",
    },
  }
);

const page: HypothesisPage = {
  readable: true,
  path: PAGE_PATH,
  hash: "abc",
  frontmatter: {
    promotedFrom: "[[Does slow-wave density predict recall gain]]",
    promoted: "2026-09-19T10:00:00Z",
    captured: "2026-09-19T08:00:00Z",
    context: "other",
    tags: [],
  },
  sections: {
    claim: { present: true, text: CLAIM },
    criteria: { present: true, criteria: [] },
    designNotes: { present: true, text: "" },
    positionHistory: {
      present: true,
      text: "",
      entries: [
        { at: "2026-09-19T10:00:00Z", field: "claim", why: null, from: "" },
      ],
    },
  },
  derivation: {
    state: "inconclusive",
    effective: "inconclusive",
    override: null,
    clause: "noCriteria",
    named: [],
    unlanded: [],
    census: { met: 0, notMet: 0, inconclusive: 0, awaiting: 0 },
  },
  overridable: false,
  problems: [],
};

const well = { indexing: null, watching: { ok: true }, current: { ok: true } };

function renderInbox(
  questions: unknown[],
  promote: (input: unknown) => unknown = () => ({ path: PAGE_PATH })
) {
  vi.useFakeTimers({ now: new Date("2026-09-19T12:00:00Z"), toFake: ["Date"] });
  return renderApp({
    "vault.current": vault,
    "vault.status": well,
    "questions.list": { ...empty, questions },
    "questions.promoteToHypothesis": promote,
    "hypotheses.page": page,
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

const claimInput = () => screen.getByRole("textbox", { name: "Claim" });

describe("promote to Hypothesis", () => {
  it("h opens one typed line on the row; ↵ sends the claim with the path, moves the hash to the page, and the page takes the keyboard", async () => {
    const promote = vi.fn(() => ({ path: PAGE_PATH }));
    renderInbox([open], promote);
    const { row, list } = await select(0);

    fireEvent.keyDown(list, { key: "h" });

    const input = within(row).getByRole("textbox", { name: "Claim" });
    expect(document.activeElement).toBe(input);
    // The question stays legible while the claim it becomes is typed.
    expect(row.textContent).toContain(open.question);

    fireEvent.change(input, { target: { value: CLAIM } });
    fireEvent.keyDown(input, { key: "Enter" });

    const view = await screen.findByRole("region", { name: "Hypothesis view" });
    expect(promote).toHaveBeenCalledWith({ path: open.path, claim: CLAIM });
    expect(window.location.hash).toBe(
      "#/hypothesis/hypotheses/Slow-wave%20density%20during%20the%20nap%20predicts%20next-day%20recall%20gain..md"
    );
    await waitFor(() => expect(document.activeElement).toBe(view));
    expect(screen.queryByRole("region", { name: "Question Inbox" })).toBeNull();
  });

  it("esc writes nothing: the line closes, the selection stays, and the list has the keyboard back", async () => {
    const promote = vi.fn(() => ({ path: PAGE_PATH }));
    renderInbox([open], promote);
    const { row, list } = await select(0);

    fireEvent.keyDown(list, { key: "h" });
    fireEvent.change(claimInput(), { target: { value: CLAIM } });
    fireEvent.keyDown(claimInput(), { key: "Escape" });

    expect(promote).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Claim" })).toBeNull();
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(list);
    expect(window.location.hash).toBe("#/inbox");

    // Reopening the line starts empty: esc discarded the typing.
    fireEvent.keyDown(list, { key: "h" });
    expect((claimInput() as HTMLInputElement).value).toBe("");
  });

  it("an empty line refuses rather than writes, and the triage keys typed into it are text", async () => {
    const promote = vi.fn(() => ({ path: PAGE_PATH }));
    renderInbox([open], promote);
    const { list } = await select(0);

    fireEvent.keyDown(list, { key: "h" });
    fireEvent.change(claimInput(), { target: { value: "   " } });
    fireEvent.keyDown(claimInput(), { key: "Enter" });
    expect(promote).not.toHaveBeenCalled();
    expect(claimInput()).toBeDefined();
    expect(window.location.hash).toBe("#/inbox");

    fireEvent.keyDown(claimInput(), { key: "p" });
    fireEvent.keyDown(claimInput(), { key: "a" });
    expect(screen.queryByRole("textbox", { name: "Answer" })).toBeNull();
    expect(claimInput()).toBeDefined();
  });

  it("a refused promotion says why on the row, keeps the typing, and stays on the Inbox", async () => {
    renderInbox([open], () => {
      throw new Error(
        `Couldn't write ${PAGE_PATH}: a file by that name is already in the vault`
      );
    });
    const { row, list } = await select(0);

    fireEvent.keyDown(list, { key: "h" });
    fireEvent.change(claimInput(), { target: { value: CLAIM } });
    fireEvent.keyDown(claimInput(), { key: "Enter" });

    const line = await within(row).findByRole("alert");
    expect(line.textContent).toContain("already in the vault");
    expect((claimInput() as HTMLInputElement).value).toBe(CLAIM);
    expect(window.location.hash).toBe("#/inbox");
  });

  it("is offered on an open row only", async () => {
    const promote = vi.fn(() => ({ path: PAGE_PATH }));
    renderInbox([open, answered], promote);
    const { list } = await select(1);
    fireEvent.keyDown(list, { key: "h" });
    expect(screen.queryByRole("textbox", { name: "Claim" })).toBeNull();
    expect(promote).not.toHaveBeenCalled();
  });

  it("a row promoted to a Hypothesis carries the word as a link to the Hypothesis view", async () => {
    renderInbox([promoted]);
    const [row] = await rows();
    expect(within(row!).getByRole("img", { name: "promoted" })).toBeDefined();
    const link = within(row!).getByRole("link", { name: "promoted" });
    expect(link.getAttribute("href")).toBe(
      "#/hypothesis/hypotheses/Reward-based%20triage%20predates%202010..md"
    );
  });

  it("lists h hypothesis in the footer beside the other triage keys", async () => {
    renderInbox([open]);
    await rows();
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toContain("p promote");
    expect(footer.textContent).toContain("h hypothesis");
  });
});
