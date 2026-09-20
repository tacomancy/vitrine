import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "./fake-core";

afterEach(cleanup);

const vault = { name: "consolidation-vault", path: "/v/consolidation-vault" };
// The Inbox is on screen beneath the capture line; it asks for the list.
const empty = { questions: [], partial: [], unreadable: [] };

// Only the clock is faked; timers stay real so Testing Library's waits work.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 19, 7, 4, 0));
});
afterEach(() => vi.useRealTimers());

function pressCaptureChord() {
  fireEvent.keyDown(window, { key: "'", metaKey: true });
}

describe("the capture line", () => {
  it("is absent until ⌘' opens it, then holds the focused input with the chip already resolved", async () => {
    renderApp({ "vault.current": vault, "questions.list": empty });
    await screen.findByRole("banner");
    expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull();

    pressCaptureChord();

    const input = screen.getByRole("textbox", { name: "Question" });
    expect(document.activeElement).toBe(input);
    const line = screen.getByRole("form", { name: "Capture" });
    // Set in caps by CSS, as the sidebar's SURFACES label is.
    expect(line.textContent).toMatch(/^Capture/);
    expect(line.textContent).toContain("Unattached · 19 Sep 2026, 07:04");
    expect(line.textContent).toContain("↵ capture · esc discards");
  });
});

describe("closing", () => {
  it("esc discards with no call and puts focus back where it was", async () => {
    const capture = vi.fn();
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "questions.capture": capture,
    });
    const link = await screen.findByRole("link", { name: "Question Inbox" });
    link.focus();

    pressCaptureChord();
    const input = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(input, { target: { value: "half a thought" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(link);
  });

  it("↵ on an empty or whitespace-only line does nothing", async () => {
    const capture = vi.fn();
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "questions.capture": capture,
    });
    await screen.findByRole("banner");

    pressCaptureChord();
    const input = screen.getByRole("textbox", { name: "Question" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(capture).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Question" })).toBeDefined();
  });

  it("↵ with text captures Unattached, closes the line, and hands focus to the Inbox list", async () => {
    const capture = vi.fn((input: unknown) => ({
      id: "k7m2p9q4wx",
      path: "/v/consolidation-vault/questions/Does this hold for sparse inputs.md",
      question: (input as { text: string }).text,
      status: "open",
      captured: "2026-09-19T07:04:00+05:30",
      context: "other",
    }));
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "questions.capture": capture,
    });
    const link = await screen.findByRole("link", { name: "Question Inbox" });
    link.focus();

    pressCaptureChord();
    const input = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(input, {
      target: { value: "Does this hold for sparse inputs?" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull()
    );
    expect(capture).toHaveBeenCalledExactlyOnceWith({
      text: "Does this hold for sparse inputs?",
      provenance: { context: "other" },
    });
    // Not back to the sidebar link: the selection moved to the new row, so
    // the keyboard goes where j/k act on it (the join, #107).
    expect(document.activeElement).toBe(
      screen.getByRole("listbox", { name: "Questions" })
    );
  });
});

describe("a write that fails", () => {
  it("keeps the line open with the text and says why, under the input", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "questions.capture": () => {
        throw new Error(
          "Couldn't write the Question into /v/consolidation-vault/questions: EACCES: permission denied"
        );
      },
    });
    await screen.findByRole("banner");

    pressCaptureChord();
    const input = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(input, { target: { value: "Will this land?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const message = await screen.findByRole("alert");
    expect(message.textContent).toContain("EACCES: permission denied");
    const kept = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Question",
    });
    expect(kept.value).toBe("Will this land?");
    expect(
      kept.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Fixing and retrying starts from the input, not from a click back into it.
    expect(document.activeElement).toBe(kept);
  });

  it("is forgotten once the line is discarded: the next open starts clean", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "questions.capture": () => {
        throw new Error("EACCES: permission denied");
      },
    });
    await screen.findByRole("banner");

    pressCaptureChord();
    const input = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(input, { target: { value: "Will this land?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("alert");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Question" }), {
      key: "Escape",
    });

    pressCaptureChord();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Question" }).value
    ).toBe("");
  });
});

describe("the chip", () => {
  it("re-resolves the time each time the line opens", async () => {
    renderApp({ "vault.current": vault, "questions.list": empty });
    await screen.findByRole("banner");

    pressCaptureChord();
    expect(screen.getByRole("form", { name: "Capture" }).textContent).toContain(
      "Unattached · 19 Sep 2026, 07:04"
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Question" }), {
      key: "Escape",
    });

    vi.setSystemTime(new Date(2026, 8, 19, 9, 30, 0));
    pressCaptureChord();
    expect(screen.getByRole("form", { name: "Capture" }).textContent).toContain(
      "Unattached · 19 Sep 2026, 09:30"
    );
  });

  it("⌘' while the line is open keeps what was typed and refocuses the input", async () => {
    renderApp({ "vault.current": vault, "questions.list": empty });
    await screen.findByRole("banner");

    pressCaptureChord();
    const input = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(input, { target: { value: "still here" } });
    input.blur();
    pressCaptureChord();

    const again = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Question",
    });
    expect(again.value).toBe("still here");
    expect(document.activeElement).toBe(again);
  });
});
