import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeAtomically } from "./atomic-write.js";
import { errorMessage, VaultError } from "./errors.js";
import { serialised } from "./serialise.js";

/**
 * `.vitrine/dismissals.json` (`docs/architecture.md` § Vault layout):
 * *mark deliberate*, permanent and judged per row kind, so silencing one
 * Loose Ends row about an object never silences a different one about the
 * same object. Keyed by the object's `id:`, or by its vault-relative path
 * when it has none (a Note never carries one).
 */
export type Dismissals = Record<string, Record<string, string>>;

const FILE = ".vitrine/dismissals.json";

/** Why the dashboard is showing rows it may have been told to silence. */
const unreadable = (why: string) =>
  `${FILE} could not be read, so nothing is silenced: ${why}`;

/** What the dashboard could read, and — when it could not — why. */
export type ReadDismissals = {
  dismissals: Dismissals;
  /** Null when the file parsed, or was simply not there yet. */
  problem: string | null;
};

/**
 * Read as found (ADR 0009): a file that is not there is no dismissals, and
 * one that does not parse is reported rather than treated as empty — every
 * row would come back at once and the user would never learn why.
 */
export async function readDismissals(
  vaultPath: string
): Promise<ReadDismissals> {
  let text: string;
  try {
    text = await readFile(join(vaultPath, FILE), "utf8");
  } catch {
    return { dismissals: {}, problem: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    return {
      dismissals: {},
      problem: unreadable(errorMessage(cause)),
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      dismissals: {},
      problem: unreadable("it is not an object of dismissals"),
    };
  }
  // Each value is an object of row kind → timestamp; anything else is one
  // entry the reader cannot judge, and it is left out rather than guessed at.
  const dismissals: Dismissals = {};
  for (const [subject, kinds] of Object.entries(parsed)) {
    if (typeof kinds !== "object" || kinds === null || Array.isArray(kinds)) {
      continue;
    }
    const kept: Record<string, string> = {};
    for (const [kind, at] of Object.entries(kinds as Record<string, unknown>)) {
      if (typeof at === "string") kept[kind] = at;
    }
    dismissals[subject] = kept;
  }
  return { dismissals, problem: null };
}

/** Whether this row about this object has been marked deliberate. */
export function dismissed(
  dismissals: Dismissals,
  subject: string,
  kind: string
): boolean {
  return dismissals[subject]?.[kind] !== undefined;
}

// Every change to the file runs one at a time. The file is read, one key is
// changed, and the whole object is written back, so two changes that both
// read before either wrote would lose one — and a lost write here is a row
// the user silenced coming back, or one they un-silenced staying gone. The
// chain is `serialise.ts`, the same one `linkQuestion` uses; the queue is
// here rather than in the callers so the read and the write cannot be pulled
// apart by one that forgets.
const serially = serialised();

async function save(vaultPath: string, dismissals: Dismissals): Promise<void> {
  const path = join(vaultPath, FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeAtomically(path, JSON.stringify(dismissals, null, 2) + "\n");
}

/**
 * *Mark deliberate*: permanent, and recorded against this row kind alone.
 * A file that does not parse refuses the write rather than replacing it —
 * the other dismissals in it are what the user would lose.
 */
export function dismiss(
  vaultPath: string,
  subject: string,
  kind: string,
  at: string
): Promise<void> {
  return serially(() =>
    change(vaultPath, (dismissals) => ({
      ...dismissals,
      [subject]: { ...dismissals[subject], [kind]: at },
    }))
  );
}

/**
 * *Undo*, for as long as the row is still on screen (#266): this one row kind
 * for this one subject, every other key left as it was. Undoing a key that is
 * not there is not a failure — the row is already showing.
 */
export function undismiss(
  vaultPath: string,
  subject: string,
  kind: string
): Promise<void> {
  return serially(() =>
    change(vaultPath, (dismissals) => without(dismissals, subject, kind))
  );
}

/** The whole of it, minus this one key — or null when the key was not there. */
function without(
  dismissals: Dismissals,
  subject: string,
  kind: string
): Dismissals | null {
  const kinds = dismissals[subject];
  if (kinds?.[kind] === undefined) return null;
  const rest = { ...kinds };
  delete rest[kind];
  const next = { ...dismissals };
  // A subject silenced in no way at all is not a subject: an empty object
  // left behind would be a dismissal the file claims and the reader denies.
  if (Object.keys(rest).length === 0) delete next[subject];
  else next[subject] = rest;
  return next;
}

/**
 * Read, plan, write — the whole hazard, inside the queue above. A plan of
 * null is nothing to write: the file is left exactly as it was found rather
 * than reserialised behind the user's back.
 */
async function change(
  vaultPath: string,
  plan: (dismissals: Dismissals) => Dismissals | null
): Promise<void> {
  const { dismissals, problem } = await readDismissals(vaultPath);
  if (problem !== null) {
    throw new VaultError(
      "writeFailed",
      `${FILE} could not be read, and the dismissals already in it would be lost by writing over it. Fix or remove it, then try again.`
    );
  }
  const next = plan(dismissals);
  if (next === null) return;
  await save(vaultPath, next);
}

/**
 * Carry path-keyed dismissals across the watcher's rename pairings
 * (`docs/architecture.md` § Watcher and Ingest, Renames): a dismissal is
 * about the *file*, not the name it happened to have, so a deliberate
 * orphan must not come back the moment it is renamed. A dismissal keyed by
 * an `id:` needs nothing — the id is in the file and travels with it.
 *
 * Called for every pairing rather than only for a Note, because what a
 * path key means is "this file has no id", which is not a Kind's business.
 */
export function renameDismissals(
  vaultPath: string,
  pairs: ReadonlyArray<{ from: string; to: string }>
): Promise<void> {
  if (pairs.length === 0) return Promise.resolve();
  return serially(() => moveKeys(vaultPath, pairs));
}

async function moveKeys(
  vaultPath: string,
  pairs: ReadonlyArray<{ from: string; to: string }>
): Promise<void> {
  const { dismissals, problem } = await readDismissals(vaultPath);
  // A file that does not parse holds every other dismissal the user made,
  // and writing over it would lose them. Nothing moves, and the row comes
  // back under the new name — visibly, beside the problem line the
  // dashboard already carries on every read, rather than silently.
  //
  // Today an unreadable file also reads as *no* dismissals, so the filter
  // below would find nothing to move anyway; the guard is what keeps the
  // rule true if the reader ever learns to return what it could salvage.
  if (problem !== null) return;
  const moving = pairs.filter(({ from }) => dismissals[from] !== undefined);
  if (moving.length === 0) return;
  const next: Dismissals = { ...dismissals };
  // Both passes read from the snapshot, so two files that swapped names in
  // one batch each end up with the other's dismissals rather than one
  // overwriting the other.
  for (const { from } of moving) delete next[from];
  for (const { from, to } of moving) {
    next[to] = { ...next[to], ...dismissals[from] };
  }
  await save(vaultPath, next);
}
