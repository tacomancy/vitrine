import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ArtifactLine, ExperimentPage, WriteResult } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

// A stored Artifact copied in and drawn inline (#366; spec #362 stories 28,
// 32–35, 37–38; prototype 05's artifact area): *+ artifact* and a drop both
// ask for a caption and then copy; an image is drawn from its bytes, fetched
// with the bearer header; anything else is a named card with its size.

const PATH = "experiments/prereg-exclusions/prereg-exclusions.md";
const FOLDER = "experiments/prereg-exclusions";
const HASH = `#/experiment/${PATH}`;

type Readable = Extract<ExperimentPage, { readable: true }>;

const pageWith = (items: ArtifactLine[]): Readable => ({
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
    artifacts: { present: true, text: "", items, inFolder: [] },
    observations: { present: true, text: "" },
    positionHistory: { present: true, text: "", entries: [] },
  },
  cameFrom: null,
  evidence: [],
  problems: [],
});

const funnel: ArtifactLine = {
  kind: "stored",
  file: "funnel-all-41.png",
  caption: "Asymmetric, as before.",
  path: `${FOLDER}/funnel-all-41.png`,
  size: 412 * 1024,
  image: true,
  rows: false,
};

const summary: ArtifactLine = {
  kind: "stored",
  file: "pooled-summary.csv",
  caption: "First rows.",
  path: `${FOLDER}/pooled-summary.csv`,
  size: 2 * 1024,
  image: false,
  rows: true,
};

const written = (): WriteResult & { file: string } => ({
  written: true,
  hash: "def",
  content: "",
  shape: [],
  file: "plot.png",
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
  "experiments.artifactPreview": { lines: ["set,k,d"], more: true },
};

let fetched: { url: string; init: RequestInit | undefined }[];
let dropped: File[];

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  fetched = [];
  dropped = [];
  window.vitrine = {
    port: 4242,
    token: "session-token",
    pathOf: (file: File) => {
      dropped.push(file);
      return `/Users/r/Desktop/${file.name}`;
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      fetched.push({ url, init });
      return Promise.resolve(
        new Response(new Blob([new Uint8Array([137, 80, 78, 71])]))
      );
    })
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

describe("the Artifacts, drawn", () => {
  it("draws an image inline from its bytes, fetched with the bearer header and never the token in the URL", async () => {
    open(() => pageWith([funnel]));
    const section = await artifacts();

    const image = await within(section).findByRole<HTMLImageElement>("img", {
      name: "Asymmetric, as before.",
    });
    await waitFor(() =>
      expect(image.getAttribute("src")).toBe("blob:vitrine/1")
    );
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.url).toBe(
      "http://127.0.0.1:4242/artifacts/experiments/prereg-exclusions/funnel-all-41.png"
    );
    expect(fetched[0]!.url).not.toContain("session-token");
    expect(new Headers(fetched[0]!.init?.headers).get("authorization")).toBe(
      "Bearer session-token"
    );
    const figure = image.closest("figure") as HTMLElement;
    expect(figure.textContent).toContain("funnel-all-41.png");
    expect(figure.textContent).toContain("412 KB · in vault");
    expect(figure.textContent).toContain("Asymmetric, as before.");
  });

  it("draws anything else as a named card with its size, and fetches nothing for it", async () => {
    open(() => pageWith([summary]));
    const section = await artifacts();

    const card = (
      await within(section).findByText("pooled-summary.csv")
    ).closest("figure") as HTMLElement;
    expect(card.textContent).toContain("2 KB · in vault");
    expect(card.textContent).toContain("First rows.");
    expect(within(section).queryByRole("img")).toBeNull();
    expect(fetched).toEqual([]);
  });

  it("keeps the order the file holds, and shows a line it cannot read as written", async () => {
    open(() =>
      pageWith([
        summary,
        { kind: "asWritten", text: "checkpoint on the lab NAS" },
        funnel,
      ])
    );
    const section = await artifacts();
    await within(section).findByRole("img");
    const text = section.textContent ?? "";
    expect(text.indexOf("pooled-summary.csv")).toBeLessThan(
      text.indexOf("checkpoint on the lab NAS")
    );
    expect(text.indexOf("checkpoint on the lab NAS")).toBeLessThan(
      text.indexOf("funnel-all-41.png")
    );
  });

  it("says a stored line's file is not in the folder rather than drawing a broken image", async () => {
    open(() => pageWith([{ ...funnel, path: null, size: null }]));
    const section = await artifacts();
    const card = (
      await within(section).findByText("funnel-all-41.png")
    ).closest("figure") as HTMLElement;
    expect(card.textContent).toContain("not in the folder");
    expect(within(section).queryByRole("img")).toBeNull();
    expect(fetched).toEqual([]);
  });
});

describe("adding an Artifact", () => {
  it("+ artifact asks the chooser, then the caption, then copies the file in", async () => {
    const added: unknown[] = [];
    open(() => pageWith([]), {
      "experiments.pickArtifact": () => ({
        source: "/Users/r/Desktop/forest-prereg-33.png",
      }),
      "experiments.addArtifact": (input: unknown) => {
        added.push(input);
        return written();
      },
    });
    const section = await artifacts();

    fireEvent.click(
      within(section).getByRole("button", { name: "+ artifact" })
    );
    const form = await within(section).findByRole("form", {
      name: "Add an Artifact",
    });
    // The file the caption is for is named beside the line.
    expect(section.textContent).toContain("forest-prereg-33.png");
    const caption = within(form).getByRole("textbox", { name: "Caption" });
    await waitFor(() => expect(document.activeElement).toBe(caption));
    fireEvent.change(caption, {
      target: { value: "Pooled estimate in the bottom row." },
    });
    fireEvent.keyDown(caption, { key: "Enter" });

    await waitFor(() =>
      expect(added).toEqual([
        {
          path: PATH,
          source: "/Users/r/Desktop/forest-prereg-33.png",
          caption: "Pooled estimate in the bottom row.",
        },
      ])
    );
    await waitFor(() => expect(within(section).queryByRole("form")).toBeNull());
  });

  it("does nothing more when the chooser is cancelled", async () => {
    open(() => pageWith([]), {
      "experiments.pickArtifact": () => ({ source: null }),
    });
    const section = await artifacts();
    fireEvent.click(
      within(section).getByRole("button", { name: "+ artifact" })
    );
    await waitFor(() =>
      expect(within(section).getByRole("button", { name: "+ artifact" })).toBe(
        document.activeElement
      )
    );
    expect(within(section).queryByRole("form")).toBeNull();
  });

  it("a file dropped on the page asks for its caption and is copied from where it lies", async () => {
    const added: unknown[] = [];
    open(() => pageWith([]), {
      "experiments.addArtifact": (input: unknown) => {
        added.push(input);
        return written();
      },
    });
    const page = await screen.findByRole("region", { name: "Experiment view" });
    await artifacts();
    const file = new File(["x"], "wandb-panel.png", { type: "image/png" });

    fireEvent.dragOver(page, {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    fireEvent.drop(page, { dataTransfer: { files: [file], types: ["Files"] } });

    const caption = await screen.findByRole("textbox", { name: "Caption" });
    expect(dropped).toEqual([file]);
    fireEvent.change(caption, { target: { value: "Kept for the config." } });
    fireEvent.keyDown(caption, { key: "Enter" });
    await waitFor(() =>
      expect(added).toEqual([
        {
          path: PATH,
          source: "/Users/r/Desktop/wandb-panel.png",
          caption: "Kept for the config.",
        },
      ])
    );
  });

  it("esc on the caption copies nothing", async () => {
    const added: unknown[] = [];
    open(() => pageWith([]), {
      "experiments.pickArtifact": () => ({ source: "/Users/r/plot.png" }),
      "experiments.addArtifact": (input: unknown) => {
        added.push(input);
        return written();
      },
    });
    const section = await artifacts();
    fireEvent.click(
      within(section).getByRole("button", { name: "+ artifact" })
    );
    const caption = await within(section).findByRole("textbox", {
      name: "Caption",
    });
    fireEvent.keyDown(caption, { key: "Escape" });
    await waitFor(() => expect(within(section).queryByRole("form")).toBeNull());
    expect(added).toEqual([]);
  });

  it("says where the file went when its line could not be written", async () => {
    open(() => pageWith([]), {
      "experiments.pickArtifact": () => ({ source: "/Users/r/plot.png" }),
      "experiments.addArtifact": () => ({
        written: false,
        reason: "unreadable",
        detail: "the file could not be read",
        file: "plot (2).png",
      }),
    });
    const section = await artifacts();
    fireEvent.click(
      within(section).getByRole("button", { name: "+ artifact" })
    );
    const caption = await within(section).findByRole("textbox", {
      name: "Caption",
    });
    fireEvent.change(caption, { target: { value: "A plot." } });
    fireEvent.keyDown(caption, { key: "Enter" });

    const said = await within(section).findByRole("status");
    expect(said.textContent).toBe(
      "plot (2).png is in the run's folder, but its line could not be written: the file could not be read"
    );
  });

  it("says why a copy was refused, and keeps the caption", async () => {
    open(() => pageWith([]), {
      "experiments.pickArtifact": () => ({ source: "/Users/r/gone.png" }),
      "experiments.addArtifact": () => {
        throw new Error("gone.png is not a file that can be read.");
      },
    });
    const section = await artifacts();
    fireEvent.click(
      within(section).getByRole("button", { name: "+ artifact" })
    );
    const caption = await within(section).findByRole<HTMLInputElement>(
      "textbox",
      { name: "Caption" }
    );
    fireEvent.change(caption, { target: { value: "Gone." } });
    fireEvent.keyDown(caption, { key: "Enter" });

    const said = await within(section).findByRole("status");
    expect(said.textContent).toBe(
      "could not add it: gone.png is not a file that can be read."
    );
    expect(caption.value).toBe("Gone.");
  });

  it("copies once however many times ↵ is pressed while the copy is on its way", async () => {
    const added: unknown[] = [];
    let land: (value: unknown) => void = () => undefined;
    open(() => pageWith([]), {
      "experiments.pickArtifact": () => ({ source: "/Users/r/plot.png" }),
      "experiments.addArtifact": (input: unknown) => {
        added.push(input);
        // Held open, as a large copy is.
        return new Promise((resolve) => (land = resolve));
      },
    });
    const section = await artifacts();
    fireEvent.click(
      within(section).getByRole("button", { name: "+ artifact" })
    );
    const caption = await within(section).findByRole("textbox", {
      name: "Caption",
    });
    fireEvent.change(caption, { target: { value: "A plot." } });
    fireEvent.keyDown(caption, { key: "Enter" });
    fireEvent.keyDown(caption, { key: "Enter" });
    await waitFor(() => expect(added).toHaveLength(1));
    land(written());
    await waitFor(() => expect(within(section).queryByRole("form")).toBeNull());
    expect(added).toHaveLength(1);
  });

  it("a second file dropped while the first waits for its caption starts with an empty one", async () => {
    open(() => pageWith([]));
    const page = await screen.findByRole("region", { name: "Experiment view" });
    await artifacts();
    const first = new File(["x"], "first.png");
    const second = new File(["y"], "second.png");

    fireEvent.drop(page, {
      dataTransfer: { files: [first], types: ["Files"] },
    });
    const caption = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "Caption",
    });
    fireEvent.change(caption, { target: { value: "For the first." } });
    fireEvent.drop(page, {
      dataTransfer: { files: [second], types: ["Files"] },
    });

    await waitFor(() => expect(page.textContent).toContain("second.png"));
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Caption" }).value
    ).toBe("");
  });
});
