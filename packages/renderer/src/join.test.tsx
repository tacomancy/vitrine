import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pressCaptureChord,
  question as q,
  renderApp,
  rows,
  vault,
} from "./fake-core";

// The join: a capture lands in the Inbox. The list is re-read, the new row is
// the selection, and the keyboard is on the list so j/k act on it at once.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const older = q("Is theta during REM detectable?", "2026-07-19T12:00:00Z");
const oldest = q("Who first reported memory triage?", "2025-01-19T12:00:00Z");

/**
 * A fake core whose vault fills as captures land: every list call reads the
 * questions captured so far, so an invalidated query sees the new file.
 */
function renderVault(initial: ReturnType<typeof q>[]) {
  vi.useFakeTimers({ now: new Date("2026-09-19T12:00:00Z"), toFake: ["Date"] });
  const onDisk = [...initial];
  const list = vi.fn((input: unknown) => {
    const { order } = input as { order: "newest" | "oldest" };
    const questions = [...onDisk].sort(
      (a, b) =>
        (order === "oldest" ? 1 : -1) *
        (Date.parse(a.captured) - Date.parse(b.captured))
    );
    return { questions, partial: [], unreadable: [] };
  });
  const capture = vi.fn((input: unknown) => {
    const { text } = input as { text: string };
    const written = q(text, new Date().toISOString());
    onDisk.push(written);
    return written;
  });
  renderApp({
    "vault.current": vault,
    "questions.list": list,
    "questions.capture": capture,
  });
  return { list, capture };
}

async function captureFromSidebar(text: string) {
  // Focus starts off the list, so the test sees focus move there rather
  // than merely stay.
  const link = await screen.findByRole("link", { name: "Question Inbox" });
  link.focus();
  pressCaptureChord();
  const input = screen.getByRole("textbox", { name: "Question" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
  await vi.waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull()
  );
}

describe("a capture lands in the Inbox", () => {
  it("re-reads the list and selects the new Question at the top under newest", async () => {
    const { list } = renderVault([older, oldest]);
    expect(await rows()).toHaveLength(2);
    const before = list.mock.calls.length;

    await captureFromSidebar("Does this hold for sparse inputs?");

    await vi.waitFor(() =>
      expect(list.mock.calls.length).toBeGreaterThan(before)
    );
    await vi.waitFor(async () => {
      const items = await rows();
      expect(items).toHaveLength(3);
      expect(items[0]?.textContent).toContain(
        "Does this hold for sparse inputs?"
      );
      expect(items[0]?.getAttribute("aria-selected")).toBe("true");
    });
    expect(
      screen
        .getAllByRole("option")
        .filter((r) => r.getAttribute("aria-selected") === "true")
    ).toHaveLength(1);
  });

  it("selects it at the bottom under oldest", async () => {
    renderVault([older, oldest]);
    await rows();
    fireEvent.click(screen.getByRole("button", { name: "oldest" }));
    await vi.waitFor(async () => {
      expect((await rows())[0]?.textContent).toContain("Who first reported");
    });

    await captureFromSidebar("Does this hold for sparse inputs?");

    await vi.waitFor(async () => {
      const items = await rows();
      expect(items).toHaveLength(3);
      expect(items[2]?.textContent).toContain(
        "Does this hold for sparse inputs?"
      );
      expect(items[2]?.getAttribute("aria-selected")).toBe("true");
    });
  });

  it("shows the new Question in the detail pane with its Provenance", async () => {
    renderVault([older]);
    await rows();

    await captureFromSidebar("Does this hold for sparse inputs?");

    const detail = screen.getByRole("complementary", {
      name: "Selected question",
    });
    await vi.waitFor(() => {
      expect(detail.textContent).toContain("Does this hold for sparse inputs?");
    });
    expect(detail.textContent).toContain("Unattached");
    expect(detail.textContent).toContain("19 September 2026");
  });

  it("increments the count by one and leaves the since month alone", async () => {
    renderVault([older, oldest]);
    await rows();
    const inbox = screen.getByRole("region", { name: "Question Inbox" });
    expect(inbox.textContent).toContain("2 questions · since Jan 2025");

    await captureFromSidebar("Does this hold for sparse inputs?");

    await vi.waitFor(() => {
      expect(inbox.textContent).toContain("3 questions · since Jan 2025");
    });
  });

  it("dates since from the first Question when the vault was empty", async () => {
    renderVault([]);
    await screen.findByRole("listbox", { name: "Questions" });
    const inbox = screen.getByRole("region", { name: "Question Inbox" });
    expect(inbox.textContent).toContain("0 questions");
    expect(inbox.textContent).not.toContain("since");

    await captureFromSidebar("Does this hold for sparse inputs?");

    await vi.waitFor(() => {
      expect(inbox.textContent).toContain("1 question · since Sep 2026");
    });
  });

  it("puts focus on the list so j/k move from the new row at once", async () => {
    renderVault([older, oldest]);
    await rows();

    await captureFromSidebar("Does this hold for sparse inputs?");

    const list = screen.getByRole("listbox", { name: "Questions" });
    await vi.waitFor(() => expect(document.activeElement).toBe(list));
    await vi.waitFor(async () => expect(await rows()).toHaveLength(3));
    fireEvent.keyDown(list, { key: "j" });
    const items = await rows();
    expect(items[1]?.getAttribute("aria-selected")).toBe("true");
    expect(items[1]?.textContent).toContain("Is theta during REM");
  });

  it("lands each of two captures in turn, the second becoming the selection", async () => {
    renderVault([oldest]);
    await rows();

    await captureFromSidebar("First");
    await vi.waitFor(async () => expect(await rows()).toHaveLength(2));
    vi.setSystemTime(new Date("2026-09-19T12:01:00Z"));
    await captureFromSidebar("Second");

    await vi.waitFor(async () => {
      const items = await rows();
      expect(items).toHaveLength(3);
      expect(items[0]?.textContent).toContain("Second");
      expect(items[0]?.getAttribute("aria-selected")).toBe("true");
    });
  });
});
