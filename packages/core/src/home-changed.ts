import type { DatabaseSync } from "node:sqlite";
import { localDay, type OpenDays } from "./open-days.js";
import { readPageFile, revisionsOf, section } from "./page-file.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * *Changed while you were away* (spec #728, RES-4): what happened in the vault
 * since the researcher was last here, collected under the Tag each item is
 * about so the landing offers threads to pick up and not a feed to read.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** With no previous open day there is still a definite answer. */
const DEFAULT_DAYS = 7;
/** A month away reads as a fortnight, not a catalogue. */
const CAP_DAYS = 14;
const MAX_GROUPS = 5;
const MAX_ITEMS = 3;

export type ChangedItem = {
  /** Vault-relative, as the index keys it; the renderer makes the Address. */
  path: string;
  kind:
    | "question"
    | "note"
    | "research-question"
    | "hypothesis"
    | "experiment"
    | "source";
  sentence: string;
  title: string;
  at: string;
};

export type ChangedGroup = {
  topic:
    | { kind: "tag"; tag: string }
    | { kind: "invalid"; reason: string }
    | { kind: "untagged" };
  items: ChangedItem[];
};

/**
 * Where the window opens. The start of the previous open day, not of
 * yesterday, so a Monday after a week away reaches back to the last Monday;
 * `before` is strictly earlier than today, so today is never its own previous.
 */
export function changedWindowStart(days: OpenDays, now: Date): Date {
  const previous = days.before(localDay(now));
  const floor = now.getTime() - CAP_DAYS * DAY_MS;
  if (previous === null) return new Date(now.getTime() - DEFAULT_DAYS * DAY_MS);
  const [y, m, d] = previous.split("-").map(Number) as [number, number, number];
  return new Date(Math.max(new Date(y, m - 1, d).getTime(), floor));
}

/** Kinds whose file carries `## Position history`. */
const REVISED_KINDS = [
  "research-question",
  "hypothesis",
  "experiment",
] as const;

const AFTER_EVIDENCE = " · edited after evidence";

/** What a Revision's field reads as on Home: a criterion edited after Evidence is named for what it is, any other field by itself (*Working answer revised*, *Claim revised*). */
function revisionSentence(field: string): string {
  if (field.endsWith(AFTER_EVIDENCE)) return "Criterion edited after Evidence";
  return `${field.charAt(0).toUpperCase()}${field.slice(1)} revised`;
}

type Tags = { valid: Map<string, string>; invalid: string[] };

/**
 * Only events with a durable timestamp of their own are items. A structured
 * Kind is never reported on its file `mtime` alone — that moves under sync, a
 * restore and Obsidian's own rewrites, and would put a claim on the page with
 * no warrant. A Note has no event record, so its `mtime` is its one item.
 */
export async function changedWhileAway(
  index: VaultIndex,
  days: OpenDays,
  now: Date,
  vaultPath: string,
  queue: DatabaseSync
): Promise<{ since: string; groups: ChangedGroup[] }> {
  const start = changedWindowStart(days, now).getTime();

  const items: Array<ChangedItem & { tags: Tags }> = [];
  const tagsOf = new Map<string, Tags>();
  for (const row of index.select<{
    path: string;
    canonical: string | null;
    written: string;
    invalid: string | null;
  }>("SELECT path, canonical, written, invalid FROM tags ORDER BY written")) {
    const tags: Tags = tagsOf.get(row.path) ?? {
      valid: new Map(),
      invalid: [],
    };
    if (row.invalid !== null) tags.invalid.push(row.invalid);
    else if (row.canonical !== null && !tags.valid.has(row.canonical))
      tags.valid.set(row.canonical, row.written);
    tagsOf.set(row.path, tags);
  }
  const titleOf = (path: string) =>
    index.select<{ display: string | null }>(
      "SELECT display FROM files WHERE path = ?",
      path
    )[0]?.display ?? path;
  const tagsFor = (path: string): Tags =>
    tagsOf.get(path) ?? { valid: new Map(), invalid: [] };

  const captured = new Map<string, string>();
  for (const row of index.select<{ path: string; key: string; value: string }>(
    "SELECT path, key, value FROM fields WHERE key IN ('captured', 'question') AND path IN (SELECT path FROM files WHERE kind = 'question') ORDER BY path"
  )) {
    captured.set(`${row.key}:${row.path}`, JSON.parse(row.value) as string);
  }
  for (const row of index.select<{ path: string }>(
    "SELECT path FROM files WHERE kind = 'question'"
  )) {
    const at = Date.parse(captured.get(`captured:${row.path}`) ?? "");
    if (Number.isNaN(at) || at < start) continue;
    items.push({
      path: row.path,
      kind: "question",
      sentence: "Question captured",
      title: captured.get(`question:${row.path}`) ?? row.path,
      at: new Date(at).toISOString(),
      tags: tagsFor(row.path),
    });
  }

  // Position history's own dates: one item per entry, named by its field.
  for (const row of index.select<{ path: string; kind: string }>(
    `SELECT f.path, f.kind FROM files f WHERE f.kind IN (${REVISED_KINDS.map(() => "?").join(", ")})
       AND EXISTS (SELECT 1 FROM headings h WHERE h.path = f.path AND h.level = 2 AND h.text = 'Position history')
     ORDER BY f.path`,
    ...REVISED_KINDS
  )) {
    const page = await readPageFile(vaultPath, row.path, [row.kind], row.kind);
    if (!page.readable) continue;
    const { heading } = section(page.outline, "Position history");
    const { entries } = revisionsOf(
      page.relativePath,
      row.kind,
      page.content,
      page.outline,
      heading
    );
    for (const revision of entries) {
      const at = Date.parse(revision.at);
      if (Number.isNaN(at) || at < start) continue;
      items.push({
        path: row.path,
        kind: row.kind as ChangedItem["kind"],
        sentence: revisionSentence(revision.field),
        title: titleOf(row.path),
        at: new Date(at).toISOString(),
        tags: tagsFor(row.path),
      });
    }
  }

  // An Experiment is a run recorded, from its own `created:`.
  for (const row of index.select<{ path: string; created: string | null }>(
    `SELECT f.path, json_extract(fm.value, '$.created') AS created FROM files f
       JOIN frontmatter fm ON fm.path = f.path WHERE f.kind = 'experiment'`
  )) {
    const at = Date.parse(row.created ?? "");
    if (Number.isNaN(at) || at < start) continue;
    items.push({
      path: row.path,
      kind: "experiment",
      sentence: "Experiment run recorded",
      title: titleOf(row.path),
      at: new Date(at).toISOString(),
      tags: tagsFor(row.path),
    });
  }

  // A stub the researcher accepted from a Scout: the triage row's own date.
  for (const row of queue
    .prepare(
      `SELECT t.at, p.title, p.stub_path FROM triage t JOIN proposals p ON p.id = t.proposal_id
       WHERE t.action = 'accept' AND p.stub_path IS NOT NULL`
    )
    .all() as Array<{ at: string; title: string; stub_path: string }>) {
    const at = Date.parse(row.at);
    if (Number.isNaN(at) || at < start) continue;
    items.push({
      path: row.stub_path,
      kind: "source",
      sentence: "Source stub accepted",
      title: row.title,
      at: new Date(at).toISOString(),
      tags: tagsFor(row.stub_path),
    });
  }

  // A Source's highlights ingested is left out: Ingest records no timestamp of
  // its own (the sidecar's `last_matched` moves on every re-match, the PDF's
  // mtime is a file time), so there is nothing to report it from (#734).

  for (const row of index.select<{
    path: string;
    display: string | null;
    mtime: number;
  }>(
    "SELECT path, display, mtime FROM files WHERE markdown = 1 AND kind IS NULL AND mtime >= ?",
    start
  )) {
    items.push({
      path: row.path,
      kind: "note",
      sentence: "Note edited",
      title: row.display ?? row.path,
      at: new Date(row.mtime).toISOString(),
      tags: tagsFor(row.path),
    });
  }

  // How many items carry each Tag decides which one an item lands under: the
  // page offers fewer, fuller threads, and the same vault always groups the same.
  const shared = new Map<string, number>();
  for (const item of items)
    for (const tag of item.tags.valid.keys())
      shared.set(tag, (shared.get(tag) ?? 0) + 1);

  const groups = new Map<string, ChangedGroup>();
  for (const { tags, ...item } of items) {
    const best = [...tags.valid.keys()].sort(
      (a, b) => (shared.get(b) ?? 0) - (shared.get(a) ?? 0) || (a < b ? -1 : 1)
    )[0];
    const topic: ChangedGroup["topic"] =
      best !== undefined
        ? { kind: "tag", tag: tags.valid.get(best) ?? best }
        : tags.invalid.length > 0
          ? { kind: "invalid", reason: [...tags.invalid].sort()[0] ?? "" }
          : { kind: "untagged" };
    const key = best !== undefined ? `tag:${best}` : JSON.stringify(topic);
    const group = groups.get(key) ?? { topic, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }

  const heading = (g: ChangedGroup) =>
    g.topic.kind === "tag"
      ? g.topic.tag
      : g.topic.kind === "invalid"
        ? g.topic.reason
        : "";
  const newest = (g: ChangedGroup) => g.items[0]?.at ?? "";
  const ordered = [...groups.values()];
  // Path breaks a tie in time, so the same vault always reads the same.
  for (const g of ordered)
    g.items.sort(
      (a, b) =>
        (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (a.path < b.path ? -1 : 1)
    );
  ordered.sort(
    (a, b) =>
      Number(a.topic.kind === "untagged") -
        Number(b.topic.kind === "untagged") ||
      (newest(a) < newest(b) ? 1 : newest(a) > newest(b) ? -1 : 0) ||
      (heading(a) < heading(b) ? -1 : 1)
  );
  // Untagged keeps its slot when the cap bites: an item is never dropped for
  // lacking a Tag (story 41).
  const last = ordered.at(-1);
  const shown =
    ordered.length > MAX_GROUPS && last?.topic.kind === "untagged"
      ? [...ordered.slice(0, MAX_GROUPS - 1), last]
      : ordered.slice(0, MAX_GROUPS);
  // The remainder is not counted or hinted at: the group simply ends.
  return {
    // Said in the Warrant of an empty section: what was looked at, since when.
    since: new Date(start).toISOString(),
    groups: shown.map((g) => ({
      ...g,
      items: g.items.slice(0, MAX_ITEMS),
    })),
  };
}
