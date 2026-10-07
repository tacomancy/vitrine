import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import { core, fixtureCopy } from "./test-core.js";

// A vault whose Scout queue is seeded row by row, for the tests that assert a
// figure a Scout Activity row carries (the Accept rate, the volume, the cost)
// and not how the rows came to be. Shared so two suites cannot seed the same
// fact two ways.

export const NOW = new Date("2026-09-30T12:00:00Z");
const DAY = 86_400_000;
export const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * DAY).toISOString();

export const arxivScout = (name: string) =>
  `name: ${name}\ncadence: daily\nlane: review\ncreated: 2026-06-01T00:00:00Z\nfilter:\n  query: all:${name}\n`;
export const watchedScout = (name: string) =>
  `name: ${name}\ncadence: weekly\nlane: review\ncreated: 2026-06-01T00:00:00Z\nsource:\n  kind: watched\n  url: https://lab.example/${name}\n`;

export type Seed = {
  action?: "accept" | "reject";
  /** Triaged this many days ago. */
  ago?: number;
  lane?: "review" | "skim";
  authors?: string[];
  venue?: string | null;
  promoted?: boolean;
  undone?: boolean;
  held?: boolean;
  /** `reject this run` on a run that was (or was not) a backward search. */
  batch?: { retroactive: boolean };
  /** Another Scout found it first. */
  firstBy?: string;
  /**
   * With `firstBy`: that Scout's run started first but finished writing last,
   * as two overlapping runs do, so its Appearance has the lower run id and the
   * higher `rowid`.
   */
  recordedLast?: boolean;
};

export async function openedWithQueue(
  scouts: Record<string, string>,
  /** Vault-relative files to write beside the fixture's own: Questions a suite needs. */
  files: Record<string, string> = {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  for (const [file, text] of Object.entries(scouts)) {
    const path = join(vault, ".vitrine/scouts", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  const c = await core({ now: () => NOW });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
  let n = 0;
  const run = (scout: string, retroactive: boolean) =>
    Number(
      db
        .prepare(
          `INSERT INTO scout_runs (scout_id, started, finished, outcome, window_from, window_to, retroactive)
           VALUES (?, ?, ?, 'ok', ?, ?, ?)`
        )
        .run(
          scout,
          daysAgo(1),
          daysAgo(1),
          daysAgo(2),
          daysAgo(1),
          +retroactive
        ).lastInsertRowid
    );
  return {
    c,
    db,
    /** One Proposal this Scout placed, and what the researcher did with it. */
    seed: (scout: string, s: Seed = {}) => {
      n += 1;
      const firstRun = s.firstBy === undefined ? null : run(s.firstBy, false);
      const ordinary = run(scout, false);
      const batchRun =
        s.batch === undefined ? null : run(scout, s.batch.retroactive);
      const proposal = Number(
        db
          .prepare(
            `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
             VALUES (?, ?, ?, '2026-01-01', ?, '', 'https://x.example', ?, ?, ?)`
          )
          .run(
            `k${n}`,
            `T${n}`,
            JSON.stringify(s.authors ?? ["A. Author"]),
            s.venue === undefined ? "A Journal" : s.venue,
            s.lane ?? "review",
            s.held === true
              ? "held"
              : s.action === undefined
                ? "pending"
                : s.action === "accept"
                  ? "accepted"
                  : "rejected",
            daysAgo(s.ago ?? 3)
          ).lastInsertRowid
      );
      const appear = (by: string, runId: number) =>
        db
          .prepare(
            "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, ?, ?, 'https://x.example')"
          )
          .run(proposal, runId, by, daysAgo(s.ago ?? 3));
      if (s.firstBy !== undefined && s.recordedLast !== true) {
        appear(s.firstBy, firstRun!);
      }
      appear(scout, ordinary);
      if (s.firstBy !== undefined && s.recordedLast === true) {
        appear(s.firstBy, firstRun!);
      }
      const log = (action: string, batch: number | null = null) =>
        db
          .prepare(
            "INSERT INTO triage (proposal_id, action, at, batch) VALUES (?, ?, ?, ?)"
          )
          .run(proposal, action, daysAgo(s.ago ?? 3), batch);
      if (s.promoted === true) log("promote");
      if (s.action !== undefined) log(s.action, batchRun);
      if (s.undone === true) log("undo");
    },
  };
}
