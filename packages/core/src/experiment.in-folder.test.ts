import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactPreview } from "./artifact.js";
import type { ExperimentPage } from "./experiment.js";
import { closeCores, core, vaultWith, type CoreOptions } from "./test-core.js";
import type { WriteResult } from "./vault-files.js";

// A file in the Experiment's folder with no line on the page (#368; spec
// #362 stories 36, 41–43; ADR 0035 decisions 2–3): offered as *in the
// folder, not on the page*, *show it here* appending the line and copying
// nothing, a removed line leaving the file to be offered again, and a CSV,
// TSV or text file previewed as its first rows.

afterEach(closeCores);

type Vault = { name: string; path: string };
type Readable = Extract<ExperimentPage, { readable: true }>;

const PATH = "experiments/prereg-exclusions/prereg-exclusions.md";
const FOLDER = "experiments/prereg-exclusions";

const page = (artifacts = "") => `---
id: ex9q2w7m4k
kind: experiment
name: "prereg-exclusions"
status: complete
created: 2026-09-09T10:00:00+02:00
tags: []
---

## Purpose

See whether the pooled effect survives the exclusion rule at all.

## Design

## Where it ran

## Artifacts
${artifacts === "" ? "" : `\n${artifacts}\n`}
## Observations

## Position history
`;

const PLOT = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 255,
]);

async function opened(
  files: Record<string, string | Buffer> = { [PATH]: page() },
  opts: CoreOptions = {}
) {
  const vault = await vaultWith({});
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(vault, name, ".."), { recursive: true });
    await writeFile(join(vault, name), content);
  }
  const c = await core(opts);
  const reply = await c.mutate<Vault>("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

type Core = Awaited<ReturnType<typeof opened>>["c"];

async function pageOf(c: Core) {
  const reply = await c.query<ExperimentPage>("experiments.page", {
    path: PATH,
  });
  expect(reply.error).toBeUndefined();
  return reply.result?.data as Readable;
}

async function preview(c: Core, file: string) {
  return c.query<ArtifactPreview>("experiments.artifactPreview", {
    path: PATH,
    file,
  });
}

describe("experiments.page — in the folder, not on the page", () => {
  it("offers each file in the run's folder that no line names", async () => {
    const { c } = await opened({
      [PATH]: page("- ![[funnel.png]] — On the page."),
      [`${FOLDER}/funnel.png`]: PLOT,
      [`${FOLDER}/forest.png`]: PLOT,
      [`${FOLDER}/pooled-summary.csv`]: "set,k\nall,41\n",
    });

    const { sections } = await pageOf(c);

    expect(sections.artifacts.inFolder).toEqual([
      {
        kind: "inFolder",
        file: "forest.png",
        path: `${FOLDER}/forest.png`,
        size: PLOT.length,
        image: true,
        rows: false,
      },
      {
        kind: "inFolder",
        file: "pooled-summary.csv",
        path: `${FOLDER}/pooled-summary.csv`,
        size: Buffer.byteLength("set,k\nall,41\n"),
        image: false,
        rows: true,
      },
    ]);
  });

  it("does not offer the page, another note, a dot-file, or a file in a folder below the run's", async () => {
    const { c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/scratch.md`]: "# Scratch\n",
      [`${FOLDER}/.DS_Store`]: PLOT,
      [`${FOLDER}/checkpoints/step-1000.pt`]: PLOT,
    });

    const { sections } = await pageOf(c);

    expect(sections.artifacts.inFolder).toEqual([]);
  });

  it("counts a line naming the file in another case as naming it, as the Mac's disk does", async () => {
    const { c } = await opened({
      [PATH]: page("- ![[Funnel.PNG]] — On the page."),
      [`${FOLDER}/funnel.png`]: PLOT,
    });

    const { sections } = await pageOf(c);

    expect(sections.artifacts.inFolder).toEqual([]);
  });

  it("offers a plot a script writes into the folder while the vault is open", async () => {
    const { vault, c } = await opened(undefined, { settleMs: 200 });
    const stream = await c.events();

    await writeFile(join(vault, FOLDER, "loss.png"), PLOT);
    await stream.next("vaultChanged");
    stream.close();

    const { sections } = await pageOf(c);
    expect(sections.artifacts.inFolder.map((a) => a.file)).toEqual([
      "loss.png",
    ]);
  });
});

describe("experiments.showArtifact", () => {
  it("appends the line and copies nothing: the file's bytes and date are as the script left them", async () => {
    const { vault, c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/loss.png`]: PLOT,
    });
    const before = await stat(join(vault, FOLDER, "loss.png"));

    const reply = await c.mutate<WriteResult>("experiments.showArtifact", {
      path: PATH,
      file: "loss.png",
      caption: "Loss by step.",
    });

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toMatchObject({ written: true });
    expect(await readFile(join(vault, PATH), "utf8")).toBe(
      page("- ![[loss.png]] — Loss by step.")
    );
    const after = await stat(join(vault, FOLDER, "loss.png"));
    expect(await readFile(join(vault, FOLDER, "loss.png"))).toEqual(PLOT);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
    expect((await readdir(join(vault, FOLDER))).sort()).toEqual([
      "loss.png",
      "prereg-exclusions.md",
    ]);

    const { sections } = await pageOf(c);
    expect(sections.artifacts.inFolder).toEqual([]);
    expect(sections.artifacts.items).toMatchObject([
      { kind: "stored", file: "loss.png", path: `${FOLDER}/loss.png` },
    ]);
  });

  it("refuses a file already on the page, rather than drawing it twice", async () => {
    const { vault, c } = await opened({
      [PATH]: page("- ![[loss.png]] — Loss."),
      [`${FOLDER}/loss.png`]: PLOT,
    });

    const reply = await c.mutate("experiments.showArtifact", {
      path: PATH,
      file: "loss.png",
      caption: "Again.",
    });

    expect(reply.error?.message).toBe("loss.png is already on the page.");
    expect(await readFile(join(vault, PATH), "utf8")).toBe(
      page("- ![[loss.png]] — Loss.")
    );
  });

  it.each([
    ["a file the folder does not hold", "gone.png"],
    ["a file in a folder below the run's", "checkpoints/step-1000.pt"],
    ["a note", "scratch.md"],
    ["a path that climbs out", "../elsewhere/plot.png"],
  ])("refuses %s, and writes nothing", async (_, file) => {
    const { vault, c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/checkpoints/step-1000.pt`]: PLOT,
      [`${FOLDER}/scratch.md`]: "# Scratch\n",
      "experiments/elsewhere/plot.png": PLOT,
    });

    const reply = await c.mutate("experiments.showArtifact", {
      path: PATH,
      file,
      caption: "Something.",
    });

    expect(reply.error?.message).toBe(
      `${file} is not a file in the run's folder.`
    );
    expect(await readFile(join(vault, PATH), "utf8")).toBe(page());
  });

  it("refuses a blank caption", async () => {
    const { vault, c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/loss.png`]: PLOT,
    });

    const reply = await c.mutate("experiments.showArtifact", {
      path: PATH,
      file: "loss.png",
      caption: "  ",
    });

    expect(reply.error?.message).toContain("An Artifact needs a caption.");
    expect(await readFile(join(vault, PATH), "utf8")).toBe(page());
  });
});

describe("a removed line", () => {
  it("leaves the file in the folder, where the page offers it again", async () => {
    const { vault, c } = await opened(
      {
        [PATH]: page("- ![[loss.png]] — Loss."),
        [`${FOLDER}/loss.png`]: PLOT,
      },
      { settleMs: 200 }
    );
    const stream = await c.events();

    // Removed in Obsidian: the app has no procedure that removes a line, and
    // none that deletes, moves or copies out an Artifact (ADR 0035 decision 2).
    await writeFile(join(vault, PATH), page());
    await stream.next("vaultChanged");
    stream.close();

    expect(await readFile(join(vault, FOLDER, "loss.png"))).toEqual(PLOT);
    const { sections } = await pageOf(c);
    expect(sections.artifacts.items).toEqual([]);
    expect(sections.artifacts.inFolder.map((a) => a.file)).toEqual([
      "loss.png",
    ]);
  });
});

describe("experiments.artifactPreview", () => {
  it("answers a CSV's first rows, and says there are more", async () => {
    const csv = [
      "set,k,d",
      ...Array.from({ length: 20 }, (_, i) => `s${i},${i},0.${i}`),
    ].join("\n");
    const { c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/pooled-summary.csv`]: csv,
    });

    const reply = await preview(c, "pooled-summary.csv");

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toEqual({
      lines: [
        "set,k,d",
        "s0,0,0.0",
        "s1,1,0.1",
        "s2,2,0.2",
        "s3,3,0.3",
        "s4,4,0.4",
      ],
      more: true,
    });
  });

  it("answers a short TSV whole, with nothing more, and CRLF lines split cleanly", async () => {
    const { c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/lr.tsv`]: "lr\tloss\r\n0.1\t2.3\r\n",
    });

    const reply = await preview(c, "lr.tsv");

    expect(reply.result?.data).toEqual({
      lines: ["lr\tloss", "0.1\t2.3"],
      more: false,
    });
  });

  it("answers a text file's first lines", async () => {
    const { c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/sample output.txt`]: "The model said:\nhello\n",
    });

    const reply = await preview(c, "sample output.txt");

    expect(reply.result?.data).toEqual({
      lines: ["The model said:", "hello"],
      more: false,
    });
  });

  it("reads only the head of a large file, so one enormous line is bounded too", async () => {
    const { c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/dump.txt`]: "x".repeat(5_000_000),
    });

    const reply = await preview(c, "dump.txt");
    const data = reply.result?.data as ArtifactPreview;

    expect(data.more).toBe(true);
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0]!.length).toBeLessThan(20_000);
  });

  it("previews a file the folder holds with no line on the page", async () => {
    const { c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/written-by-script.csv`]: "a,b\n1,2\n",
    });

    const reply = await preview(c, "written-by-script.csv");

    expect(reply.result?.data).toEqual({ lines: ["a,b", "1,2"], more: false });
  });

  it.each([
    ["an image", "loss.png"],
    ["a file the folder does not hold", "gone.csv"],
    ["a path that climbs out", "../elsewhere/rows.csv"],
    ["a file outside the Experiments", "notes/rows.csv"],
  ])("refuses %s", async (_, file) => {
    const { c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/loss.png`]: PLOT,
      "experiments/elsewhere/rows.csv": "a\n",
      "notes/rows.csv": "a\n",
    });

    const reply = await preview(c, file);

    expect(reply.error?.message).toBe(`${file} has no rows to show.`);
  });
});
