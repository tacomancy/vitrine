import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  ExperimentListing,
  ExperimentPage,
  ListedExperiment,
  Question,
  RelatedQuestion,
} from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, pressCaptureChord, renderApp, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// A question captured from a run (#373; spec #362 stories 68–72; CAP-6):
// ⌘' on an Experiment page and `Q` in the Experiment Inbox both open the
// one Capture line with the run as its Provenance — `observing` — and the
// page lists the Questions that name it.

const PATH = "experiments/bayes-sceptic/bayes-sceptic.md";

const page = (
  questions: RelatedQuestion[] = []
): Extract<ExperimentPage, { readable: true }> => ({
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: {
    name: "bayes-sceptic",
    status: "complete",
    statusUnreadable: null,
    tags: [],
  },
  sections: {
    purpose: { present: true, text: "" },
    design: { present: true, text: "" },
    whereItRan: { present: true, text: "", lines: [] },
    artifacts: { present: true, text: "", items: [], inFolder: [] },
    observations: { present: true, text: "Four share a first author." },
    positionHistory: { present: true, text: "", entries: [] },
  },
  cameFrom: null,
  evidence: [],
  questions,
  problems: [],
});

const RUN: ListedExperiment = {
  path: PATH,
  hash: "hash-bayes-sceptic",
  name: "bayes-sceptic",
  status: "complete",
  statusUnreadable: null,
  purpose: "Find out how far the harmonisation delta moves.",
  when: "2026-09-21T10:00:00+02:00",
  artifacts: 0,
  firstArtifact: null,
  whereItRan: [],
  project: null,
  reading: "read",
};

const listing: ExperimentListing = {
  runs: 1,
  projects: [],
  experiments: [RUN],
  unreadable: [],
};

const captured = (text: string): Question => ({
  id: "q000000009",
  path: `questions/${text}.md`,
  question: text,
  status: "open",
  captured: "2026-09-30T10:00:00+05:30",
  from: "[[bayes-sceptic]]",
  context: "observing",
});

function open(hash: string, more: Record<string, unknown> = {}) {
  window.location.hash = hash;
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "looseEnds.rows": { groups: [], problems: [] },
    "experiments.inbox": listing,
    "experiments.page": () => page(),
    ...more,
  });
}

function write(text: string) {
  const input = screen.getByRole("textbox", { name: "Question" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("⌘' on an Experiment page", () => {
  it("resolves the Provenance to the run before a character is typed, and writes it as `observing`", async () => {
    const capture = vi.fn(({ text }: { text: string }) => captured(text));
    open(`#/experiment/${PATH}`, { "questions.capture": capture });
    await screen.findByRole("region", { name: "Experiment view" });

    pressCaptureChord();
    expect(screen.getByRole("form", { name: "Capture" }).textContent).toContain(
      "Observing · bayes-sceptic"
    );
    write("Does a shared first author matter?");

    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith({
        text: "Does a shared first author matter?",
        provenance: { context: "observing", experiment: PATH },
      })
    );
  });
});

describe("the Questions the Experiment page lists", () => {
  it("names each Question that names the run, opening it, with how it came to", async () => {
    open(`#/experiment/${PATH}`, {
      "experiments.page": () =>
        page([
          {
            path: "questions/Does a shared first author matter.md",
            question: "Does a shared first author matter?",
            status: "open",
            context: "observing",
            captured: "2026-09-23T09:00:00+05:30",
          },
          {
            path: "questions/Named by hand.md",
            question: "Named by hand?",
            status: "answered",
            context: "other",
            captured: "2026-09-22T09:00:00+05:30",
          },
        ]),
    });
    const rail = await screen.findByRole("complementary", {
      name: "About this run",
    });
    const section = await within(rail).findByRole("region", {
      name: "Questions from this run",
    });

    expect(
      within(section)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual([
      "Does a shared first author matter?question · captured from this run",
      "Named by hand?question · names this run · answered",
    ]);
    expect(
      within(section)
        .getByRole("link", { name: "Does a shared first author matter?" })
        .getAttribute("href")
    ).toBe(
      "#/question/questions/Does%20a%20shared%20first%20author%20matter.md"
    );
  });

  it("says what would go there when nothing names the run", async () => {
    open(`#/experiment/${PATH}`);
    const rail = await screen.findByRole("complementary", {
      name: "About this run",
    });
    const section = await within(rail).findByRole("region", {
      name: "Questions from this run",
    });

    expect(section.textContent).toContain("None yet.");
  });
});

describe("Q in the Experiment Inbox", () => {
  async function chooseRun() {
    const region = await screen.findByRole("region", { name: "Experiments" });
    const box = within(region).getByRole("listbox", { name: "Experiments" });
    await within(box).findAllByRole("option");
    fireEvent.keyDown(box, { key: "j" });
    return box;
  }

  it("opens the Capture line on the chosen run, writes it as `observing`, and gives the keyboard back to the list", async () => {
    const capture = vi.fn(({ text }: { text: string }) => captured(text));
    open("#/experiments", { "questions.capture": capture });
    const box = await chooseRun();
    box.focus();

    fireEvent.keyDown(box, { key: "Q", shiftKey: true });
    const line = screen.getByRole("form", { name: "Capture" });
    expect(line.textContent).toContain("Observing · bayes-sceptic");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Question" })
      )
    );
    write("Why does the delta stall at 0.4?");

    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith({
        text: "Why does the delta stall at 0.4?",
        provenance: { context: "observing", experiment: PATH },
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "Capture" })).toBeNull()
    );
    expect(document.activeElement).toBe(box);
    // Captured from the Inbox, it stays on the Inbox.
    expect(window.location.hash).toBe("#/experiments");
  });

  it("leaves ⌘' on the Inbox Unattached: only Q names a run", async () => {
    open("#/experiments");
    await chooseRun();

    pressCaptureChord();

    expect(screen.getByRole("form", { name: "Capture" }).textContent).toContain(
      "Unattached"
    );
  });

  it("offers the capture in the detail pane and the key hints too", async () => {
    open("#/experiments");
    await chooseRun();
    const detail = screen.getByRole("complementary", { name: "This run" });

    fireEvent.click(
      within(detail).getByRole("button", {
        name: "Capture a question from it",
      })
    );

    expect(screen.getByRole("form", { name: "Capture" }).textContent).toContain(
      "Observing · bayes-sceptic"
    );
    expect(
      screen.getByRole("region", { name: "Experiments" }).textContent
    ).toContain("Q capture");
  });
});
