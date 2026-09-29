import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { LooseEnds } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The *PDF unreadable* row (#418; spec #416 stories 65–67): a plain reason,
// never a path, under Broken plumbing, resolved by *try again* — which the
// researcher runs, once per press, and nothing else does.

const ROW = {
  kind: "unreadable-pdf" as const,
  subject: "sources/pdf/locked.pdf",
  path: "sources/pdf/locked.pdf",
  title: "locked.pdf",
  reason: "it is protected by a password",
};

const ends = (): LooseEnds => ({
  problems: [],
  groups: [{ group: "Broken plumbing", rows: [ROW] }],
});

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = "#/loose-ends";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "looseEnds.rows": ends(),
    ...more,
  });
};

const row = async () => {
  const view = await screen.findByRole("region", { name: "Loose Ends" });
  return (await within(view).findAllByRole("listitem"))[0]!;
};

describe("the PDF unreadable row", () => {
  it("names the file and the reason, under Broken plumbing", async () => {
    open();
    const item = await row();
    expect(within(item).getByText("locked.pdf")).toBeDefined();
    expect(within(item).getByText("PDF · unreadable")).toBeDefined();
    expect(
      within(item).getByText(
        "This PDF could not be read because it is protected by a password."
      )
    ).toBeDefined();
    expect(item.textContent).not.toContain("sources/pdf");
    expect(
      screen.getByRole("region", { name: "Broken plumbing" })
    ).toBeDefined();
  });

  it("runs try again only when pressed, and says a file that reads now is a no-Source row again", async () => {
    const tryAgain = vi.fn<(input: unknown) => unknown>(() => ({
      readable: true,
    }));
    open({ "sources.tryAgain": tryAgain });
    const item = await row();
    expect(tryAgain).not.toHaveBeenCalled();
    fireEvent.click(within(item).getByRole("button", { name: "try again" }));
    await within(item).findByText(/It reads now/);
    expect(tryAgain).toHaveBeenCalledTimes(1);
    expect(tryAgain).toHaveBeenCalledWith({ pdf: "sources/pdf/locked.pdf" });
  });

  it("shows the new reason when it still will not read, and offers try again again", async () => {
    open({
      "sources.tryAgain": () => ({
        readable: false,
        reason: "the reader stopped on it",
      }),
    });
    const item = await row();
    fireEvent.click(within(item).getByRole("button", { name: "try again" }));
    await within(item).findByText(
      "This PDF could not be read because the reader stopped on it."
    );
    expect(
      within(item).getByRole("button", { name: "try again" })
    ).toBeDefined();
  });

  it("is marked deliberate by the row shell, keyed by the PDF's path", async () => {
    const dismiss = vi.fn<(input: unknown) => void>();
    open({
      "looseEnds.dismiss": (input: unknown) => {
        dismiss(input);
        return undefined;
      },
    });
    const item = await row();
    fireEvent.click(
      within(item).getByRole("button", { name: "mark deliberate" })
    );
    await within(item).findByText(/marked deliberate/);
    expect(dismiss).toHaveBeenCalledWith({
      subject: "sources/pdf/locked.pdf",
      kind: "unreadable-pdf",
    });
  });
});
