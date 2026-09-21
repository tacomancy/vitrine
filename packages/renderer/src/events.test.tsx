import { act, cleanup, screen } from "@testing-library/react";
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
});
