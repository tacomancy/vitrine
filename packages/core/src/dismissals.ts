import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeAtomically } from "./atomic-write.js";
import { errorMessage, VaultError } from "./errors.js";

/**
 * `.vitrine/dismissals.json` (`docs/architecture.md` § Vault layout):
 * *mark deliberate*, permanent and judged per row kind, so silencing one
 * Loose Ends row about an object never silences a different one about the
 * same object. Keyed by the object's `id:`, or by its vault-relative path
 * when it has none (a Note never carries one).
 */
export type Dismissals = Record<string, Record<string, string>>;

const FILE = ".vitrine/dismissals.json";

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
      problem: `${FILE} could not be read, so nothing is silenced: ${errorMessage(cause)}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      dismissals: {},
      problem: `${FILE} could not be read, so nothing is silenced: it is not an object of dismissals`,
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

// Dismissals run one at a time. The file is read, one key is added, and the
// whole object is written back, so two dismissals that both read before
// either wrote would lose one — and losing one means a row the user told
// the app to stop showing comes back. The queue lives here rather than in
// the router so that the read and the write cannot be pulled apart by a
// caller that forgets to hold it (the same rule as `linkQuestion`).
let previous: Promise<unknown> = Promise.resolve();

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
  const run = () => write(vaultPath, subject, kind, at);
  // A dismissal that threw leaves the queue usable for the next one.
  const queued = previous.then(run, run);
  previous = queued;
  return queued;
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
  const next: Dismissals = {
    ...dismissals,
    [subject]: { ...dismissals[subject], [kind]: at },
  };
  const path = join(vaultPath, FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeAtomically(path, JSON.stringify(next, null, 2) + "\n");
}
