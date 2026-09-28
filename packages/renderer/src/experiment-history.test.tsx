import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ExperimentPage, Revision } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Design and Observations edited in place as Positions (#365; spec #362
// stories 13–16, 26): each a plain text field like a Hypothesis's claim —
// blur saves, ⌥↵ saves and opens a why — saved through the core, which
// records the Revision; the history trail beside them leads with explained
// revisions and collapses the rest into dates, and *+ why* writes onto a
// quiet one later.

const PATH = "experiments/leave-one-lab-out/leave-one-lab-out.md";
const HASH = "#/experiment/experiments/leave-one-lab-out/leave-one-lab-out.md";
const RECORDED = "2026-09-29T10:00:00+02:00";

type Readable = Extract<ExperimentPage, { readable: true }>;

const revision = (
  at: string,
  field: string,
  why: string | null = null
): Revision => ({ at, field, why, from: "" });

const page = (
  over: { design?: string; observations?: string; entries?: Revision[] } = {}
): Readable => ({
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: {
    id: "ex4k8m2p9q",
    name: "leave-one-lab-out",
    status: "complete",
    statusUnreadable: null,
    created: "2026-09-17T10:00:00+02:00",
    tags: [],
  },
  sections: {
    purpose: { present: true, text: "See whether one lab carries it." },
    design: { present: true, text: over.design ?? "Drop each lab in turn." },
    whereItRan: { present: true, text: "", lines: [] },
    artifacts: { present: true, text: "", items: [], inFolder: [] },
    observations: { present: true, text: over.observations ?? "" },
    positionHistory: { present: true, text: "…", entries: over.entries ?? [] },
  },
  cameFrom: null,
  evidence: [],
  questions: [],
  problems: [],
});

const saved = { written: true, hash: "def", shape: [], revision: RECORDED };

const open = (
  current: () => ExperimentPage,
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
    "looseEnds.rows": { groups: [], problems: [] },
    "experiments.page": current,
    "experiments.savePosition": () => saved,
    "picker.candidates": { rows: [], total: 0 },
    ...more,
  });
};

const region = () => screen.findByRole("region", { name: "Experiment view" });
const field = async (name: "Design" | "Observations") =>
  within(await region()).findByRole("textbox", { name });

describe("Design and Observations, edited as Positions", () => {
  it.each([
    ["Design", "design", "Drop each lab in turn."],
    ["Observations", "observations", ""],
  ] as const)(
    "blur saves %s as its own Position, with the hash and the text the page read",
    async (name, key, was) => {
      const save = vi.fn(() => saved);
      open(() => page(), { "experiments.savePosition": save });
      const box = await field(name);
      expect((box as HTMLTextAreaElement).value).toBe(was);
      fireEvent.change(box, { target: { value: "Held: the rule." } });
      fireEvent.blur(box);
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith({
          path: PATH,
          field: key,
          text: "Held: the rule.",
          basedOn: "abc",
          was,
        })
      );
    }
  );

  it("an empty Observations still says what belongs there", async () => {
    open(() => page());
    const section = await within(await region()).findByRole("region", {
      name: "Observations",
    });
    expect(section.textContent).toContain("interpretation changes");
  });

  it("⌥↵ saves and opens the line for why, which writes onto the Revision that save recorded", async () => {
    const explain = vi.fn(() => ({ written: true, hash: "ghi", shape: [] }));
    open(() => page(), { "experiments.explainRevision": explain });
    const box = await field("Design");
    fireEvent.change(box, { target: { value: "Drop each lab, and site." } });
    fireEvent.keyDown(box, { key: "Enter", altKey: true });

    const line = await screen.findByRole("textbox", { name: "Why" });
    fireEvent.change(line, { target: { value: "Two labs share a site." } });
    fireEvent.keyDown(line, { key: "Enter" });
    await waitFor(() =>
      expect(explain).toHaveBeenCalledWith({
        path: PATH,
        at: RECORDED,
        field: "design",
        why: "Two labs share a site.",
        basedOn: "def",
      })
    );
  });
});

describe("the history trail", () => {
  it("leads with explained revisions and collapses the quiet ones into dates", async () => {
    open(() =>
      page({
        entries: [
          revision("2026-09-29T11:00:00+02:00", "observations"),
          revision(
            "2026-09-29T10:00:00+02:00",
            "design",
            "Two labs share a site."
          ),
          revision("2026-09-28T10:00:00+02:00", "design"),
        ],
      })
    );
    const history = await within(await region()).findByRole("region", {
      name: "Position history",
    });
    expect(history.textContent).toContain("Two labs share a site.");
    // The quiet one either side of it is a trail of dates to open, not an
    // entry drawn in full.
    expect(
      within(history).getAllByRole("button", { name: /quiet/ })
    ).toHaveLength(2);
    expect(within(history).queryByRole("button", { name: "+ why" })).toBeNull();
  });

  it("+ why on a quiet entry writes through the Experiment's own procedure", async () => {
    const explain = vi.fn(() => ({ written: true, hash: "ghi", shape: [] }));
    open(
      () =>
        page({
          entries: [revision("2026-09-28T10:00:00+02:00", "observations")],
        }),
      { "experiments.explainRevision": explain }
    );
    const history = await within(await region()).findByRole("region", {
      name: "Position history",
    });
    fireEvent.click(
      await within(history).findByRole("button", { name: /quiet/ })
    );
    fireEvent.click(within(history).getByRole("button", { name: "+ why" }));
    const line = await screen.findByRole("textbox", { name: "Why" });
    fireEvent.change(line, { target: { value: "Read it again at n=40." } });
    fireEvent.keyDown(line, { key: "Enter" });
    await waitFor(() =>
      expect(explain).toHaveBeenCalledWith({
        path: PATH,
        at: "2026-09-28T10:00:00+02:00",
        field: "observations",
        why: "Read it again at n=40.",
        basedOn: "abc",
      })
    );
  });
});
