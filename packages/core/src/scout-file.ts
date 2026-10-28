import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, YAMLParseError } from "yaml";
import { writeAtomically } from "./atomic-write.js";
import { errorMessageWithoutPath, VaultError } from "./errors.js";
import { openAlexId } from "./openalex.js";

/**
 * A Scout as its file says it (ADR 0016 decision 4; `docs/architecture.md`
 * § Vault layout, `scouts/<id>.yaml`). Read as found, ADR 0009's rule: a
 * hand edit is honoured on the next read, and a file that does not parse, or
 * cannot be read, is returned by name rather than skipped (ADR 0039 decision
 * 7). Runtime never lives in the file; everything a run learns is a row in
 * `queue.sqlite`.
 */
export type Scout = {
  /** The file's own name, `.vitrine/scouts/<id>.yaml`: what a run row refers to. */
  id: string;
  name: string;
  /**
   * What it watches: arXiv or OpenAlex through their APIs, or one or more web
   * pages (ADR 0017, ADR 0051, ADR 0056). A Watched Scout's pages are a list
   * whichever key its file uses, in file order and each trimmed, so no reader
   * asks which form the file was written in.
   */
  source: { kind: "arxiv" | "openalex" } | { kind: "watched"; urls: string[] };
  /**
   * The arXiv Query — what a run asked, so an edit to it overrides a wait. For
   * a Watched source, its first page: the one *Address* the form shows until
   * it lists them (#911). A read about a page asks `atPage`, never this.
   */
  query: string;
  /**
   * A Tag Filter (spec #678): the Tags as written, whose Lexicons the run
   * compiles. Absent for a Query Scout and a Watched one, and then `query` is
   * the Filter; present, `query` is empty, since the compiled string is never
   * stored on the Scout, only on the runs that asked it.
   */
  tags?: string[];
  /**
   * An OpenAlex Scout's venue allowlist (ADR 0051 decision 9): the only
   * venues it asks, each by OpenAlex source ID with the name the researcher
   * chose it by. It narrows what is asked, so it is not a mute. Absent for no
   * allowlist; never empty, since an empty list would ask nothing.
   */
  venues?: Venue[];
  cadence: "daily" | "weekly" | "monthly";
  /** Question ids (§ Vault layout: `assigned: [question ids]`). */
  assigned: string[];
  /** Where a Proposal lands on arrival; stamped then, so editing it moves nothing already here. */
  lane: "review" | "skim";
  paused: boolean;
  /**
   * When the researcher retired it (ADR 0042 decision 1), or null while it is
   * looking. Not *paused*, which is a Scout that will look again.
   */
  dropped: Date | null;
  /** Where the first run's window opens, unless `searchBackTo` reaches further. */
  created: Date;
  /** *Also search back to* (ADR 0016 decision 5): the first run opens its window here and its finds are Retroactive. */
  searchBackTo: Date | null;
  /** Queue behaviour (ADR 0044 d.11). Most Proposals a run keeps in Review, or null for no cap; `arrive` applies it once the Scout has `HISTORY_FLOOR` counted acts. */
  cap: number | null;
  /** Days before a pending Review item collapses into the digest. */
  reviewDays: number;
  /** Days before a Skim line sits behind *show older*. */
  skimDays: number;
};

/** An OpenAlex source ID, short form: what a request's filter carries as it is, so nothing else may reach it. */
export const VENUE_ID = /^S\d+$/;

/** A venue on an allowlist: the short source ID (`S…`) a request carries, and its name. */
export type Venue = { id: string; name: string };

export const DEFAULT_REVIEW_DAYS = 14;
export const DEFAULT_SKIM_DAYS = 30;

/** The file's key for each Queue behaviour field, which is the name a refusal gives it. */
export const QUEUE_KEYS = {
  cap: "cap",
  reviewDays: "review_days",
  skimDays: "skim_days",
} as const;

/** The sentence naming a bad value, the same in the rail and in the form's refusal. */
export const queueNumberProblem = (key: string) =>
  `${key} is not a whole number of 1 or more`;

/**
 * The one definition of a good Queue behaviour number, for the file and for
 * the form's text alike: a whole number of 1 or more. A value outside it is
 * named, never read as the default, so a typo cannot pass for "no cap" or
 * quietly put *show older* back at 30 days (ADR 0044 d.11; ADR 0039 d.7).
 */
export function parseQueueNumber(value: unknown): number | null {
  const n =
    typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** A Scout file the app cannot use — it does not parse, or its bytes could not be read: its name, and one sentence naming what is wrong. */
export type UnreadableScout = { file: string; sentence: string };

/** The one sentence the rail and Loose Ends both print for such a file. */
const unreadableFile = (file: string, problem: string): UnreadableScout => ({
  file,
  sentence: `This file could not be read: ${problem}.`,
});

/**
 * Vault-relative, and kept so: it goes into the reasons a surface shows as
 * well as onto the vault path, and a message that interpolated the joined
 * path would put back what the errno's cut took out (ADR 0028, #288).
 */
export const SCOUTS_FOLDER = ".vitrine/scouts";

/**
 * Which names in the Scouts folder are Scouts, and the id each one gives. One
 * definition, so the read of the Scouts and the lookup of a Scout's file for
 * an edit cannot take different names (#533).
 */
const SCOUT_FILE = /\.ya?ml$/i;
export const isScoutFile = (name: string) => SCOUT_FILE.test(name);
export const scoutIdOf = (file: string) => file.replace(SCOUT_FILE, "");

/**
 * What an erased Scout leaves in place of its file (ADR 0053 decision 6): its
 * name and id, nothing else, in `<id>.erased`. The extension is not a Scout's,
 * so every reader that lists Scouts passes over it without being told to; only
 * a reader that names a Scout by id asks for it, through `readScouts`.
 */
export type Tombstone = { id: string; name: string };
const TOMBSTONE_FILE = /\.erased$/;
export const isTombstoneFile = (name: string) => TOMBSTONE_FILE.test(name);
/**
 * The id a name in the Scouts folder takes, whichever kind of file it is: what
 * a new Scout's id must not repeat, since a record still points at an erased
 * Scout's id and a new Scout under it would inherit that history.
 */
export const takenIdOf = (file: string) =>
  scoutIdOf(file).replace(TOMBSTONE_FILE, "");

/** Shortest first, the order `dueUnder` names them in. The renderer takes types from `core` and no values, so its menu keeps a list of its own. */
export const CADENCES = ["daily", "weekly", "monthly"] as const;
const LANES = ["review", "skim"] as const;

/**
 * The names in the Scouts folder. A folder that is not there is a vault with
 * no Scouts yet, and that is the one absence; anything else that stops it
 * being listed — a file where the folder should be, a folder the app may not
 * read — means what the Scouts are is *not known*, so the read fails rather
 * than answering an empty list that nobody looked to warrant (ADR 0032;
 * `CLAUDE.md` § Invariants, no silent failures). Every reader of the folder
 * comes through here, so none can forget the difference.
 *
 * The reason is vault-relative with Node's path cut off: surfaces print it
 * as it stands (ADR 0028).
 */
export async function listScoutsFolder(vaultPath: string): Promise<string[]> {
  try {
    return await readdir(join(vaultPath, SCOUTS_FOLDER));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new VaultError(
      "unreadable",
      `Couldn't read ${SCOUTS_FOLDER}/: ${errorMessageWithoutPath(cause)}`
    );
  }
}

/**
 * Every Scout file, told apart by what the app may do with it. `scouts` are
 * the ones that are looking; a dropped Scout (ADR 0042 decision 1) is in
 * `dropped` and never in `scouts`, so the scheduler, the Queue's rail and every
 * other list of Scouts skip it because the reader has not handed it to them —
 * not because each caller remembered to ask. Reading `dropped` is therefore
 * always a choice: whoever names a dropped Scout, grep for it.
 */
export async function readScouts(vaultPath: string): Promise<{
  scouts: Scout[];
  dropped: Scout[];
  /** Tombstones: never a row, never restorable, only a name for a record that still points at the id. */
  erased: Tombstone[];
  unreadable: UnreadableScout[];
}> {
  const folder = join(vaultPath, SCOUTS_FOLDER);
  const names = await listScoutsFolder(vaultPath);
  const scouts: Scout[] = [];
  const dropped: Scout[] = [];
  const unreadable: UnreadableScout[] = [];
  const erased: Tombstone[] = [];
  for (const file of names.filter(isTombstoneFile).sort()) {
    const id = file.replace(TOMBSTONE_FILE, "");
    // A tombstone that cannot be read still says the Scout is gone: the id is
    // the name it can give, so what points at it does not dangle.
    erased.push({ id, name: await tombstoneName(folder, file, id) });
  }
  for (const file of names.filter(isScoutFile).sort()) {
    let text: string;
    try {
      text = await readFile(join(folder, file), "utf8");
    } catch (cause) {
      // Listed, so someone made it, and the app could not read it. It is
      // named as a file that does not parse is, and does not take the other
      // Scouts down with it: a file the app cannot read must not look like a
      // Scout nobody made (ADR 0039 decision 7).
      unreadable.push(unreadableFile(file, errorMessageWithoutPath(cause)));
      continue;
    }
    const read = readScout(scoutIdOf(file), text);
    if (!read.ok) unreadable.push(unreadableFile(file, read.problem));
    else if (read.scout.dropped !== null) dropped.push(read.scout);
    else scouts.push(read.scout);
  }
  // A Scout file and a tombstone for one id (only by hand) is a Scout: the
  // file is the later word, and it must not be called erased.
  const live = new Set([...scouts, ...dropped].map((s) => s.id));
  return {
    scouts,
    dropped,
    erased: erased.filter((t) => !live.has(t.id)),
    unreadable,
  };
}

async function tombstoneName(
  folder: string,
  file: string,
  id: string
): Promise<string> {
  try {
    const doc: unknown = parse(await readFile(join(folder, file), "utf8"));
    const name = (doc as Record<string, unknown> | null)?.["name"];
    return typeof name === "string" && name.trim() !== "" ? name.trim() : id;
  } catch {
    return id;
  }
}

// Editing a Scout's own file — the form's save, and pause and resume from the
// header or from Loose Ends, all in `scout-form.ts` — reads it and writes it
// back. A step the filesystem refuses is a `VaultError` in the app's words, the
// file named vault-relative and Node's path cut off: surfaces print its
// message as it stands, and the machine's layout is not for a window or a bug
// report (ADR 0028, #530). The words carry what the path used to: with it cut,
// `EACCES: permission denied` says neither whether a read or a write was
// refused nor which Scout, and for a write Node had named a temp file that
// nobody made.

/**
 * A Scout's file as text, to edit it. ENOENT keeps its cause, as ADR 0028 has
 * it for every write: a file that goes between the listing and the edit is a
 * race, not an absence anyone is waiting on.
 */
export async function readScoutFile(
  vaultPath: string,
  file: string
): Promise<string> {
  try {
    return await readFile(join(vaultPath, SCOUTS_FOLDER, file), "utf8");
  } catch (cause) {
    throw new VaultError(
      "unreadable",
      `Couldn't read ${SCOUTS_FOLDER}/${file}: ${errorMessageWithoutPath(cause)}`
    );
  }
}

/** A Scout's file written whole and renamed into place: how every edit of one is written (#533). */
export async function writeScoutFile(
  vaultPath: string,
  file: string,
  text: string
): Promise<void> {
  try {
    await writeAtomically(join(vaultPath, SCOUTS_FOLDER, file), text);
  } catch (cause) {
    throw new VaultError(
      "writeFailed",
      `Couldn't write ${SCOUTS_FOLDER}/${file}: ${errorMessageWithoutPath(cause)}`
    );
  }
}

type Read = { ok: true; scout: Scout } | { ok: false; problem: string };

function readScout(id: string, text: string): Read {
  let doc: unknown;
  try {
    // `yaml`'s default schema leaves a timestamp as the string it was typed.
    doc = parse(text);
  } catch (cause) {
    const line =
      cause instanceof YAMLParseError ? cause.linePos?.[0].line : undefined;
    return {
      ok: false,
      problem:
        line === undefined
          ? "it is not valid YAML"
          : `line ${line} is not valid YAML`,
    };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { ok: false, problem: "it is not a map of keys" };
  }
  const file = doc as Record<string, unknown>;
  const declared = file["source"] as Record<string, unknown> | undefined;
  const kind = declared?.["kind"] ?? "arxiv";
  let source: Scout["source"];
  let query: string;
  let tags: string[] | undefined;
  let venues: Venue[] | undefined;
  if (kind === "watched") {
    const read = readPages(declared!);
    if (typeof read === "string") return { ok: false, problem: read };
    query = read[0]!;
    source = { kind: "watched", urls: read };
  } else if (kind === "arxiv" || kind === "openalex") {
    // A filter that is not a map is named, not read as "neither".
    const rawFilter = file["filter"];
    if (
      rawFilter !== undefined &&
      (typeof rawFilter !== "object" ||
        rawFilter === null ||
        Array.isArray(rawFilter))
    ) {
      return { ok: false, problem: "filter is not a map of keys" };
    }
    const filter = rawFilter as Record<string, unknown> | undefined;
    const asked = filter?.["query"];
    const named = filter?.["tags"];
    // Exclusive, and refused by name, so "what does it search?" has one answer.
    if (named !== undefined && asked !== undefined) {
      return {
        ok: false,
        problem:
          "it has both filter.tags and filter.query, and a Scout has one",
      };
    }
    if (named !== undefined) {
      if (
        !Array.isArray(named) ||
        named.length === 0 ||
        !named.every((t) => typeof t === "string" && t.trim() !== "")
      ) {
        return { ok: false, problem: "filter.tags is not a list of Tags" };
      }
      tags = (named as string[]).map((t) => t.trim());
      query = "";
    } else if (typeof asked !== "string" || asked.trim() === "") {
      return {
        ok: false,
        problem:
          asked === undefined
            ? "it has neither filter.tags nor filter.query"
            : "it has no filter.query",
      };
    } else {
      query = asked;
    }
    const listed = filter?.["venues"];
    if (listed !== undefined) {
      if (kind !== "openalex") {
        return {
          ok: false,
          problem: "filter.venues is for an OpenAlex Scout only",
        };
      }
      const read = readVenues(listed);
      if (typeof read === "string") return { ok: false, problem: read };
      venues = read;
    }
    source = { kind };
  } else {
    return {
      ok: false,
      problem: "source.kind is not arxiv, openalex or watched",
    };
  }
  const cadence = file["cadence"];
  if (!CADENCES.includes(cadence as never)) {
    return { ok: false, problem: "cadence is not daily, weekly or monthly" };
  }
  const lane = file["lane"] ?? "review";
  if (!LANES.includes(lane as never)) {
    return { ok: false, problem: "lane is not review or skim" };
  }
  const assigned = file["assigned"] ?? [];
  if (
    !Array.isArray(assigned) ||
    !assigned.every((q) => typeof q === "string")
  ) {
    return { ok: false, problem: "assigned is not a list of Question ids" };
  }
  const created = date(file["created"]);
  if (created === null) return { ok: false, problem: "created is not a date" };
  const back = file["search_back_to"];
  const searchBackTo = back === undefined ? null : date(back);
  if (back !== undefined && searchBackTo === null) {
    return { ok: false, problem: "search_back_to is not a date" };
  }
  const retired = file["dropped"];
  const dropped = retired === undefined ? null : date(retired);
  if (retired !== undefined && dropped === null) {
    return { ok: false, problem: "dropped is not a date" };
  }
  const queue: Record<string, number | undefined> = {};
  for (const key of Object.values(QUEUE_KEYS)) {
    const given = file[key];
    if (given === undefined || given === null) continue;
    // The file holds numbers; text such as "7" is the form's, not a hand edit's.
    const n = typeof given === "number" ? parseQueueNumber(given) : null;
    if (n === null) return { ok: false, problem: queueNumberProblem(key) };
    queue[key] = n;
  }
  return {
    ok: true,
    scout: {
      id,
      name:
        typeof file["name"] === "string" && file["name"] !== ""
          ? file["name"]
          : id,
      source,
      query: query.trim(),
      ...(tags === undefined ? {} : { tags }),
      ...(venues === undefined ? {} : { venues }),
      cadence: cadence as Scout["cadence"],
      assigned,
      lane: lane as Scout["lane"],
      paused: file["paused"] === true,
      dropped,
      created,
      searchBackTo,
      cap: queue[QUEUE_KEYS.cap] ?? null,
      reviewDays: queue[QUEUE_KEYS.reviewDays] ?? DEFAULT_REVIEW_DAYS,
      skimDays: queue[QUEUE_KEYS.skimDays] ?? DEFAULT_SKIM_DAYS,
    },
  };
}

const WEB_ADDRESS = /^https?:\/\/\S+$/i;

/**
 * A Watched source's pages as written (ADR 0056 decision 12): `url:` is one
 * page, every file from before several were possible, and `urls:` a list of
 * one or more. Anything else is the sentence naming what is wrong, and never a
 * Scout watching fewer pages than its file lists, or none: both keys, an empty
 * list, an entry that is not an address, or one page twice, which a check
 * would read twice (ADR 0039 decision 7). Page identity is the trimmed string
 * (ADR 0043 decision 3), so that is what a duplicate is.
 */
function readPages(declared: Record<string, unknown>): string[] | string {
  const url = declared["url"];
  const listed = declared["urls"];
  if (url !== undefined && listed !== undefined) {
    return "source has both url and urls, and a Scout has one of them";
  }
  if (listed === undefined) {
    return typeof url === "string" && WEB_ADDRESS.test(url.trim())
      ? [url.trim()]
      : "source.url is not a web address";
  }
  if (!Array.isArray(listed)) {
    return "source.urls is not a list of web addresses";
  }
  if (listed.length === 0) return "source.urls lists no page";
  const pages: string[] = [];
  for (const entry of listed as unknown[]) {
    if (typeof entry !== "string" || !WEB_ADDRESS.test(entry.trim())) {
      return "source.urls has an entry that is not a web address";
    }
    const page = entry.trim();
    if (pages.includes(page)) return `source.urls lists ${page} twice`;
    pages.push(page);
  }
  return pages;
}

/** The pages a Watched Scout reads, in file order; none for a Structured source. */
export const pagesOf = (scout: Scout): string[] =>
  scout.source.kind === "watched" ? scout.source.urls : [];

/**
 * One of a Watched Scout's pages as a Scout of that page alone: what every
 * read about a page — its Voice, its Due, its first look — is asked of, so a
 * page of several is judged exactly as a one-page Scout is (ADR 0056
 * decisions 3 to 5). The Scout's id stays, so its runs are found; ADR 0043's
 * predicate then keeps the ones at this page.
 */
export const atPage = (scout: Scout, url: string): Scout => ({
  ...scout,
  source: { kind: "watched", urls: [url] },
  query: url,
});

/**
 * The allowlist as written, or the sentence naming what is wrong with it. An
 * entry that is not an ID with a name is named and never skipped: a skipped
 * entry would narrow the Scout to fewer venues than its file lists, or to none.
 * The ID is checked for shape because it goes into a request's filter as it is.
 */
function readVenues(listed: unknown): Venue[] | string {
  const problem =
    "filter.venues is not a list of venues, each with an id and a name";
  if (!Array.isArray(listed) || listed.length === 0) return problem;
  const venues: Venue[] = [];
  for (const raw of listed as unknown[]) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return problem;
    }
    const entry = raw as Record<string, unknown>;
    const id = openAlexId(entry["id"]);
    const name = entry["name"];
    if (
      id === null ||
      !VENUE_ID.test(id) ||
      typeof name !== "string" ||
      name.trim() === "" ||
      Object.keys(entry).some((k) => k !== "id" && k !== "name")
    ) {
      return problem;
    }
    venues.push({ id, name: name.trim() });
  }
  return venues;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
