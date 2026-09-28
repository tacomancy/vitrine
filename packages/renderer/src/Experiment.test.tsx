import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  Destinations,
  ExperimentPage,
  HypothesisPage,
  WriteResult,
} from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, pressGlobalChord, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Experiment made by name and its page (#364; spec #362 stories 1–6,
// 9–12, 17–21, 25, 79–80; prototype 05's "designed, not yet run" panel).

const PATH = "experiments/leave-one-lab-out/leave-one-lab-out.md";
const HASH = "#/experiment/experiments/leave-one-lab-out/leave-one-lab-out.md";

type Readable = Extract<ExperimentPage, { readable: true }>;

const planned: Readable = {
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: {
    id: "ex4k8m2p9q",
    name: "leave-one-lab-out",
    status: "planned",
    statusUnreadable: null,
    created: "2026-09-17T10:00:00+02:00",
    tags: [],
  },
  sections: {
    purpose: { present: true, text: "" },
    design: { present: true, text: "" },
    whereItRan: { present: true, text: "", lines: [] },
    artifacts: { present: true, text: "", items: [] },
    observations: { present: true, text: "" },
    positionHistory: { present: true, text: "", entries: [] },
  },
  cameFrom: null,
  problems: [],
};

const written = (hash = "def"): WriteResult => ({
  written: true,
  hash,
  content: "",
  shape: [],
});

const well = { indexing: null, watching: { ok: true }, current: { ok: true } };

const answers = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": well,
  "looseEnds.rows": { groups: [], problems: [] },
};

/** The page, once its read has landed: the status chips are the first thing drawn from it. */
async function region() {
  const page = await screen.findByRole("region", { name: "Experiment view" });
  await within(page).findByRole("radiogroup", { name: "Status" });
  return page;
}

function open(page: () => ExperimentPage, more: Record<string, unknown> = {}) {
  window.location.hash = HASH;
  return renderApp({ ...answers, "experiments.page": page, ...more });
}

function railEntry(name: string): HTMLElement {
  const nav = screen.getByRole("navigation", { name: "Surfaces" });
  const found = within(nav)
    .getAllByRole("listitem")
    .find((li) => li.textContent?.startsWith(name));
  if (!found) throw new Error(`no rail entry ${name}`);
  return found;
}

describe("making an Experiment on its surface", () => {
  it("types a short name, lands on the page, and leaves the keyboard in Purpose", async () => {
    window.location.hash = "#/experiments";
    const made: unknown[] = [];
    renderApp({
      ...answers,
      "experiments.create": (input: unknown) => {
        made.push(input);
        return { path: PATH };
      },
      "experiments.page": () => planned,
    });
    const surface = await screen.findByRole("region", {
      name: "Experiments",
    });
    const name = within(surface).getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "leave-one-lab-out" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await region();
    expect(made).toEqual([{ name: "leave-one-lab-out" }]);
    expect(window.location.hash).toBe(HASH);
    const purpose = await screen.findByRole("textbox", { name: "Purpose" });
    await waitFor(() => expect(document.activeElement).toBe(purpose));
  });

  it("leaves the keyboard with the page on any other arrival, purpose written or not", async () => {
    open(() => planned);
    const page = await region();
    await screen.findByRole("textbox", { name: "Purpose" });
    await waitFor(() => expect(document.activeElement).toBe(page));
  });

  it("shows a refused name's reason on the line and keeps the typing", async () => {
    window.location.hash = "#/experiments";
    renderApp({
      ...answers,
      "experiments.create": () => {
        throw new Error(
          "An Experiment named sweep-7 is already in the vault; the name is its folder, so pick another."
        );
      },
    });
    const surface = await screen.findByRole("region", {
      name: "Experiments",
    });
    const name = within(surface).getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "sweep-7" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect((await within(surface).findByRole("status")).textContent).toContain(
      "already in the vault"
    );
    expect((name as HTMLInputElement).value).toBe("sweep-7");
    expect(window.location.hash).toBe("#/experiments");
  });

  it("lights the rail's Experiment view on the surface and on a page", async () => {
    window.location.hash = "#/experiments";
    renderApp(answers);
    await screen.findByRole("region", { name: "Experiments" });
    const onSurface = within(railEntry("Experiment view")).getByRole("link");
    expect(onSurface.getAttribute("aria-current")).toBe("page");
    cleanup();

    open(() => planned);
    await region();
    const onPage = within(railEntry("Experiment view")).getByRole("link");
    expect(onPage.getAttribute("aria-current")).toBe("page");
    expect(onPage.getAttribute("href")).toBe(HASH);
  });
});

describe("the page of a run designed but not yet run", () => {
  it("draws the name, Purpose and Design, and says what the empty regions will hold", async () => {
    open(() => planned);
    const page = await region();
    expect(within(page).getByText("leave-one-lab-out")).toBeTruthy();
    for (const name of ["Design", "Artifacts", "Observations"]) {
      const section = within(page).getByRole("region", { name });
      const sentence = within(section).getByText(/\.\s*$/);
      // A sentence on what belongs there, not a blank — a planned run is a
      // finished plan (TEST-9).
      expect(sentence.textContent?.length).toBeGreaterThan(30);
    }
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });

  it("shows four status chips, the file's checked, captioned as the user's own call", async () => {
    open(() => planned);
    const page = await region();
    const status = within(page).getByRole("radiogroup", { name: "Status" });
    const chips = within(status).getAllByRole<HTMLInputElement>("radio");
    expect(chips.map((c) => c.value)).toEqual([
      "planned",
      "running",
      "complete",
      "abandoned",
    ]);
    expect(chips.map((c) => c.checked)).toEqual([true, false, false, false]);
    expect(page.textContent).toContain(
      "you set this — the app never changes it"
    );
  });

  it("sets the status with one write, based on the page's read", async () => {
    const asked: unknown[] = [];
    open(() => planned, {
      "experiments.setStatus": (input: unknown) => {
        asked.push(input);
        return written();
      },
    });
    const page = await region();
    fireEvent.click(within(page).getByRole("radio", { name: "running" }));
    await waitFor(() =>
      expect(asked).toEqual([{ path: PATH, status: "running", basedOn: "abc" }])
    );
  });

  it("checks no chip for a status outside the four, and says what the file holds", async () => {
    open(() => ({
      ...planned,
      frontmatter: {
        ...planned.frontmatter,
        status: null,
        statusUnreadable: "done",
      },
    }));
    const page = await region();
    const chips = within(page).getAllByRole<HTMLInputElement>("radio");
    expect(chips.some((c) => c.checked)).toBe(false);
    expect(page.textContent).toContain("status unreadable: done");
  });

  it("saves Purpose on blur with the section as read, and no why line is offered", async () => {
    const saved: unknown[] = [];
    open(() => planned, {
      "experiments.saveSection": (input: unknown) => {
        saved.push(input);
        return written();
      },
    });
    await region();
    const purpose = await screen.findByRole("textbox", { name: "Purpose" });
    fireEvent.focus(purpose);
    expect(screen.queryByText(/save with a note/)).toBeNull();
    fireEvent.change(purpose, {
      target: { value: "See whether the four matter at all." },
    });
    fireEvent.blur(purpose);
    await waitFor(() =>
      expect(saved).toEqual([
        {
          path: PATH,
          section: "Purpose",
          body: "See whether the four matter at all.",
          basedOn: "abc",
          was: "",
        },
      ])
    );
  });

  it("saves where it ran as the user's own label: value lines", async () => {
    const saved: unknown[] = [];
    open(() => planned, {
      "experiments.saveSection": (input: unknown) => {
        saved.push(input);
        return written();
      },
    });
    await region();
    const where = await screen.findByRole("textbox", { name: "Where it ran" });
    fireEvent.change(where, {
      target: { value: "repo: nap-reanalysis\nnotebook: loo.ipynb" },
    });
    fireEvent.blur(where);
    await waitFor(() =>
      expect(saved).toEqual([
        {
          path: PATH,
          section: "Where it ran",
          body: "repo: nap-reanalysis\nnotebook: loo.ipynb",
          basedOn: "abc",
          was: "",
        },
      ])
    );
  });

  it("draws where it ran as the user's labels and values, and edits it as lines", async () => {
    const text = "repo: nap-reanalysis\ncommit: 8c41f0d\nhttps://wandb.ai/x";
    const saved: unknown[] = [];
    open(
      () => ({
        ...planned,
        sections: {
          ...planned.sections,
          whereItRan: {
            present: true,
            text,
            lines: [
              { label: "repo", value: "nap-reanalysis" },
              { label: "commit", value: "8c41f0d" },
              { label: null, value: "https://wandb.ai/x" },
            ],
          },
        },
      }),
      {
        "experiments.saveSection": (input: unknown) => {
          saved.push(input);
          return written();
        },
      }
    );
    const page = await region();
    const where = within(page).getByRole("region", { name: "Where it ran" });
    expect(
      within(where)
        .getAllByRole("term")
        .map((t) => t.textContent)
    ).toEqual(["repo", "commit"]);
    expect(
      within(where)
        .getAllByRole("definition")
        .map((d) => d.textContent)
    ).toEqual(["nap-reanalysis", "8c41f0d", "https://wandb.ai/x"]);
    expect(within(where).queryByRole("textbox")).toBeNull();

    fireEvent.click(within(where).getByRole("button", { name: "edit" }));
    const field = within(where).getByRole("textbox", { name: "Where it ran" });
    expect((field as HTMLTextAreaElement).value).toBe(text);
    expect(document.activeElement).toBe(field);
    // esc with nothing typed puts the lines back.
    fireEvent.keyDown(field, { key: "Escape" });
    expect(within(where).queryByRole("textbox")).toBeNull();

    fireEvent.click(within(where).getByRole("button", { name: "edit" }));
    const again = within(where).getByRole("textbox", { name: "Where it ran" });
    fireEvent.change(again, { target: { value: `${text}\nout: out/` } });
    fireEvent.blur(again);
    await waitFor(() =>
      expect(saved).toEqual([
        {
          path: PATH,
          section: "Where it ran",
          body: `${text}\nout: out/`,
          basedOn: "abc",
          was: text,
        },
      ])
    );
    // Saved with no typing past it: the field closes on the lines.
    await waitFor(() =>
      expect(within(where).queryByRole("textbox")).toBeNull()
    );
  });

  it("shows the changed-on-disk line when the section moved underneath", async () => {
    open(() => planned, {
      "experiments.saveSection": (): WriteResult => ({
        written: false,
        reason: "changedAndUnreapplyable",
        detail: "the section changed on disk since the page read it",
      }),
    });
    await region();
    const purpose = await screen.findByRole("textbox", { name: "Purpose" });
    fireEvent.change(purpose, { target: { value: "Typed here." } });
    fireEvent.blur(purpose);
    expect(await screen.findByText("changed on disk")).toBeTruthy();
    expect((purpose as HTMLTextAreaElement).value).toBe("Typed here.");
  });

  it("names what it came from, and opens it", async () => {
    open(() => ({
      ...planned,
      cameFrom: {
        text: "[[Four of the 41 share a first author]]",
        path: "questions/Four of the 41 share a first author.md",
        kind: "question",
        display: "Four of the 41 share a first author — does that matter?",
      },
    }));
    const page = await region();
    const came = within(page).getByRole("region", { name: "Came from" });
    const link = within(came).getByRole("link", {
      name: "Four of the 41 share a first author — does that matter?",
    });
    expect(link.getAttribute("href")).toBe(
      "#/question/questions/Four%20of%20the%2041%20share%20a%20first%20author.md"
    );
  });

  it("draws no came-from region for a run nothing prompted", async () => {
    open(() => planned);
    const page = await region();
    expect(
      within(page).queryByRole("region", { name: "Came from" })
    ).toBeNull();
  });
});

describe("the Address", () => {
  it("lands on the Inbox naming an Address the vault cannot answer for", async () => {
    open(() => ({
      readable: false,
      path: PATH,
      reason: "missing from the vault",
    }));
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    await waitFor(() => expect(window.location.hash).toBe("#/inbox"));
    expect(inbox.textContent).toContain(HASH);
    expect(inbox.textContent).toContain("missing from the vault");
  });

  it("is reachable from ⌘K by name, with the Kind's glyph", async () => {
    renderApp({
      ...answers,
      "experiments.page": () => planned,
      "globalCommand.destinations": (): Destinations => ({
        rows: [
          { kind: "experiment", path: PATH, display: "leave-one-lab-out" },
        ],
        total: 1,
      }),
    });
    await screen.findByRole("banner");
    pressGlobalChord();
    const dialog = await screen.findByRole("dialog", {
      name: "Global command",
    });
    const box = within(dialog).getByRole("combobox");
    fireEvent.change(box, { target: { value: "leave-one-lab-out" } });
    // The capture row, last, carries the typing too; the destination leads.
    const [option] = await within(dialog).findAllByRole("option", {
      name: /leave-one-lab-out/,
    });
    expect(option?.textContent).toBe("▼leave-one-lab-outexperiment");
    fireEvent.keyDown(box, { key: "Enter" });
    await region();
    expect(window.location.hash).toBe(HASH);
  });
});

describe("the rail on an empty vault", () => {
  it("keeps the Experiment view's place hollow, with where runs come from, and still goes there", async () => {
    renderApp({ ...answers, "vault.kinds": [] });
    const nav = await screen.findByRole("navigation", { name: "Surfaces" });
    await within(nav).findByText("designed here, run elsewhere");
    const entry = railEntry("Experiment view");
    expect(entry.textContent).toBe(
      "Experiment view" + "designed here, run elsewhere"
    );
    // Unlike a page-only entry, this one has a surface to make a run on.
    expect(within(entry).getByRole("link").getAttribute("href")).toBe(
      "#/experiments"
    );
  });
});

describe("an Evidence line on a Hypothesis page", () => {
  it("links to the Experiment it names", async () => {
    const hypothesis: HypothesisPage = {
      readable: true,
      path: "hypotheses/h.md",
      hash: "h1",
      frontmatter: { context: "other", tags: [] },
      sections: {
        claim: { present: true, text: "The effect shrinks." },
        criteria: {
          present: true,
          criteria: [
            {
              id: "c1",
              label: "F1",
              text: "It shrinks under the rule",
              relationship: "falsifying",
              outcome: "met",
              outcomeUnreadable: null,
              evidence: [
                {
                  text: "[[leave-one-lab-out]] — nothing moved",
                  link: {
                    target: "leave-one-lab-out",
                    blockId: null,
                    resolution: "resolved",
                    resolvedPath: PATH,
                    resolvedKind: "experiment",
                    resolvedDisplay: "leave-one-lab-out",
                  },
                  note: "nothing moved",
                },
              ],
              editedAfterEvidence: [],
            },
          ],
        },
        designNotes: { present: true, text: "" },
        positionHistory: { present: true, text: "", entries: [] },
      },
      derivation: {
        state: "falsified",
        effective: "falsified",
        override: null,
        unlanded: [],
        clause: "falsifyingMet",
        named: ["F1"],
        census: { met: 1, notMet: 0, inconclusive: 0, awaiting: 0 },
      },
      overridable: false,
      loop: { status: "none", refusal: null, result: "falsified" },
      related: { promotedFrom: null, questions: [] },
      problems: [],
    };
    window.location.hash = "#/hypothesis/hypotheses/h.md";
    renderApp({ ...answers, "hypotheses.page": () => hypothesis });
    const page = await screen.findByRole("region", {
      name: "Hypothesis view",
    });
    const link = await within(page).findByRole("link", {
      name: "leave-one-lab-out",
    });
    expect(link.getAttribute("href")).toBe(HASH);
  });
});
