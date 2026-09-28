import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentListing } from "./experiment.js";
import { closeCores, core, vaultWith } from "./test-core.js";

// The Experiment Inbox (#372; spec #362 stories 56–67): the runs that are
// complete and either have no observations or are Evidence for no
// Criterion — derived, never a flag, so a run leaves only by being written
// up *and* attached, or by being abandoned. Its two halves are facets; the
// status facets cover every run; the project facet is read from each run's
// `repo:` line. The one number is how many runs exist.

afterEach(closeCores);

const path = (name: string) => `experiments/${name}/${name}.md`;

type Run = {
  status?: string;
  created?: string;
  purpose?: string;
  where?: string;
  artifacts?: string;
  observations?: string;
};

const run = (name: string, r: Run = {}) => `---
id: ex-${name}
kind: experiment
name: "${name}"
status: ${r.status ?? "complete"}
${r.created === undefined ? "" : `created: ${r.created}\n`}tags: []
---

## Purpose

${r.purpose ?? ""}

## Design

## Where it ran

${r.where ?? ""}

## Artifacts

${r.artifacts ?? ""}

## Observations

${r.observations ?? ""}

## Position history
`;

const HYPOTHESIS = "hypotheses/The effect shrinks.md";
const hypothesis = (criteria: string, claim = "The effect shrinks.") => `---
id: hy-1
kind: hypothesis
promoted: 2026-09-20T10:00:00+02:00
context: reading
---

## Claim

${claim}

## Criteria

${criteria}

## Design notes

## Position history

- 2026-09-20T10:00:00+02:00 · claim
  from:
`;

const F1 =
  "### The effect survives the exclusion rule ^c1\n\nrelationship:: falsifying";

const day = (n: number) =>
  `2026-09-${String(n).padStart(2, "0")}T10:00:00+02:00`;

async function opened(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core({ settleMs: 40, now: () => new Date(day(28)) });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const inbox = async (input: Record<string, unknown> = {}) => {
    const reply = await c.query<ExperimentListing>("experiments.inbox", {
      facet: "inbox",
      sort: "newest",
      ...input,
    });
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  const names = async (input: Record<string, unknown> = {}) =>
    (await inbox(input)).experiments.map((e) => e.name);
  return { vault, c, inbox, names };
}

describe("experiments.inbox", () => {
  it("holds the complete runs that are unread or unattached, and nothing else", async () => {
    const { names } = await opened({
      [path("unread")]: run("unread", { created: day(1) }),
      [path("read")]: run("read", {
        created: day(2),
        observations: "It moved.",
      }),
      [path("done")]: run("done", {
        created: day(3),
        observations: "It held.",
      }),
      [path("attached-unread")]: run("attached-unread", { created: day(4) }),
      [path("planned")]: run("planned", { status: "planned", created: day(5) }),
      [path("running")]: run("running", { status: "running", created: day(6) }),
      [path("dropped")]: run("dropped", {
        status: "abandoned",
        created: day(7),
      }),
      [HYPOTHESIS]: hypothesis(
        `${F1}\n\n- [[done]] — held\n- [[attached-unread]] — not read yet`
      ),
    });
    expect(await names()).toEqual(["attached-unread", "read", "unread"]);
  });

  it("splits into its two halves as facets", async () => {
    const { names } = await opened({
      [path("unread")]: run("unread", { created: day(1) }),
      [path("read")]: run("read", {
        created: day(2),
        observations: "It moved.",
      }),
      [path("attached-unread")]: run("attached-unread", { created: day(4) }),
      [HYPOTHESIS]: hypothesis(`${F1}\n\n- [[attached-unread]] — a note`),
    });
    expect(await names({ facet: "not-yet-interpreted" })).toEqual([
      "attached-unread",
      "unread",
    ]);
    expect(await names({ facet: "read-unattached" })).toEqual(["read"]);
  });

  it("says of each row whether it is attached, read, or not yet read", async () => {
    const { inbox } = await opened({
      [path("unread")]: run("unread", { created: day(1) }),
      [path("read")]: run("read", {
        created: day(2),
        observations: "It moved.",
      }),
      [path("done")]: run("done", { created: day(3), observations: "Held." }),
      [HYPOTHESIS]: hypothesis(`${F1}\n\n- [[done]] — held`),
    });
    const listing = await inbox({ facet: "status" });
    expect(
      Object.fromEntries(listing.experiments.map((e) => [e.name, e.reading]))
    ).toEqual({ unread: "not yet read", read: "read", done: "attached" });
  });

  it("counts only an Evidence line under a Criterion as attached, not a mention", async () => {
    const { names } = await opened({
      [path("mentioned")]: run("mentioned", { observations: "Seen." }),
      [HYPOTHESIS]: hypothesis(
        F1,
        "The effect shrinks, as [[mentioned]] hinted."
      ),
    });
    expect(await names()).toEqual(["mentioned"]);
  });

  it("sees an Evidence line written in Obsidian once the watcher has told the Index", async () => {
    const { vault, c, names } = await opened({
      [path("read")]: run("read", { observations: "It moved." }),
      [HYPOTHESIS]: hypothesis(F1),
    });
    expect(await names()).toEqual(["read"]);
    const stream = await c.events();
    await writeFile(
      join(vault, HYPOTHESIS),
      hypothesis(`${F1}\n\n- [[read]] — written by hand`)
    );
    await stream.next("vaultChanged");
    await c.indexed();
    expect(await names()).toEqual([]);
  });

  it("covers every run by status, or all of them", async () => {
    const { names } = await opened({
      [path("a")]: run("a", { status: "planned", created: day(1) }),
      [path("b")]: run("b", { status: "running", created: day(2) }),
      [path("c")]: run("c", { status: "abandoned", created: day(3) }),
      [path("d")]: run("d", { created: day(4), observations: "x" }),
    });
    expect(await names({ facet: "status" })).toEqual(["d", "c", "b", "a"]);
    expect(await names({ facet: "status", status: "planned" })).toEqual(["a"]);
    expect(await names({ facet: "status", status: "abandoned" })).toEqual([
      "c",
    ]);
  });

  it("offers the projects named by `repo:` lines, and narrows to one", async () => {
    const { inbox, names } = await opened({
      [path("a")]: run("a", {
        created: day(1),
        where: "repo: nap-reanalysis\ncommit: 8c41f0d",
      }),
      [path("b")]: run("b", { created: day(2), where: "- Repo: tmr-sim" }),
      [path("c")]: run("c", { created: day(3), where: "repo: nap-reanalysis" }),
      [path("d")]: run("d", { created: day(4) }),
    });
    const listing = await inbox();
    expect(listing.projects).toEqual(["nap-reanalysis", "tmr-sim"]);
    expect(listing.experiments.map((e) => e.project)).toEqual([
      null,
      "nap-reanalysis",
      "tmr-sim",
      "nap-reanalysis",
    ]);
    expect(await names({ project: "nap-reanalysis" })).toEqual(["c", "a"]);
  });

  it("offers no project when no run names a repo", async () => {
    const { inbox } = await opened({
      [path("a")]: run("a", { where: "commit: 8c41f0d" }),
    });
    expect((await inbox()).projects).toEqual([]);
  });

  it("sorts by newest, oldest, most Artifacts, or a shuffle that holds still", async () => {
    const files: Record<string, string> = {
      [path("one")]: run("one", {
        created: day(1),
        artifacts: "- ![[a.png]] — a",
      }),
      [path("three")]: run("three", {
        created: day(2),
        artifacts: "- ![[a.png]] — a\n- ![[b.png]] — b\n- ![[c.csv]] — c",
      }),
      [path("none")]: run("none", { created: day(3) }),
    };
    for (let n = 4; n < 12; n += 1)
      files[path(`r${n}`)] = run(`r${n}`, { created: day(n) });
    const { names } = await opened(files);
    const newest = await names({ sort: "newest" });
    expect(newest.slice(-3)).toEqual(["none", "three", "one"]);
    expect(await names({ sort: "oldest" })).toEqual([...newest].reverse());
    expect((await names({ sort: "most-artifacts" })).slice(0, 2)).toEqual([
      "three",
      "one",
    ]);
    const shuffled = await names({ sort: "shuffle", seed: 7 });
    expect([...shuffled].sort()).toEqual([...newest].sort());
    expect(shuffled).not.toEqual(newest);
    // The same seed is the same order, so a re-read does not reshuffle
    // the list under the selection.
    expect(await names({ sort: "shuffle", seed: 7 })).toEqual(shuffled);
  });

  it("carries what a row and the detail pane show", async () => {
    const { inbox } = await opened({
      [path("sweep-7")]: run("sweep-7", {
        created: day(9),
        purpose: "See whether X matters at all.",
        where: "repo: nap-reanalysis\ncommit: 8c41f0d",
        artifacts: "- ![[funnel.png]] — funnel\n- ![[summary.csv]] — rows",
      }),
    });
    const [row] = (await inbox()).experiments;
    expect(row).toMatchObject({
      path: path("sweep-7"),
      name: "sweep-7",
      status: "complete",
      purpose: "See whether X matters at all.",
      when: day(9),
      artifacts: 2,
      firstArtifact: { kind: "stored", file: "funnel.png", caption: "funnel" },
      whereItRan: [
        { label: "repo", value: "nap-reanalysis" },
        { label: "commit", value: "8c41f0d" },
      ],
      reading: "not yet read",
    });
    expect(row!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("counts every run in the vault, whatever the facet shows", async () => {
    const { inbox } = await opened({
      [path("a")]: run("a", { status: "planned" }),
      [path("b")]: run("b"),
      [path("c")]: run("c", { status: "abandoned" }),
    });
    const listing = await inbox({ facet: "read-unattached" });
    expect(listing.experiments).toEqual([]);
    expect(listing.runs).toBe(3);
  });

  it("lets a run leave only once written up and attached, or abandoned", async () => {
    const { c, names } = await opened({
      [path("r")]: run("r", { created: day(1) }),
      [path("s")]: run("s", { created: day(2) }),
      [HYPOTHESIS]: hypothesis(F1),
    });
    const hash = async (p: string) =>
      (await c.query<{ hash: string }>("experiments.page", { path: p })).result!
        .data.hash;
    const hypothesisHash = async () =>
      (await c.query<{ hash: string }>("hypotheses.page", { path: HYPOTHESIS }))
        .result!.data.hash;

    // Attached, not yet written up: still here.
    await c.mutate("experiments.attachEvidence", {
      hypothesis: HYPOTHESIS,
      criterion: "c1",
      experiment: path("r"),
      note: "it held",
      basedOn: await hypothesisHash(),
    });
    expect(await names()).toEqual(["s", "r"]);
    // Written up too: gone.
    await c.mutate("experiments.savePosition", {
      path: path("r"),
      field: "observations",
      text: "It held.",
      basedOn: await hash(path("r")),
      was: "",
    });
    expect(await names()).toEqual(["s"]);
    // Abandoned (`D`): gone, and still a run.
    await c.mutate("experiments.setStatus", {
      path: path("s"),
      status: "abandoned",
      basedOn: await hash(path("s")),
    });
    expect(await names()).toEqual([]);
    expect(await names({ facet: "status", status: "abandoned" })).toEqual([
      "s",
    ]);
  });
});
