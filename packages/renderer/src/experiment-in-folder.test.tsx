import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  ArtifactLine,
  ExperimentPage,
  InFolderArtifact,
  WriteResult,
} from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

// A file in the run's folder with no line on the page, and a text Artifact
// drawn as its first rows (#368; spec #362 stories 36, 41–43; ADR 0035
// decision 3; prototype 05's `pooled-summary.csv` card): *in the folder, not
// on the page* with *show it here*, which asks for a caption and appends the
// line, and a CSV drawn as the lines `artifactPreview` answers.

const PATH = "experiments/prereg-exclusions/prereg-exclusions.md";
const FOLDER = "experiments/prereg-exclusions";
const HASH = `#/experiment/${PATH}`;

type Readable = Extract<ExperimentPage, { readable: true }>;

const pageWith = (
  items: ArtifactLine[],
  inFolder: InFolderArtifact[] = []
): Readable => ({
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: {
    id: "ex9q2w7m4k",
    name: "prereg-exclusions",
    status: "complete",
    statusUnreadable: null,
    created: "2026-09-09T10:00:00+02:00",
    tags: [],
  },
  sections: {
    purpose: { present: true, text: "See whether it survives." },
    design: { present: true, text: "" },
    whereItRan: { present: true, text: "", lines: [] },
    artifacts: { present: true, text: "", items, inFolder },
    observations: { present: true, text: "" },
    positionHistory: { present: true, text: "", entries: [] },
  },
  cameFrom: null,
  evidence: [],
  questions: [],
  problems: [],
});

const loss: InFolderArtifact = {
  kind: "inFolder",
  file: "loss.png",
  path: `${FOLDER}/loss.png`,
  size: 88_000,
  image: true,
  rows: false,
};

const summary: ArtifactLine = {
  kind: "stored",
  file: "pooled-summary.csv",
  caption: "The pooled rows.",
  path: `${FOLDER}/pooled-summary.csv`,
  size: 2_000,
  image: false,
  rows: true,
};

const written = (): WriteResult => ({
  written: true,
  hash: "def",
  content: "",
  shape: [],
});

const answers = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": {
    indexing: null,
    watching: { ok: true },
    current: { ok: true },
  },
  "looseEnds.rows": { groups: [], problems: [] },
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.vitrine = {
    port: 4242,
    token: "session-token",
    pathOf: (file: File) => `/Users/r/Desktop/${file.name}`,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(new Blob([new Uint8Array([137, 80, 78, 71])]))
      )
    )
  );
  URL.createObjectURL = vi.fn(() => "blob:vitrine/1");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(page: () => ExperimentPage, more: Record<string, unknown> = {}) {
  window.location.hash = HASH;
  return renderApp({ ...answers, "experiments.page": page, ...more });
}

async function artifacts() {
  const page = await screen.findByRole("region", { name: "Experiment view" });
  return within(page).findByRole("region", { name: "Artifacts" });
}

describe("in the folder, not on the page", () => {
  it("draws a file no line names after the lines, saying so, with show it here", async () => {
    open(() => pageWith([summary], [loss]), {
      "experiments.artifactPreview": () => ({ lines: ["a,b"], more: false }),
    });
    const section = await artifacts();

    const offered = await within(section).findByRole("list", {
      name: "In the folder, not on the page",
    });
    const card = within(offered).getByText("loss.png").closest("figure")!;
    expect(card.textContent).toContain(
      "88 KB · in the folder, not on the page"
    );
    // Drawn as it would be on the page, so it can be judged before it is shown.
    expect(await within(offered).findByRole("img")).toBeTruthy();
    within(offered).getByRole("button", { name: "show it here" });
    const text = section.textContent ?? "";
    expect(text.indexOf("pooled-summary.csv")).toBeLessThan(
      text.indexOf("loss.png")
    );
  });

  it("does not call a run with only such files empty", async () => {
    open(() => pageWith([], [loss]));
    const section = await artifacts();
    await within(section).findByText("loss.png");
    expect(section.textContent).not.toContain("Nothing yet.");
  });

  it("show it here asks for a caption, then appends the line and copies nothing", async () => {
    const shown: unknown[] = [];
    let page = pageWith([], [loss]);
    open(() => page, {
      "experiments.showArtifact": (input: unknown) => {
        shown.push(input);
        page = pageWith([
          { ...loss, kind: "stored", caption: "Loss by step." },
        ]);
        return written();
      },
      "experiments.addArtifact": () => {
        throw new Error("show it here never copies");
      },
    });
    const section = await artifacts();

    fireEvent.click(
      await within(section).findByRole("button", { name: "show it here" })
    );
    const form = await within(section).findByRole("form", {
      name: "Show it here",
    });
    const caption = within(form).getByRole("textbox", { name: "Caption" });
    await waitFor(() => expect(document.activeElement).toBe(caption));
    fireEvent.change(caption, { target: { value: "Loss by step." } });
    fireEvent.keyDown(caption, { key: "Enter" });

    await waitFor(() =>
      expect(shown).toEqual([
        { path: PATH, file: "loss.png", caption: "Loss by step." },
      ])
    );
    await waitFor(() =>
      expect(
        within(section).queryByRole("list", {
          name: "In the folder, not on the page",
        })
      ).toBeNull()
    );
    expect(section.textContent).toContain("Loss by step.");
  });

  it("esc on the caption shows nothing", async () => {
    const shown: unknown[] = [];
    open(() => pageWith([], [loss]), {
      "experiments.showArtifact": (input: unknown) => {
        shown.push(input);
        return written();
      },
    });
    const section = await artifacts();
    const button = await within(section).findByRole("button", {
      name: "show it here",
    });

    fireEvent.click(button);
    const caption = await within(section).findByRole("textbox", {
      name: "Caption",
    });
    fireEvent.keyDown(caption, { key: "Escape" });

    await waitFor(() => expect(within(section).queryByRole("form")).toBeNull());
    expect(shown).toEqual([]);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(section).getByRole("button", { name: "show it here" })
      )
    );
  });

  it("says why it was refused, and keeps the caption", async () => {
    open(() => pageWith([], [loss]), {
      "experiments.showArtifact": () => {
        throw new Error("loss.png is already on the page.");
      },
    });
    const section = await artifacts();

    fireEvent.click(
      await within(section).findByRole("button", { name: "show it here" })
    );
    const caption = await within(section).findByRole("textbox", {
      name: "Caption",
    });
    fireEvent.change(caption, { target: { value: "Loss." } });
    fireEvent.keyDown(caption, { key: "Enter" });

    await within(section).findByText(
      "could not show it: loss.png is already on the page."
    );
    expect(
      within(section).getByRole<HTMLInputElement>("textbox", {
        name: "Caption",
      }).value
    ).toBe("Loss.");
  });
});

describe("a text Artifact, drawn as its first rows", () => {
  it("draws the rows artifactPreview answers, and says they are the first of more", async () => {
    const asked: unknown[] = [];
    open(() => pageWith([summary]), {
      "experiments.artifactPreview": (input: unknown) => {
        asked.push(input);
        return {
          lines: ["set,k,d", "all,41,0.44", "prereg,33,0.41"],
          more: true,
        };
      },
    });
    const section = await artifacts();

    const rows = await within(section).findByRole("region", {
      name: "pooled-summary.csv, first rows",
    });
    expect(
      within(rows)
        .getAllByRole("listitem")
        .map((row) => row.textContent)
    ).toEqual(["set,k,d", "all,41,0.44", "prereg,33,0.41"]);
    const card = rows.closest("figure")!;
    expect(card.textContent).toContain("2 KB · in vault · first 3 rows");
    expect(asked).toEqual([{ path: PATH, file: "pooled-summary.csv" }]);
  });

  it("does not call a file shown whole its first rows", async () => {
    open(() => pageWith([summary]), {
      "experiments.artifactPreview": () => ({
        lines: ["a,b", "1,2"],
        more: false,
      }),
    });
    const section = await artifacts();

    await within(section).findByText("1,2");
    expect(section.textContent).not.toContain("first 2 rows");
  });

  it("says so where the rows would be when they cannot be read", async () => {
    open(() => pageWith([summary]), {
      "experiments.artifactPreview": () => {
        throw new Error("pooled-summary.csv has no rows to show.");
      },
    });
    const section = await artifacts();

    await within(section).findByText(
      "could not read its rows: pooled-summary.csv has no rows to show."
    );
  });

  it("asks for no rows for a line whose file is not in the folder", async () => {
    const asked: unknown[] = [];
    open(() => pageWith([{ ...summary, path: null, size: null }]), {
      "experiments.artifactPreview": (input: unknown) => {
        asked.push(input);
        return { lines: [], more: false };
      },
    });
    const section = await artifacts();

    await within(section).findByText("pooled-summary.csv");
    expect(section.textContent).toContain("not in the folder");
    expect(asked).toEqual([]);
  });
});
