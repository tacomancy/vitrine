import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Derivation, HypothesisPage, Loop } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Closing the loop on the page (#338; spec #327 stories 64–70, 74, 75; ADR
// 0031 decision 8): offered only when the core says the state is closable
// and there is one parent to write to; afterwards the page reads the loop
// closed, and when, from the line in that parent — and says so plainly when
// the state has moved since, offering to close it again. A Hypothesis with
// nothing behind it says once, quietly, that there is nothing to write back
// to; a parent that does not resolve is a line with the reason.

const PATH = "hypotheses/The pooled effect is mostly small-study bias.md";
const HASH =
  "#/hypothesis/hypotheses/The%20pooled%20effect%20is%20mostly%20small-study%20bias.md";
const QUESTION = "questions/Does the reanalysis shrink the pooled effect.md";

type Readable = Extract<HypothesisPage, { readable: true }>;

const falsified: Derivation = {
  state: "falsified",
  effective: "falsified",
  override: null,
  clause: "falsifyingMet",
  named: ["F2"],
  unlanded: ["F2"],
  census: { met: 2, notMet: 0, inconclusive: 0, awaiting: 0 },
};

const page = (loop: Loop): Readable => ({
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: {
    context: "other",
    tags: [],
    promotedFrom: "[[Does the reanalysis shrink the pooled effect]]",
  },
  sections: {
    claim: {
      present: true,
      text: "The pooled effect is mostly small-study bias.",
    },
    criteria: { present: true, criteria: [] },
    designNotes: { present: true, text: "" },
    positionHistory: { present: true, text: "", entries: [] },
  },
  derivation: falsified,
  overridable: false,
  loop,
  problems: [],
});

const parent = { path: QUESTION, kind: "question" as const };

const open = (
  current: () => HypothesisPage,
  more: Record<string, unknown> = {}
) => {
  window.location.hash = HASH;
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "hypotheses.page": current,
    "picker.candidates": { rows: [], total: 0 },
    ...more,
  });
};

const loopRegion = () => screen.findByRole("region", { name: "The loop" });

describe("closing the loop", () => {
  it("is offered when the state is closable, and writes the result to the parent", async () => {
    let current = page({
      status: "open",
      parent,
      closable: true,
      result: "falsified",
    });
    const closeLoop = vi.fn(() => {
      current = page({
        status: "closed",
        parent,
        closable: true,
        result: "falsified",
        written: { result: "falsified", date: "2026-09-30" },
      });
      return { path: QUESTION };
    });
    open(() => current, { "hypotheses.closeLoop": closeLoop });

    const loop = await loopRegion();
    fireEvent.click(
      within(loop).getByRole("button", {
        name: "close the loop — write falsified to Does the reanalysis shrink the pooled effect",
      })
    );

    await waitFor(() =>
      expect(closeLoop).toHaveBeenCalledWith({ path: PATH, basedOn: "abc" })
    );
    expect(
      await within(loop).findByText(
        "loop closed — falsified, written to Does the reanalysis shrink the pooled effect on 30 September 2026"
      )
    ).toBeTruthy();
    expect(within(loop).queryByRole("button")).toBeNull();
  });

  it("is not offered while something still awaits evidence", async () => {
    open(() =>
      page({ status: "open", parent, closable: false, result: "inconclusive" })
    );
    const loop = await loopRegion();
    expect(within(loop).queryByRole("button")).toBeNull();
  });

  it("says when the written line no longer matches, and closes again by appending", async () => {
    const closeLoop = vi.fn(() => ({ path: QUESTION }));
    open(
      () =>
        page({
          status: "closed",
          parent,
          closable: true,
          result: "supported",
          written: { result: "falsified", date: "2026-09-30" },
        }),
      { "hypotheses.closeLoop": closeLoop }
    );

    const loop = await loopRegion();
    expect(
      within(loop).getByText(
        "the line written to Does the reanalysis shrink the pooled effect on 30 September 2026 says falsified; the state is now supported, so it no longer matches"
      )
    ).toBeTruthy();
    fireEvent.click(
      within(loop).getByRole("button", {
        name: "close the loop again — append supported",
      })
    );
    await waitFor(() => expect(closeLoop).toHaveBeenCalled());
  });

  it("shows the core's refusal as a line on the page", async () => {
    const closeLoop = vi.fn(() => {
      throw new Error(
        "questions/Does the reanalysis shrink the pooled effect.md changed on disk"
      );
    });
    open(
      () =>
        page({ status: "open", parent, closable: true, result: "falsified" }),
      { "hypotheses.closeLoop": closeLoop }
    );

    const loop = await loopRegion();
    fireEvent.click(within(loop).getByRole("button"));

    expect(
      await within(loop).findByText(
        /could not close the loop: .*changed on disk/
      )
    ).toBeTruthy();
  });
});

describe("no one to write back to", () => {
  it("says once and quietly that a Hypothesis written directly has nothing to write back to", async () => {
    open(() => page({ status: "none", closable: true, result: "falsified" }));
    const loop = await loopRegion();
    expect(
      within(loop).getByText(
        "written directly — there is nothing to write back to"
      )
    ).toBeTruthy();
    expect(within(loop).queryByRole("button")).toBeNull();
    expect(screen.getAllByText(/nothing to write back to/)).toHaveLength(1);
  });

  it("gives the reason when the parent does not resolve", async () => {
    open(() =>
      page({
        status: "unresolved",
        reason:
          "[[Does the reanalysis shrink the pooled effect]] matches more than one file",
        closable: true,
        result: "falsified",
      })
    );
    const loop = await loopRegion();
    expect(
      within(loop).getByText(
        "cannot write back: [[Does the reanalysis shrink the pooled effect]] matches more than one file"
      )
    ).toBeTruthy();
    expect(within(loop).queryByRole("button")).toBeNull();
  });
});
