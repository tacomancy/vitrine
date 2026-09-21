import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultStatus } from "core";
import { empty, question as q, renderApp, rows, vault } from "./fake-core";

afterEach(cleanup);

// `vault.status` in the Inbox's footer channel (#190; spec #177 at the
// renderer seam): two quiet lines beside the unreadable count, or nothing.

const listing = {
  ...empty,
  questions: [q("A question", "2026-09-19T08:00:00Z")],
  unreadable: [{ path: "/v/consolidation-vault/Garbled.md", reason: "bad" }],
};

const well: VaultStatus = {
  indexing: null,
  watching: { ok: true },
  current: { ok: true },
};

describe("the footer channel and vault.status", () => {
  it("shows indexing… with thousands separated while a build runs", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": listing,
      "vault.status": {
        ...well,
        indexing: { done: 1250, total: 4000 },
        current: { ok: false, reason: "a sweep has not completed" },
      },
    });
    await rows();
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toContain("indexing… 1,250 of 4,000");
    expect(footer.textContent).toContain("1 file could not be read");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows not watching with the reason and a retry that calls vault.rewatch", async () => {
    let status: VaultStatus = {
      ...well,
      watching: { ok: false, reason: "EMFILE: too many open files" },
      current: { ok: false, reason: "not watching: EMFILE" },
    };
    const rewatch = vi.fn(() => {
      status = well;
      return null;
    });
    renderApp({
      "vault.current": vault,
      "questions.list": listing,
      "vault.status": () => status,
      "vault.rewatch": rewatch,
    });
    await rows();
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toContain(
      "not watching — EMFILE: too many open files · retry"
    );
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await vi.waitFor(() => {
      expect(rewatch).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/not watching/)).toBeNull();
    });
  });

  it("shows nothing — no footer at all — when all is well and every file was read", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": { ...listing, unreadable: [] },
      "vault.status": well,
    });
    await rows();
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });

  it("re-reads vault.status when a vaultStatus is pushed", async () => {
    let status: Record<string, unknown> = well;
    const read = vi.fn(() => status);
    const { stream } = renderApp({
      "vault.current": vault,
      "questions.list": { ...listing, unreadable: [] },
      "vault.status": read,
    });
    await rows();
    expect(screen.queryByRole("contentinfo")).toBeNull();

    status = { ...well, indexing: { done: 3, total: 12 } };
    act(() => stream.push({ type: "vaultStatus" }));
    await screen.findByText("indexing… 3 of 12");
  });
});
