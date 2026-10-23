import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { question, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// #783 (spec #782): the New Scout form is three always-visible labelled
// sections on shared rows. jsdom cannot see layout, so what is asserted is
// grouping, label ties and the sentences beside disabled controls; spacing and
// alignment are checked in the hidden-launch screenshot (docs/agents/run.md).

const open = async () => {
  renderApp({
    "vault.current": vault,
    "vault.tags": { tags: [], invalid: [] },
    "scouts.list": { scouts: [], unreadable: [] },
    "scouts.queue": [],
    "scouts.batches": [],
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
  });
  fireEvent.click(await screen.findByRole("button", { name: "+ New Scout" }));
  return screen.findByRole("form", { name: "New Scout" });
};

describe("the New Scout form's sections", () => {
  it("shows three labelled sections, none collapsed, holding the fields as listed", async () => {
    const form = await open();

    const watches = within(form).getByRole("group", {
      name: "What it watches",
    });
    const when = within(form).getByRole("group", { name: "When" });
    const queue = within(form).getByRole("group", { name: "Queue behaviour" });

    for (const label of ["Name", "Watching", "Query"]) {
      expect(within(watches).getByLabelText(label)).toBeDefined();
    }
    expect(
      within(watches).getByRole("radiogroup", { name: "Filter" })
    ).toBeDefined();
    expect(within(watches).getByRole("button", { name: "Try" })).toBeDefined();
    for (const label of ["Cadence", "Starting lane", "Also search back to"]) {
      expect(within(when).getByLabelText(label)).toBeDefined();
    }
    expect(
      within(queue).getByRole("group", { name: "Assigned Questions" })
    ).toBeDefined();
    for (const label of ["Cap", "Review days", "Skim days"]) {
      expect(within(queue).getByLabelText(label)).toBeDefined();
    }
  });

  it("ties every field's label to its control", async () => {
    const form = await open();

    for (const label of [
      "Name",
      "Watching",
      "Query",
      "Cadence",
      "Starting lane",
      "Also search back to",
      "Cap",
      "Review days",
      "Skim days",
    ]) {
      const control = within(form).getByLabelText(label);
      expect(["INPUT", "SELECT", "TEXTAREA"]).toContain(control.tagName);
    }
  });

  it("says what unlocks a disabled Save and a disabled Try, beside each", async () => {
    const form = await open();

    const save = within(form).getByRole("button", { name: "Save" });
    const tryIt = within(form).getByRole("button", { name: "Try" });
    expect(save).toHaveProperty("disabled", true);
    expect(tryIt).toHaveProperty("disabled", true);
    expect(screen.getByText("Save needs a name and a Query.")).toBeDefined();
    expect(screen.getByText("Try needs a Query.")).toBeDefined();
    // Neither is a submit but Save.
    expect(tryIt).toHaveProperty("type", "button");
    expect(within(form).getByRole("button", { name: "Cancel" })).toHaveProperty(
      "type",
      "button"
    );

    fireEvent.change(within(form).getByLabelText("Name"), {
      target: { value: "N" },
    });
    fireEvent.change(within(form).getByLabelText("Query"), {
      target: { value: "probing" },
    });
    expect(save).toHaveProperty("disabled", false);
    expect(tryIt).toHaveProperty("disabled", false);
    expect(screen.queryByText(/Save needs/)).toBeNull();
    expect(screen.queryByText(/Try needs/)).toBeNull();
  });

  it("blocks Save without a name and a Query, and names which is missing", async () => {
    const form = await open();
    const save = within(form).getByRole("button", { name: "Save" });

    fireEvent.change(within(form).getByLabelText("Name"), {
      target: { value: "N" },
    });
    expect(save).toHaveProperty("disabled", true);
    expect(screen.getByText("Save needs a Query.")).toBeDefined();
    fireEvent.change(within(form).getByLabelText("Name"), {
      target: { value: "" },
    });
    fireEvent.change(within(form).getByLabelText("Query"), {
      target: { value: "q" },
    });
    expect(save).toHaveProperty("disabled", true);
    expect(screen.getByText("Save needs a name.")).toBeDefined();
  });

  it("says what an empty optional field means", async () => {
    const form = await open();

    expect(within(form).getByLabelText("Review days")).toHaveProperty(
      "placeholder",
      "14"
    );
    expect(within(form).getByText(/Empty keeps 14 days/)).toBeDefined();
    expect(within(form).getByText(/Empty keeps 30 days/)).toBeDefined();
    expect(within(form).getByText(/Empty means no Cap/)).toBeDefined();
  });
});
