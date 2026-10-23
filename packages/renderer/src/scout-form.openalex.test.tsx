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
  window.location.hash = "#/scouts";
});

// #802 (spec #800): the Scout form offers OpenAlex as a source. The core is
// faked, so what is asserted is what the form says and sends.

const answers = (more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": { scouts: [], unreadable: [] },
  "scouts.queue": [],
  "scouts.batches": [],
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
  await screen.findByRole("form", { name: "New Scout" });
};
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the form's OpenAlex source", () => {
  it("offers OpenAlex, and says journals and conferences only, and that a preprint-only work will not appear", async () => {
    await open();
    type("Watching", "openalex");

    const note = screen.getByText(/journals and conferences/);
    expect(note.textContent).toMatch(
      /only exists as a preprint will not appear/
    );
    expect(note.textContent).not.toMatch(/peer-review/i);
    expect(screen.getByLabelText("Query")).toBeDefined();
    expect(screen.getByLabelText("Also search back to")).toBeDefined();
  });

  it("does not say it for arXiv", async () => {
    await open();
    expect(screen.queryByText(/journals and conferences/)).toBeNull();
  });

  it("saves it as an OpenAlex Scout", async () => {
    const saves: Array<Record<string, unknown>> = [];
    await open({
      "scouts.save": (input: Record<string, unknown>) => {
        saves.push(input);
        return { id: "pub", run: null };
      },
    });
    type("Watching", "openalex");
    type("Name", "Published sleep");
    type("Query", '"sleep consolidation"');
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({
      watching: "openalex",
      query: '"sleep consolidation"',
    });
  });

  it("tries it: the total across OpenAlex, the first titles and the credits left", async () => {
    const tries: Array<Record<string, unknown>> = [];
    await open({
      "scouts.tryQuery": (input: Record<string, unknown>) => {
        tries.push(input);
        return {
          outcome: "found",
          total: 212,
          titles: ["First paper", "Second paper"],
          creditsLeft: 940,
        };
      },
    });
    type("Watching", "openalex");
    type("Query", "sleep");
    fireEvent.click(screen.getByRole("button", { name: "Try" }));

    expect(
      await screen.findByText(
        /212 results across journals and conferences in OpenAlex/
      )
    ).toBeDefined();
    expect(screen.getByText(/940 credits left today/)).toBeDefined();
    expect(
      within(screen.getByRole("list", { name: "First results" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["First paper", "Second paper"]);
    expect(tries).toEqual([{ query: "sleep", watching: "openalex" }]);
  });

  it("leaves the credits line out when OpenAlex did not state them", async () => {
    await open({
      "scouts.tryQuery": {
        outcome: "found",
        total: 1,
        titles: ["A"],
        creditsLeft: null,
      },
    });
    type("Watching", "openalex");
    type("Query", "sleep");
    fireEvent.click(screen.getByRole("button", { name: "Try" }));
    await screen.findByText(/1 result/);
    expect(screen.queryByText(/credits/)).toBeNull();
  });
});
