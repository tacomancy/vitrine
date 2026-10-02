import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openQueue } from "./queue.js";

// Version 5 to 6 (#464) rebuilds `scout_runs` to widen its error kinds. The
// queue has no rebuild path, so what the researcher's runs, Proposals and
// triage acts hold must come through a copy of a real version-5 file intact.

const V5 = `
CREATE TABLE pending_revisions (id INTEGER PRIMARY KEY, path TEXT NOT NULL, field TEXT NOT NULL, from_text TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX pending_revisions_path ON pending_revisions (path);
CREATE TABLE open_days (day TEXT PRIMARY KEY);
CREATE TABLE last_arrival (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE scout_runs (
  id INTEGER PRIMARY KEY, scout_id TEXT NOT NULL, started TEXT NOT NULL, finished TEXT,
  outcome TEXT CHECK (outcome IN ('ok', 'failed')),
  error_kind TEXT CHECK (error_kind IN ('network', 'http', 'rate_limited', 'parse', 'interrupted')),
  error_message TEXT, window_from TEXT NOT NULL, window_to TEXT NOT NULL,
  retroactive INTEGER NOT NULL DEFAULT 0, fetched INTEGER NOT NULL DEFAULT 0,
  new INTEGER NOT NULL DEFAULT 0, held INTEGER NOT NULL DEFAULT 0, truncated INTEGER NOT NULL DEFAULT 0,
  query TEXT
);
CREATE INDEX scout_runs_scout ON scout_runs (scout_id);
CREATE TABLE proposals (
  id INTEGER PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, doi TEXT, title TEXT NOT NULL, authors TEXT NOT NULL,
  published TEXT NOT NULL, venue TEXT, abstract TEXT NOT NULL, url TEXT NOT NULL,
  lane TEXT NOT NULL CHECK (lane IN ('review', 'skim')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'deferred', 'accepted', 'rejected', 'held')),
  first_seen TEXT NOT NULL, stub_path TEXT
);
CREATE TABLE appearances (
  proposal_id INTEGER NOT NULL REFERENCES proposals (id), run_id INTEGER NOT NULL REFERENCES scout_runs (id),
  scout_id TEXT NOT NULL, seen_at TEXT NOT NULL, url TEXT NOT NULL, UNIQUE (proposal_id, scout_id, url)
);
CREATE TABLE triage (
  proposal_id INTEGER NOT NULL REFERENCES proposals (id),
  action TEXT NOT NULL CHECK (action IN ('accept', 'reject', 'defer', 'promote', 'undo')),
  at TEXT NOT NULL, batch INTEGER REFERENCES scout_runs (id)
);
INSERT INTO open_days (day) VALUES ('2026-09-20');
INSERT INTO scout_runs (id, scout_id, started, finished, outcome, window_from, window_to, fetched, new, query)
  VALUES (7, 'sleep', '2026-09-25T10:00:00Z', '2026-09-25T10:00:05Z', 'ok', '2026-09-20T00:00:00Z', '2026-09-25T10:00:00Z', 1, 1, 'all:sleep');
INSERT INTO scout_runs (id, scout_id, started, finished, outcome, error_kind, error_message, window_from, window_to)
  VALUES (8, 'sleep', '2026-09-26T10:00:00Z', '2026-09-26T10:00:05Z', 'failed', 'http', 'HTTP 503', '2026-09-25T10:00:00Z', '2026-09-26T10:00:00Z');
INSERT INTO proposals (id, source_key, title, authors, published, abstract, url, lane, state, first_seen)
  VALUES (3, 'arxiv:2609.01234', 'Probing', '["Ada"]', '2026-09-01', 'An abstract.', 'https://arxiv.org/abs/2609.01234', 'review', 'rejected', '2026-09-25T10:00:00Z');
INSERT INTO appearances VALUES (3, 7, 'sleep', '2026-09-25T10:00:00Z', 'https://arxiv.org/abs/2609.01234');
INSERT INTO triage VALUES (3, 'reject', '2026-09-25T11:00:00Z', 7);
PRAGMA user_version = 5;
`;

describe("the queue database, version 5 to 6", () => {
  it("keeps every run, Proposal, Appearance and triage act, and learns the new columns and error kinds", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vitrine-queue-"));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const old = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
    old.exec(V5);
    old.close();

    const queue = await openQueue(vault);
    try {
      expect(
        (queue.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version
      ).toBe(6);
      expect(
        queue
          .prepare(
            "SELECT id, scout_id, outcome, error_kind, error_message, new, query, model, cost_usd, page_hash, unverified FROM scout_runs ORDER BY id"
          )
          .all()
      ).toEqual([
        {
          id: 7,
          scout_id: "sleep",
          outcome: "ok",
          error_kind: null,
          error_message: null,
          new: 1,
          query: "all:sleep",
          model: null,
          cost_usd: null,
          page_hash: null,
          unverified: 0,
        },
        {
          id: 8,
          scout_id: "sleep",
          outcome: "failed",
          error_kind: "http",
          error_message: "HTTP 503",
          new: 0,
          query: null,
          model: null,
          cost_usd: null,
          page_hash: null,
          unverified: 0,
        },
      ]);
      expect(queue.prepare("SELECT run_id FROM appearances").all()).toEqual([
        { run_id: 7 },
      ]);
      expect(queue.prepare("SELECT batch FROM triage").all()).toEqual([
        { batch: 7 },
      ]);
      expect(queue.prepare("SELECT day FROM open_days").all()).toEqual([
        { day: "2026-09-20" },
      ]);
      expect(queue.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      // Foreign keys are back on once the migration is done, and the table is the new one.
      expect(
        (queue.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number })
          .foreign_keys
      ).toBe(1);
      for (const kind of ["credentials", "model", "extraction"]) {
        queue
          .prepare(
            "INSERT INTO scout_runs (scout_id, started, outcome, error_kind, window_from, window_to) VALUES ('s', 'x', 'failed', ?, 'x', 'x')"
          )
          .run(kind);
      }
    } finally {
      queue.close();
    }
  });
});
