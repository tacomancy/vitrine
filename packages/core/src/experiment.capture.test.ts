import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ExperimentPage } from "./experiment.js";
import type { ListedQuestion } from "./question-kind.js";
import type { Question } from "./questions.js";
import { closeCores, core, fingerprint, vaultWith } from "./test-core.js";

// A question captured from a run (#373; spec #362 stories 68–72; CAP-6,
// CAP-8). The capture is the one every chord makes, with the run as its
// `from:` and `context: observing`; nothing is written onto the Experiment,
// whose page lists it because its `from:` names the page.

afterEach(closeCores);

beforeAll(() => {
  process.env["TZ"] = "Asia/Kolkata";
});
const at = new Date("2026-09-30T10:00:00+05:30");

type Readable = Extract<ExperimentPage, { readable: true }>;

const PATH = "experiments/prereg-exclusions/prereg-exclusions.md";
const NAME = "[[prereg-exclusions]]";

const EXPERIMENT = `---
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

Four of the 41 share a first author.

## Position history
`;

const NOTE_PATH = "notes/Reading log.md";

/** A Question written by another hand, naming whatever `from` says. */
const question = (
  id: string,
  text: string,
  from: string,
  context: string,
  captured: string
) =>
  `---
id: ${id}
kind: question
question: "${text}"
status: open
captured: ${captured}
from: "${from}"
context: ${context}
---
`;

async function opened(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core({ now: () => at });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const bytes = (path: string) => readFile(join(vault, path), "utf8");
  const page = async (): Promise<Readable> => {
    const reply = await c.query<ExperimentPage>("experiments.page", {
      path: PATH,
    });
    expect(reply.error).toBeUndefined();
    const data = reply.result?.data as ExperimentPage;
    if (!data.readable) throw new Error(data.reason);
    return data;
  };
  const capture = (text: string, provenance: Record<string, string>) =>
    c.mutate<Question>("questions.capture", { text, provenance });
  return { vault, c, bytes, page, capture };
}

describe("a capture from a run", () => {
  it("writes the Question with `from:` the run and `context: observing`, and leaves the Experiment byte-identical", async () => {
    const h = await opened({ [PATH]: EXPERIMENT });
    const before = await h.bytes(PATH);

    const reply = await h.capture("Does a shared first author matter?", {
      context: "observing",
      experiment: PATH,
    });

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toMatchObject({
      question: "Does a shared first author matter?",
      status: "open",
      from: NAME,
      context: "observing",
    });
    expect(await h.bytes("questions/Does a shared first author matter.md"))
      .toBe(`---
id: ${reply.result?.data.id}
kind: question
question: "Does a shared first author matter?"
status: open
captured: 2026-09-30T10:00:00+05:30
from: "${NAME}"
context: observing
---
`);
    expect(await h.bytes(PATH)).toBe(before);
  });

  it("lands in the Question Inbox as any capture does, read back as `observing`", async () => {
    const h = await opened({ [PATH]: EXPERIMENT });
    await h.capture("Does a shared first author matter?", {
      context: "observing",
      experiment: PATH,
    });

    const reply = await h.c.query<{ questions: ListedQuestion[] }>(
      "questions.list"
    );

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data.questions).toMatchObject([
      {
        question: "Does a shared first author matter?",
        status: "open",
        from: NAME,
        context: "observing",
      },
    ]);
  });

  it("refuses a capture whose page is not an Experiment, writing nothing", async () => {
    const h = await opened({
      [NOTE_PATH]: "# Reading log\n",
    });
    const before = await fingerprint(h.vault);

    const reply = await h.capture("Orphaned?", {
      context: "observing",
      experiment: NOTE_PATH,
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain(`${NOTE_PATH} is not an Experiment`);
    expect(await fingerprint(h.vault)).toEqual(before);
  });

  it("refuses an observing capture that names no run, as an input error", async () => {
    const h = await opened({ [PATH]: EXPERIMENT });
    const before = await fingerprint(h.vault);

    for (const provenance of [
      { context: "observing" },
      { context: "observing", page: PATH },
    ]) {
      const reply = await h.c.mutate("questions.capture", {
        text: "x",
        provenance,
      });
      expect(reply.error).toBeDefined();
      expect(reply.error?.data.kind).toBeUndefined();
    }
    expect(await fingerprint(h.vault)).toEqual(before);
  });
});

describe("the Questions the Experiment page lists", () => {
  it("lists every Question whose `from:` names the run, newest first, and no other", async () => {
    const h = await opened({
      [PATH]: EXPERIMENT,
      "questions/Seen in the plot.md": question(
        "q000000002",
        "Seen in the plot?",
        NAME,
        "observing",
        "2026-09-22T09:00:00+05:30"
      ),
      // A `from:` written by hand names the run too, whatever its context.
      "questions/Named by hand.md": question(
        "q000000003",
        "Named by hand?",
        NAME,
        "other",
        "2026-09-23T09:00:00+05:30"
      ),
      // Naming a different page, and naming nothing: neither is listed.
      "questions/Elsewhere.md": question(
        "q000000004",
        "Elsewhere?",
        "[[Reading log]]",
        "observing",
        "2026-09-24T09:00:00+05:30"
      ),
      "questions/Free text.md": question(
        "q000000005",
        "Free text?",
        "prereg-exclusions",
        "other",
        "2026-09-25T09:00:00+05:30"
      ),
    });

    expect((await h.page()).questions).toEqual([
      {
        path: "questions/Named by hand.md",
        question: "Named by hand?",
        status: "open",
        context: "other",
        captured: "2026-09-23T09:00:00+05:30",
      },
      {
        path: "questions/Seen in the plot.md",
        question: "Seen in the plot?",
        status: "open",
        context: "observing",
        captured: "2026-09-22T09:00:00+05:30",
      },
    ]);
  });

  it("lists a capture made from the run at once", async () => {
    const h = await opened({ [PATH]: EXPERIMENT });
    expect((await h.page()).questions).toEqual([]);

    await h.capture("Does a shared first author matter?", {
      context: "observing",
      experiment: PATH,
    });

    expect((await h.page()).questions).toMatchObject([
      { question: "Does a shared first author matter?", context: "observing" },
    ]);
  });
});
