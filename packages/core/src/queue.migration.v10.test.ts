import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openQueue } from "./queue.js";

// Version 9 to 10 (#689) rebuilds `scout_runs` to widen its error kinds with
// `tags` and to add `note`. A copy of a real version-9 file must come through
// with every run, its id and what points at it intact.

const V9 = `
CREATE TABLE pending_revisions (id INTEGER PRIMARY KEY, path TEXT NOT NULL, field TEXT NOT NULL, from_text TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX pending_revisions_path ON pending_revisions (path);
CREATE TABLE open_days (day TEXT PRIMARY KEY);
CREATE TABLE last_arrival (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE scout_runs (
  id INTEGER PRIMARY KEY, scout_id TEXT NOT NULL, started TEXT NOT NULL, finished TEXT,
  outcome TEXT CHECK (outcome IN ('ok', 'failed')),
  error_kind TEXT CHECK (error_kind IN ('network', 'http', 'rate_limited', 'parse', 'interrupted', 'credentials', 'model', 'extraction')),
  error_message TEXT, window_from TEXT NOT NULL, window_to TEXT NOT NULL,
  retroactive INTEGER NOT NULL DEFAULT 0, fetched INTEGER NOT NULL DEFAULT 0,
  new INTEGER NOT NULL DEFAULT 0, held INTEGER NOT NULL DEFAULT 0, truncated INTEGER NOT NULL DEFAULT 0,
  query TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
  cost_usd REAL, page_hash TEXT, page_length INTEGER, page_capped INTEGER NOT NULL DEFAULT 0,
  unverified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX scout_runs_scout ON scout_runs (scout_id);
CREATE TABLE proposals (
  id INTEGER PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, doi TEXT, title TEXT NOT NULL, authors TEXT NOT NULL,
  published TEXT NOT NULL, venue TEXT, abstract TEXT NOT NULL, url TEXT NOT NULL,
  lane TEXT NOT NULL CHECK (lane IN ('review', 'skim')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'deferred', 'accepted', 'rejected', 'held', 'capped')),
  first_seen TEXT NOT NULL, stub_path TEXT
);
CREATE TABLE appearances (
  proposal_id INTEGER NOT NULL REFERENCES proposals (id), run_id INTEGER NOT NULL REFERENCES scout_runs (id),
  scout_id TEXT NOT NULL, seen_at TEXT NOT NULL, url TEXT NOT NULL, UNIQUE (proposal_id, scout_id, url)
);
CREATE TABLE triage (
  proposal_id INTEGER NOT NULL REFERENCES proposals (id),
  action TEXT NOT NULL CHECK (action IN ('accept', 'reject', 'defer', 'promote', 'undo', 'demote', 'raise')),
  at TEXT NOT NULL, batch INTEGER REFERENCES scout_runs (id), bulk INTEGER
);
INSERT INTO scout_runs (id, scout_id, started, finished, outcome, window_from, window_to, fetched, new, query, model, cost_usd, unverified)
  VALUES (7, 'sleep', '2026-09-25T10:00:00Z', '2026-09-25T10:00:05Z', 'ok', '2026-09-20T00:00:00Z', '2026-09-25T10:00:00Z', 1, 1, 'all:sleep', 'm', 0.5, 2);
INSERT INTO scout_runs (id, scout_id, started, finished, outcome, error_kind, error_message, window_from, window_to)
  VALUES (8, 'sleep', '2026-09-26T10:00:00Z', '2026-09-26T10:00:05Z', 'failed', 'extraction', 'nothing', '2026-09-25T10:00:00Z', '2026-09-26T10:00:00Z');
INSERT INTO proposals (id, source_key, title, authors, published, abstract, url, lane, state, first_seen)
  VALUES (3, 'arxiv:2609.01234', 'Probing', '["Ada"]', '2026-09-01', 'An abstract.', 'https://arxiv.org/abs/2609.01234', 'review', 'pending', '2026-09-25T10:00:00Z');
INSERT INTO appearances VALUES (3, 7, 'sleep', '2026-09-25T10:00:00Z', 'https://arxiv.org/abs/2609.01234');
INSERT INTO triage VALUES (3, 'reject', '2026-09-25T11:00:00Z', 7, NULL);
PRAGMA user_version = 9;
`;

describe("the queue database, version 9 to 10", () => {
  it("keeps every run and what points at it, and learns the `tags` kind and a note", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vitrine-queue-"));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const old = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
    old.exec(V9);
    old.close();

    const queue = await openQueue(vault);
    try {
      expect(
        (queue.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version
      ).toBe(13);
      expect(
        queue
          .prepare(
            "SELECT id, outcome, error_kind, error_message, query, model, cost_usd, unverified, note FROM scout_runs ORDER BY id"
          )
          .all()
      ).toEqual([
        {
          id: 7,
          outcome: "ok",
          error_kind: null,
          error_message: null,
          query: "all:sleep",
          model: "m",
          cost_usd: 0.5,
          unverified: 2,
          note: null,
        },
        {
          id: 8,
          outcome: "failed",
          error_kind: "extraction",
          error_message: "nothing",
          query: null,
          model: null,
          cost_usd: null,
          unverified: 0,
          note: null,
        },
      ]);
      expect(queue.prepare("SELECT run_id FROM appearances").all()).toEqual([
        { run_id: 7 },
      ]);
      expect(queue.prepare("SELECT batch FROM triage").all()).toEqual([
        { batch: 7 },
      ]);
      expect(queue.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      queue
        .prepare(
          "INSERT INTO scout_runs (scout_id, started, outcome, error_kind, window_from, window_to, note) VALUES ('s', 'x', 'failed', 'tags', 'x', 'x', 'n')"
        )
        .run();
      expect(() =>
        queue
          .prepare(
            "INSERT INTO scout_runs (scout_id, started, outcome, error_kind, window_from, window_to) VALUES ('s', 'x', 'failed', 'bogus', 'x', 'x')"
          )
          .run()
      ).toThrow();
    } finally {
      queue.close();
    }
  });
});
