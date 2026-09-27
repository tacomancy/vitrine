import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LooseEnds } from "./loose-ends.js";
import { closeCores, core, vaultWith, type CoreOptions } from "./test-core.js";

afterEach(closeCores);

// A quiet period is counted in open days, never calendar days (#243), so
// every test here says which dates the vault was open on and lets the
// calendar fall where it likes. `at` is midday in one zone throughout.
const at = (day: string) => new Date(`${day}T12:00:00+01:00`);

/** `n` consecutive dates from `day`, as the record of open days holds them. */
function run(day: string, n: number): string[] {
  const out: string[] = [];
  const start = at(day);
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  }
  return out;
}

/** A promoted page, `promoted:` and its two sides filled in by the caller. */
const page = (
  name: string,
  {
    promoted,
    status = "open",
    supporting = "",
    opposing = "",
    id = `rq-${name}`,
  }: {
    promoted?: string;
    status?: string;
    supporting?: string;
    opposing?: string;
    id?: string | null;
  }
) => `---
${id === null ? "" : `id: ${id}\n`}kind: research-question
question: "${name}?"
status: ${status}
promoted_from: "[[${name}]]"
${promoted === undefined ? "" : `promoted: ${promoted}\n`}context: other
---

## Working answer

## Supporting sources
${supporting}
## Opposing sources
${opposing}
## Related questions

## Open threads

## Position history
`;

const SOURCE = `---
kind: source
citekey: rasch2013
---
`;

/**
 * Open the vault on the first of `days`, then bring the window to the front
 * on each of the rest — the two things that record an open day, driven at
 * the seams the app itself uses rather than by seeding the table.
 */
async function openedOn(
  files: Record<string, string>,
  days: string[],
  opts: CoreOptions = {}
) {
  let today = at(days[0]!);
  const vault = await vaultWith(files);
  const c = await core({ now: () => today, ...opts });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  for (const day of days.slice(1)) {
    today = at(day);
    await c.focused();
  }
  return { vault, c };
}

/** The default run: one open day, which no threshold above zero is met by. */
const opened = (files: Record<string, string>) =>
  openedOn(files, ["2026-09-21"]);

/** The dashboard's rows, or the failure that stopped it. */
async function rows(c: {
  query: <T>(p: string) => Promise<{ result?: { data: T }; error?: unknown }>;
}) {
  const reply = await c.query<LooseEnds>("looseEnds.rows");
  expect(reply.error).toBeUndefined();
  return reply.result!.data;
}

/** Every row's title across every group, for the assertions that only care which rows are drawn. */
const titles = (ends: LooseEnds) =>
  ends.groups.flatMap((g) => g.rows.map((r) => r.title));

describe("looseEnds.rows — the stalled Research Question", () => {
  // Promoted well in the past throughout: what decides the row is how many
  // days the vault was open after that, never how many the calendar turned.
  const PROMOTED = "2026-01-05T09:00:00+01:00";
  const short = { stalledOpenDays: 3 };

  it("leaves one out while the vault has been open fewer days than the threshold, however long ago it was promoted", async () => {
    const { c } = await openedOn(
      { "q/stale (RQ).md": page("stale", { promoted: PROMOTED }) },
      // Nine months of calendar have passed; two days at the vault have.
      run("2026-09-20", 2),
      short
    );
    expect(titles(await rows(c))).toEqual([]);
  });

  it("lists one once the vault has been open the threshold's days since, with no source on either side", async () => {
    const { c } = await openedOn(
      { "q/stale (RQ).md": page("stale", { promoted: PROMOTED }) },
      run("2026-09-20", 3),
      short
    );
    const ends = await rows(c);
    expect(ends.groups).toHaveLength(1);
    expect(ends.groups[0]?.group).toBe("Stalled questions");
    expect(ends.groups[0]?.rows).toEqual([
      {
        kind: "stalled-research-question",
        subject: "rq-stale",
        path: "q/stale (RQ).md",
        title: "stale?",
        since: PROMOTED,
      },
    ]);
  });

  it("does not count the day it was promoted on: the clock starts strictly after", async () => {
    // Promoted on the one day the vault was open, threshold one day.
    const { c } = await openedOn(
      {
        "q/today (RQ).md": page("today", {
          promoted: "2026-09-20T09:00:00+01:00",
        }),
      },
      run("2026-09-20", 1),
      { stalledOpenDays: 1 }
    );
    expect(titles(await rows(c))).toEqual([]);
  });

  it("counts a page promoted before the record began from the first recorded day, so it surfaces late rather than early", async () => {
    // The table knows nothing of 2026-01: the two days it does know are all
    // this page can be judged on, and two is short of three.
    const promotedLongBefore = {
      "q/old (RQ).md": page("old", { promoted: PROMOTED }),
    };
    const { c } = await openedOn(
      promotedLongBefore,
      run("2026-09-20", 2),
      short
    );
    expect(titles(await rows(c))).toEqual([]);

    const { c: later } = await openedOn(
      promotedLongBefore,
      run("2026-09-20", 4),
      short
    );
    expect(titles(await rows(later))).toEqual(["old?"]);
  });

  it("leaves out one with a source on either side", async () => {
    const { c } = await openedOn(
      {
        "sources/rasch2013.md": SOURCE,
        "q/fed (RQ).md": page("fed", {
          promoted: PROMOTED,
          supporting: "\n- [[rasch2013]] — it holds up.\n",
        }),
        "q/opposed (RQ).md": page("opposed", {
          promoted: PROMOTED,
          opposing: "\n- [[rasch2013]]\n",
        }),
      },
      run("2026-09-20", 5),
      short
    );
    expect(titles(await rows(c))).toEqual([]);
  });

  it("leaves out one that is answered or abandoned", async () => {
    const { c } = await openedOn(
      {
        "q/done (RQ).md": page("done", {
          promoted: PROMOTED,
          status: "answered",
        }),
        "q/gone (RQ).md": page("gone", {
          promoted: PROMOTED,
          status: "abandoned",
        }),
      },
      run("2026-09-20", 5),
      short
    );
    expect(titles(await rows(c))).toEqual([]);
  });

  it("leaves out one with no promoted: — there is no date to be stalled since", async () => {
    const { c } = await openedOn(
      { "q/undated (RQ).md": page("undated", {}) },
      run("2026-09-20", 5),
      short
    );
    expect(titles(await rows(c))).toEqual([]);
  });

  it("uses fourteen open days when the caller names no threshold", async () => {
    const files = { "q/stale (RQ).md": page("stale", { promoted: PROMOTED }) };
    const { c } = await openedOn(files, run("2026-09-01", 13));
    expect(titles(await rows(c))).toEqual([]);

    // The fourteenth open day since is the one that makes it a row.
    const { c: one } = await openedOn(files, run("2026-09-01", 14));
    expect(titles(await rows(one))).toEqual(["stale?"]);
  });
});

describe("looseEnds.dismiss — mark deliberate", () => {
  const PROMOTED = "2026-01-05T09:00:00+01:00";
  const stalled = {
    "q/stale (RQ).md": page("stale", { promoted: PROMOTED }),
  };
  // Enough open days after `promoted` for the row to be there to dismiss;
  // the last of them is the date a dismissal is stamped with.
  const DAYS = run("2026-09-20", 3);
  const LAST = at(DAYS[DAYS.length - 1]!);
  const showing = (files: Record<string, string> = stalled) =>
    openedOn(files, DAYS, { stalledOpenDays: 3 });

  it("removes the row and writes dismissals.json keyed by the object and the row kind", async () => {
    const { vault, c } = await showing();

    const reply = await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "stalled-research-question",
    });

    expect(reply.error).toBeUndefined();
    expect(titles(await rows(c))).toEqual([]);
    const written: unknown = JSON.parse(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    );
    expect(written).toEqual({
      "rq-stale": { "stalled-research-question": LAST.toISOString() },
    });
  });

  it("keeps both dismissals when two arrive at once", async () => {
    // The write reads dismissals.json and puts the whole object back, so
    // two that overlapped would lose one — and a losing row is one the user
    // told the app to stop showing, back again. The queue is in `dismiss`
    // (`serialise.ts`); this is what notices if it ever stops being.
    const { vault, c } = await showing({
      "q/stale (RQ).md": page("stale", { promoted: PROMOTED }),
      "q/other (RQ).md": page("other", { promoted: PROMOTED }),
    });
    expect(titles(await rows(c))).toEqual(["other?", "stale?"]);

    const [first, second] = await Promise.all([
      c.mutate("looseEnds.dismiss", {
        subject: "rq-stale",
        kind: "stalled-research-question",
      }),
      c.mutate("looseEnds.dismiss", {
        subject: "rq-other",
        kind: "stalled-research-question",
      }),
    ]);

    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
    expect(titles(await rows(c))).toEqual([]);
    const written: unknown = JSON.parse(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    );
    expect(written).toEqual({
      "rq-stale": { "stalled-research-question": LAST.toISOString() },
      "rq-other": { "stalled-research-question": LAST.toISOString() },
    });
  });

  it("keeps the row silenced across a vault reopen", async () => {
    const { vault, c } = await showing();
    await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "stalled-research-question",
    });

    const second = await core({ now: () => LAST, stalledOpenDays: 3 });
    await second.mutate("vault.open", { path: vault });
    await second.indexed();

    expect(titles(await rows(second))).toEqual([]);
  });

  it("does not silence a different row kind about the same object", async () => {
    const { vault, c } = await showing();

    await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "ambiguous-link",
    });

    expect(titles(await rows(c))).toEqual(["stale?"]);
    expect(
      JSON.parse(
        await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
      )
    ).toEqual({ "rq-stale": { "ambiguous-link": LAST.toISOString() } });
  });

  it("adds a second row kind beside the first rather than replacing it", async () => {
    const { vault, c } = await showing();
    await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "ambiguous-link",
    });
    await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "stalled-research-question",
    });

    expect(
      JSON.parse(
        await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
      )
    ).toEqual({
      "rq-stale": {
        "ambiguous-link": LAST.toISOString(),
        "stalled-research-question": LAST.toISOString(),
      },
    });
  });

  it("says so rather than silencing nothing when dismissals.json cannot be read", async () => {
    const { vault, c } = await showing({
      ...stalled,
      ".vitrine/dismissals.json": "{ not json",
    });

    const ends = await rows(c);
    expect(ends.problems).toEqual([
      expect.stringMatching(/dismissals\.json/) as unknown as string,
    ]);
    expect(titles(ends)).toEqual(["stale?"]);

    // And the write refuses rather than overwriting what it could not read.
    const reply = await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "stalled-research-question",
    });
    expect(reply.error?.message).toMatch(/dismissals\.json/);
    expect(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    ).toBe("{ not json");
  });
});

describe("looseEnds.undismiss — taking mark deliberate back", () => {
  const PROMOTED = "2026-01-05T09:00:00+01:00";
  const DAYS = run("2026-09-20", 3);
  const LAST = at(DAYS[DAYS.length - 1]!);
  const both = {
    "q/stale (RQ).md": page("stale", { promoted: PROMOTED }),
    "q/other (RQ).md": page("other", { promoted: PROMOTED }),
  };
  const showing = (files: Record<string, string> = both) =>
    openedOn(files, DAYS, { stalledOpenDays: 3 });
  const file = (vault: string) =>
    readFile(join(vault, ".vitrine/dismissals.json"), "utf8");
  const STALLED = "stalled-research-question";

  it("takes back one row kind for one subject and leaves every other key alone", async () => {
    const { vault, c } = await showing();
    for (const key of [
      { subject: "rq-stale", kind: STALLED },
      { subject: "rq-stale", kind: "ambiguous-link" },
      { subject: "rq-other", kind: STALLED },
    ]) {
      expect((await c.mutate("looseEnds.dismiss", key)).error).toBeUndefined();
    }

    const reply = await c.mutate("looseEnds.undismiss", {
      subject: "rq-stale",
      kind: STALLED,
    });

    expect(reply.error).toBeUndefined();
    expect(JSON.parse(await file(vault))).toEqual({
      "rq-stale": { "ambiguous-link": LAST.toISOString() },
      "rq-other": { [STALLED]: LAST.toISOString() },
    });
    // The row it silenced is back, and the other subject's is still silent.
    expect(titles(await rows(c))).toEqual(["stale?"]);
  });

  it("drops a subject whose last kind is gone rather than leaving an empty one behind", async () => {
    const { vault, c } = await showing();
    await c.mutate("looseEnds.dismiss", { subject: "rq-stale", kind: STALLED });

    await c.mutate("looseEnds.undismiss", {
      subject: "rq-stale",
      kind: STALLED,
    });

    expect(JSON.parse(await file(vault))).toEqual({});
  });

  it("succeeds without writing at all when that kind was never dismissed", async () => {
    // Hand-formatted on purpose: nothing to undo is nothing to write, so the
    // file is not reserialised behind the user's back either.
    const seeded = '{"rq-stale":{"ambiguous-link":"2026-09-01T00:00:00.000Z"}}';
    const { vault, c } = await showing({
      ...both,
      ".vitrine/dismissals.json": seeded,
    });

    const reply = await c.mutate("looseEnds.undismiss", {
      subject: "rq-stale",
      kind: STALLED,
    });

    expect(reply.error).toBeUndefined();
    expect(await file(vault)).toBe(seeded);
  });

  it("refuses on a dismissals.json it cannot read, in the words dismiss refuses in", async () => {
    const { vault, c } = await showing({
      ...both,
      ".vitrine/dismissals.json": "{ not json",
    });

    const undo = await c.mutate("looseEnds.undismiss", {
      subject: "rq-stale",
      kind: STALLED,
    });

    // The same refusal for the same reason: the dismissals already in the
    // file are what writing over it would lose.
    const dismiss = await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: STALLED,
    });
    expect(undo.error?.message).toMatch(/dismissals\.json/);
    expect(undo.error?.message).toBe(dismiss.error?.message);
    expect(await file(vault)).toBe("{ not json");
  });

  it("keeps a dismissal and an undo that arrive at once, losing neither", async () => {
    // Both read the file and put the whole object back, so two that
    // overlapped would lose one — either a row the user silenced comes back,
    // or one they un-silenced stays gone. The queue is inside
    // `dismissals.ts`, shared by both; this is what notices if it is not.
    const { vault, c } = await showing();
    await c.mutate("looseEnds.dismiss", { subject: "rq-other", kind: STALLED });

    const [dismissed, undone] = await Promise.all([
      c.mutate("looseEnds.dismiss", { subject: "rq-stale", kind: STALLED }),
      c.mutate("looseEnds.undismiss", { subject: "rq-other", kind: STALLED }),
    ]);

    expect(dismissed.error).toBeUndefined();
    expect(undone.error).toBeUndefined();
    expect(JSON.parse(await file(vault))).toEqual({
      "rq-stale": { [STALLED]: LAST.toISOString() },
    });
    expect(titles(await rows(c))).toEqual(["other?"]);
  });
});

describe("looseEnds.rows — the dashboard's shape", () => {
  it("draws no group at all when nothing is loose", async () => {
    const { c } = await opened({
      "q/young (RQ).md": page("young", {
        promoted: "2026-09-20T09:00:00+01:00",
      }),
    });
    expect(await rows(c)).toEqual({ groups: [], problems: [] });
  });

  it("names a page it could not read rather than dropping it silently", async () => {
    const { c } = await openedOn(
      {
        "q/broken (RQ).md": page("broken", {
          promoted: "2026-01-05T09:00:00+01:00",
        }).replace("status: open", "status: musing"),
      },
      run("2026-09-20", 3),
      { stalledOpenDays: 3 }
    );

    const ends = await rows(c);
    expect(titles(ends)).toEqual([]);
    expect(ends.problems).toEqual([
      'q/broken (RQ).md could not be read: status is not open, answered, or abandoned: "musing"',
    ]);
  });

  it("keys a page that carries no id by its path", async () => {
    const { c } = await openedOn(
      {
        "q/anon (RQ).md": page("anon", {
          promoted: "2026-01-05T09:00:00+01:00",
          id: null,
        }),
      },
      run("2026-09-20", 3),
      { stalledOpenDays: 3 }
    );
    expect((await rows(c)).groups[0]?.rows[0]?.subject).toBe("q/anon (RQ).md");
  });
});
