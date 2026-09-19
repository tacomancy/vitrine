import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "./fake-core";

afterEach(cleanup);

const vault = { name: "consolidation-vault", path: "/v/consolidation-vault" };

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
    renderApp({ "vault.current": vault });
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
