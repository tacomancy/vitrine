import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { question, renderApp, vault } from "./fake-core";
import { hashOf } from "./router";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

// #858 (spec #854; ADR 0053 decision 5): a Scout's form is not part of the
// Queue. It has two Addresses under the Scouts screen, so a reload, the back
// button and a link all find it. The core is faked: what is asserted is what
// the window draws and what it sends.

const sleep = {
  id: "sleep",
  name: "Sleep and memory",
  source: { kind: "arxiv" },
  query: "all:sleep",
  cadence: "daily",
  assigned: [],
  lane: "review",
  paused: false,
  created: "2026-09-20T00:00:00.000Z",
  searchBackTo: null,
};

const answers = (more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": { scouts: [sleep], unreadable: [], dropped: [] },
  "scouts.activity": {
    rows: [],
    fleet: {
      parsingCleanly: 0,
      notParsing: 0,
      notReached: 0,
      keyRejected: 0,
      noKey: 0,
    },
    review: {
      pending: 0,
      pastWindow: 0,
      deferred: 0,
      median: null,
      oldest: null,
    },
    coverageGaps: {
      kind: "covered",
      warrant: { questions: 0, scouts: 0 },
      notLooking: [],
    },
    dropped: [],
  },
  "questions.list": {
    questions: [
      question("Is it consolidation?", "2026-09-01T00:00:00Z", { id: "rq1" }),
      question("Does it need REM?", "2026-09-02T00:00:00Z", { id: "rq2" }),
    ],
    partial: [],
    unreadable: [],
    shape: [],
  },
  "vault.status": {
    indexing: null,
    watching: { ok: true },
    current: { ok: true },
  },
  ...more,
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the form's Addresses", () => {
  it("spells the new-Scout Address, with a Question to Assign when one is named", () => {
    expect(hashOf({ surface: "scout-form" })).toBe("#/scout-management/new");
    expect(hashOf({ surface: "scout-form", assigning: "rq 1" })).toBe(
      "#/scout-management/new?assign=rq%201"
    );
    expect(hashOf({ surface: "scout-form", scout: "sleep" })).toBe(
      "#/scout-management/sleep/edit"
    );
  });

  it("opens the new-Scout form at #/scout-management/new and keeps the hash", async () => {
    window.location.hash = "#/scout-management/new";
    renderApp(answers());

    expect(
      await screen.findByRole("form", { name: "New Scout" })
    ).toBeDefined();
    expect(window.location.hash).toBe("#/scout-management/new");
    // The Scouts screen's entry stays lit under the form, as a Source's does for the Reader.
    expect(screen.getByRole("link", { current: "page" }).textContent).toBe(
      "Scouts"
    );
  });

  it("opens a Scout's form at #/scout-management/<id>/edit, filled from the Scout", async () => {
    window.location.hash = "#/scout-management/sleep/edit";
    renderApp(answers());

    const form = await screen.findByRole("form", {
      name: "Edit Sleep and memory",
    });
    expect(within(form).getByLabelText<HTMLInputElement>("Name").value).toBe(
      "Sleep and memory"
    );
    expect(window.location.hash).toBe("#/scout-management/sleep/edit");
  });

  it("says a Scout that does not exist is not there, naming the Address, and not an empty page", async () => {
    window.location.hash = "#/scout-management/ghost/edit";
    renderApp(answers());

    const said = await screen.findByText(/no Scout with that id/);
    expect(said.textContent).toContain("#/scout-management/ghost/edit");
    expect(screen.queryByRole("form")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Question Inbox" })
    ).toBeDefined();
  });

  it("keeps an unsaved draft across a reload", async () => {
    window.location.hash = "#/scout-management/new";
    const first = renderApp(answers());
    await screen.findByRole("form", { name: "New Scout" });
    type("Name", "Half written");
    type("Query", "all:rem");
    first.unmount();

    renderApp(answers());
    await screen.findByRole("form", { name: "New Scout" });

    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(
      "Half written"
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>("Query").value).toBe(
      "all:rem"
    );
  });

  it("keeps a restored draft through the next reload too", async () => {
    window.location.hash = "#/scout-management/new";
    const first = renderApp(answers());
    await screen.findByRole("form", { name: "New Scout" });
    type("Name", "Half written");
    first.unmount();
    const second = renderApp(answers());
    await screen.findByRole("form", { name: "New Scout" });
    second.unmount();

    renderApp(answers());
    await screen.findByRole("form", { name: "New Scout" });

    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(
      "Half written"
    );
  });

  it("keeps the last try across a reload", async () => {
    window.location.hash = "#/scout-management/new";
    const first = renderApp(
      answers({
        "scouts.tryQuery": {
          outcome: "found",
          total: 212,
          titles: ["First paper"],
        },
      })
    );
    await screen.findByRole("form", { name: "New Scout" });
    type("Query", "all:sleep");
    fireEvent.click(screen.getByRole("button", { name: "Try" }));
    await screen.findByText(/212 results across all of arXiv/);
    first.unmount();

    renderApp(answers());
    await screen.findByRole("form", { name: "New Scout" });

    expect(screen.getByText(/212 results across all of arXiv/)).toBeDefined();
    expect(screen.getByText("First paper")).toBeDefined();
  });

  it("forgets a try once the text it was about changes", async () => {
    window.location.hash = "#/scout-management/new";
    const first = renderApp(
      answers({
        "scouts.tryQuery": { outcome: "found", total: 3, titles: ["A"] },
      })
    );
    await screen.findByRole("form", { name: "New Scout" });
    type("Query", "all:sleep");
    fireEvent.click(screen.getByRole("button", { name: "Try" }));
    await screen.findByText(/3 results/);
    type("Query", "all:rem");
    first.unmount();

    renderApp(answers());
    await screen.findByRole("form", { name: "New Scout" });

    expect(screen.queryByText(/3 results/)).toBeNull();
  });

  it("does not hand one form's draft to another", async () => {
    window.location.hash = "#/scout-management/new";
    const first = renderApp(answers());
    await screen.findByRole("form", { name: "New Scout" });
    type("Name", "Only for new");
    first.unmount();

    window.location.hash = "#/scout-management/sleep/edit";
    renderApp(answers());
    await screen.findByRole("form", { name: "Edit Sleep and memory" });

    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(
      "Sleep and memory"
    );
  });

  it("opens with the Question Assigned when the Address names one", async () => {
    window.location.hash = "#/scout-management/new?assign=rq2";
    renderApp(answers());

    const form = await screen.findByRole("form", { name: "New Scout" });
    await within(form).findByRole("checkbox", { name: /Does it need REM/ });

    expect(
      within(form)
        .getAllByRole("checkbox")
        .map((box) => [
          box.parentElement?.textContent,
          (box as HTMLInputElement).checked,
        ])
    ).toEqual([
      [expect.stringContaining("Is it consolidation?"), false],
      [expect.stringContaining("Does it need REM?"), true],
    ]);
  });

  it("returns to the Scouts screen on save, and back does not return to the form", async () => {
    window.location.hash = "#/scout-management";
    window.location.hash = "#/scout-management/new";
    renderApp(answers({ "scouts.save": () => ({ id: "fresh", run: null }) }));
    await screen.findByRole("form", { name: "New Scout" });
    type("Name", "Fresh");
    type("Query", "all:fresh");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("region", { name: "Scouts" })).toBeDefined();
    expect(window.location.hash).toBe("#/scout-management");
    expect(screen.queryByRole("form")).toBeNull();
    // The saved draft is spent: a form opened later starts empty.
    window.location.hash = "#/scout-management/new";
    await screen.findByRole("form", { name: "New Scout" });
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("");
  });

  it("returns to the Scouts screen on Esc and spends the draft", async () => {
    window.location.hash = "#/scout-management/new";
    renderApp(answers());
    await screen.findByRole("form", { name: "New Scout" });
    type("Name", "Abandoned");

    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() =>
      expect(window.location.hash).toBe("#/scout-management")
    );
    expect(await screen.findByRole("region", { name: "Scouts" })).toBeDefined();
    window.location.hash = "#/scout-management/new";
    await screen.findByRole("form", { name: "New Scout" });
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("");
  });

  it("does not keep a form nobody has touched, so one Question's Assigning is not the next form's default", async () => {
    window.location.hash = "#/scout-management/new?assign=rq2";
    const first = renderApp(answers());
    const form = await screen.findByRole("form", { name: "New Scout" });
    await within(form).findByRole("checkbox", { name: /Does it need REM/ });
    first.unmount();

    window.location.hash = "#/scout-management/new";
    renderApp(answers());
    const next = await screen.findByRole("form", { name: "New Scout" });
    await within(next).findByRole("checkbox", { name: /Does it need REM/ });
    expect(
      within(next)
        .getAllByRole("checkbox")
        .filter((box) => (box as HTMLInputElement).checked)
    ).toEqual([]);
  });
});
