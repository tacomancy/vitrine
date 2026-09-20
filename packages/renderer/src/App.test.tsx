import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "./fake-core";

// Testing Library only cleans up by itself when the runner exposes globals.
afterEach(cleanup);

describe("First run", () => {
  it("is what a launch with no vault shows: the promise and one action", async () => {
    renderApp({ "vault.current": null });
    expect(
      await screen.findByRole("button", { name: "Open a vault" })
    ).toBeDefined();
    expect(screen.getByText(/plain Markdown/)).toBeDefined();
    expect(screen.getByText(/one folder beside them/)).toBeDefined();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows a refused pick as a plain message under the action and stays put", async () => {
    renderApp({
      "vault.current": null,
      "vault.pick": () => {
        throw new Error("/Users/me/notes.md is not a folder.");
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Open a vault" })
    );
    expect(
      await screen.findByText("/Users/me/notes.md is not a folder.")
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Open a vault" })).toBeDefined();
  });

  it("stays on First run when the chooser is cancelled", async () => {
    renderApp({ "vault.current": null, "vault.pick": null });
    fireEvent.click(
      await screen.findByRole("button", { name: "Open a vault" })
    );
    expect(
      await screen.findByRole("button", { name: "Open a vault" })
    ).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives way to the window once a vault is picked", async () => {
    const vault = {
      name: "consolidation-vault",
      path: "/v/consolidation-vault",
    };
    let current: typeof vault | null = null;
    renderApp({
      "vault.current": () => current,
      "vault.pick": () => (current = vault),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Open a vault" })
    );
    expect(await screen.findByRole("banner")).toBeDefined();
    expect(screen.getByRole("banner").textContent).toContain(
      "consolidation-vault"
    );
    expect(screen.queryByRole("button", { name: "Open a vault" })).toBeNull();
  });
});

describe("the window with a vault open", () => {
  const vault = { name: "consolidation-vault", path: "/v/consolidation-vault" };

  it("names the vault in the title bar", async () => {
    renderApp({ "vault.current": vault });
    expect((await screen.findByRole("banner")).textContent).toBe(
      "consolidation-vault"
    );
  });

  it("lists the eight surfaces with only Question Inbox live", async () => {
    renderApp({ "vault.current": vault });
    const nav = await screen.findByRole("navigation", { name: "Surfaces" });
    const items = Array.from(nav.querySelectorAll("li")).map(
      (li) => li.textContent
    );
    expect(items).toEqual([
      "Home",
      "Question Inbox",
      "Reader",
      "Research Question view",
      "Hypothesis view",
      "Experiment view",
      "Scout Queue",
      "Vault",
    ]);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Question Inbox"]);
    expect(nav.querySelectorAll("button, [tabindex]")).toHaveLength(0);
    expect(nav.textContent).not.toContain("⌘K");
    expect(nav.textContent).not.toContain("THREADS");
  });

  it("shows the Inbox header counting zero questions and nothing else", async () => {
    renderApp({ "vault.current": vault });
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(inbox.textContent).toContain("0 questions");
    expect(
      inbox.querySelectorAll("li, table, button, [role=listbox]")
    ).toHaveLength(0);
  });
});
