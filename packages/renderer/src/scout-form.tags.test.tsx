import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { question, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// #688 (spec #678): the Scout form's Filter is a Query or Tags. The core is
// faked, so what is asserted is what the renderer sends and what it draws from
// what the core says.

const node = (canonical: string, children: unknown[] = []) => ({
  canonical,
  display: canonical,
  name: canonical.split("/").pop(),
  implicit: false,
  count: { inclusive: 1, exclusive: 1 },
  files: [],
  occurrences: [],
  children,
});

const tagTree = {
  tags: [node("bio"), node("ml", [node("ml/probing")])],
  invalid: [],
};

const QUERY = 'abs:"alpha" OR ti:"alpha" OR abs:"beta" OR ti:"beta"';
const previews: Record<string, string[]> = {
  ml: ["alpha"],
  bio: ["beta"],
  "ml/probing": [],
};

const base = (more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "vault.tags": tagTree,
  "scouts.list": { scouts: [], unreadable: [] },
  "scouts.queue": [],
  "scouts.groups": [],
  "scouts.health": { scouts: [], unreadable: [] },
  "scouts.muted": { rules: [], problem: null, items: [] },
  "scouts.fleet": { claim: "", naming: [] },
  "questions.list": {
    questions: [question("Is it?", "2026-09-01T00:00:00Z", { id: "rq1" })],
    partial: [],
    unreadable: [],
    shape: [],
  },
  "scouts.previewTags": ({ tags }: { tags: string[] }) => ({
    tags: tags.map((tag) => ({ tag, terms: previews[tag] ?? [] })),
    query: tags.some((t) => (previews[t] ?? []).length > 0) ? QUERY : null,
  }),
  ...more,
});

const open = async (more: Record<string, unknown> = {}) => {
  renderApp(base(more));
  fireEvent.click(await screen.findByRole("button", { name: "+ New Scout" }));
  await screen.findByRole("form", { name: "New Scout" });
};
const pickTags = () => fireEvent.click(screen.getByLabelText("by Tags"));
// The list is there before the vault's Tags arrive; a key pressed on it before
// then has nothing to choose.
const picker = async () => {
  const list = await screen.findByRole("listbox", {
    name: "Tags in the vault",
  });
  await within(list).findAllByRole("option");
  return list;
};
const press = (el: HTMLElement, key: string) => fireEvent.keyDown(el, { key });

describe("the Tags Filter", () => {
  it("picks, shows Terms and the compiled query, and saves Tags with no Query — by keyboard alone", async () => {
    const saves: Array<Record<string, unknown>> = [];
    await open({
      "scouts.save": (input: Record<string, unknown>) => {
        saves.push(input);
        return { id: "new", run: null };
      },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "N" } });
    pickTags();
    const list = await picker();
    // bio, ml, ml/probing — a tree, flattened in order.
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual([
      expect.stringContaining("bio") as string,
      expect.stringContaining("ml") as string,
      expect.stringContaining("probing") as string,
    ]);

    press(list, "ArrowDown");
    expect(list.getAttribute("aria-activedescendant")).toBe(
      within(list).getAllByRole("option")[1]!.id
    );
    press(list, "Enter"); // ml
    press(list, "ArrowUp");
    press(list, "Enter"); // bio

    const chips = await screen.findByRole("list", { name: "Chosen Tags" });
    expect(within(chips).getAllByRole("listitem")).toHaveLength(2);
    const code = await screen.findByLabelText("Compiled query");
    expect(code.textContent).toBe(QUERY);
    // A chip expands to its Terms in use.
    fireEvent.click(within(chips).getByRole("button", { name: /ml.*Terms/ }));
    expect(within(chips).getByText("alpha")).toBeDefined();
    expect(
      screen.getByText(/A Lexicon change does not search back/)
    ).toBeDefined();

    // Remove a chip by its button, then save.
    fireEvent.click(within(chips).getByRole("button", { name: "Remove bio" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ name: "N", query: "", tags: ["ml"] });
  });

  it("names what Save is missing, and try never gates it", async () => {
    await open({
      "scouts.tryTags": { outcome: "found", total: 3, titles: ["A", "B"] },
    });
    pickTags();
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Save needs a name and a Tag.")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "N" } });
    expect(screen.getByText("Save needs a Tag.")).toBeDefined();

    press(await picker(), "ArrowDown");
    press(await picker(), "Enter");
    // Chosen, never tried: Save is open.
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Save needs/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try" }));
    expect(
      await screen.findByText(/3 results across all of arXiv/)
    ).toBeDefined();
  });

  it("says a Tag with no Terms has none, and the Query is the way out", async () => {
    await open();
    pickTags();
    const list = await picker();
    press(list, "ArrowDown");
    press(list, "ArrowDown");
    press(list, "Enter"); // ml/probing — nothing to compile

    expect(await screen.findByText(/no Terms to search/)).toBeDefined();
  });

  it("switches an existing Query Scout to Tags and back, keeping the Scout", async () => {
    const saves: Array<Record<string, unknown>> = [];
    renderApp(
      base({
        "scouts.list": {
          scouts: [
            {
              id: "sleep",
              name: "Sleep",
              source: { kind: "arxiv" },
              query: "all:sleep",
              cadence: "daily",
              assigned: [],
              lane: "review",
              paused: false,
              created: "2026-09-20T00:00:00.000Z",
              searchBackTo: null,
            },
          ],
          unreadable: [],
        },
        "scouts.save": (input: Record<string, unknown>) => {
          saves.push(input);
          return { id: "sleep", run: null };
        },
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: /Sleep/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByRole("form", { name: "Edit Sleep" });
    expect(screen.getByLabelText("by Query").checked).toBe(true);

    pickTags();
    const list = await picker();
    press(list, "ArrowDown");
    press(list, "Enter");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ id: "sleep", query: "", tags: ["ml"] });
  });
});
