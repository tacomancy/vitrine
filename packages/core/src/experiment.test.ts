import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentPage } from "./experiment.js";
import type { Destinations } from "./destinations.js";
import { localIso } from "./time.js";
import { closeCores, core, sha256, vaultWith } from "./test-core.js";
import type { WriteResult } from "./vault-files.js";

afterEach(closeCores);

type Vault = { name: string; path: string };
type Readable = Extract<ExperimentPage, { readable: true }>;

const NOW = new Date("2026-09-28T09:30:00Z");

/** A core on a temp vault holding `files`, opened and indexed, its clock and ids pinned. */
async function opened(files: Record<string, string> = {}) {
  const vault = await vaultWith(files);
  const c = await core({ now: () => NOW, newId: () => "ex4k8m2p9q" });
  const reply = await c.mutate<Vault>("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

async function pageOf(
  c: Awaited<ReturnType<typeof opened>>["c"],
  path: string
): Promise<Readable> {
  const reply = await c.query<ExperimentPage>("experiments.page", { path });
  expect(reply.error).toBeUndefined();
  const page = reply.result?.data as ExperimentPage;
  expect(page.readable).toBe(true);
  return page as Readable;
}

const PATH = "experiments/prereg-exclusions/prereg-exclusions.md";

/** A hand-written Experiment, as Obsidian or a script might leave one. */
const experiment = ({
  status = "complete",
  purpose = "See whether the pooled effect survives the exclusion rule at all.",
  whereItRan = "repo: nap-reanalysis\ncommit: 8c41f0d\nw&b: nap-reanalysis/3f2a91",
  from = null as string | null,
} = {}) => `---
id: ex9q2w7m4k
kind: experiment
name: "prereg-exclusions"
status: ${status}
created: 2026-09-09T10:00:00+02:00
${from === null ? "" : `from: "${from}"\n`}tags: []
---

## Purpose

${purpose}

## Design

Varied: the inclusion rule only.

## Where it ran

${whereItRan}

## Artifacts

## Observations

## Position history
`;

describe("experiments.create", () => {
  it("writes the folder and the page, frontmatter and six headings in order", async () => {
    const { vault, c } = await opened();
    const reply = await c.mutate<{ path: string }>("experiments.create", {
      name: "leave-one-lab-out",
    });
    expect(reply.error).toBeUndefined();
    const path = "experiments/leave-one-lab-out/leave-one-lab-out.md";
    expect(reply.result?.data).toEqual({ path });
    // The bytes, because Obsidian is the other reader of this file.
    expect(await readFile(join(vault, path), "utf8")).toBe(
      [
        "---",
        "id: ex4k8m2p9q",
        "kind: experiment",
        'name: "leave-one-lab-out"',
        "status: planned",
        `created: ${localIso(NOW)}`,
        "tags: []",
        "---",
        "",
        "## Purpose",
        "",
        "## Design",
        "",
        "## Where it ran",
        "",
        "## Artifacts",
        "",
        "## Observations",
        "",
        "## Position history",
        "",
      ].join("\n")
    );
  });

  it("keeps the name as typed and strips the folder's by the Question's rule", async () => {
    const { vault, c } = await opened();
    const reply = await c.mutate<{ path: string }>("experiments.create", {
      name: "  run: 2026/09 #3?  ",
    });
    expect(reply.error).toBeUndefined();
    const path = "experiments/run 202609 3/run 202609 3.md";
    expect(reply.result?.data).toEqual({ path });
    const text = await readFile(join(vault, path), "utf8");
    // The Display name is what was typed; only the file name had to drop characters.
    expect(text).toContain('name: "run: 2026/09 #3?"');
    const page = await pageOf(c, path);
    expect(page.frontmatter.name).toBe("run: 2026/09 #3?");
  });

  it("refuses a taken name with its reason and never suffixes it", async () => {
    const { vault, c } = await opened({ [PATH]: experiment() });
    const before = await readFile(join(vault, PATH), "utf8");
    const reply = await c.mutate("experiments.create", {
      name: "prereg-exclusions",
    });
    expect(reply.error?.message).toBe(
      "An Experiment named prereg-exclusions is already in the vault; the name is its folder, so pick another."
    );
    expect(reply.error?.data.kind).toBe("refused");
    expect(await readdir(join(vault, "experiments"))).toEqual([
      "prereg-exclusions",
    ]);
    expect(await readFile(join(vault, PATH), "utf8")).toBe(before);
  });

  it("refuses a folder already there, even without a page in it — its files are not the new run's", async () => {
    const { vault, c } = await opened();
    await mkdir(join(vault, "experiments/sweep-7"), { recursive: true });
    await writeFile(join(vault, "experiments/sweep-7/loss.png"), "png");
    const reply = await c.mutate("experiments.create", { name: "sweep-7" });
    expect(reply.error?.data.kind).toBe("refused");
    expect(await readdir(join(vault, "experiments/sweep-7"))).toEqual([
      "loss.png",
    ]);
  });

  it("refuses an empty name, and one with nothing left once stripped", async () => {
    const { vault, c } = await opened();
    const empty = await c.mutate("experiments.create", { name: "   " });
    expect(empty.error?.message).toBe(
      "An Experiment needs a name: type the short handle the run goes by."
    );
    const stripped = await c.mutate("experiments.create", { name: "???" });
    expect(stripped.error?.message).toBe(
      'Nothing in "???" can name a folder; use letters or digits.'
    );
    await expect(readdir(join(vault, "experiments"))).rejects.toThrow();
  });

  it("never touches any Question's Status", async () => {
    const question =
      '---\nkind: question\nquestion: "Does it survive?"\nstatus: open\ncaptured: 2026-08-01T09:00:00+01:00\n---\n';
    const { vault, c } = await opened({
      "questions/Does it survive.md": question,
    });
    const reply = await c.mutate("experiments.create", {
      name: "Does it survive",
    });
    expect(reply.error).toBeUndefined();
    expect(
      await readFile(join(vault, "questions/Does it survive.md"), "utf8")
    ).toBe(question);
  });

  it("made from a Criterion, says the Hypothesis it came from", async () => {
    const hypothesis = "hypotheses/Exclusions shrink the effect.md";
    const { vault, c } = await opened({
      [hypothesis]:
        "---\nkind: hypothesis\n---\n\n## Claim\n\nExclusions shrink the effect.\n",
    });
    const before = await readFile(join(vault, hypothesis), "utf8");
    const reply = await c.mutate<{ path: string }>("experiments.create", {
      name: "sweep-7",
      from: hypothesis,
    });
    expect(reply.error).toBeUndefined();
    const path = "experiments/sweep-7/sweep-7.md";
    // Between `created` and `tags`, where § Vault layout (Experiment) puts it.
    expect(await readFile(join(vault, path), "utf8")).toContain(
      `created: ${localIso(NOW)}\nfrom: "[[Exclusions shrink the effect]]"\ntags: []\n`
    );
    const page = await pageOf(c, path);
    expect(page.cameFrom).toEqual({
      text: "[[Exclusions shrink the effect]]",
      path: hypothesis,
      kind: "hypothesis",
      display: "Exclusions shrink the effect.",
    });
    // Not a Promotion: what it came from is not written to.
    expect(await readFile(join(vault, hypothesis), "utf8")).toBe(before);
  });

  it("refuses a came-from that is not in the vault, and makes nothing", async () => {
    const { vault, c } = await opened();
    const reply = await c.mutate("experiments.create", {
      name: "sweep-7",
      from: "hypotheses/Gone.md",
    });
    expect(reply.error?.data.kind).toBe("refused");
    await expect(readdir(join(vault, "experiments"))).rejects.toThrow();
  });

  it("is indexed at once: ⌘K finds it by its name", async () => {
    const { c } = await opened();
    await c.mutate("experiments.create", { name: "run: sweep 7" });
    const found = await c.query<Destinations>("globalCommand.destinations", {
      query: "sweep 7",
    });
    expect(found.result?.data.rows).toEqual([
      {
        kind: "experiment",
        path: "experiments/run sweep 7/run sweep 7.md",
        display: "run: sweep 7",
      },
    ]);
  });
});

describe("experiments.page", () => {
  it("reads the frontmatter, the sections, and where it ran as the user's own labels", async () => {
    const { c } = await opened({
      [PATH]: experiment({
        whereItRan:
          "repo: nap-reanalysis\ncommit: 8c41f0d · clean tree\nw&b: nap-reanalysis/3f2a91\na line with no label",
      }),
    });
    const page = await pageOf(c, PATH);
    expect(page.frontmatter).toEqual({
      id: "ex9q2w7m4k",
      name: "prereg-exclusions",
      status: "complete",
      statusUnreadable: null,
      created: "2026-09-09T10:00:00+02:00",
      tags: [],
    });
    expect(page.sections.purpose.text).toBe(
      "See whether the pooled effect survives the exclusion rule at all."
    );
    expect(page.sections.design.text).toBe("Varied: the inclusion rule only.");
    expect(page.sections.whereItRan.lines).toEqual([
      { label: "repo", value: "nap-reanalysis" },
      { label: "commit", value: "8c41f0d · clean tree" },
      { label: "w&b", value: "nap-reanalysis/3f2a91" },
      // Kept, not dropped: what the user wrote is shown even without a label.
      { label: null, value: "a line with no label" },
    ]);
    expect(page.sections.artifacts.text).toBe("");
    expect(page.sections.observations.text).toBe("");
    expect(page.cameFrom).toBeNull();
    expect(page.problems).toEqual([]);
  });

  it("names what it came from, resolved through the index", async () => {
    const { c } = await opened({
      [PATH]: experiment({ from: "[[Four of the 41 share a first author]]" }),
      "questions/Four of the 41 share a first author.md":
        '---\nkind: question\nquestion: "Four of the 41 share a first author — does that matter?"\ncaptured: 2026-09-16T09:00:00+01:00\n---\n',
    });
    const page = await pageOf(c, PATH);
    expect(page.cameFrom).toEqual({
      text: "[[Four of the 41 share a first author]]",
      path: "questions/Four of the 41 share a first author.md",
      kind: "question",
      display: "Four of the 41 share a first author — does that matter?",
    });
  });

  it("says a came-from link that lands nowhere, rather than dropping it", async () => {
    const { c } = await opened({ [PATH]: experiment({ from: "[[Gone]]" }) });
    const page = await pageOf(c, PATH);
    expect(page.cameFrom).toEqual({
      text: "[[Gone]]",
      path: null,
      kind: null,
      display: null,
    });
  });

  it("keeps a status outside the vocabulary visible instead of reading it as none", async () => {
    const { c } = await opened({ [PATH]: experiment({ status: "done" }) });
    const page = await pageOf(c, PATH);
    expect(page.frontmatter.status).toBeNull();
    expect(page.frontmatter.statusUnreadable).toBe("done");
  });

  it("is not a page for a file of another Kind", async () => {
    const { c } = await opened({
      "notes/x.md": "---\nkind: hypothesis\n---\n",
    });
    const reply = await c.query<ExperimentPage>("experiments.page", {
      path: "notes/x.md",
    });
    expect(reply.result?.data).toEqual({
      readable: false,
      path: "notes/x.md",
      reason: "not an Experiment: kind is hypothesis",
    });
  });

  it("reports a heading it could not find", async () => {
    const { c } = await opened({
      [PATH]: experiment().replace("## Where it ran\n", ""),
    });
    const page = await pageOf(c, PATH);
    expect(page.sections.whereItRan.present).toBe(false);
    expect(page.problems).toContainEqual({
      path: PATH,
      kind: "experiment",
      problem: "sectionMissing",
      block: "Where it ran",
    });
  });
});

describe("experiments.saveSection", () => {
  it("saves Purpose as typed, with no Revision", async () => {
    const { vault, c } = await opened({ [PATH]: experiment() });
    const page = await pageOf(c, PATH);
    const reply = await c.mutate<WriteResult>("experiments.saveSection", {
      path: PATH,
      section: "Purpose",
      body: "See whether X matters at all.\n",
      basedOn: page.hash,
      was: page.sections.purpose.text,
    });
    expect(reply.result?.data.written).toBe(true);
    const text = await readFile(join(vault, PATH), "utf8");
    expect(text).toBe(experiment({ purpose: "See whether X matters at all." }));
    expect(text).toMatch(/## Position history\n$/);
  });

  it("saves where it ran as label: value lines the user chose", async () => {
    const { vault, c } = await opened({ [PATH]: experiment() });
    const page = await pageOf(c, PATH);
    const lines =
      "repo: nap-reanalysis\nnotebook: loo.ipynb\nout: out/2026-09-14/";
    const reply = await c.mutate<WriteResult>("experiments.saveSection", {
      path: PATH,
      section: "Where it ran",
      body: lines,
      basedOn: page.hash,
      was: page.sections.whereItRan.text,
    });
    expect(reply.result?.data.written).toBe(true);
    expect(await readFile(join(vault, PATH), "utf8")).toBe(
      experiment({ whereItRan: lines })
    );
    const after = await pageOf(c, PATH);
    expect(after.sections.whereItRan.lines).toEqual([
      { label: "repo", value: "nap-reanalysis" },
      { label: "notebook", value: "loo.ipynb" },
      { label: "out", value: "out/2026-09-14/" },
    ]);
  });

  it("refuses a section changed underneath rather than overwriting it", async () => {
    const { vault, c } = await opened({ [PATH]: experiment() });
    const page = await pageOf(c, PATH);
    const edited = experiment({ purpose: "Edited in Obsidian meanwhile." });
    await writeFile(join(vault, PATH), edited);
    const reply = await c.mutate<WriteResult>("experiments.saveSection", {
      path: PATH,
      section: "Purpose",
      body: "Typed on the page.",
      basedOn: page.hash,
      was: page.sections.purpose.text,
    });
    expect(reply.result?.data).toEqual({
      written: false,
      reason: "changedAndUnreapplyable",
      detail: "the section changed on disk since the page read it",
    });
    expect(await readFile(join(vault, PATH), "utf8")).toBe(edited);
  });

  it("accepts only the two Edited sections: Design and Observations are Positions", async () => {
    const { c } = await opened({ [PATH]: experiment() });
    const page = await pageOf(c, PATH);
    const reply = await c.mutate("experiments.saveSection", {
      path: PATH,
      section: "Design",
      body: "x",
      basedOn: page.hash,
      was: page.sections.design.text,
    });
    expect(reply.error).toBeDefined();
  });
});

describe("experiments.setStatus", () => {
  it("writes status: and adds nothing to the Position history", async () => {
    const { vault, c } = await opened({ [PATH]: experiment() });
    const page = await pageOf(c, PATH);
    const reply = await c.mutate<WriteResult>("experiments.setStatus", {
      path: PATH,
      status: "abandoned",
      basedOn: page.hash,
    });
    expect(reply.result?.data.written).toBe(true);
    const text = await readFile(join(vault, PATH), "utf8");
    expect(text).toBe(experiment({ status: "abandoned" }));
    expect((await pageOf(c, PATH)).sections.positionHistory.entries).toEqual(
      []
    );
  });

  it("writes nothing for the status the file already holds", async () => {
    const { vault, c } = await opened({ [PATH]: experiment() });
    const page = await pageOf(c, PATH);
    const reply = await c.mutate<WriteResult>("experiments.setStatus", {
      path: PATH,
      status: "complete",
      basedOn: page.hash,
    });
    expect(reply.result?.data).toMatchObject({
      written: true,
      hash: page.hash,
    });
    expect(sha256(await readFile(join(vault, PATH)))).toBe(page.hash);
  });

  it("refuses a status outside the four", async () => {
    const { c } = await opened({ [PATH]: experiment() });
    const page = await pageOf(c, PATH);
    const reply = await c.mutate("experiments.setStatus", {
      path: PATH,
      status: "done",
      basedOn: page.hash,
    });
    expect(reply.error).toBeDefined();
  });
});

describe("an Evidence line naming an Experiment", () => {
  it("resolves to the Experiment on the Hypothesis page", async () => {
    const hypothesis = `---
kind: hypothesis
---

## Claim

The pooled effect shrinks below d = 0.20.

## Criteria

### The preregistered reanalysis shrinks it ^c1

relationship:: falsifying
outcome:: met

- [[prereg-exclusions]] — d = 0.41; the effect did not move.

## Design notes

## Position history
`;
    const { c } = await opened({
      [PATH]: experiment(),
      "hypotheses/The pooled effect shrinks.md": hypothesis,
    });
    const reply = await c.query<{
      readable: true;
      sections: {
        criteria: {
          criteria: Array<{
            evidence: Array<{
              link: { resolvedPath: string; resolvedKind: string } | null;
            }>;
          }>;
        };
      };
    }>("hypotheses.page", { path: "hypotheses/The pooled effect shrinks.md" });
    const line = reply.result?.data.sections.criteria.criteria[0]?.evidence[0];
    expect(line?.link).toMatchObject({
      resolvedPath: PATH,
      resolvedKind: "experiment",
    });
  });
});
