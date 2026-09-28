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
// A heavy one proposed as linked, overridable either way, and the linked
// card with the brief's warning (#369; stories 29–31, 39).

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
    artifacts: { present: true, text: "", items },
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
  size: 412_000,
  image: true,
};

const summary: ArtifactLine = {
  kind: "stored",
  file: "pooled-summary.csv",
  caption: "First rows.",
  path: `${FOLDER}/pooled-summary.csv`,
  size: 2_000,
  image: false,
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
  // Under 25 MB unless a test says otherwise: proposed as stored.
  "experiments.inspectArtifact": { size: 2048, proposed: "stored" },
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
          as: "stored",
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
          as: "stored",
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
      (
        await screen.findByRole<HTMLInputElement>("textbox", {
          name: "Caption",
        })
      ).value
    ).toBe("");
  });
});

const draws: ArtifactLine = {
  kind: "linked",
  file: "bootstrap-draws.parquet",
  target: "/Users/r/research/out/bootstrap-draws.parquet",
  url: false,
  size: "2.4 GB",
  date: "2026-09-14",
  machine: "Studio Mac",
  fingerprint: "2576980378:1789374600000:4f2ac1e9b0d3",
  description: "Every bootstrap draw, before pooling.",
};

const WARNING =
  "Outside the vault. If this file moves or is cleaned up, the vault will not notice and this page will point at nothing.";

describe("a linked Artifact, drawn", () => {
  it("is the warning card: its path, size and the machine it was linked on, with the brief's warning", async () => {
    open(() => pageWith([funnel, draws]));
    const section = await artifacts();

    const card = (
      await within(section).findByText("bootstrap-draws.parquet")
    ).closest("figure") as HTMLElement;
    expect(card.textContent).toContain("2.4 GB · linked");
    expect(card.textContent).toContain(
      "/Users/r/research/out/bootstrap-draws.parquet"
    );
    expect(card.textContent).toContain("linked on Studio Mac · 2026-09-14");
    expect(card.textContent).toContain(WARNING);
    expect(card.textContent).toContain("Every bootstrap draw, before pooling.");
    // Distinct from a stored card, which carries neither the warning nor
    // the linked mark (story 38).
    expect(card.dataset["kind"]).toBe("linked");
    const stored = within(section)
      .getByText("funnel-all-41.png")
      .closest("figure") as HTMLElement;
    expect(stored.dataset["kind"]).toBe("stored");
    expect(stored.textContent).not.toContain("vault will not notice");
    // Nothing outside the vault is fetched.
    await within(section).findByRole("img");
    expect(fetched).toHaveLength(1);
  });

  it("names a URL as linked with no size, and says the page is outside the vault", async () => {
    open(() =>
      pageWith([
        {
          ...draws,
          file: "3f2a",
          target: "https://wandb.ai/lab/runs/3f2a",
          url: true,
          size: null,
          fingerprint: null,
          description: "The sweep's panel.",
        },
      ])
    );
    const section = await artifacts();

    const card = (await within(section).findByText("3f2a")).closest(
      "figure"
    ) as HTMLElement;
    expect(card.textContent).toContain("URL · linked");
    expect(card.textContent).toContain("https://wandb.ai/lab/runs/3f2a");
    expect(card.textContent).toContain(
      "Outside the vault. If this page moves or is taken down, the vault will not notice and this link will point at nothing."
    );
  });
});

describe("stored or linked, proposed by size", () => {
  async function chosen(
    inspected: unknown,
    added: unknown[],
    source = "/Users/r/out/bootstrap-draws.parquet"
  ) {
    open(() => pageWith([]), {
      "experiments.pickArtifact": () => ({ source }),
      "experiments.inspectArtifact": inspected,
      "experiments.addArtifact": (input: unknown) => {
        added.push(input);
        return written();
      },
    });
    const section = await artifacts();
    fireEvent.click(
      within(section).getByRole("button", { name: "+ artifact" })
    );
    return section;
  }

  it("proposes a file of 25 MB or more as linked, with the warning, and links it", async () => {
    const added: unknown[] = [];
    const section = await chosen({ size: 2.4e9, proposed: "linked" }, added);

    const form = await within(section).findByRole("form", {
      name: "Link an Artifact",
    });
    expect(section.textContent).toContain("2.4 GB · linked, not copied");
    expect(section.textContent).toContain(WARNING);
    const description = within(form).getByRole("textbox", {
      name: "Description",
    });
    await waitFor(() => expect(document.activeElement).toBe(description));
    fireEvent.change(description, {
      target: { value: "Every bootstrap draw." },
    });
    fireEvent.keyDown(description, { key: "Enter" });

    await waitFor(() =>
      expect(added).toEqual([
        {
          path: PATH,
          source: "/Users/r/out/bootstrap-draws.parquet",
          as: "linked",
          caption: "Every bootstrap draw.",
        },
      ])
    );
  });

  it("proposes a smaller file as stored, and says so", async () => {
    const section = await chosen({ size: 412_000, proposed: "stored" }, []);

    await within(section).findByRole("form", { name: "Add an Artifact" });
    expect(section.textContent).toContain("412 KB · copied into the vault");
    expect(section.textContent).not.toContain("vault will not notice");
  });

  it("stores a heavy file when asked to, keeping what was typed", async () => {
    const added: unknown[] = [];
    const section = await chosen({ size: 40e6, proposed: "linked" }, added);
    const description = await within(section).findByRole("textbox", {
      name: "Description",
    });
    fireEvent.change(description, { target: { value: "A big plot." } });

    fireEvent.click(
      within(section).getByRole("button", { name: "copy it in instead" })
    );

    const caption = await within(section).findByRole<HTMLInputElement>(
      "textbox",
      { name: "Caption" }
    );
    expect(caption.value).toBe("A big plot.");
    await waitFor(() => expect(document.activeElement).toBe(caption));
    expect(section.textContent).not.toContain("vault will not notice");
    fireEvent.keyDown(caption, { key: "Enter" });
    await waitFor(() =>
      expect(added).toEqual([
        {
          path: PATH,
          source: "/Users/r/out/bootstrap-draws.parquet",
          as: "stored",
          caption: "A big plot.",
        },
      ])
    );
  });

  it("links a small file when asked to, with the warning", async () => {
    const added: unknown[] = [];
    const section = await chosen(
      { size: 2e6, proposed: "stored" },
      added,
      "/Users/r/notes.txt"
    );
    await within(section).findByRole("textbox", { name: "Caption" });

    fireEvent.click(
      within(section).getByRole("button", { name: "link it instead" })
    );

    const description = await within(section).findByRole("textbox", {
      name: "Description",
    });
    expect(section.textContent).toContain(WARNING);
    fireEvent.change(description, { target: { value: "Not copied." } });
    fireEvent.keyDown(description, { key: "Enter" });
    await waitFor(() =>
      expect(added).toEqual([
        {
          path: PATH,
          source: "/Users/r/notes.txt",
          as: "linked",
          caption: "Not copied.",
        },
      ])
    );
  });

  it("says why a file cannot be looked at, and adds nothing", async () => {
    const added: unknown[] = [];
    const section = await chosen(
      () => {
        throw new Error("gone.pt is not a file that can be read.");
      },
      added,
      "/Users/r/gone.pt"
    );

    const said = await within(section).findByRole("status");
    expect(said.textContent).toBe(
      "could not add it: gone.pt is not a file that can be read."
    );
    expect(within(section).queryByRole("form")).toBeNull();
    expect(added).toEqual([]);
  });

  it("links a URL dropped on the page, and offers no copy", async () => {
    const added: unknown[] = [];
    open(() => pageWith([]), {
      "experiments.inspectArtifact": { size: null, proposed: "linked" },
      "experiments.addArtifact": (input: unknown) => {
        added.push(input);
        return written();
      },
    });
    const page = await screen.findByRole("region", { name: "Experiment view" });
    const section = await artifacts();
    const url = "https://wandb.ai/lab/runs/3f2a";
    const dataTransfer = {
      files: [],
      types: ["text/uri-list"],
      getData: (type: string) =>
        type === "text/uri-list" ? `# a comment\r\n${url}\r\n` : "",
    };

    fireEvent.dragOver(page, { dataTransfer });
    fireEvent.drop(page, { dataTransfer });

    const description = await within(section).findByRole("textbox", {
      name: "Description",
    });
    expect(section.textContent).toContain(url);
    expect(section.textContent).toContain("URL · linked, not copied");
    expect(
      within(section).queryByRole("button", { name: "copy it in instead" })
    ).toBeNull();
    fireEvent.change(description, { target: { value: "The panel." } });
    fireEvent.keyDown(description, { key: "Enter" });
    await waitFor(() =>
      expect(added).toEqual([
        { path: PATH, source: url, as: "linked", caption: "The panel." },
      ])
    );
    expect(dropped).toEqual([]);
  });
});
