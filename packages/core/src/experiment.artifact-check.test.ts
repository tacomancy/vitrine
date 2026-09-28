import { mkdir, open, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactCheck } from "./artifact.js";
import {
  closeCores,
  core,
  tmp,
  vaultWith,
  type CoreOptions,
} from "./test-core.js";
import type { WriteResult } from "./vault-files.js";

// Linked Artifacts checked when a run is trusted (#370; TEST-13; spec #362
// stories 52–54; ADR 0035 decisions 6–7): each linked line read back as
// *here and unchanged*, *on another machine* (named), *changed or gone*, or
// — a URL — *not checked here*. One temp vault plays both machines: the
// core that links is closed, and a core with another `machine` opens the
// same folder.

afterEach(() => {
  vi.restoreAllMocks();
  return closeCores();
});

type Added = WriteResult & { file: string };
type Checked = { checks: ArtifactCheck[] };

const PATH = "experiments/prereg-exclusions/prereg-exclusions.md";
const NOW = new Date(2026, 8, 28, 12, 0, 0);
const STUDIO = "Studio Mac";
const LAPTOP = "Laptop";
const MIB = 1024 * 1024;

const page = `---
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

## Observations

## Position history
`;

/** A file outside the vault, bigger than the two MiB the Fingerprint hashes whole, with a fixed modification time. */
async function heavy(name: string, fill = "a") {
  const source = join(await tmp("scratch"), name);
  await writeFile(source, Buffer.alloc(3 * MIB, fill));
  await utimes(
    source,
    new Date("2026-09-14T08:30:00Z"),
    new Date("2026-09-14T08:30:00Z")
  );
  return source;
}

async function opened(vault: string, opts: CoreOptions) {
  const c = await core({ now: () => NOW, ...opts });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return c;
}

/** A vault holding the run, opened on the Studio Mac. */
async function studio() {
  const vault = await vaultWith({});
  await mkdir(join(vault, "experiments/prereg-exclusions"), {
    recursive: true,
  });
  await writeFile(join(vault, PATH), page);
  return { vault, c: await opened(vault, { machine: STUDIO }) };
}

async function link(
  c: Awaited<ReturnType<typeof opened>>,
  source: string,
  caption = "the checkpoint"
) {
  const reply = await c.mutate<Added>("experiments.addArtifact", {
    path: PATH,
    source,
    as: "linked",
    caption,
  });
  expect(reply.error).toBeUndefined();
  expect(reply.result?.data.written).toBe(true);
}

async function checked(c: Awaited<ReturnType<typeof opened>>) {
  const reply = await c.query<Checked>("experiments.checkArtifacts", {
    path: PATH,
  });
  expect(reply.error).toBeUndefined();
  return reply.result!.data.checks;
}

describe("experiments.checkArtifacts", () => {
  it("says a file linked here, still here and untouched, is here and unchanged", async () => {
    const { c } = await studio();
    const source = await heavy("step-4000.ckpt");
    await link(c, source);

    expect(await checked(c)).toEqual([
      {
        file: "step-4000.ckpt",
        target: source,
        machine: STUDIO,
        outcome: "unchanged",
      },
    ]);
  });

  it("says a file edited since it was linked is changed or gone", async () => {
    const { c } = await studio();
    const source = await heavy("step-4000.ckpt");
    await link(c, source);

    const handle = await open(source, "a");
    await handle.write("one more step");
    await handle.close();

    expect((await checked(c))[0]?.outcome).toBe("changed");
  });

  it("says a file replaced by one of the same size and date is changed or gone, from its ends", async () => {
    const { c } = await studio();
    const source = await heavy("step-4000.ckpt");
    await link(c, source);
    const was = await stat(source);

    // Same size, and the date put back: only the hash of the ends can tell.
    await writeFile(source, Buffer.alloc(3 * MIB, "b"));
    await utimes(source, was.atime, was.mtime);
    expect((await stat(source)).size).toBe(was.size);

    expect((await checked(c))[0]?.outcome).toBe("changed");
  });

  it("says a file deleted since it was linked is changed or gone", async () => {
    const { c } = await studio();
    const source = await heavy("step-4000.ckpt");
    await link(c, source);

    await rm(source);

    expect((await checked(c))[0]?.outcome).toBe("changed");
  });

  it("names the other machine for a link made there, whatever this machine's disk holds at that path", async () => {
    const { vault, c } = await studio();
    const kept = await heavy("kept.ckpt");
    const gone = await heavy("gone.ckpt");
    await link(c, kept, "kept");
    await link(c, gone, "gone");
    await c.close();

    // The same vault, opened on the other Mac: one path still stats here,
    // one does not, and neither is this machine's to judge (decision 7).
    await rm(gone);
    const laptop = await opened(vault, { machine: LAPTOP });

    expect(await checked(laptop)).toEqual([
      {
        file: "kept.ckpt",
        target: kept,
        machine: STUDIO,
        outcome: "elsewhere",
      },
      {
        file: "gone.ckpt",
        target: gone,
        machine: STUDIO,
        outcome: "elsewhere",
      },
    ]);
  });

  it("says a URL is not checked here, and makes no network call to check it", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    const { c } = await studio();
    const url = "https://wandb.ai/lab/prereg/runs/7h2k/files/model.ckpt";
    await link(c, url, "the checkpoint on W&B");

    expect(await checked(c)).toEqual([
      {
        file: "model.ckpt",
        target: url,
        machine: STUDIO,
        outcome: "notChecked",
      },
    ]);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("does not check a URL whose line was hand-written with a size and Fingerprint", async () => {
    const vault = await vaultWith({});
    await mkdir(join(vault, "experiments/prereg-exclusions"), {
      recursive: true,
    });
    const url = "https://example.org/results.tar";
    await writeFile(
      join(vault, PATH),
      page.replace(
        "## Artifacts\n",
        `## Artifacts\n\n- results.tar — ${url} · 2.4 GB · 2026-09-14 · ${STUDIO} · 2400000000:1789000000000:0123456789ab — results\n`
      )
    );
    const c = await opened(vault, { machine: STUDIO });

    expect((await checked(c))[0]).toMatchObject({
      target: url,
      outcome: "notChecked",
    });
  });

  it("checks only linked lines, in the page's order", async () => {
    const { vault, c } = await studio();
    await writeFile(
      join(vault, "experiments/prereg-exclusions/pooled.png"),
      "png"
    );
    const stored = await c.mutate<WriteResult>("experiments.showArtifact", {
      path: PATH,
      file: "pooled.png",
      caption: "pooled effect",
    });
    expect(stored.error).toBeUndefined();
    const url = "https://example.org/results.tar";
    await link(c, url, "results");
    const source = await heavy("step-4000.ckpt");
    await link(c, source);

    expect((await checked(c)).map((check) => check.file)).toEqual([
      "results.tar",
      "step-4000.ckpt",
    ]);
  });

  it("refuses a page that is not an Experiment", async () => {
    const vault = await vaultWith({
      "notes/idle.md": "---\nkind: note\n---\n\nidle\n",
    });
    const c = await opened(vault, { machine: STUDIO });

    const reply = await c.query<Checked>("experiments.checkArtifacts", {
      path: "notes/idle.md",
    });
    expect(reply.error?.message).toMatch(/not an experiment/i);
  });
});
