import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { empty, question as q, renderApp, rows, vault } from "./fake-core";

afterEach(cleanup);

// The renderer's side of the event stream (spec #177, at the renderer seam):
// one subscription for the window's life, invalidation and never a patch.

describe("the event stream in the renderer", () => {
  it("re-queries the list when a vaultChanged is pushed, and shows the row it brought", async () => {
    let listing = { ...empty, questions: [] as ReturnType<typeof q>[] };
    const list = vi.fn(() => listing);
    const { stream } = renderApp({
      "vault.current": vault,
      "questions.list": list,
    });
    await screen.findByRole("region", { name: "Question Inbox" });
    const before = list.mock.calls.length;

    listing = {
      ...empty,
      questions: [q("Written in Obsidian", "2026-09-19T08:00:00Z")],
    };
    act(() => {
      stream.push({
        type: "vaultChanged",
        changed: ["questions/Written in Obsidian.md"],
        removed: [],
        renamed: [],
      });
    });
    expect((await rows()).map((r) => r.textContent)).toEqual([
      expect.stringContaining("Written in Obsidian") as string,
    ]);
    expect(list.mock.calls.length).toBeGreaterThan(before);
  });

  it("invalidates every query on connect and again on reconnect", async () => {
    const current = vi.fn(() => vault);
    const list = vi.fn(() => empty);
    const { stream } = renderApp({
      "vault.current": current,
      "questions.list": list,
    });
    await screen.findByRole("region", { name: "Question Inbox" });
    // The connect landed after `vault.current` was first asked, so it was
    // asked again; the list only mounts once the vault is known, after the
    // connect, so its first read is already fresh.
    await vi.waitFor(() => {
      expect(current.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const beforeCurrent = current.mock.calls.length;
    const beforeList = list.mock.calls.length;

    act(() => stream.reconnect());
    await vi.waitFor(() => {
      expect(current.mock.calls.length).toBeGreaterThan(beforeCurrent);
      expect(list.mock.calls.length).toBeGreaterThan(beforeList);
    });
  });

  describe("the selection under external change", () => {
    const a = q(
      "Does slow-wave density predict recall gain?",
      "2026-09-19T08:00:00Z"
    );
    const b = q("Is theta during REM detectable?", "2026-07-19T12:00:00Z");
    const c = q(
      "Who first reported reward-based triage?",
      "2025-01-19T12:00:00Z"
    );

    it("a selected row whose path is in renamed is still selected under `to` after the re-query", async () => {
      let listing = { ...empty, questions: [a, b, c] };
      const { stream } = renderApp({
        "vault.current": vault,
        "questions.list": () => listing,
      });
      const items = await rows();
      fireEvent.click(items[1]!);
      expect(items[1]?.getAttribute("aria-selected")).toBe("true");

      // One batch: the selected file renamed, another deleted — the deletion
      // is what makes the re-query visible, so the assertion after it is on
      // the new list and not the old one.
      const moved = {
        ...b,
        path: `${vault.path}/questions/Renamed in Obsidian.md`,
      };
      listing = { ...empty, questions: [a, moved] };
      act(() => {
        stream.push({
          type: "vaultChanged",
          changed: [],
          removed: ["questions/Who first reported reward-based triage?.md"],
          renamed: [
            {
              from: "questions/Is theta during REM detectable?.md",
              to: "questions/Renamed in Obsidian.md",
            },
          ],
        });
      });
      await vi.waitFor(() => {
        expect(screen.getAllByRole("option")).toHaveLength(2);
      });
      expect(
        screen
          .getAllByRole("option")
          .map((r) => r.getAttribute("aria-selected"))
      ).toEqual(["false", "true"]);
      expect(screen.getByRole("complementary").textContent).toContain(
        "Is theta during REM detectable?"
      );
    });

    it("a selected row whose path is in removed clears the selection, focus where it was, and j/k still act on the list", async () => {
      let listing = { ...empty, questions: [a, b, c] };
      const { stream } = renderApp({
        "vault.current": vault,
        "questions.list": () => listing,
      });
      const items = await rows();
      const list = screen.getByRole("listbox", { name: "Questions" });
      list.focus();
      fireEvent.click(items[1]!);
      expect(items[1]?.getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(list);

      listing = { ...empty, questions: [a, c] };
      act(() => {
        stream.push({
          type: "vaultChanged",
          changed: [],
          removed: ["questions/Is theta during REM detectable?.md"],
          renamed: [],
        });
      });
      await vi.waitFor(() => {
        const after = screen.getAllByRole("option");
        expect(after).toHaveLength(2);
        expect(
          after.every((r) => r.getAttribute("aria-selected") === "false")
        ).toBe(true);
      });
      expect(document.activeElement).toBe(list);
      expect(screen.getByRole("complementary").textContent).toBe("");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();

      fireEvent.keyDown(list, { key: "j" });
      const after = await rows();
      expect(after[0]?.getAttribute("aria-selected")).toBe("true");
    });
  });
});
