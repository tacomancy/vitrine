import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  CriteriaToAttach,
  ExperimentListing,
  ExperimentPage,
  ListedExperiment,
  VaultStatus,
  WriteResult,
} from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, scrollsInto, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Experiment Inbox (#372; spec #362 stories 56–67; prototype 05's
// third panel): the surface's default view, its facets and sorts, the
// keyboard list, the detail pane, and O / E / D. No count of runs waiting
// and no red (HOLD-5, HOLD-6): the one number is how many runs exist.

const path = (name: string) => `experiments/${name}/${name}.md`;

const listed = (
  name: string,
  more: Partial<ListedExperiment> = {}
): ListedExperiment => ({
  path: path(name),
  hash: `hash-${name}`,
  name,
  status: "complete",
  statusUnreadable: null,
  purpose: `Find out what ${name} shows.`,
  when: "2026-09-21T10:00:00+02:00",
  artifacts: 0,
  firstArtifact: null,
  whereItRan: [],
  project: null,
  reading: "not yet read",
  ...more,
});

const SWEEP = listed("bayes-sceptic", {
  purpose: "Find out how far the harmonisation delta moves.",
  artifacts: 3,
  firstArtifact: {
    kind: "stored",
    file: "pooled-summary.csv",
    caption: "the pooled rows",
    path: "experiments/bayes-sceptic/pooled-summary.csv",
    size: 2048,
    image: false,
    rows: true,
  },
  whereItRan: [
    { label: "repo", value: "eeg-pipeline" },
    { label: "commit", value: "acc0f1" },
  ],
  project: "eeg-pipeline",
});
const PARITY = listed("v2-parity", {
  artifacts: 1,
  reading: "read",
  when: "2026-09-14T10:00:00+02:00",
});

const listing = (
  experiments: ListedExperiment[],
  more: Partial<ExperimentListing> = {}
): ExperimentListing => ({
  runs: 142,
  projects: ["eeg-pipeline", "nap-reanalysis"],
  experiments,
  unreadable: [],
  ...more,
});

const well: VaultStatus = {
  indexing: null,
  watching: { ok: true, since: "2026-09-19T08:00:00Z" },
  current: { ok: true },
};

const written = (hash = "def"): WriteResult => ({
  written: true,
  hash,
  content: "",
  shape: [],
});

const planned: Extract<ExperimentPage, { readable: true }> = {
  readable: true,
  path: SWEEP.path,
  hash: "abc",
  frontmatter: {
    name: SWEEP.name,
    status: "complete",
    statusUnreadable: null,
    tags: [],
  },
  sections: {
    purpose: { present: true, text: SWEEP.purpose },
    design: { present: true, text: "" },
    whereItRan: { present: true, text: "", lines: [] },
    artifacts: { present: true, text: "", items: [], inFolder: [] },
    observations: { present: true, text: "" },
    positionHistory: { present: true, text: "", entries: [] },
  },
  cameFrom: null,
  evidence: [],
  questions: [],
  problems: [],
};

function open(
  answer: ExperimentListing | ((input: unknown) => ExperimentListing),
  more: Record<string, unknown> = {}
) {
  window.location.hash = "#/experiments";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": well,
    "looseEnds.rows": { groups: [], problems: [] },
    "experiments.inbox": answer,
    "experiments.artifactPreview": {
      lines: ["set,k,d", "all,41,0.44"],
      more: false,
    },
    ...more,
  });
}

async function surface() {
  return screen.findByRole("region", { name: "Experiments" });
}

async function list() {
  const region = await surface();
  const box = within(region).getByRole("listbox", { name: "Experiments" });
  await within(box).findAllByRole("option");
  return box;
}

const chosen = (box: HTMLElement) =>
  document.getElementById(box.getAttribute("aria-activedescendant") ?? "");

describe("the Experiment Inbox", () => {
  it("opens on the Inbox, newest first, each row saying what the run is", async () => {
    const asked: unknown[] = [];
    open((input) => {
      asked.push(input);
      return listing([SWEEP, PARITY]);
    });
    const box = await list();
    expect(asked[0]).toEqual({ facet: "inbox", sort: "newest" });
    const [first, second] = within(box).getAllByRole("option");
    expect(first!.textContent).toContain("bayes-sceptic");
    expect(first!.textContent).toContain(
      "Find out how far the harmonisation delta moves."
    );
    expect(first!.textContent).toContain("3 items");
    expect(first!.textContent).toContain("not yet read");
    expect(second!.textContent).toContain("1 item");
    expect(second!.textContent).toContain("read");
    // Its age, in the neutral voice every age in the app takes.
    expect(first!.textContent).toMatch(/\d+(d|mo|y)|today/);
  });

  it("puts one number in the chrome: how many runs exist", async () => {
    open(listing([SWEEP, PARITY]));
    const region = await surface();
    await list();
    const header = region.querySelector("header")!;
    expect(header.textContent).toContain("142 runs");
    expect(header.textContent.match(/\d+/g)).toEqual(["142"]);
    const facets = within(region).getByRole("navigation", { name: "Views" });
    expect(facets.textContent).not.toMatch(/\d/);
  });

  it("switches to the Inbox's two halves, and to every run by status", async () => {
    const asked: unknown[] = [];
    open((input) => {
      asked.push(input);
      return listing([SWEEP]);
    });
    const region = await surface();
    await list();
    const facets = within(region).getByRole("navigation", { name: "Views" });
    const click = async (name: string) => {
      fireEvent.click(within(facets).getByRole("button", { name }));
      await waitFor(() => expect(asked.length).toBeGreaterThan(0));
      return asked.at(-1);
    };
    expect(await click("not yet interpreted")).toEqual({
      facet: "not-yet-interpreted",
      sort: "newest",
    });
    expect(await click("read, unattached")).toEqual({
      facet: "read-unattached",
      sort: "newest",
    });
    expect(await click("planned")).toEqual({
      facet: "status",
      status: "planned",
      sort: "newest",
    });
    expect(await click("every run")).toEqual({
      facet: "status",
      sort: "newest",
    });
    expect(
      within(facets)
        .getByRole("button", { name: "every run" })
        .getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("narrows by project, and offers no project facet when no run names one", async () => {
    const asked: unknown[] = [];
    open((input) => {
      asked.push(input);
      return listing([SWEEP]);
    });
    const region = await surface();
    await list();
    const facets = within(region).getByRole("navigation", { name: "Views" });
    fireEvent.click(
      within(facets).getByRole("button", { name: "eeg-pipeline" })
    );
    await waitFor(() =>
      expect(asked.at(-1)).toEqual({
        facet: "inbox",
        project: "eeg-pipeline",
        sort: "newest",
      })
    );
    cleanup();
    open(listing([SWEEP], { projects: [] }));
    const again = await surface();
    await list();
    expect(within(again).queryByText("Project")).toBeNull();
    expect(
      within(again).queryByRole("button", { name: "all projects" })
    ).toBeNull();
  });

  it("sorts by newest, oldest, most artifacts, or a shuffle", async () => {
    const asked: { sort?: string; seed?: number }[] = [];
    open((input) => {
      asked.push(input as { sort?: string });
      return listing([SWEEP]);
    });
    const region = await surface();
    await list();
    const sort = within(region).getByRole("group", { name: "Sort" });
    for (const name of ["oldest", "most artifacts", "newest"]) {
      fireEvent.click(within(sort).getByRole("button", { name }));
    }
    fireEvent.click(within(sort).getByRole("button", { name: "shuffle" }));
    await waitFor(() => expect(asked.at(-1)?.sort).toBe("shuffle"));
    // A view returned to is re-read, so each sort is asked for at least once.
    expect([...new Set(asked.map((a) => a.sort))]).toEqual([
      "newest",
      "oldest",
      "most-artifacts",
      "shuffle",
    ]);
    expect(typeof asked.at(-1)?.seed).toBe("number");
  });

  it("moves with j/k, keeping the choice in view, and shows it in the detail pane", async () => {
    open(listing([SWEEP, PARITY]));
    const box = await list();
    const scrolled = scrollsInto();
    const options = within(box).getAllByRole("option");
    fireEvent.keyDown(box, { key: "j" });
    expect(chosen(box)).toBe(options[0]);
    fireEvent.keyDown(box, { key: "j" });
    expect(chosen(box)).toBe(options[1]);
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(scrolled.at(-1)).toEqual({ row: options[1], block: "nearest" });
    fireEvent.keyDown(box, { key: "k" });
    expect(chosen(box)).toBe(options[0]);
    const detail = screen.getByRole("complementary", { name: "This run" });
    expect(detail.textContent).toContain("pooled-summary.csv");
    expect(detail.textContent).toContain("the pooled rows");
    // Its first rows, as the page draws a CSV (#368).
    expect(await within(detail).findByText(/all,41,0.44/)).toBeDefined();
    expect(detail.textContent).toContain("repo");
    expect(detail.textContent).toContain("eeg-pipeline");
    expect(detail.textContent).toContain("acc0f1");
  });

  it("O opens the run's page with the keyboard in Observations", async () => {
    open(listing([SWEEP]), { "experiments.page": () => planned });
    const box = await list();
    fireEvent.keyDown(box, { key: "j" });
    fireEvent.keyDown(box, { key: "O", shiftKey: true });
    await waitFor(() =>
      expect(window.location.hash).toBe(`#/experiment/${SWEEP.path}`)
    );
    const observations = await screen.findByRole("textbox", {
      name: "Observations",
    });
    await waitFor(() => expect(document.activeElement).toBe(observations));
  });

  it("E opens attach as evidence for the chosen run", async () => {
    const asked: unknown[] = [];
    const criteria: CriteriaToAttach = {
      groups: [
        {
          path: "hypotheses/H.md",
          claim: "The effect shrinks.",
          hash: "h1",
          criteria: [
            {
              id: "c1",
              label: "F1",
              text: "The effect survives",
              relationship: "falsifying",
              outcome: null,
            },
          ],
        },
      ],
      problems: [],
    };
    open(listing([SWEEP, PARITY]), {
      "experiments.criteria": criteria,
      "experiments.attachEvidence": (input: unknown) => {
        asked.push(input);
        return { ...written(), revision: null };
      },
    });
    const box = await list();
    fireEvent.keyDown(box, { key: "j" });
    fireEvent.keyDown(box, { key: "j" });
    fireEvent.keyDown(box, { key: "e" });
    const dialog = await screen.findByRole("dialog", {
      name: "Attach as evidence",
    });
    const criteriaList = within(dialog).getByRole("listbox");
    await within(criteriaList).findAllByRole("option");
    fireEvent.keyDown(criteriaList, { key: "Enter" });
    const note = await screen.findByRole("textbox", {
      name: "What this run shows for F1",
    });
    fireEvent.change(note, { target: { value: "it did not move" } });
    fireEvent.keyDown(note, { key: "Enter" });
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toMatchObject({
      hypothesis: "hypotheses/H.md",
      criterion: "c1",
      experiment: PARITY.path,
      note: "it did not move",
    });
  });

  it("D abandons the chosen run by its status, based on the read it was listed from", async () => {
    const asked: unknown[] = [];
    open(listing([SWEEP, PARITY]), {
      "experiments.setStatus": (input: unknown) => {
        asked.push(input);
        return written();
      },
    });
    const box = await list();
    fireEvent.keyDown(box, { key: "j" });
    fireEvent.keyDown(box, { key: "d" });
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toEqual({
      path: SWEEP.path,
      status: "abandoned",
      basedOn: SWEEP.hash,
    });
  });

  it("D does nothing to a run already abandoned, as the pane offers nothing", async () => {
    const asked: unknown[] = [];
    open(listing([listed("gone", { status: "abandoned" })]), {
      "experiments.setStatus": (input: unknown) => {
        asked.push(input);
        return written();
      },
    });
    const box = await list();
    fireEvent.keyDown(box, { key: "j" });
    fireEvent.keyDown(box, { key: "d" });
    const detail = screen.getByRole("complementary", { name: "This run" });
    expect(
      within(detail).queryByRole("button", { name: "Abandon" })
    ).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toEqual([]);
  });

  it("says a refused D on its row, as a refusal of the key just pressed", async () => {
    open(listing([SWEEP]), {
      "experiments.setStatus": () => {
        throw new Error("the file changed underneath");
      },
    });
    const box = await list();
    fireEvent.keyDown(box, { key: "j" });
    fireEvent.keyDown(box, { key: "d" });
    const row = within(box).getAllByRole("option")[0]!;
    expect((await within(row).findByRole("alert")).textContent).toBe(
      "could not abandon it: the file changed underneath"
    );
  });

  it("lets go of a project no run names any more", async () => {
    const asked: { project?: string }[] = [];
    let projects = ["eeg-pipeline"];
    const { stream } = open((input) => {
      asked.push(input as { project?: string });
      return listing([SWEEP], { projects });
    });
    const region = await surface();
    await list();
    const facets = within(region).getByRole("navigation", { name: "Views" });
    fireEvent.click(
      within(facets).getByRole("button", { name: "eeg-pipeline" })
    );
    await waitFor(() => expect(asked.at(-1)?.project).toBe("eeg-pipeline"));
    projects = [];
    stream.push({
      type: "vaultChanged",
      changed: [],
      removed: [],
      renamed: [],
    });
    await waitFor(() => expect(asked.at(-1)?.project).toBeUndefined());
  });

  it("offers O, E and D in the detail pane too", async () => {
    open(listing([SWEEP]));
    const box = await list();
    fireEvent.keyDown(box, { key: "j" });
    const detail = screen.getByRole("complementary", { name: "This run" });
    for (const name of [
      "Write observations",
      "Attach to a criterion",
      "Abandon",
    ]) {
      expect(within(detail).getByRole("button", { name })).toBeDefined();
    }
  });

  it("claims an empty Inbox with its warrant, in a vault read in full", async () => {
    open(listing([], { runs: 4 }));
    const region = await surface();
    expect(
      (
        await within(region).findByText(
          "No complete run is unread or unattached."
        )
      ).parentElement!.textContent
    ).toContain("read in full · watching");
  });

  it("says not known, never empty, when the listing failed", async () => {
    open(() => {
      throw new Error("No vault is open.");
    });
    const region = await surface();
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain("No complete run");
    expect(region.querySelector("header")!.textContent).not.toMatch(/\d/);
  });

  it("keeps the line that makes a run by name", async () => {
    open(listing([]));
    const region = await surface();
    expect(within(region).getByRole("textbox", { name: "Name" })).toBeDefined();
  });
});
