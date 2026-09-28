import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentPage } from "./experiment.js";
import {
  closeCores,
  core,
  tmp,
  vaultWith,
  type CoreOptions,
} from "./test-core.js";
import type { WriteResult } from "./vault-files.js";

// A heavy Artifact proposed as linked, with its machine and Fingerprint
// (#369; spec #362 stories 29–31, 39–40; ADR 0035 decisions 4–5): the
// proposal either side of 25 MB, the override both ways, the linked line's
// exact bytes, and a URL linked with no Fingerprint.

afterEach(closeCores);

type Vault = { name: string; path: string };
type Readable = Extract<ExperimentPage, { readable: true }>;
type Added = WriteResult & { file: string };
type Inspected = { size: number | null; proposed: "stored" | "linked" };

const PATH = "experiments/prereg-exclusions/prereg-exclusions.md";
const FOLDER = "experiments/prereg-exclusions";
const MIB = 1024 * 1024;
// 25 MB as the ADR and Finder count it: decimal megabytes.
const THRESHOLD = 25_000_000;
// Local noon, so the date the line records is the same in every zone the
// suite runs in.
const NOW = new Date(2026, 8, 28, 12, 0, 0);
const MACHINE = "Studio Mac";

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

/**
 * A file of `size` bytes outside the vault, sparse where the filesystem
 * allows: only its first and last bytes are written, and they differ, so a
 * Fingerprint that skipped either end would not match the one computed here.
 */
async function heavy(name: string, size: number) {
  const source = join(await tmp("desktop"), name);
  const handle = await open(source, "w");
  try {
    await handle.truncate(size);
    await handle.write(Buffer.from("head"), 0, 4, 0);
    await handle.write(Buffer.from("tail"), 0, 4, size - 4);
  } finally {
    await handle.close();
  }
  // A modification time the line can be read against.
  const mtime = new Date("2026-09-14T08:30:00Z");
  await utimes(source, mtime, mtime);
  return source;
}

/** The Fingerprint as `docs/architecture.md` § Vault layout (Experiment) writes it, derived here independently. */
async function fingerprintOf(source: string) {
  const bytes = await readFile(source);
  const { size, mtimeMs } = await stat(source);
  const hashed =
    size <= 2 * MIB
      ? bytes
      : Buffer.concat([bytes.subarray(0, MIB), bytes.subarray(size - MIB)]);
  const sha = createHash("sha256").update(hashed).digest("hex").slice(0, 12);
  return `${size}:${Math.floor(mtimeMs)}:${sha}`;
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
  const c = await core({ now: () => NOW, machine: MACHINE, ...opts });
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

const folderHolds = async (vault: string) =>
  (await readdir(join(vault, FOLDER))).sort();

describe("experiments.inspectArtifact", () => {
  it("proposes stored just under 25 MB and linked at 25 MB (KEEP-9)", async () => {
    const { c } = await opened();
    const under = await heavy("under.parquet", THRESHOLD - 1);
    const at = await heavy("at.parquet", THRESHOLD);

    const small = await c.query<Inspected>("experiments.inspectArtifact", {
      source: under,
    });
    const large = await c.query<Inspected>("experiments.inspectArtifact", {
      source: at,
    });

    expect(small.result?.data).toEqual({
      size: THRESHOLD - 1,
      proposed: "stored",
    });
    expect(large.result?.data).toEqual({ size: THRESHOLD, proposed: "linked" });
  });

  it("proposes a URL as linked, with no size, since nothing is fetched", async () => {
    const { c } = await opened();

    const reply = await c.query<Inspected>("experiments.inspectArtifact", {
      source: "https://wandb.ai/lab/nap-reanalysis/runs/3f2a",
    });

    expect(reply.result?.data).toEqual({ size: null, proposed: "linked" });
  });

  it("refuses a source that is not a file", async () => {
    const { c } = await opened();
    const folder = await tmp("desktop");

    const reply = await c.query("experiments.inspectArtifact", {
      source: join(folder, "never-written.pt"),
    });

    expect(reply.error?.message).toBe(
      "never-written.pt is not a file that can be read."
    );
  });
});

describe("experiments.addArtifact — linked", () => {
  it("writes the linked line with its path, size, date, machine and Fingerprint, and copies nothing", async () => {
    const { vault, c } = await opened();
    const source = await heavy(
      "bootstrap-draws.parquet",
      THRESHOLD + 3_000_000
    );
    const fingerprint = await fingerprintOf(source);

    const reply = await c.mutate<Added>("experiments.addArtifact", {
      path: PATH,
      source,
      as: "linked",
      caption: "Every bootstrap draw, before pooling.",
    });

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toMatchObject({
      written: true,
      file: "bootstrap-draws.parquet",
    });
    // The bytes, because Obsidian is the other reader (ADR 0035 decision 5).
    expect(await readFile(join(vault, PATH), "utf8")).toBe(
      page(
        `- bootstrap-draws.parquet — ${source} · 28.0 MB · 2026-09-28 · Studio Mac · ${fingerprint} — Every bootstrap draw, before pooling.`
      )
    );
    expect(await folderHolds(vault)).toEqual(["prereg-exclusions.md"]);
    // The source is only read.
    expect((await stat(source)).size).toBe(THRESHOLD + 3_000_000);
  });

  it("hashes a file of 2 MiB or less whole, since its ends are all of it", async () => {
    const { vault, c } = await opened();
    const source = join(await tmp("desktop"), "notes.txt");
    await writeFile(source, "a small file, linked by choice\n");
    const fingerprint = await fingerprintOf(source);

    await c.mutate<Added>("experiments.addArtifact", {
      path: PATH,
      source,
      as: "linked",
      caption: "Linked rather than copied.",
    });

    expect(await readFile(join(vault, PATH), "utf8")).toContain(
      ` · ${MACHINE} · ${fingerprint} — Linked rather than copied.`
    );
  });

  it("records the machine it was given, whatever it is called", async () => {
    const { vault, c } = await opened(undefined, { machine: "laptop" });
    const source = await heavy("weights.pt", THRESHOLD);

    await c.mutate("experiments.addArtifact", {
      path: PATH,
      source,
      as: "linked",
      caption: "Final weights.",
    });

    expect(await readFile(join(vault, PATH), "utf8")).toContain(
      " · 2026-09-28 · laptop · "
    );
  });

  it("links a URL with no size and no Fingerprint", async () => {
    const { vault, c } = await opened();

    const reply = await c.mutate<Added>("experiments.addArtifact", {
      path: PATH,
      source: "https://wandb.ai/lab/nap-reanalysis/runs/3f2a",
      as: "linked",
      caption: "The sweep's panel.",
    });

    expect(reply.result?.data).toMatchObject({ written: true, file: "3f2a" });
    expect(await readFile(join(vault, PATH), "utf8")).toBe(
      page(
        "- 3f2a — https://wandb.ai/lab/nap-reanalysis/runs/3f2a · 2026-09-28 · Studio Mac — The sweep's panel."
      )
    );
  });

  it("refuses to store a URL, since there are no bytes to copy", async () => {
    const { vault, c } = await opened();

    const reply = await c.mutate("experiments.addArtifact", {
      path: PATH,
      source: "https://wandb.ai/lab/nap-reanalysis/runs/3f2a",
      as: "stored",
      caption: "x",
    });

    expect(reply.error?.message).toBe(
      "A URL can only be linked: there is no file to copy in."
    );
    expect(await readFile(join(vault, PATH), "utf8")).toBe(page());
  });

  it("refuses a source that is not a file, and writes no line", async () => {
    const { vault, c } = await opened();
    const folder = await tmp("desktop");

    const reply = await c.mutate("experiments.addArtifact", {
      path: PATH,
      source: join(folder, "never-written.pt"),
      as: "linked",
      caption: "x",
    });

    expect(reply.error?.message).toBe(
      "never-written.pt is not a file that can be read."
    );
    expect(await readFile(join(vault, PATH), "utf8")).toBe(page());
  });
});

describe("a path the line must carry back", () => {
  it("reads back a path with the line's own dash in it as the path it was", async () => {
    const { vault, c } = await opened();
    const folder = join(await tmp("desktop"), "run 3 — final");
    await mkdir(folder);
    const source = join(folder, "weights.pt");
    await writeFile(source, "weights");

    await c.mutate("experiments.addArtifact", {
      path: PATH,
      source,
      as: "linked",
      caption: "Final — after the rerun.",
    });

    expect(await readFile(join(vault, PATH), "utf8")).toContain(
      `- weights.pt — ${source} · 7 B · `
    );
    const [item] = (await pageOf(c)).sections.artifacts.items;
    expect(item).toMatchObject({
      kind: "linked",
      target: source,
      description: "Final — after the rerun.",
    });
  });

  it("refuses a path with a line break in it, which the list item could not hold", async () => {
    const { vault, c } = await opened();
    const folder = join(await tmp("desktop"), "two\nlines");
    await mkdir(folder);
    const source = join(folder, "weights.pt");
    await writeFile(source, "weights");

    const reply = await c.mutate("experiments.addArtifact", {
      path: PATH,
      source,
      as: "linked",
      caption: "x",
    });

    expect(reply.error?.message).toBe(
      "weights.pt cannot be linked: its path has a line break in it."
    );
    expect(await readFile(join(vault, PATH), "utf8")).toBe(page());
  });
});

describe("the override (story 31)", () => {
  it("stores a file at 25 MB when asked to", async () => {
    const { vault, c } = await opened();
    const source = await heavy("big-plot.png", THRESHOLD);

    const reply = await c.mutate<Added>("experiments.addArtifact", {
      path: PATH,
      source,
      as: "stored",
      caption: "Stored anyway.",
    });

    expect(reply.result?.data.written).toBe(true);
    expect(await folderHolds(vault)).toEqual([
      "big-plot.png",
      "prereg-exclusions.md",
    ]);
    expect(await readFile(join(vault, PATH), "utf8")).toBe(
      page("- ![[big-plot.png]] — Stored anyway.")
    );
  });

  it("links a small file when asked to, and copies nothing", async () => {
    const { vault, c } = await opened();
    const source = join(await tmp("desktop"), "tiny.csv");
    await writeFile(source, "k,d\n41,0.44\n");

    await c.mutate("experiments.addArtifact", {
      path: PATH,
      source,
      as: "linked",
      caption: "Not copied.",
    });

    expect(await folderHolds(vault)).toEqual(["prereg-exclusions.md"]);
    expect(await readFile(join(vault, PATH), "utf8")).toMatch(
      /^- tiny\.csv — .* · 12 B · 2026-09-28 · Studio Mac · 12:\d+:[0-9a-f]{12} — Not copied\.$/m
    );
  });
});

describe("experiments.page — a linked Artifact", () => {
  it("reads a linked line as its target, size, date, machine and Fingerprint, in the file's order", async () => {
    const { c } = await opened({
      [PATH]: page(
        [
          "- ![[funnel.png]] — Asymmetric.",
          "- bootstrap-draws.parquet — /Users/r/out/bootstrap-draws.parquet · 2.4 GB · 2026-09-14 · Studio Mac · 2576980378:1789374600000:4f2ac1e9b0d3 — Every draw — before pooling.",
          "- 3f2a — https://wandb.ai/lab/runs/3f2a · 2026-09-15 · laptop — The panel.",
        ].join("\n")
      ),
      [`${FOLDER}/funnel.png`]: "png",
    });

    const { sections } = await pageOf(c);

    expect(sections.artifacts.items.slice(1)).toEqual([
      {
        kind: "linked",
        file: "bootstrap-draws.parquet",
        target: "/Users/r/out/bootstrap-draws.parquet",
        url: false,
        size: "2.4 GB",
        date: "2026-09-14",
        machine: "Studio Mac",
        fingerprint: "2576980378:1789374600000:4f2ac1e9b0d3",
        description: "Every draw — before pooling.",
      },
      {
        kind: "linked",
        file: "3f2a",
        target: "https://wandb.ai/lab/runs/3f2a",
        url: true,
        size: null,
        date: "2026-09-15",
        machine: "laptop",
        fingerprint: null,
        description: "The panel.",
      },
    ]);
  });

  it("reads back the line it wrote", async () => {
    const { c } = await opened();
    const source = await heavy("weights.pt", THRESHOLD);

    await c.mutate("experiments.addArtifact", {
      path: PATH,
      source,
      as: "linked",
      caption: "Final weights.",
    });

    const { sections } = await pageOf(c);
    expect(sections.artifacts.items).toEqual([
      {
        kind: "linked",
        file: "weights.pt",
        target: source,
        url: false,
        size: "25.0 MB",
        date: "2026-09-28",
        machine: MACHINE,
        fingerprint: await fingerprintOf(source),
        description: "Final weights.",
      },
    ]);
  });
});
