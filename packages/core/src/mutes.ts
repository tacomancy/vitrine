import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parse, stringify } from "yaml";
import { writeAtomically } from "./atomic-write.js";
import { errorMessage, errorMessageWithoutPath, VaultError } from "./errors.js";
import { openAlexId } from "./openalex.js";
import { serialised } from "./serialise.js";

/**
 * Mute rules (ADR 0044 decision 4; `docs/architecture.md` § Scouts): one
 * vault-wide file, read as found and applied inside the Queue's reads, so a
 * Proposal is never marked and deleting a rule returns everything it held.
 * Only pending and deferred Proposals can be muted: an accepted, rejected or
 * held one is a decision already made, and muting must not hide it.
 */

export const MUTE_KINDS = ["author", "venue", "publisher", "keyword"] as const;
export type MuteKind = (typeof MUTE_KINDS)[number];
/**
 * `id` is an OpenAlex source (`S…`) or publisher (`P…`) ID, kept beside the
 * name (ADR 0051 decision 8). A venue rule without one matches by name as it
 * always did; a publisher rule has nothing to match on without one.
 */
export type MuteRule = {
  kind: MuteKind;
  value: string;
  id?: string | undefined;
};

const FILE = ".vitrine/mutes.yaml";

/** The file holds one list per kind; the key is the plural a hand-editor would type. */
const KEYS: Record<MuteKind, string> = {
  author: "authors",
  venue: "venues",
  publisher: "publishers",
  keyword: "keywords",
};

const unreadable = (why: string) =>
  `${FILE} could not be read, so no mute rule is applied: ${why}`;

export type ReadMutes = {
  rules: MuteRule[];
  /** Null when the file parsed or is not there. A rules file that does not parse is named, never read as no rules (ADR 0044 decision 4). */
  problem: string | null;
};

/** An entry is a bare name, or for a venue or publisher a name with its OpenAlex ID. */
function entryOf(kind: MuteKind, raw: unknown): MuteRule | string {
  const list = KEYS[kind];
  if (typeof raw === "string") {
    return kind === "publisher"
      ? `${list} must each give a name and an id, as "name: …" and "id: P…"`
      : { kind, value: raw };
  }
  const idKinds: MuteKind[] = ["venue", "publisher"];
  if (
    !idKinds.includes(kind) ||
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw)
  ) {
    return `${list} must be a list of text`;
  }
  const entry = raw as Record<string, unknown>;
  const stray = Object.keys(entry).find((k) => k !== "name" && k !== "id");
  if (stray !== undefined) {
    return `"${stray}" is not one of name, id in ${list}`;
  }
  const id = openAlexId(entry["id"]);
  const name = entry["name"];
  if (id === null || (name !== undefined && typeof name !== "string")) {
    return `${list} must each give an id${name === undefined ? "" : " and a name in text"}`;
  }
  return { kind, value: name ?? id, id };
}

/**
 * Read as found (ADR 0009). A key it does not know is a problem and not an
 * ignored line: `author:` for `authors:` would otherwise be a rule that
 * silently never fires, which looks the same as no rules.
 */
export async function readMutes(vaultPath: string): Promise<ReadMutes> {
  let text: string;
  try {
    text = await readFile(join(vaultPath, FILE), "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return { rules: [], problem: null };
    }
    return { rules: [], problem: unreadable(errorMessageWithoutPath(cause)) };
  }
  let parsed: unknown;
  try {
    parsed = parse(text) as unknown;
  } catch (cause) {
    return { rules: [], problem: unreadable(errorMessage(cause)) };
  }
  // An empty file is no rules; anything but a mapping is not a rules file.
  if (parsed === null || parsed === undefined) {
    return { rules: [], problem: null };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      rules: [],
      problem: unreadable("it is not a list of authors, venues and keywords"),
    };
  }
  const found = parsed as Record<string, unknown>;
  const keys = Object.values(KEYS);
  const stray = Object.keys(found).find((key) => !keys.includes(key));
  if (stray !== undefined) {
    return {
      rules: [],
      problem: unreadable(`"${stray}" is not one of ${keys.join(", ")}`),
    };
  }
  const rules: MuteRule[] = [];
  for (const kind of MUTE_KINDS) {
    const list = found[KEYS[kind]];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) {
      return {
        rules: [],
        problem: unreadable(`${KEYS[kind]} must be a list of text`),
      };
    }
    for (const raw of list as unknown[]) {
      const entry = entryOf(kind, raw);
      if (typeof entry === "string") {
        return { rules: [], problem: unreadable(entry) };
      }
      // A blank entry would match every venue-less or empty field; it is a typo.
      if (entry.value.trim() !== "") {
        rules.push({ ...entry, value: entry.value.trim() });
      }
    }
  }
  return { rules, problem: null };
}

const fold = (text: string) => text.trim().toLowerCase();
const same = (a: MuteRule, b: MuteRule) =>
  a.kind === b.kind &&
  (a.id !== undefined || b.id !== undefined
    ? a.id === b.id
    : fold(a.value) === fold(b.value));

type Row = {
  id: number;
  title: string;
  authors: string;
  venue: string | null;
  venue_source_id: string | null;
  /** JSON list of publisher IDs; null where the source gave no lineage. */
  publisher_lineage: string | null;
  abstract: string;
};

/** Author and venue name match whole after trim and case-fold; a keyword is a substring of title or abstract (there are no keywords on a Proposal). */
function catches(rule: MuteRule, row: Row): boolean {
  const wanted = fold(rule.value);
  switch (rule.kind) {
    case "author":
      return (JSON.parse(row.authors) as string[]).some(
        (name) => fold(name) === wanted
      );
    case "venue":
      // The ID decides when both sides have one, so a renamed journal is still
      // caught; a Proposal with none (arXiv, a page, older rows) falls back to
      // the name, which is what every rule did before OpenAlex.
      if (rule.id !== undefined && row.venue_source_id !== null) {
        return row.venue_source_id === rule.id;
      }
      return row.venue !== null && fold(row.venue) === wanted;
    case "publisher":
      // The lineage holds the parent organisations too, so a rule on a parent
      // catches its imprints.
      return (
        rule.id !== undefined &&
        row.publisher_lineage !== null &&
        (JSON.parse(row.publisher_lineage) as string[]).includes(rule.id)
      );
    case "keyword":
      return (
        row.title.toLowerCase().includes(wanted) ||
        row.abstract.toLowerCase().includes(wanted)
      );
  }
}

/** The Proposals a rule can hold: pending and deferred, in either Lane. */
function mutable(queue: DatabaseSync): Row[] {
  return queue
    .prepare(
      "SELECT id, title, authors, venue, venue_source_id, publisher_lineage, abstract FROM proposals WHERE state IN ('pending', 'deferred')"
    )
    .all() as Row[];
}

/** Which rule holds which Proposal: the first in the file's order, so a rule's removal hands an item to the next rather than to nothing. */
export function applied(
  queue: DatabaseSync,
  rules: MuteRule[]
): Map<number, MuteRule> {
  const caught = new Map<number, MuteRule>();
  if (rules.length === 0) return caught;
  for (const row of mutable(queue)) {
    const rule = rules.find((r) => catches(r, row));
    if (rule !== undefined) caught.set(row.id, rule);
  }
  return caught;
}

/**
 * The one answer every Queue read filters by, so the stack, Skim, Review
 * depth and a group's figures cannot disagree about what is muted. A file
 * that does not parse holds back nothing here and says why in `problem`.
 */
export async function readMuteState(deps: {
  vaultPath: string;
  queue: DatabaseSync;
}): Promise<ReadMutes & { caught: Map<number, MuteRule> }> {
  const { rules, problem } = await readMutes(deps.vaultPath);
  return { rules, problem, caught: applied(deps.queue, rules) };
}

export type MutedItem = {
  id: number;
  title: string;
  authors: string[];
  venue: string | null;
  url: string;
  lane: "review" | "skim";
  state: "pending" | "deferred";
  /** The rule that caught it: the first in the file when more than one would. */
  rule: MuteRule;
};

/** The muted view: every item a rule holds, each with the rule that holds it. */
export type Muted = ReadMutes & { items: MutedItem[] };

export async function readMuted(deps: {
  vaultPath: string;
  queue: DatabaseSync;
}): Promise<Muted> {
  const { rules, problem, caught } = await readMuteState(deps);
  const rows = deps.queue
    .prepare(
      `SELECT id, title, authors, venue, url, lane, state FROM proposals
        WHERE state IN ('pending', 'deferred') ORDER BY first_seen DESC, id DESC`
    )
    .all() as Array<Omit<MutedItem, "authors" | "rule"> & { authors: string }>;
  return {
    rules,
    problem,
    items: rows.flatMap((row) => {
      const rule = caught.get(row.id);
      return rule === undefined
        ? []
        : [{ ...row, authors: JSON.parse(row.authors) as string[], rule }];
    }),
  };
}

/**
 * How many pending and deferred Proposals saving this rule would newly hold,
 * which is the rise in *N muted* once it is saved: what another rule already
 * holds is not the candidate's to claim, since the file's earlier rule names it.
 */
export async function muteReach(
  deps: { vaultPath: string; queue: DatabaseSync },
  candidate: MuteRule
): Promise<number> {
  const rule = checked(candidate);
  const { caught } = await readMuteState(deps);
  return mutable(deps.queue).filter(
    (row) => !caught.has(row.id) && catches(rule, row)
  ).length;
}

function checked(rule: MuteRule): MuteRule {
  const id = rule.id === undefined ? null : openAlexId(rule.id);
  if (
    !MUTE_KINDS.includes(rule.kind) ||
    rule.value.trim() === "" ||
    (rule.kind === "publisher" && id === null)
  ) {
    throw new VaultError(
      "refused",
      "A mute rule needs an author, a venue, a publisher (with its OpenAlex id) or a keyword to match."
    );
  }
  return id === null
    ? { kind: rule.kind, value: rule.value.trim() }
    : { kind: rule.kind, value: rule.value.trim(), id };
}

// Read, change, write the whole file: two changes that both read before either
// wrote would lose one — a rule that vanished or one that would not go. The
// queue is here, in the function, and not in the procedures that call it.
const serially = serialised();

export function addMute(vaultPath: string, rule: MuteRule): Promise<void> {
  const added = checked(rule);
  return serially(() =>
    change(vaultPath, (rules) =>
      rules.some((r) => same(r, added)) ? null : [...rules, added]
    )
  );
}

/** Deleting a rule that is not there is not a failure: the item is already back. */
export function removeMute(vaultPath: string, rule: MuteRule): Promise<void> {
  const removed = checked(rule);
  return serially(() =>
    change(vaultPath, (rules) =>
      rules.some((r) => same(r, removed))
        ? rules.filter((r) => !same(r, removed))
        : null
    )
  );
}

async function change(
  vaultPath: string,
  plan: (rules: MuteRule[]) => MuteRule[] | null
): Promise<void> {
  const { rules, problem } = await readMutes(vaultPath);
  if (problem !== null) {
    throw new VaultError(
      "writeFailed",
      `${FILE} could not be read, and the rules already in it would be lost by writing over it. Fix or remove it, then try again.`
    );
  }
  const next = plan(rules);
  if (next === null) return;
  const lists: Record<
    string,
    Array<string | { name: string; id: string }>
  > = {};
  for (const kind of MUTE_KINDS) {
    const values = next
      .filter((r) => r.kind === kind)
      .map((r) => (r.id === undefined ? r.value : { name: r.value, id: r.id }));
    if (values.length > 0) lists[KEYS[kind]] = values;
  }
  const path = join(vaultPath, FILE);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeAtomically(path, stringify(lists, { lineWidth: 0 }));
  } catch (cause) {
    throw new VaultError(
      "writeFailed",
      `Couldn't write ${FILE}: ${errorMessageWithoutPath(cause)}`
    );
  }
}
