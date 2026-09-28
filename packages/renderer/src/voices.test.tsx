import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultStatus } from "core";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);

// The Inbox's first slot in the three Voices (ADR 0032; prototype 12's
// contrast set, 5). Prototype 12 says the three differ in four places; the
// first three are here — the slot's face, the Warrant, the footer — and the
// rail's hollow entries are #347's.

const well: VaultStatus = {
  indexing: null,
  watching: { ok: true },
  current: { ok: true },
};

const CLAIM = "No questions have been captured in this vault.";
const WARRANT = "read in full · watching";

async function inbox() {
  return screen.findByRole("region", { name: "Question Inbox" });
}

describe("an empty Inbox, read in full and watched", () => {
  it("claims nothing has been captured, with its Warrant beside it", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": well,
    });
    const region = await inbox();
    expect(await within(region).findByText(CLAIM)).toBeDefined();
    expect(within(region).getByText(WARRANT)).toBeDefined();
    // The paragraph on how questions arrive, once, below the claim.
    expect(region.textContent).toContain(
      "A question lands here when you capture one"
    );
    // The claim is the only word on how many: no count, and nothing that
    // reads as *all clear* (prototype 12, panel 2).
    expect(region.textContent).not.toMatch(/\d+ questions?/);
  });
});

describe("an empty Inbox while the vault is still being read", () => {
  it("says not read yet, a fragment with no Warrant, and the footer shows the read's progress", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": {
        ...well,
        indexing: { done: 1250, total: 8400 },
        current: { ok: false, reason: "a sweep has not completed" },
      },
    });
    const region = await inbox();
    expect(await within(region).findByText("not read yet")).toBeDefined();
    expect(region.textContent).not.toContain(CLAIM);
    expect(region.textContent).not.toContain(WARRANT);
    const footer = within(region).getByRole("contentinfo");
    expect(footer.textContent).toContain(
      "◐ reading the vault · 1,250 of 8,400 files"
    );
  });
});

describe("an empty Inbox the app cannot vouch for", () => {
  it("says not known while the vault is not watched, and the reason and retry are the footer's", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": {
        ...well,
        watching: {
          ok: false,
          reason: "the app lost permission to read the vault folder",
        },
        current: { ok: false, reason: "not watching" },
      },
    });
    const region = await inbox();
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain(CLAIM);
    expect(region.textContent).not.toContain(WARRANT);
    // A state the app is in, stated quietly: polite, never an alert.
    const line = within(region).getByRole("status");
    expect(line.textContent).toBe(
      "‖ not watching — the app lost permission to read the vault folder · retry"
    );
    expect(within(line).getByRole("button", { name: "retry" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says not known when the listing failed, with the reason in the footer on a polite line", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": () => {
        throw new Error("No vault is open.");
      },
      "vault.status": well,
    });
    const region = await inbox();
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain(WARRANT);
    const footer = within(region).getByRole("contentinfo");
    expect(within(footer).getByRole("status").textContent).toBe(
      "‖ not read — No vault is open."
    );
    expect(screen.queryByRole("alert")).toBeNull();
    // A failed read must never read as an empty vault.
    expect(region.textContent).not.toMatch(/\d+ questions?/);
  });
});
