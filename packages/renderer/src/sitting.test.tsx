import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListedQuestion } from "core";
import { empty, question as q, renderApp, rows, vault } from "./fake-core";
import { othersInSitting, SITTING_GAP_MINUTES } from "./sitting";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The other questions captured in the same sitting (#265; spec #206 story 60,
// from HOLD-4): a reading of `captured` alone, so a question can be read back
// into the train of thought it was pulled out of. Never a count — the others
// are named (HOLD-5).

/** A Question as the list returns it, at a time; only `captured` is read. */
const at = (captured: string, text = `q ${captured}`): ListedQuestion => ({
  path: `/v/questions/${text}.md`,
  question: text,
  status: "open",
  captured,
  context: "other",
});

const texts = (found: ListedQuestion[]) => found.map((f) => f.question);

describe("the sitting a Question belongs to", () => {
  it("is the maximal run of captures whose adjacent gaps are within the threshold", () => {
    const list = [
      at("2026-09-19T08:00:00Z", "first"),
      at("2026-09-19T08:40:00Z", "second"),
      at("2026-09-19T09:30:00Z", "third"),
      // Two hours on: a sitting of its own, however close the rest are.
      at("2026-09-19T11:30:00Z", "later"),
    ];
    expect(texts(othersInSitting(list, list[1]!.path, 90))).toEqual([
      "first",
      "third",
    ]);
  });

  it("holds a Question at either edge of the run", () => {
    const list = [
      at("2026-09-19T08:00:00Z", "first"),
      at("2026-09-19T08:40:00Z", "second"),
      at("2026-09-19T09:30:00Z", "third"),
    ];
    expect(texts(othersInSitting(list, list[0]!.path, 90))).toEqual([
      "second",
      "third",
    ]);
    expect(texts(othersInSitting(list, list[2]!.path, 90))).toEqual([
      "first",
      "second",
    ]);
  });

  it("leaves a Question alone when both its neighbours are beyond the threshold", () => {
    const list = [
      at("2026-09-19T08:00:00Z", "before"),
      at("2026-09-19T12:00:00Z", "alone"),
      at("2026-09-19T16:00:00Z", "after"),
    ];
    expect(othersInSitting(list, list[1]!.path, 90)).toEqual([]);
  });

  it("keeps a gap exactly at the threshold inside the run", () => {
    const list = [
      at("2026-09-19T08:00:00Z", "first"),
      at("2026-09-19T09:30:00Z", "ninety minutes on"),
      at("2026-09-19T11:01:00Z", "ninety-one minutes on"),
    ];
    expect(texts(othersInSitting(list, list[0]!.path, 90))).toEqual([
      "ninety minutes on",
    ]);
  });

  it("names the others in capture order whatever order the list arrives in", () => {
    const list = [
      at("2026-09-19T09:30:00Z", "third"),
      at("2026-09-19T08:00:00Z", "first"),
      at("2026-09-19T08:40:00Z", "second"),
    ];
    expect(texts(othersInSitting(list, list[1]!.path, 90))).toEqual([
      "second",
      "third",
    ]);
  });

  it("has nothing to say about a path the list does not hold", () => {
    const list = [at("2026-09-19T08:00:00Z"), at("2026-09-19T08:40:00Z")];
    expect(othersInSitting(list, "/v/questions/gone.md", 90)).toEqual([]);
  });

  it("counts a sitting's gaps in minutes the app names once", () => {
    expect(SITTING_GAP_MINUTES).toBe(90);
  });
});

// The pane. Fixtures sit inside and outside the real threshold, so the
// component is tested against the number the app ships.
const first = q(
  "Does replay happen in quiet wakefulness?",
  "2026-09-19T08:00:00Z"
);
const second = q(
  "Is the decoding sensitivity established?",
  "2026-09-19T08:40:00Z"
);
const third = q("Would this hold for sparse inputs?", "2026-09-19T09:30:00Z");
const apart = q(
  "Who first reported reward-based memory triage?",
  "2026-09-19T11:20:00Z"
);

function renderInbox(listing: Record<string, unknown>) {
  vi.useFakeTimers({ now: new Date("2026-09-19T12:00:00Z"), toFake: ["Date"] });
  return renderApp({
    "vault.current": vault,
    "questions.list": { ...empty, ...listing },
  });
}

const detail = () => screen.getByRole("complementary");

/** Select the row whose text says which one it is; the sort is not the point. */
async function selectRow(text: string) {
  const items = await rows();
  fireEvent.click(items.find((row) => row.textContent?.includes(text))!);
}

describe("the sitting on the Detail pane", () => {
  it("names the others in capture order with their time, below Provenance", async () => {
    renderInbox({ questions: [third, second, first, apart] });
    await selectRow("decoding sensitivity");
    const sitting = within(detail()).getByRole("list", {
      name: "Captured in the same sitting",
    });
    expect(
      within(sitting)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual([
      "Does replay happen in quiet wakefulness?08:00",
      "Would this hold for sparse inputs?09:30",
    ]);
    // Below Provenance, and nothing that totals them (HOLD-5).
    expect(detail().textContent).toMatch(/Provenance[\s\S]*same sitting/);
    expect(detail().textContent).not.toMatch(/\b[23] (questions|others)\b/);
  });

  it("shows the clicked question's own sitting once it is selected", async () => {
    renderInbox({ questions: [third, second, first, apart] });
    await selectRow("quiet wakefulness");
    fireEvent.click(
      within(detail()).getByRole("button", { name: /decoding sensitivity/ })
    );
    expect(within(detail()).getByRole("heading").textContent).toBe(
      "Is the decoding sensitivity established?"
    );
    expect(
      within(detail())
        .getAllByRole("button")
        .map((b) => b.textContent?.replace(/\d\d:\d\d$/, ""))
    ).toEqual([
      "Does replay happen in quiet wakefulness?",
      "Would this hold for sparse inputs?",
    ]);
  });

  it("puts the keyboard back on the list, so j/k moves from the new selection", async () => {
    renderInbox({ questions: [third, second, first, apart] });
    await selectRow("quiet wakefulness");
    fireEvent.click(
      within(detail()).getByRole("button", { name: /sparse inputs/ })
    );
    const list = screen.getByRole("listbox", { name: "Questions" });
    expect(document.activeElement).toBe(list);
    // Newest first, so k from 09:30 reaches the 11:20 capture.
    fireEvent.keyDown(list, { key: "k" });
    expect(within(detail()).getByRole("heading").textContent).toContain(
      "reward-based memory triage"
    );
  });

  it("adds nothing at all for a Question alone in its sitting", async () => {
    renderInbox({ questions: [first, second, third, apart] });
    await selectRow("reward-based memory triage");
    expect(within(detail()).getByRole("heading").textContent).toContain(
      "reward-based memory triage"
    );
    expect(detail().textContent).not.toContain("sitting");
    expect(within(detail()).queryAllByRole("button")).toHaveLength(0);
  });

  it("shows no sitting for a Partial row, as it shows no Provenance", async () => {
    renderInbox({
      questions: [first, second],
      partial: [
        {
          path: `${vault.path}/questions/Half a capture.md`,
          name: "Half a capture",
          mtime: "2026-09-19T08:20:00Z",
        },
      ],
    });
    await selectRow("Half a capture");
    expect(detail().textContent).not.toContain("sitting");
  });

  it("does not let a Partial break a run it sits inside", async () => {
    renderInbox({
      questions: [first, second],
      partial: [
        {
          path: `${vault.path}/questions/Half a capture.md`,
          name: "Half a capture",
          mtime: "2026-09-19T08:20:00Z",
        },
      ],
    });
    await selectRow("quiet wakefulness");
    expect(
      within(detail()).getByRole("button", { name: /decoding sensitivity/ })
    ).toBeDefined();
  });
});
