import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ResearchQuestionPage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, question as q, renderApp, rows, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Promote to Research Question from the Inbox (#210; spec #206 stories 1–3,
// 8–11): one key, the page takes the keyboard (ADR 0010), the row stays as
// its own row marked promoted and pointing at its page, a refusal is a line
// on the row.

const open = q(
  "Does slow-wave density predict recall gain?",
  "2026-09-19T08:00:00Z"
);
const PAGE_PATH =
  "questions/Does slow-wave density predict recall gain (RQ).md";
const promoted = q("Is theta during REM detectable?", "2026-07-19T12:00:00Z", {
  status: "promoted",
  promotedTo: {
    link: "[[Is theta during REM detectable (RQ)]]",
    path: "questions/Is theta during REM detectable (RQ).md",
  },
});
const pointingNowhere = q(
  "Who first reported reward-based triage?",
  "2025-01-19T12:00:00Z",
  {
    status: "promoted",
    promotedTo: { link: "[[Gone (RQ)]]", path: null },
  }
);

const page: ResearchQuestionPage = {
  readable: true,
  path: PAGE_PATH,
  hash: "abc",
  frontmatter: {
    question: "Does slow-wave density predict recall gain?",
    status: "open",
    promotedFrom: "[[Does slow-wave density predict recall gain]]",
    promoted: "2026-09-19T10:00:00Z",
    captured: "2026-09-19T08:00:00Z",
    context: "other",
    tags: [],
  },
  sections: {
    workingAnswer: { present: true, text: "" },
    supporting: { present: true, lines: [] },
    opposing: { present: true, lines: [] },
    related: { present: true, lines: [] },
    openThreads: { present: true, threads: [] },
    positionHistory: { present: true, text: "", entries: [] },
  },
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
    "questions.promote": promote,
    "researchQuestions.page": page,
  });
}

async function selectFirst() {
  const [first] = await rows();
  fireEvent.click(first!);
  const list = screen.getByRole("listbox", { name: "Questions" });
  list.focus();
  return { first: first!, list };
}

describe("promote to Research Question", () => {
  it("p on the selected open row calls promote with its path, moves the hash to the page, and the page takes the keyboard", async () => {
    const promote = vi.fn(() => ({ path: PAGE_PATH }));
    renderInbox([open], promote);
    const { list } = await selectFirst();

    fireEvent.keyDown(list, { key: "p" });

    const view = await screen.findByRole("region", {
      name: "Research Question view",
    });
    expect(promote).toHaveBeenCalledWith({ path: open.path });
    expect(window.location.hash).toBe(
      "#/questions/questions/Does%20slow-wave%20density%20predict%20recall%20gain%20(RQ).md"
    );
    expect(document.activeElement).toBe(view);
    expect(screen.queryByRole("region", { name: "Question Inbox" })).toBeNull();
  });

  it("a refused promote shows its reason on the row, the selection stays, and the window stays on the Inbox — and the reason is gone once the selection has moved", async () => {
    renderInbox([open, promoted], () => {
      throw new Error(
        "Couldn't mark questions/Does slow-wave density predict recall gain.md promoted: the file changed underneath"
      );
    });
    const { first, list } = await selectFirst();

    fireEvent.keyDown(list, { key: "p" });

    const line = await within(first).findByRole("alert");
    expect(line.textContent).toContain("the file changed underneath");
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(window.location.hash).toBe("#/inbox");
    expect(document.activeElement).toBe(list);

    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "k" });
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(within(first).queryByRole("alert")).toBeNull();
  });

  it("does nothing on a row that is not open, or when nothing is selected", async () => {
    const promote = vi.fn(() => ({ path: PAGE_PATH }));
    renderInbox([promoted, open], promote);
    await rows();
    const list = screen.getByRole("listbox", { name: "Questions" });
    fireEvent.keyDown(list, { key: "p" });
    expect(promote).not.toHaveBeenCalled();

    // Newest first: the promoted row is second.
    const [, second] = await rows();
    fireEvent.click(second!);
    fireEvent.keyDown(list, { key: "p" });
    expect(promote).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/inbox");
  });

  it("a promoted row carries the glyph and the word, as a link to its page — plain when the page is not there", async () => {
    renderInbox([promoted, pointingNowhere]);
    const [first, second] = await rows();
    expect(within(first!).getByRole("img", { name: "promoted" })).toBeDefined();
    const link = within(first!).getByRole("link", { name: "promoted" });
    expect(link.getAttribute("href")).toBe(
      "#/questions/questions/Is%20theta%20during%20REM%20detectable%20(RQ).md"
    );
    expect(within(second!).queryByRole("link")).toBeNull();
    expect(second!.textContent).toContain("promoted");
    // Never a badge: no number anywhere in the row but the age.
    expect(first!.textContent).toBe(
      "■Is theta during REM detectable?Unattached · promoted2mo"
    );
  });

  it("lists the key quietly in the footer channel, with no key for Hypothesis", async () => {
    renderInbox([open]);
    await rows();
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toContain("j/k move");
    expect(footer.textContent).toContain("p promote");
    expect(footer.textContent).not.toMatch(/hypothesis/i);
    expect(footer.querySelector("[role=alert]")).toBeNull();
  });
});
