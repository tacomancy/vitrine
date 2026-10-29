import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

// #911 (spec #909; ADR 0056 decision 13): the form lists a Watched Scout's
// Addresses — add one, remove one, save. The core is faked: what is asserted
// is what the form draws and what it sends; the file's two forms are the
// core's (`scout-pages.test.ts`).

const RESEARCH = "https://lab.example/research";
const NEWS = "https://lab.example/news";
const BLOG = "https://lab.example/blog";

const lab = (urls: string[]) => ({
  id: "lab",
  name: "Lab",
  source: { kind: "watched", urls },
  query: urls[0],
  cadence: "weekly",
  assigned: [],
  lane: "skim",
  paused: false,
  created: "2026-09-20T00:00:00.000Z",
  searchBackTo: null,
});

const answers = (
  urls: string[],
  saves: Array<Record<string, unknown>> = []
) => ({
  "vault.current": vault,
  "scouts.list": { scouts: [lab(urls)], unreadable: [], dropped: [] },
  "scouts.queue": [],
  "scouts.batches": [],
  "scouts.groups": [{ id: "lab", runId: null, runPending: 0, held: [] }],
  "scouts.health": { scouts: [], unreadable: [] },
  "scouts.muted": { rules: [], problem: null, items: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "questions.list": { questions: [], partial: [], unreadable: [], shape: [] },
  "vault.status": {
    indexing: null,
    watching: { ok: true },
    current: { ok: true },
  },
  "settings.get": {},
  "scouts.save": (input: Record<string, unknown>) => {
    saves.push(input);
    return { id: "lab", run: null };
  },
});

const editing = async (
  urls: string[],
  saves?: Array<Record<string, unknown>>
) => {
  window.location.hash = "#/scout-management/lab/edit";
  const rendered = renderApp(answers(urls, saves));
  await screen.findByRole("form", { name: "Edit Lab" });
  return rendered;
};

const group = () => screen.getByRole("group", { name: "Addresses" });
const addresses = () =>
  within(group())
    .getAllByRole<HTMLInputElement>("textbox")
    .map((input) => input.value);
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Save" });

describe("the form's Addresses", () => {
  it("offers web pages, and lists a Scout's pages in one group row with its note", async () => {
    await editing([RESEARCH, NEWS]);

    expect(
      within(screen.getByLabelText("Watching")).getByRole<HTMLOptionElement>(
        "option",
        { selected: true }
      ).textContent
    ).toBe("web pages");
    expect(addresses()).toEqual([RESEARCH, NEWS]);
    expect(screen.getByLabelText<HTMLInputElement>("Address 2").value).toBe(
      NEWS
    );
    expect(group().getAttribute("aria-describedby")).not.toBeNull();
    expect(
      document.getElementById(group().getAttribute("aria-describedby")!)
        ?.textContent
    ).toBe(
      "Each page is read on its own and has its own health. Adding a page runs nothing; its first look proposes everything it lists."
    );
    // A secondary *remove* beside each, and *add another address* under the last.
    expect(
      within(group())
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["remove", "remove", "add another address"]);
  });

  it("adds an address, removes one, and saves the list as it stands", async () => {
    const saves: Array<Record<string, unknown>> = [];
    await editing([RESEARCH, NEWS], saves);

    fireEvent.click(
      within(group()).getByRole("button", { name: "add another address" })
    );
    type("Address 3", ` ${BLOG} `);
    fireEvent.click(
      within(group()).getByRole("button", { name: `remove ${RESEARCH}` })
    );
    // A url input drops the spaces as it is typed; the core trims what it is sent.
    expect(addresses()).toEqual([NEWS, BLOG]);

    fireEvent.click(save());

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({
      watching: "watched",
      urls: [NEWS, BLOG],
    });
  });

  it("leaves a blank address out of the save, and needs one that is not blank", async () => {
    const saves: Array<Record<string, unknown>> = [];
    await editing([RESEARCH], saves);
    fireEvent.click(
      within(group()).getByRole("button", { name: "add another address" })
    );

    type("Address 1", "");
    expect(save().disabled).toBe(true);
    expect(screen.getByText("Save needs an Address.")).toBeDefined();

    type("Address 1", RESEARCH);
    fireEvent.click(save());

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ urls: [RESEARCH] });
  });

  it("disables remove while one page is left, beside the sentence that says why", async () => {
    await editing([RESEARCH, NEWS]);

    fireEvent.click(
      within(group()).getByRole("button", { name: `remove ${NEWS}` })
    );

    const remove = within(group()).getByRole<HTMLButtonElement>("button", {
      name: `remove ${RESEARCH}`,
    });
    expect(remove.disabled).toBe(true);
    expect(remove.parentElement?.textContent).toContain(
      "A Scout needs at least one page."
    );
    // Not before: two pages can each be removed.
    fireEvent.click(
      within(group()).getByRole("button", { name: "add another address" })
    );
    expect(remove.disabled).toBe(false);
    expect(screen.queryByText("A Scout needs at least one page.")).toBeNull();
  });

  it("refuses a duplicate once trimmed beside its second copy, and Save waits for it", async () => {
    await editing([RESEARCH, NEWS]);

    type("Address 2", `${RESEARCH}  `);

    const refused = screen.getByText(
      "Already listed. A Scout reads each page once."
    );
    expect(
      refused.parentElement?.contains(screen.getByLabelText("Address 2"))
    ).toBe(true);
    expect(
      refused.parentElement?.contains(screen.getByLabelText("Address 1"))
    ).toBe(false);
    expect(save().disabled).toBe(true);
    expect(screen.getByText("Save needs each page once.")).toBeDefined();

    type("Address 2", BLOG);
    expect(
      screen.queryByText("Already listed. A Scout reads each page once.")
    ).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it("keeps the list through a reload", async () => {
    const first = await editing([RESEARCH]);
    fireEvent.click(
      within(group()).getByRole("button", { name: "add another address" })
    );
    type("Address 2", BLOG);
    first.unmount();

    await editing([RESEARCH]);

    expect(addresses()).toEqual([RESEARCH, BLOG]);
  });

  it("keeps the list through the trip to Settings and back", async () => {
    await editing([RESEARCH]);
    fireEvent.click(
      within(group()).getByRole("button", { name: "add another address" })
    );
    type("Address 2", BLOG);

    window.location.hash = "#/settings";
    await screen.findByRole("region", { name: "Settings" });
    window.history.back();
    await waitFor(() =>
      expect(window.location.hash).toBe("#/scout-management/lab/edit")
    );

    await screen.findByRole("form", { name: "Edit Lab" });
    expect(addresses()).toEqual([RESEARCH, BLOG]);
  });

  it("makes a new Scout from the Addresses typed", async () => {
    const saves: Array<Record<string, unknown>> = [];
    window.location.hash = "#/scout-management/new";
    renderApp(answers([RESEARCH], saves));
    await screen.findByRole("form", { name: "New Scout" });
    type("Name", "Another lab");
    type("Watching", "watched");
    expect(addresses()).toEqual([""]);
    type("Address 1", NEWS);
    fireEvent.click(
      within(group()).getByRole("button", { name: "add another address" })
    );
    type("Address 2", BLOG);

    fireEvent.click(save());

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({
      name: "Another lab",
      watching: "watched",
      urls: [NEWS, BLOG],
    });
  });
});
