import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { errorMessage } from "./errors.js";
import { readQuestion } from "./question-kind.js";
import { analyseFile, sha256, type OutlineResponse } from "./vault-files.js";

/**
 * `.vitrine/index.sqlite` (ADR 0014; `docs/architecture.md` § Index): the
 * disposable record of what the vault's Markdown contains, and the read path
 * for every list a surface shows. This module is the one writer, fed from
 * three places — the open-time sweep here, the watcher's settled batches
 * through `refresh()`, and the app's own writes through `own()` — so a row is
 * never written by code that did not also outline the file. Nothing here
 * ever writes to a vault file.
 */

/**
 * `PRAGMA user_version`. Bump on any change to the tables below: an index
 * carrying another number is deleted and rebuilt, which is the migration
 * path — there is no other (ADR 0014 decision 10).
 */
export const SCHEMA_VERSION = 1;

/** How many files one transaction covers; a build over more commits in pieces so rows appear as it goes. */
export const CHUNK_SIZE = 250;

export type ReadableOutline = Extract<OutlineResponse, { readable: true }>;

/** What a Kind reports as its Positions — `## Working answer`'s text, say — for the `positions` table. */
export type Position = { field: string; text: string };

/**
 * The per-Kind registry the indexer asks after outlining every changed
 * Markdown file (ADR 0014 decision 6), keyed by `kind:`. Beat 1b ships it
 * empty; beat 2 registers the Research Question. A file whose Kind has no
 * entry yields no `positions` rows.
 */
export type PositionsOf = Record<
  string,
  (outline: ReadableOutline, content: string) => Position[]
>;

/** Raised after every commit, by the code that committed (ADR 0014 decision 9). Paths are vault-relative. */
export type VaultChanged = {
  type: "vaultChanged";
  changed: string[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
};

export type IndexStatus = {
  /** Non-null while a build runs: files applied so far, of how many. */
  indexing: { done: number; total: number } | null;
  /**
   * Whether the index may be trusted to say a file is not there (ADR 0014
   * decision 11), as far as the index itself can tell: the sweep and the
   * batches. The watcher's health is the vault service's to add.
   */
  current: { ok: true } | { ok: false; reason: string };
};

export type IndexOptions = {
  chunkSize?: number | undefined;
  positionsOf?: PositionsOf | undefined;
  /** Awaited before the next chunk, so a listener that queries inside sees each commit on its own. */
  onChanged?: ((event: VaultChanged) => void | Promise<void>) | undefined;
  /** Indexing progress changed; the listener re-reads `status()`. */
  onStatus?: (() => void | Promise<void>) | undefined;
};

export type VaultIndex = {
  /**
   * The build: compare every non-dot file's stat to `files`, re-outline
   * what differs, drop what is gone, in chunks. At open, and again after a
   * watcher failure, when it is the catch-up for whatever the watch missed
   * (ADR 0013 decision 3). Resolves when the sweep is done; never rejects —
   * a failure is a status reason.
   */
  sweep: () => Promise<void>;
  /**
   * Apply a settled watcher Batch: stat each path and compare to `files`,
   * hash and re-outline what differs, drop what is gone (ADR 0013 decision
   * 4). A path whose stat or hash matches its row changes nothing and is
   * named in no event — how an own write, a touch, and a byte-identical
   * sync rewrite all no-op. Runs after any sweep or batch already in flight.
   */
  refresh: (paths: string[]) => Promise<void>;
  /**
   * Index a file the app just wrote, from the content it wrote, before the
   * write's caller returns: this is what makes the row's stat record match
   * the disk and lets the watcher recognise the write as its own.
   */
  own: (path: string, content: string) => Promise<void>;
  status: () => IndexStatus;
  /** A read-only query; the surfaces compose their own SELECTs over the tables. */
  select: <T>(sql: string, ...params: Array<string | number | null>) => T[];
  close: () => void;
};

const SCHEMA = `
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  markdown INTEGER NOT NULL,
  size INTEGER, mtime REAL, hash TEXT,
  kind TEXT, id TEXT,
  bom INTEGER, eol TEXT, trailing_newline INTEGER,
  indexed_at REAL NOT NULL
);
CREATE TABLE problems (path TEXT NOT NULL, channel TEXT NOT NULL, kind TEXT, problem TEXT NOT NULL, block TEXT);
CREATE TABLE fields (path TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL);
CREATE TABLE headings (path TEXT NOT NULL, level INTEGER NOT NULL, text TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, body_start INTEGER NOT NULL, body_end INTEGER NOT NULL, block TEXT);
CREATE TABLE blocks (path TEXT NOT NULL, id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, marker_start INTEGER NOT NULL, marker_end INTEGER NOT NULL);
CREATE TABLE links (path TEXT NOT NULL, syntax TEXT NOT NULL, target TEXT NOT NULL, heading TEXT NOT NULL, block TEXT, alias TEXT, embed INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, resolution TEXT, resolved_path TEXT);
CREATE TABLE tags (path TEXT NOT NULL, canonical TEXT, written TEXT NOT NULL, source TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, invalid TEXT);
CREATE TABLE fields_inline (path TEXT NOT NULL, block TEXT, key TEXT NOT NULL, value TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, value_start INTEGER NOT NULL, value_end INTEGER NOT NULL);
CREATE TABLE positions (path TEXT NOT NULL, field TEXT NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL);
CREATE INDEX problems_path ON problems (path);
CREATE INDEX problems_channel ON problems (channel);
CREATE INDEX fields_path ON fields (path);
CREATE INDEX headings_path ON headings (path);
CREATE INDEX blocks_path ON blocks (path);
CREATE INDEX links_path ON links (path);
CREATE INDEX links_target ON links (target);
CREATE INDEX tags_path ON tags (path);
CREATE INDEX tags_canonical ON tags (canonical);
CREATE INDEX fields_inline_path ON fields_inline (path);
CREATE INDEX positions_path ON positions (path);
`;

const TABLES = [
  "files",
  "problems",
  "fields",
  "headings",
  "blocks",
  "links",
  "tags",
  "fields_inline",
  "positions",
];

/** The database file and the WAL siblings `index.sqlite*` covers. */
const indexFiles = (folder: string) =>
  ["index.sqlite", "index.sqlite-wal", "index.sqlite-shm"].map((name) =>
    join(folder, name)
  );

async function removeIndexFiles(folder: string): Promise<void> {
  for (const file of indexFiles(folder)) {
    await unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

/**
 * Open the database at its schema, or replace it: a missing file, a garbage
 * file, and a `user_version` from another build all take the same path —
 * delete `index.sqlite*`, create afresh — so the rebuild is exercised on
 * every schema change, not only in disaster.
 */
async function openDatabase(folder: string): Promise<DatabaseSync> {
  const file = join(folder, "index.sqlite");
  const attempt = (): DatabaseSync | null => {
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file);
      db.exec("PRAGMA journal_mode = WAL");
      const row = db.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      if (row.user_version === SCHEMA_VERSION) return db;
      db.close();
      return null;
    } catch {
      db?.close();
      return null;
    }
  };
  const existing = attempt();
  if (existing !== null) return existing;
  await removeIndexFiles(folder);
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

/** One file as the sweep found it; `statAt` dates the stat so a fresher own-write record is never overwritten by it. */
type Entry = { size: number; mtime: number; markdown: boolean; statAt: number };
type FilesRow = {
  path: string;
  markdown: number;
  size: number | null;
  mtime: number | null;
  hash: string | null;
  indexed_at: number;
};

const entryOf = (
  path: string,
  s: { size: number; mtimeMs: number }
): Entry => ({
  size: s.size,
  mtime: s.mtimeMs,
  markdown: path.endsWith(".md"),
  statAt: Date.now(),
});

/** A vault-relative path with a vault-relative `changed`/`removed` event around it. */
const vaultChanged = (
  changed: string[],
  removed: string[] = []
): VaultChanged => ({ type: "vaultChanged", changed, removed, renamed: [] });

/**
 * Every non-dot entry under a folder of the vault (the whole vault by
 * default), never through a symlink, with the stat the sweep compares. A
 * folder that cannot be listed is reported as an unreadable path rather
 * than skipped.
 */
async function walk(
  root: string,
  from = ""
): Promise<{
  entries: Map<string, Entry>;
  unlistable: Array<{ path: string; reason: string }>;
}> {
  const entries = new Map<string, Entry>();
  const unlistable: Array<{ path: string; reason: string }> = [];
  async function visit(relative: string) {
    const dir = relative === "" ? root : join(root, relative);
    let listed;
    try {
      listed = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      unlistable.push({ path: relative, reason: errorMessage(error) });
      return;
    }
    for (const entry of listed) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        let s;
        try {
          s = await stat(join(root, path));
        } catch (error) {
          unlistable.push({ path, reason: errorMessage(error) });
          continue;
        }
        entries.set(path, entryOf(path, s));
      }
    }
  }
  await visit(from);
  return { entries, unlistable };
}

export class IndexOpenError extends Error {}

/**
 * Open (or create, or replace) the index for a vault. Throws
 * `IndexOpenError` when `.vitrine/` cannot be created or written — the
 * vault service turns that into the `writeFailed` refusal.
 */
export async function openIndex(
  vaultPath: string,
  options: IndexOptions = {}
): Promise<VaultIndex> {
  const folder = join(vaultPath, ".vitrine");
  const failing = (what: string) => (cause: unknown) => {
    throw new IndexOpenError(`Couldn't ${what}: ${errorMessage(cause)}`);
  };
  await mkdir(folder, { recursive: true }).catch(failing(`create ${folder}`));
  // The one disposable file, ignored in a vault under git; written once, so a
  // user's own `.gitignore` there is never touched (ADR 0014 decision 10).
  await writeFile(join(folder, ".gitignore"), "index.sqlite*\n", {
    flag: "wx",
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") failing(`write ${folder}/.gitignore`)(error);
  });
  const db = await openDatabase(folder).catch(
    failing(`open ${join(folder, "index.sqlite")}`)
  );
  return createIndex(vaultPath, db, options);
}

function createIndex(
  vaultPath: string,
  db: DatabaseSync,
  {
    chunkSize = CHUNK_SIZE,
    positionsOf = {},
    onChanged,
    onStatus,
  }: IndexOptions
): VaultIndex {
  let closed = false;
  let sweep: "pending" | "running" | "done" | { failed: string } = "pending";
  // Batches settled but not yet applied — ADR 0014 decision 11's third
  // reason. Counted from the call, not from the write lock, so a batch
  // queued behind a sweep already counts.
  let batchesInFlight = 0;
  let progress: IndexStatus["indexing"] = null;

  const deletes = TABLES.map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE path = ?`)
  );
  const insertFile = db.prepare(
    `INSERT OR REPLACE INTO files (path, markdown, size, mtime, hash, kind, id, bom, eol, trailing_newline, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const touchFile = db.prepare(
    "UPDATE files SET size = ?, mtime = ?, indexed_at = ? WHERE path = ?"
  );
  const insertProblem = db.prepare(
    "INSERT INTO problems (path, channel, kind, problem, block) VALUES (?, ?, ?, ?, ?)"
  );
  const insertField = db.prepare(
    "INSERT INTO fields (path, key, value) VALUES (?, ?, ?)"
  );
  const insertHeading = db.prepare(
    "INSERT INTO headings (path, level, text, start, end, body_start, body_end, block) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertBlock = db.prepare(
    "INSERT INTO blocks (path, id, start, end, marker_start, marker_end) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertLink = db.prepare(
    "INSERT INTO links (path, syntax, target, heading, block, alias, embed, start, end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertTag = db.prepare(
    "INSERT INTO tags (path, canonical, written, source, start, end, invalid) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertInlineField = db.prepare(
    "INSERT INTO fields_inline (path, block, key, value, start, end, value_start, value_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertPosition = db.prepare(
    "INSERT INTO positions (path, field, text, hash) VALUES (?, ?, ?, ?)"
  );
  const fileRow = db.prepare(
    "SELECT path, markdown, size, mtime, hash, indexed_at FROM files WHERE path = ?"
  );

  const dropRows = (path: string) => {
    for (const statement of deletes) statement.run(path);
  };

  /** A `files` row; everything but the path is null for a non-Markdown file or one that could not be read. */
  const putFile = (
    path: string,
    row: {
      markdown: boolean;
      size?: number;
      mtime?: number;
      hash?: string;
      kind?: string | null;
      id?: string | null;
      file?: { bom: boolean; eol: string; trailingNewline: boolean };
    }
  ) =>
    insertFile.run(
      path,
      row.markdown ? 1 : 0,
      row.size ?? null,
      row.mtime ?? null,
      row.hash ?? null,
      row.kind ?? null,
      row.id ?? null,
      row.file ? (row.file.bom ? 1 : 0) : null,
      row.file?.eol ?? null,
      row.file ? (row.file.trailingNewline ? 1 : 0) : null,
      Date.now()
    );

  /** Every row one Markdown file yields, from its content; inside a transaction. */
  const insertOutlined = (
    path: string,
    { size, mtime }: { size: number; mtime: number },
    hash: string,
    content: string
  ) => {
    const read = analyseFile(path, content, hash);
    if (!read.readable) {
      putFile(path, { markdown: true, size, mtime, hash });
      insertProblem.run(path, "unreadable", null, read.reason, null);
      return;
    }
    const fm = (read.outline.frontmatter?.value ?? {}) as Record<
      string,
      unknown
    >;
    const id = typeof fm["id"] === "string" ? fm["id"] : null;
    putFile(path, {
      markdown: true,
      size,
      mtime,
      hash,
      kind: read.kind,
      id,
      file: read.file,
    });
    for (const h of read.outline.headings) {
      insertHeading.run(
        path,
        h.level,
        h.text,
        h.range.start,
        h.range.end,
        h.body.start,
        h.body.end,
        h.blockId
      );
    }
    for (const b of read.outline.blockIds) {
      insertBlock.run(
        path,
        b.id,
        b.range.start,
        b.range.end,
        b.marker.start,
        b.marker.end
      );
    }
    for (const l of read.outline.links) {
      insertLink.run(
        path,
        l.syntax,
        l.target,
        JSON.stringify(l.heading),
        l.blockId,
        l.alias,
        l.embed ? 1 : 0,
        l.range.start,
        l.range.end
      );
    }
    for (const t of read.outline.tags) {
      if (t.valid) {
        insertTag.run(
          path,
          t.canonical,
          t.text,
          t.source,
          t.range.start,
          t.range.end,
          null
        );
      } else {
        insertTag.run(
          path,
          null,
          t.text,
          t.source,
          t.range.start,
          t.range.end,
          t.reason
        );
      }
    }
    for (const f of read.outline.inlineFields) {
      insertInlineField.run(
        path,
        f.under,
        f.key,
        f.value,
        f.range.start,
        f.range.end,
        f.valueRange.start,
        f.valueRange.end
      );
    }
    for (const s of read.shape) {
      insertProblem.run(path, "shape", s.kind, s.problem, s.block ?? null);
    }
    // The Question is the one Kind with row fields today (ADR 0009): a
    // missing key is Partial, a wrong value Unreadable, both recorded here
    // so the footer counts can never be out of step with the rows.
    if (read.kind === "question") {
      try {
        const fields = readQuestion(fm);
        if (fields === null) {
          insertProblem.run(
            path,
            "partial",
            "question",
            "question or captured is missing",
            null
          );
        } else {
          for (const [key, value] of Object.entries(fields)) {
            insertField.run(path, key, JSON.stringify(value));
          }
        }
      } catch (error) {
        insertProblem.run(
          path,
          "unreadable",
          "question",
          errorMessage(error),
          null
        );
      }
    }
    if (read.kind !== null) {
      for (const p of positionsOf[read.kind]?.(read, content) ?? []) {
        insertPosition.run(path, p.field, p.text, sha256(p.text));
      }
    }
  };

  const transaction = (work: () => void) => {
    db.exec("BEGIN");
    try {
      work();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const raise = async (event: VaultChanged) => {
    await onChanged?.(event);
  };
  const raiseStatus = async () => {
    await onStatus?.();
  };

  type Read = {
    path: string;
    entry: Entry;
    bytes: Buffer | null;
    error: string | null;
    readAt: number;
  };

  const readAll = (paths: string[], entries: Map<string, Entry>) =>
    Promise.all(
      paths.map(async (path): Promise<Read> => {
        const entry = entries.get(path) as Entry;
        const readAt = Date.now();
        if (!entry.markdown) {
          return { path, entry, bytes: null, error: null, readAt };
        }
        try {
          const bytes = await readFile(join(vaultPath, path));
          return { path, entry, bytes, error: null, readAt };
        } catch (error) {
          return {
            path,
            entry,
            bytes: null,
            error: errorMessage(error),
            readAt,
          };
        }
      })
    );

  /** One read file into its rows; inside a transaction. True when what a surface reads changed. */
  const apply = ({ path, entry, bytes, error, readAt }: Read): boolean => {
    const existing = fileRow.get(path) as FilesRow | undefined;
    // An own write that landed after this read already holds newer rows
    // than the bytes read here; its record wins.
    if (existing !== undefined && existing.indexed_at >= readAt) return false;
    if (!entry.markdown) {
      if (existing !== undefined) return false;
      putFile(path, { markdown: false });
      return true;
    }
    if (bytes === null) {
      dropRows(path);
      putFile(path, { markdown: true, size: entry.size, mtime: entry.mtime });
      insertProblem.run(path, "unreadable", null, error ?? "unreadable", null);
      return true;
    }
    const hash = sha256(bytes);
    // A touch, a sync client's byte-identical rewrite: the stat moved and
    // nothing else, so record the stat and keep the rows (ADR 0013 d.4) —
    // unless an own write recorded a fresher stat since this one was taken.
    if (existing?.hash === hash) {
      if (existing.indexed_at < entry.statAt) {
        touchFile.run(entry.size, entry.mtime, Date.now(), path);
      }
      return false;
    }
    dropRows(path);
    insertOutlined(path, entry, hash, bytes.toString("utf8"));
    return true;
  };

  /**
   * What a set of stat-ted entries means against `files`: the paths to read
   * again, and the known paths that are gone. Shared by the sweep (every
   * file) and a batch (the settled ones).
   */
  const reconcile = (
    entries: Map<string, Entry>,
    known: FilesRow[]
  ): { work: string[]; removed: string[] } => {
    const byPath = new Map(known.map((row) => [row.path, row]));
    const work: string[] = [];
    for (const [path, entry] of entries) {
      const row = byPath.get(path);
      const unchanged =
        row !== undefined &&
        (!entry.markdown ||
          (row.size === entry.size && row.mtime === entry.mtime));
      if (!unchanged) work.push(path);
    }
    const removed = known
      .map((row) => row.path)
      .filter((path) => !entries.has(path));
    return { work, removed };
  };

  /**
   * Apply what `reconcile` found: the vanished paths go with the first
   * chunk's transaction and event, so a delete-plus-create that settled
   * together is one `vaultChanged` (and #189 can pair a rename inside it);
   * every further chunk is its own transaction and event. A chunk that
   * changed no row — every path a touch or an own write — raises nothing.
   */
  const applyChunked = async (
    { work, removed }: { work: string[]; removed: string[] },
    entries: Map<string, Entry>,
    afterChunk: (chunk: string[]) => Promise<void> = () => Promise.resolve()
  ) => {
    const chunks: string[][] = [];
    for (let at = 0; at < work.length; at += chunkSize) {
      chunks.push(work.slice(at, at + chunkSize));
    }
    if (chunks.length === 0 && removed.length > 0) chunks.push([]);
    for (const [n, chunk] of chunks.entries()) {
      const reads = await readAll(chunk, entries);
      if (closed) return;
      const changed: string[] = [];
      const dropped = n === 0 ? removed : [];
      transaction(() => {
        for (const path of dropped) dropRows(path);
        for (const read of reads) if (apply(read)) changed.push(read.path);
      });
      if (changed.length > 0 || dropped.length > 0) {
        await raise(vaultChanged(changed, dropped));
      }
      await afterChunk([...dropped, ...chunk]);
    }
  };

  const allKnown = () =>
    db
      .prepare(
        "SELECT path, markdown, size, mtime, hash, indexed_at FROM files"
      )
      .all() as FilesRow[];

  async function runSweep(): Promise<void> {
    const { entries, unlistable } = await walk(vaultPath);
    if (closed) return;
    const { work, removed } = reconcile(entries, allKnown());
    progress = { done: 0, total: work.length + removed.length };
    await raiseStatus();
    if (closed) return;

    // Folders that could not be listed are problems with no file behind
    // them; the sweep is the only thing that learns of them, so it owns
    // their rows outright.
    transaction(() => {
      db.exec(
        "DELETE FROM problems WHERE path NOT IN (SELECT path FROM files)"
      );
      for (const { path, reason } of unlistable) {
        insertProblem.run(path, "unreadable", null, reason, null);
      }
    });

    await applyChunked({ work, removed }, entries, async (applied) => {
      progress = {
        done: (progress?.done ?? 0) + applied.length,
        total: progress?.total ?? 0,
      };
      await raiseStatus();
    });
  }

  const rowsUnder = db.prepare(
    "SELECT path, markdown, size, mtime, hash, indexed_at FROM files WHERE path = ? OR path LIKE ? ESCAPE '\\'"
  );
  const likePrefix = (path: string) => path.replace(/[\\%_]/g, "\\$&") + "/%";

  /**
   * A settled Batch: the same comparison as the sweep, over its paths alone.
   * A path is compared with everything the index holds at or under it,
   * because a folder dragged out of the vault or into it is one event for
   * the folder, not one per file (Finder's delete is a move to the Trash).
   */
  async function runRefresh(paths: string[]): Promise<void> {
    const entries = new Map<string, Entry>();
    const known = new Map<string, FilesRow>();
    for (const path of paths) {
      for (const row of rowsUnder.all(path, likePrefix(path)) as FilesRow[]) {
        known.set(row.path, row);
      }
      let s;
      try {
        s = await stat(join(vaultPath, path));
      } catch {
        // Gone: what the index held there is removed. Nothing held there —
        // a temp file the batch caught mid-flight — and nothing is owed.
        continue;
      }
      if (s.isFile()) {
        entries.set(path, entryOf(path, s));
      } else if (s.isDirectory()) {
        for (const [p, entry] of (await walk(vaultPath, path)).entries) {
          entries.set(p, entry);
        }
      }
    }
    if (closed) return;
    await applyChunked(reconcile(entries, [...known.values()]), entries);
  }

  // The sweep and every batch write one after another: a batch that ran
  // inside the sweep's walk-to-commit gap could otherwise index a file the
  // sweep is about to drop as unseen.
  let writes: Promise<void> = Promise.resolve();
  const serially = (work: () => Promise<void>) => {
    const run = writes.then(work, work);
    writes = run;
    return run;
  };

  return {
    sweep: () => {
      // A sweep asked for while one runs is answered by that one: both would
      // compare the same disk to the same rows.
      if (sweep === "running") return writes;
      sweep = "running";
      return serially(async () => {
        try {
          await runSweep();
          sweep = "done";
        } catch (error) {
          sweep = { failed: errorMessage(error) };
        }
        progress = null;
        if (!closed) await raiseStatus();
      });
    },
    refresh: (paths) => {
      batchesInFlight++;
      return serially(async () => {
        if (closed) return;
        await runRefresh(paths);
      }).finally(() => batchesInFlight--);
    },
    own: async (path, content) => {
      const s = await stat(join(vaultPath, path));
      // The vault was switched or the app is exiting between the write and
      // its indexing; the next open's sweep picks the file up by stat.
      if (closed) return;
      const hash = sha256(Buffer.from(content, "utf8"));
      transaction(() => {
        dropRows(path);
        insertOutlined(path, { size: s.size, mtime: s.mtimeMs }, hash, content);
      });
      await raise(vaultChanged([path]));
    },
    status: () => ({
      indexing: progress,
      current:
        sweep === "pending" || sweep === "running"
          ? { ok: false, reason: "a sweep has not completed" }
          : typeof sweep === "object"
            ? { ok: false, reason: `the sweep failed: ${sweep.failed}` }
            : batchesInFlight > 0
              ? { ok: false, reason: "a settled batch is not yet applied" }
              : { ok: true },
    }),
    select: <T>(sql: string, ...params: Array<string | number | null>) =>
      db.prepare(sql).all(...params) as T[],
    close: () => {
      closed = true;
      db.close();
    },
  };
}
