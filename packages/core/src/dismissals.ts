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
// read before either wrote would lose one — and losing one means a row the
// user told the app to stop showing comes back. The chain is
// `serialise.ts`, the same one `linkQuestion` uses; the queue is here
// rather than in the callers so the read and the write cannot be pulled
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
  return serially(() => write(vaultPath, subject, kind, at));
}

async function write(
  vaultPath: string,
  subject: string,
  kind: string,
  at: string
): Promise<void> {
  const { dismissals, problem } = await readDismissals(vaultPath);
  if (problem !== null) {
    throw new VaultError(
      "writeFailed",
      `${FILE} could not be read, and the dismissals already in it would be lost by writing over it. Fix or remove it, then try again.`
    );
  }
  await save(vaultPath, {
    ...dismissals,
    [subject]: { ...dismissals[subject], [kind]: at },
  });
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
