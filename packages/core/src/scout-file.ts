import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, YAMLParseError } from "yaml";
import { writeAtomically } from "./atomic-write.js";
import { errorMessageWithoutPath, VaultError } from "./errors.js";

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
  /** What it watches: arXiv through its API, or one web page (ADR 0017). */
  source: { kind: "arxiv" } | { kind: "watched"; url: string };
  /** The arXiv Query; for a Watched source, the address — what a run asked, so an edit to it overrides a wait. */
  query: string;
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
};

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

const CADENCES = ["daily", "weekly", "monthly"] as const;
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
  unreadable: UnreadableScout[];
}> {
  const folder = join(vaultPath, SCOUTS_FOLDER);
  const names = await listScoutsFolder(vaultPath);
  const scouts: Scout[] = [];
  const dropped: Scout[] = [];
  const unreadable: UnreadableScout[] = [];
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
  return { scouts, dropped, unreadable };
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
  if (kind === "watched") {
    const url = declared?.["url"];
    if (typeof url !== "string" || !/^https?:\/\/\S+$/i.test(url.trim())) {
      return { ok: false, problem: "source.url is not a web address" };
    }
    query = url.trim();
    source = { kind: "watched", url: query };
  } else if (kind === "arxiv") {
    const filter = file["filter"] as Record<string, unknown> | undefined;
    const asked = filter?.["query"];
    if (typeof asked !== "string" || asked.trim() === "") {
      return { ok: false, problem: "it has no filter.query" };
    }
    query = asked;
    source = { kind: "arxiv" };
  } else {
    return { ok: false, problem: "source.kind is not arxiv or watched" };
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
      cadence: cadence as Scout["cadence"],
      assigned,
      lane: lane as Scout["lane"],
      paused: file["paused"] === true,
      dropped,
      created,
      searchBackTo,
    },
  };
}

function date(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
