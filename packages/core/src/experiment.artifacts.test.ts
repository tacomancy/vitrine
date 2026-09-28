import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentPage } from "./experiment.js";
import {
  closeCores,
  core,
  fakeHost,
  tmp,
  vaultWith,
  type CoreOptions,
} from "./test-core.js";
import type { WriteResult } from "./vault-files.js";

// A stored Artifact copied in and drawn inline (#366; spec #362 stories 28,
// 32–35, 37–38, 44; ADR 0035 decisions 1–2): the copy's bytes, the source
// left where it was, a taken name suffixed, the line's exact bytes, the copy
// recorded as the app's own write, and the bytes served to the page behind
// the bearer header.

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

// Not a real PNG: the app never decodes an Artifact, it copies and serves
// bytes, so any bytes that are not text prove the copy is byte-for-byte.
const PLOT = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 255,
]);

/** A file somewhere outside the vault, as the chooser or a drop would name it. */
async function outside(name: string, bytes: Buffer | string = PLOT) {
  const folder = await tmp("desktop");
  const source = join(folder, name);
  await writeFile(source, bytes);
  return source;
}

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

async function pageOf(c: Awaited<ReturnType<typeof opened>>["c"]) {
  const reply = await c.query<ExperimentPage>("experiments.page", {
    path: PATH,
  });
  expect(reply.error).toBeUndefined();
  return reply.result?.data as Readable;
}

type Added = WriteResult & { file: string };

describe("experiments.addArtifact", () => {
  it("copies the file into the run's folder, leaves the source where it was, and appends its line", async () => {
    const { vault, c } = await opened();
    const source = await outside("funnel-all-41.png");

    const reply = await c.mutate<Added>("experiments.addArtifact", {
      path: PATH,
      source,
      caption: "Asymmetric, as before.",
    });

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toMatchObject({
      written: true,
      file: "funnel-all-41.png",
    });
    expect(await readFile(join(vault, FOLDER, "funnel-all-41.png"))).toEqual(
      PLOT
    );
    // Copied, never moved (story 32).
    expect(await readFile(source)).toEqual(PLOT);
    // The bytes, because Obsidian is the other reader: an ordinary embed
    // beside the note (story 44).
    expect(await readFile(join(vault, PATH), "utf8")).toBe(
      page("- ![[funnel-all-41.png]] — Asymmetric, as before.")
    );
  });

  it("keeps a name already taken in the folder under a suffix, and overwrites nothing", async () => {
    const { vault, c } = await opened({
      [PATH]: page("- ![[plot.png]] — the first one"),
      [`${FOLDER}/plot.png`]: "the first one's bytes",
      [`${FOLDER}/plot (2).png`]: "a script's",
    });
    const source = await outside("plot.png");

    const reply = await c.mutate<Added>("experiments.addArtifact", {
      path: PATH,
      source,
      caption: "The second.",
    });

    expect(reply.result?.data.file).toBe("plot (3).png");
    expect(await readFile(join(vault, FOLDER, "plot (3).png"))).toEqual(PLOT);
    expect(await readFile(join(vault, FOLDER, "plot.png"), "utf8")).toBe(
      "the first one's bytes"
    );
    expect(await readFile(join(vault, FOLDER, "plot (2).png"), "utf8")).toBe(
      "a script's"
    );
    expect(await readFile(join(vault, PATH), "utf8")).toBe(
      page("- ![[plot.png]] — the first one\n- ![[plot (3).png]] — The second.")
    );
  });

  it("drops the characters an embed cannot carry from the stored name", async () => {
    const { vault, c } = await opened();
    const source = await outside("run #3 [final].png");

    const reply = await c.mutate<Added>("experiments.addArtifact", {
      path: PATH,
      source,
      caption: "Final.",
    });

    expect(reply.result?.data.file).toBe("run 3 final.png");
    expect(await readdir(join(vault, FOLDER))).toContain("run 3 final.png");
  });

  it("puts a caption typed over several lines on the one line", async () => {
    const { vault, c } = await opened();
    const source = await outside("forest.png");

    await c.mutate<Added>("experiments.addArtifact", {
      path: PATH,
      source,
      caption: "  Pooled estimate\nin the bottom row.  ",
    });

    expect(await readFile(join(vault, PATH), "utf8")).toBe(
      page("- ![[forest.png]] — Pooled estimate in the bottom row.")
    );
  });

  it("lands the copy before the line, so a line that cannot be written leaves the file in the folder", async () => {
    const { vault, c } = await opened();
    const source = await outside("wandb-panel.png");
    // The page is indexed as an Experiment, and then cannot be read: the
    // copy has landed by the time the line's write finds that out.
    await chmod(join(vault, PATH), 0o000);

    const reply = await c.mutate<Added>("experiments.addArtifact", {
      path: PATH,
      source,
      caption: "Kept for the sweep config.",
    });
    await chmod(join(vault, PATH), 0o644);

    expect(reply.result?.data).toMatchObject({
      written: false,
      file: "wandb-panel.png",
    });
    expect(await readFile(join(vault, FOLDER, "wandb-panel.png"))).toEqual(
      PLOT
    );
    expect(await readFile(join(vault, PATH), "utf8")).toBe(page());
  });

  it("refuses a source that is not a file, and copies nothing", async () => {
    const { vault, c } = await opened();
    const folder = await tmp("desktop");

    const gone = await c.mutate("experiments.addArtifact", {
      path: PATH,
      source: join(folder, "never-written.png"),
      caption: "x",
    });
    const directory = await c.mutate("experiments.addArtifact", {
      path: PATH,
      source: folder,
      caption: "x",
    });

    expect(gone.error?.message).toBe(
      "never-written.png is not a file that can be read."
    );
    expect(directory.error?.message).toMatch(/is not a file that can be read/);
    expect(await readdir(join(vault, FOLDER))).toEqual([
      "prereg-exclusions.md",
    ]);
  });

  it("refuses a blank caption, and copies nothing", async () => {
    const { vault, c } = await opened();
    const source = await outside("plot.png");

    const reply = await c.mutate("experiments.addArtifact", {
      path: PATH,
      source,
      caption: "   ",
    });

    expect(reply.error?.message).toContain("An Artifact needs a caption.");
    expect(await readdir(join(vault, FOLDER))).toEqual([
      "prereg-exclusions.md",
    ]);
  });

  it("refuses a page that is not an Experiment, and copies nothing", async () => {
    const note = "notes/plain.md";
    const { vault, c } = await opened({ [note]: "# Plain\n" });
    const source = await outside("plot.png");

    const reply = await c.mutate("experiments.addArtifact", {
      path: note,
      source,
      caption: "x",
    });

    expect(reply.error?.message).toBe("notes/plain.md is not an Experiment.");
    expect(await readdir(join(vault, "notes"))).toEqual(["plain.md"]);
  });

  it("is the app's own write: the watcher does not raise the copy again as an arrival", async () => {
    const { vault, c } = await opened(undefined, { settleMs: 200 });
    const stream = await c.events();
    const source = await outside("funnel.png");

    await c.mutate("experiments.addArtifact", {
      path: PATH,
      source,
      caption: "Funnel.",
    });
    // The copy's own event, then the page's.
    expect((await stream.next("vaultChanged")).changed).toEqual([
      `${FOLDER}/funnel.png`,
    ]);
    expect((await stream.next("vaultChanged")).changed).toEqual([PATH]);

    // The proof of absence (`vault-watcher.test.ts`): the next event is a
    // later, unrelated write's, and names it alone.
    await writeFile(join(vault, "Sentinel.md"), "# Sentinel\n");
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["Sentinel.md"],
      removed: [],
      renamed: [],
    });
    stream.close();
  });
});

describe("experiments.page — the Artifacts", () => {
  it("reads each stored line as its file, caption, size and whether it is drawn as an image", async () => {
    const { c } = await opened({
      [PATH]: page(
        "- ![[funnel.png]] — Asymmetric.\n- ![[pooled-summary.csv]] — First rows.\n- ![[checkpoint notes.txt]]\n- a line the page cannot read yet"
      ),
      [`${FOLDER}/funnel.png`]: PLOT,
      [`${FOLDER}/pooled-summary.csv`]: "set,k,d\nall,41,0.44\n",
    });

    const { sections } = await pageOf(c);

    expect(sections.artifacts.items).toEqual([
      {
        kind: "stored",
        file: "funnel.png",
        caption: "Asymmetric.",
        path: `${FOLDER}/funnel.png`,
        size: PLOT.length,
        image: true,
        rows: false,
      },
      {
        kind: "stored",
        file: "pooled-summary.csv",
        caption: "First rows.",
        path: `${FOLDER}/pooled-summary.csv`,
        size: Buffer.byteLength("set,k,d\nall,41,0.44\n"),
        image: false,
        rows: true,
      },
      // Named in the line and not in the vault: shown, with nothing to size.
      {
        kind: "stored",
        file: "checkpoint notes.txt",
        caption: "",
        path: null,
        size: null,
        image: false,
        rows: true,
      },
      // Never dropped: what the user wrote is shown as written.
      { kind: "asWritten", text: "a line the page cannot read yet" },
    ]);
  });

  it("does not offer as in the vault a file the page could never draw — one outside the Experiments", async () => {
    const { c } = await opened({
      [PATH]: page("- ![[figs/plot.png]] — Kept elsewhere."),
      "figs/plot.png": PLOT,
    });

    const { sections } = await pageOf(c);

    expect(sections.artifacts.items).toEqual([
      {
        kind: "stored",
        file: "figs/plot.png",
        caption: "Kept elsewhere.",
        path: null,
        size: null,
        image: true,
        rows: false,
      },
    ]);
  });

  it("an added Artifact is on the page at once, in the order it was added", async () => {
    const { c } = await opened({
      [PATH]: page("- ![[first.png]] — First."),
      [`${FOLDER}/first.png`]: PLOT,
    });
    const source = await outside("second.png");

    await c.mutate("experiments.addArtifact", {
      path: PATH,
      source,
      caption: "Second.",
    });

    const { sections } = await pageOf(c);
    expect(
      sections.artifacts.items.map((a) => (a.kind === "stored" ? a.file : a))
    ).toEqual(["first.png", "second.png"]);
  });
});

describe("experiments.pickArtifact", () => {
  it("asks the Host for one file and answers with its path", async () => {
    const { c } = await opened(undefined, {
      host: fakeHost(null, "/Users/r/Desktop/plot.png"),
    });
    const reply = await c.mutate<{ source: string | null }>(
      "experiments.pickArtifact"
    );
    expect(reply.result?.data).toEqual({ source: "/Users/r/Desktop/plot.png" });
  });

  it("answers null when the chooser is cancelled", async () => {
    const { c } = await opened(undefined, { host: fakeHost(null, null) });
    const reply = await c.mutate<{ source: string | null }>(
      "experiments.pickArtifact"
    );
    expect(reply.result?.data).toEqual({ source: null });
  });
});

describe("the Artifact bytes route", () => {
  const auth = { authorization: "Bearer test-token" };

  it("serves a stored Artifact's bytes behind the bearer header, typed by its extension", async () => {
    const { c } = await opened({
      [PATH]: page("- ![[funnel.png]] — Asymmetric."),
      [`${FOLDER}/funnel.png`]: PLOT,
    });

    const res = await c.raw(`/artifacts/${encodeURI(`${FOLDER}/funnel.png`)}`, {
      headers: auth,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PLOT);
  });

  it("serves a name with spaces in it", async () => {
    const { c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/plot (2).png`]: PLOT,
    });
    const res = await c.raw(
      `/artifacts/${encodeURI(`${FOLDER}/plot (2).png`)}`,
      { headers: auth }
    );
    expect(res.status).toBe(200);
  });

  it("answers 401 without the header, and never takes the token from the URL", async () => {
    const { c } = await opened({
      [PATH]: page(),
      [`${FOLDER}/funnel.png`]: PLOT,
    });
    const bare = await c.raw(`/artifacts/${FOLDER}/funnel.png`);
    const inUrl = await c.raw(
      `/artifacts/${FOLDER}/funnel.png?token=test-token`
    );
    expect(bare.status).toBe(401);
    expect(inUrl.status).toBe(401);
  });

  it("serves nothing outside an Experiment's folder, nor a path that climbs out of the vault", async () => {
    const { c } = await opened({
      [PATH]: page(),
      "notes/private.png": PLOT,
    });
    for (const path of [
      "notes/private.png",
      `${FOLDER}/../../notes/private.png`,
      `${FOLDER}/%2e%2e/%2e%2e/notes/private.png`,
      `${FOLDER}/.hidden.png`,
      `${FOLDER}/missing.png`,
      // The page itself is read through the router, never as bytes.
      PATH,
    ]) {
      const res = await c.raw(`/artifacts/${path}`, { headers: auth });
      expect(res.status, path).toBe(404);
    }
  });
});
