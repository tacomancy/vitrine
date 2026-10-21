import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, question, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// From the notebook (spec #728, #732): three old open Questions on Home, each
// a way into the Question, and a dismissal that takes one out of the rotation
// and nothing else. Every case goes through App with the core faked.

const watched = {
  indexing: null,
  watching: { ok: true },
  current: { ok: true },
};

const old = (text: string, rest: Record<string, unknown> = {}) =>
  question(text, "2025-08-14T09:00:00+01:00", rest);

const FIRST = [
  old("Does sleep gate consolidation?", {
    from: "Staresina 2015",
    page: 7,
    context: "reading",
  }),
  old("Why do spindles cluster?"),
  old("What sets the replay rate?"),
];
const SECOND = [
  old("Is the effect dose dependent?"),
  old("Who first measured it?"),
  old("Does it survive preregistration?"),
];

const answers = {
  "vault.current": vault,
  "questions.list": {
    ...empty,
    questions: [...FIRST, ...SECOND],
  },
  "vault.status": watched,
  "vault.kinds": ["question"],
  "vault.tree": [{ path: "questions/a.md", kind: "question" }],
  "looseEnds.rows": { groups: [], problems: [] },
  "home.away": { since: null },
  "scouts.health": { scouts: [], unreadable: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "home.resurfaced": ({ seed }: { seed: number }) => ({
    questions: seed === 0 ? FIRST : SECOND,
  }),
};

const section = () =>
  screen.findByRole("region", { name: "From the notebook" });

describe("Home — from the notebook", () => {
  it("draws three Questions with their provenance and age, and no count of the pool", async () => {
    renderApp(answers);
    const notebook = await section();
    const items = within(notebook).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("Does sleep gate consolidation?");
    expect(items[0]!.textContent).toContain("Staresina 2015 · p.7");
    expect(items[1]!.textContent).toContain("Unattached");
    expect(items[0]!.textContent).toMatch(/\d+(mo|y)/);
    // No figure at all: nothing says how many older Questions there are.
    expect(notebook.textContent).not.toMatch(/\d+ (older|more|questions)/i);
    expect(notebook.textContent).not.toMatch(/overdue/i);
  });

  it("shows a different three on ↻ others", async () => {
    const ask = vi.fn<(input: unknown) => void>();
    renderApp({
      ...answers,
      "home.resurfaced": (input: { seed: number }) => {
        ask(input);
        return answers["home.resurfaced"](input);
      },
    });
    const notebook = await section();
    await within(notebook).findByText("Does sleep gate consolidation?");

    fireEvent.click(within(notebook).getByRole("button", { name: /others/ }));

    await within(notebook).findByText("Is the effect dose dependent?");
    expect(
      within(notebook).queryByText("Does sleep gate consolidation?")
    ).toBeNull();
    expect(ask).toHaveBeenCalledWith({ seed: 1 });
  });

  it("opens a Question at its Address, with the keyboard on the Inbox's list", async () => {
    renderApp(answers);
    const notebook = await section();
    fireEvent.click(
      await within(notebook).findByRole("link", {
        name: "Does sleep gate consolidation?",
      })
    );
    const list = await screen.findByRole("listbox", { name: "Questions" });
    expect(window.location.hash).toBe(
      "#/question/questions/Does%20sleep%20gate%20consolidation%3F.md"
    );
    const selected = await within(list).findByRole("option", {
      selected: true,
    });
    expect(selected.textContent).toContain("Does sleep gate consolidation?");
    await vi.waitFor(() => expect(document.activeElement).toBe(list));
  });

  it("leaves the row in place on a dismissal, with undo beside the words that say what it did", async () => {
    const dismiss = vi.fn<(input: unknown) => void>();
    const loose = vi.fn();
    renderApp({
      ...answers,
      "home.dismissResurfaced": (input: unknown) => {
        dismiss(input);
        return undefined;
      },
      "looseEnds.dismiss": loose,
    });
    const notebook = await section();
    const [first] = await within(notebook).findAllByRole("listitem");

    fireEvent.click(within(first!).getByRole("button", { name: "dismiss" }));

    await within(first!).findByText(
      /dismissing takes it out of the rotation, not out of the vault/
    );
    expect(dismiss).toHaveBeenCalledWith({ path: FIRST[0]!.path });
    expect(loose).not.toHaveBeenCalled();
    expect(within(first!).getByRole("button", { name: "undo" })).toBeDefined();
    expect(
      within(first!).queryByRole("button", { name: "dismiss" })
    ).toBeNull();
  });

  it("undoes a dismissal through its own procedure", async () => {
    const undo = vi.fn<(input: unknown) => void>();
    renderApp({
      ...answers,
      "home.dismissResurfaced": () => undefined,
      "home.undismissResurfaced": (input: unknown) => {
        undo(input);
        return undefined;
      },
    });
    const notebook = await section();
    const [first] = await within(notebook).findAllByRole("listitem");
    fireEvent.click(within(first!).getByRole("button", { name: "dismiss" }));
    fireEvent.click(
      await within(first!).findByRole("button", { name: "undo" })
    );

    await within(first!).findByRole("button", { name: "dismiss" });
    expect(undo).toHaveBeenCalledWith({ path: FIRST[0]!.path });
    expect(within(first!).queryByRole("button", { name: "undo" })).toBeNull();
  });

  it("drops a dismissed Question on the next read, undo and all", async () => {
    let dismissed = false;
    renderApp({
      ...answers,
      "home.resurfaced": () => ({
        questions: dismissed ? FIRST.slice(1) : FIRST,
      }),
      "home.dismissResurfaced": () => {
        dismissed = true;
        return undefined;
      },
    });
    const notebook = await section();
    const [first] = await within(notebook).findAllByRole("listitem");
    fireEvent.click(within(first!).getByRole("button", { name: "dismiss" }));
    await within(first!).findByRole("button", { name: "undo" });

    fireEvent.click(within(notebook).getByRole("button", { name: /others/ }));

    await vi.waitFor(() =>
      expect(within(notebook).getAllByRole("listitem")).toHaveLength(2)
    );
    expect(within(notebook).queryByRole("button", { name: "undo" })).toBeNull();
  });

  it("says a refused dismissal as an alert on the row, and leaves it dismissable", async () => {
    renderApp({
      ...answers,
      "home.dismissResurfaced": () => {
        throw new Error(".vitrine/dismissals.json could not be read");
      },
    });
    const notebook = await section();
    const [first] = await within(notebook).findAllByRole("listitem");

    fireEvent.click(within(first!).getByRole("button", { name: "dismiss" }));

    expect((await within(first!).findByRole("alert")).textContent).toMatch(
      /dismissals\.json/
    );
    expect(
      within(first!).getByRole("button", { name: "dismiss" })
    ).toBeDefined();
  });

  it("draws no section for an empty pool", async () => {
    renderApp({ ...answers, "home.resurfaced": { questions: [] } });
    await screen.findByRole("region", { name: "Home" });
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "From the notebook" })
      ).toBeNull()
    );
    expect(screen.queryByText(/notebook/i)).toBeNull();
  });

  it("says a failed read in the wrong voice, with its reason, and is never an alert", async () => {
    renderApp({
      ...answers,
      "home.resurfaced": () => {
        throw new Error("the index could not be read");
      },
    });
    const home = await screen.findByRole("region", { name: "Home" });
    await within(home).findByText(/the index could not be read/);
    expect(within(home).queryByRole("alert")).toBeNull();
    expect(within(home).queryAllByRole("listitem")).toHaveLength(0);
  });
});
