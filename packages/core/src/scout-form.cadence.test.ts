import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, fixtures, tmp, virtualClock } from "./test-core.js";

afterEach(closeCores);

// Changing a Scout's cadence from its row on Scout Activity (#520; ADR 0042
// decision 5) is one narrow write, as pause is: it sets the one key it owns and
// nothing else, so a menu on a row can never undo an edit made beside it.
// Driven through the router on a temp vault with an injected clock and arXiv
// client, and what is asserted is what the researcher would find in the file
// and on the next read.

const FOLDER = ".vitrine/scouts";
const START = Date.parse("2026-09-30T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const scoutYaml = (cadence: string, extra: string[] = []) =>
  [
    "name: Sleep and memory",
    `cadence: ${cadence}`,
    "lane: review",
    "created: 2026-09-20T00:00:00Z",
    ...extra,
    "filter:",
    "  query: all:sleep",
    "",
  ].join("\n");

async function opened(files: Record<string, string>) {
  const vault = await tmp("scout-cadence");
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  let at = START;
  const empty = await readFile(join(fixtures, "arxiv", "empty.xml"), "utf8");
  const c = await core({
    now: () => new Date(at),
    arxiv: {
      clock: virtualClock(),
      fetch: async () => new Response(empty),
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return {
    c,
    vault,
    file: () => readFile(join(vault, FOLDER, "sleep.yaml"), "utf8"),
    /** Move the injected clock on, so a run's age is a number a test chose. */
    advance: (ms: number) => void (at += ms),
    run: async (scoutId: string) => {
      const r = await c.mutate("scouts.runNow", { scoutId });
      expect(r.error).toBeUndefined();
    },
  };
}

describe("a cadence change", () => {
  it("sets the one key, and leaves a hand-written file's comments, unknown keys and order as they were", async () => {
    const hand = [
      "# Watching sleep for the lab",
      "name: Sleep and memory",
      "cadence: weekly # slow on purpose",
      "lane: review",
      "created: 2026-09-20T00:00:00Z",
      "cap: 40",
      "filter:",
      "  query: all:sleep",
      "",
    ].join("\n");
    const { c, file } = await opened({ [`${FOLDER}/sleep.yaml`]: hand });

    const reply = await c.mutate("scouts.setCadence", {
      scoutId: "sleep",
      cadence: "daily",
    });

    expect(reply.error).toBeUndefined();
    expect(await file()).toBe(
      [
        "# Watching sleep for the lab",
        "name: Sleep and memory",
        "cadence: daily # slow on purpose",
        "lane: review",
        "created: 2026-09-20T00:00:00Z",
        "cap: 40",
        "filter:",
        "  query: all:sleep",
        "",
      ].join("\n")
    );
  });

  it("refuses a Scout that is not there", async () => {
    const { c } = await opened({
      [`${FOLDER}/other.yaml`]: scoutYaml("weekly"),
    });

    const reply = await c.mutate("scouts.setCadence", {
      scoutId: "sleep",
      cadence: "daily",
    });

    expect(reply.error?.message).toBe("There is no Scout named sleep.");
    // A refusal, not a fault: the 400 `refusing` makes of a `VaultError`.
    expect(reply.error?.data).toMatchObject({
      code: "BAD_REQUEST",
      kind: "refused",
    });
  });

  // The app would be guessing at the shape of a file it cannot read as a Scout.
  it("refuses a file that does not parse, and does not rewrite it", async () => {
    const broken = "name: [unclosed\n";
    const { c, file } = await opened({ [`${FOLDER}/sleep.yaml`]: broken });

    const reply = await c.mutate("scouts.setCadence", {
      scoutId: "sleep",
      cadence: "daily",
    });

    expect(reply.error?.data).toMatchObject({
      code: "BAD_REQUEST",
      kind: "refused",
    });
    expect(await file()).toBe(broken);
  });

  it("refuses a cadence the file could not hold", async () => {
    const { c, file } = await opened({
      [`${FOLDER}/sleep.yaml`]: scoutYaml("weekly"),
    });

    const reply = await c.mutate("scouts.setCadence", {
      scoutId: "sleep",
      cadence: "hourly",
    });

    expect(reply.error).toBeDefined();
    expect(await file()).toBe(scoutYaml("weekly"));
  });
});

// A shorter cadence can make a Scout due at once: the scheduler reads *how long
// since the last clean run*, so a weekly Scout that last looked two days ago is
// due the moment it is made daily. The write says so, from the scheduler's own
// reading of due (`isDue`) and not a second one, so that a change is never a
// surprise run (spec #511 story 55).
describe("a cadence change and the next check", () => {
  const change = async (
    f: Awaited<ReturnType<typeof opened>>,
    cadence: string
  ) => {
    const reply = await f.c.mutate<{ dueAtNextCheck: boolean }>(
      "scouts.setCadence",
      { scoutId: "sleep", cadence }
    );
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };

  it("names that a shorter cadence makes a Scout due when it last looked longer ago than that", async () => {
    const f = await opened({ [`${FOLDER}/sleep.yaml`]: scoutYaml("weekly") });
    await f.run("sleep");
    f.advance(2 * DAY);

    expect(await change(f, "daily")).toEqual({ dueAtNextCheck: true });
  });

  it("says nothing of a shorter cadence that has not yet elapsed since the last look", async () => {
    const f = await opened({ [`${FOLDER}/sleep.yaml`]: scoutYaml("weekly") });
    await f.run("sleep");
    f.advance(2 * HOUR);

    expect(await change(f, "daily")).toEqual({ dueAtNextCheck: false });
  });

  it("never reports a longer cadence as making a Scout due", async () => {
    const f = await opened({ [`${FOLDER}/sleep.yaml`]: scoutYaml("daily") });
    await f.run("sleep");
    f.advance(2 * DAY);

    // It was due already at a day, and a month is not made due by being longer.
    expect(await change(f, "monthly")).toEqual({ dueAtNextCheck: false });
  });

  it("does not claim the change when the Scout was due before it", async () => {
    const f = await opened({ [`${FOLDER}/sleep.yaml`]: scoutYaml("weekly") });
    // Never run: its first check is due now whatever its cadence.

    expect(await change(f, "daily")).toEqual({ dueAtNextCheck: false });
  });

  it("does not make a paused Scout due, whatever its cadence: it is not looking", async () => {
    const f = await opened({
      [`${FOLDER}/sleep.yaml`]: scoutYaml("weekly", ["paused: true"]),
    });
    await f.run("sleep");
    f.advance(2 * DAY);

    expect(await change(f, "daily")).toEqual({ dueAtNextCheck: false });
  });
});
