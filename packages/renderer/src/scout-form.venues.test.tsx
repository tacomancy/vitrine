import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// #809 (spec #800 stories 14, 16): an OpenAlex Scout's venue allowlist is
// chosen through the name search, which runs on a press and never as you
// type, and is saved with each venue's ID and name. The core is faked.

const found = {
  outcome: "found",
  creditsLeft: 900,
  results: [
    {
      id: "S1",
      name: "Sleep",
      publisher: "Sleep Press",
      issn: "0000-0001",
      worksCount: 12345,
    },
    {
      id: "S2",
      name: "Sleep Medicine",
      publisher: "Other House",
      issn: null,
      worksCount: 87,
    },
  ],
};

const answers = (more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": { scouts: [], unreadable: [] },
  "scouts.queue": [],
  "scouts.groups": [],
  "scouts.health": { scouts: [], unreadable: [] },
  "scouts.muted": { rules: [], problem: null, items: [] },
  "scouts.fleet": { claim: "", naming: [] },
  "questions.list": { questions: [], partial: [], unreadable: [], shape: [] },
  ...more,
});

const open = async (more: Record<string, unknown> = {}) => {
  renderApp(answers(more));
  fireEvent.click(await screen.findByRole("button", { name: "+ New Scout" }));
  const form = await screen.findByRole("form", { name: "New Scout" });
  fireEvent.change(screen.getByLabelText("Watching"), {
    target: { value: "openalex" },
  });
  return form;
};
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the form's venue allowlist", () => {
  it("is offered for OpenAlex and not for arXiv", async () => {
    const form = await open();
    expect(within(form).getByText("Only these venues")).toBeDefined();
    type("Watching", "arxiv");
    expect(within(form).queryByText("Only these venues")).toBeNull();
  });

  it("searches only on a press or enter, then adds a result with its ID and name, shown to tell near-duplicates apart", async () => {
    const search = vi.fn(() => found);
    const form = await open({ "scouts.searchNames": search });
    type("Venue name", "sleep");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(search).not.toHaveBeenCalled();

    fireEvent.click(
      within(form).getByRole("button", { name: "Search venues" })
    );
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith({ kind: "venue", name: "sleep" });

    const rows = within(
      await within(form).findByRole("list", { name: "Venue results" })
    ).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("Sleep Press");
    expect(rows[0]!.textContent).toContain("ISSN 0000-0001");
    expect(rows[0]!.textContent).toContain("12,345 works");
    fireEvent.click(within(rows[1]!).getByRole("button", { name: /Add/ }));

    const chosen = within(form).getByRole("list", { name: "Allowed venues" });
    expect(chosen.textContent).toContain("Sleep Medicine");
  });

  it("presses enter in the name field without submitting the Scout", async () => {
    const search = vi.fn(() => found);
    const save = vi.fn(() => ({ id: "x", run: null }));
    await open({ "scouts.searchNames": search, "scouts.save": save });
    type("Name", "Published sleep");
    type("Query", "sleep");
    type("Venue name", "sleep");
    fireEvent.keyDown(screen.getByLabelText("Venue name"), { key: "Enter" });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(save).not.toHaveBeenCalled();
  });

  it("says a failed search in its own sentence", async () => {
    const form = await open({
      "scouts.searchNames": {
        outcome: "failed",
        sentence: "OpenAlex is down.",
      },
    });
    type("Venue name", "sleep");
    fireEvent.click(
      within(form).getByRole("button", { name: "Search venues" })
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "OpenAlex is down."
    );
  });

  it("saves the chosen venues with the Scout, and tries over them", async () => {
    const save = vi.fn(() => ({ id: "pub", run: null }));
    const tryQuery = vi.fn(() => ({
      outcome: "found",
      total: 3,
      titles: ["A"],
      creditsLeft: null,
    }));
    const form = await open({
      "scouts.searchNames": () => found,
      "scouts.save": save,
      "scouts.tryQuery": tryQuery,
    });
    type("Name", "Published sleep");
    type("Query", "sleep");
    type("Venue name", "sleep");
    fireEvent.click(
      within(form).getByRole("button", { name: "Search venues" })
    );
    const rows = within(
      await within(form).findByRole("list", { name: "Venue results" })
    ).getAllByRole("listitem");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: /Add/ }));

    fireEvent.click(screen.getByRole("button", { name: "Try" }));
    await waitFor(() => expect(tryQuery).toHaveBeenCalledTimes(1));
    const venues = [{ id: "S1", name: "Sleep" }];
    expect(tryQuery).toHaveBeenCalledWith({
      query: "sleep",
      watching: "openalex",
      venues,
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ venues }));
  });

  it("removes a venue from the list", async () => {
    const form = await open({ "scouts.searchNames": () => found });
    type("Venue name", "sleep");
    fireEvent.click(
      within(form).getByRole("button", { name: "Search venues" })
    );
    const rows = within(
      await within(form).findByRole("list", { name: "Venue results" })
    ).getAllByRole("listitem");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: /Add/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Sleep" }));
    expect(
      within(form).queryByRole("list", { name: "Allowed venues" })
    ).toBeNull();
    expect(form.textContent).toContain("Every journal and conference");
  });

  it("sends no venues for a Scout with none", async () => {
    const save = vi.fn(() => ({ id: "pub", run: null }));
    await open({ "scouts.save": save });
    type("Name", "Published sleep");
    type("Query", "sleep");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(
      (save.mock.calls as unknown[][])[0]![0] as object
    ).not.toHaveProperty("venues");
  });
});
