import { cleanup, fireEvent, screen, within } from "@testing-library/react";
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
  "looseEnds.rows": { groups: [], problems: [] },
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
    await within(dashboard).findByText(/Nothing to tidy/);
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

// A Kind-addressed object takes its Kind's own singular name (ADR 0026,
// #299). The old `#/questions/` prefix addressed a *Research* Question, so it
// is left unrecognised rather than redefined: a link saved under it must fail
// where the user can see it instead of quietly opening something else.
describe("an Address takes its Kind's name", () => {
  const PAGE = "questions/Does slow-wave density predict recall gain (RQ).md";
  const ADDRESS = `#/research-question/questions/${encodeURIComponent("Does slow-wave density predict recall gain (RQ).md")}`;
  const RETIRED = `#/questions/questions/${encodeURIComponent("Does slow-wave density predict recall gain (RQ).md")}`;
  const UNRESOLVED = `${RETIRED} — no longer an Address this app uses`;

  it("lands an Address whose file is gone on the Inbox, naming the Address and what came back", async () => {
    window.location.hash = ADDRESS;
    const asked: string[] = [];
    renderApp({
      ...answers,
      "researchQuestions.page": (input: { path: string }) => {
        asked.push(input.path);
        return {
          readable: false,
          path: input.path,
          reason: "missing from the vault",
        };
      },
    });
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(
      await within(inbox).findByText(`${ADDRESS} — missing from the vault`)
    ).toBeDefined();
    // The separator between segments survives the trip and the spaces in the
    // name do not: the core is asked about the path the Address decodes to,
    // and the line names the Address exactly as it was written.
    expect(asked).toEqual([PAGE]);
    expect(window.location.hash).toBe("#/inbox");
  });

  it("lands a retired #/questions/ Address on the Inbox, naming the Address that did not resolve", async () => {
    window.location.hash = RETIRED;
    renderApp(answers);
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(await within(inbox).findByText(UNRESOLVED)).toBeDefined();
    expect(
      screen.queryByRole("region", { name: "Research Question view" })
    ).toBeNull();
    // The canonicalising replace still happens: back never lands on a hash
    // that named nothing, and the line outlives it.
    expect(window.location.hash).toBe("#/inbox");
  });

  it("says nothing about a hash nobody ever wrote", async () => {
    window.location.hash = "#/scouts";
    renderApp(answers);
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(window.location.hash).toBe("#/inbox");
    expect(inbox.textContent).not.toMatch(/Address/);
  });

  it("drops the line once the window has been somewhere else", async () => {
    window.location.hash = RETIRED;
    renderApp(answers);
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    await within(inbox).findByText(UNRESOLVED);
    fireEvent.click(screen.getByRole("link", { name: "Loose Ends" }));
    await screen.findByRole("region", { name: "Loose Ends" });
    fireEvent.click(screen.getByRole("link", { name: "Question Inbox" }));
    const back = await screen.findByRole("region", { name: "Question Inbox" });
    expect(within(back).queryByText(UNRESOLVED)).toBeNull();
  });
});
