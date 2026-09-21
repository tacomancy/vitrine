import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
// Each test starts where a fresh window does: no hash at all.
beforeEach(() => window.history.replaceState(null, "", "/"));

const answers = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": {
    indexing: null,
    watching: { ok: true },
    current: { ok: true },
  },
};

describe("the window's location is the URL hash", () => {
  it("renders the Inbox with no hash and makes the hash read #/inbox", async () => {
    renderApp(answers);
    expect(
      await screen.findByRole("region", { name: "Question Inbox" })
    ).toBeDefined();
    expect(window.location.hash).toBe("#/inbox");
  });

  it("treats a hash it does not know as the Inbox", async () => {
    window.location.hash = "#/scouts";
    renderApp(answers);
    expect(
      await screen.findByRole("region", { name: "Question Inbox" })
    ).toBeDefined();
    expect(window.location.hash).toBe("#/inbox");
  });

  it("renders the Loose Ends shell at #/loose-ends: the heading, one quiet line, no groups", async () => {
    window.location.hash = "#/loose-ends";
    renderApp(answers);
    const dashboard = await screen.findByRole("region", { name: "Loose Ends" });
    expect(dashboard.querySelector("h1")?.textContent).toBe("Loose Ends");
    expect(dashboard.querySelectorAll("p")).toHaveLength(1);
    expect(dashboard.querySelectorAll("section, h2, ul, table")).toHaveLength(
      0
    );
    expect(dashboard.textContent).not.toMatch(/\d/);
    expect(screen.queryByRole("region", { name: "Question Inbox" })).toBeNull();
    const current = screen.getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Loose Ends");
  });

  it("navigates from the Sidebar by hash and back again", async () => {
    renderApp(answers);
    await screen.findByRole("region", { name: "Question Inbox" });
    fireEvent.click(screen.getByRole("link", { name: "Loose Ends" }));
    expect(
      await screen.findByRole("region", { name: "Loose Ends" })
    ).toBeDefined();
    expect(window.location.hash).toBe("#/loose-ends");
    fireEvent.click(screen.getByRole("link", { name: "Question Inbox" }));
    expect(
      await screen.findByRole("region", { name: "Question Inbox" })
    ).toBeDefined();
    expect(window.location.hash).toBe("#/inbox");
    expect(screen.getByRole("link", { current: "page" }).textContent).toBe(
      "Question Inbox"
    );
  });
});
