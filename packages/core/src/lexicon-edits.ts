import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeAtomically } from "./atomic-write.js";
import { errorMessage, errorMessageWithoutPath, VaultError } from "./errors.js";
import {
  MAX_PHRASE_WORDS,
  normalisePhrase,
  wordCount,
} from "./lexicon-phrases.js";
import { serialised } from "./serialise.js";

/**
 * `.vitrine/lexicon.json` (`docs/architecture.md` § Lexicon): the only
 * Lexicon state that cannot be rebuilt, because it is the user's. Seeds and
 * Excluded Terms and nothing else; derived Terms are a projection of the
 * Index and never come here (ADR 0018).
 *
 * Keyed by the Tag as written: the canonical path of the Tag the editor was
 * opened on. A parent's entry is not its children's and a child's never
 * reaches its parent, since a parent's Lexicon is derived from the union of
 * its descendants' papers and not from their Lexicons (ADR 0045 decision 3).
 */
export type TagEdits = { seeds: string[]; excluded: string[] };
export type LexiconEdits = Record<string, TagEdits>;

const FILE = ".vitrine/lexicon.json";

export const NO_EDITS: TagEdits = { seeds: [], excluded: [] };

const unreadable = (why: string) =>
  new VaultError(
    "refused",
    `${FILE} could not be read, so no Seed or Exclusion can be applied: ${why}. Fix or remove it, then try again.`
  );

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

/**
 * Read as found (ADR 0009). A file that does not parse refuses the read
 * rather than reading as empty: every Excluded Term would come back at once
 * and the user would never learn why, and a write over it would lose them.
 */
export async function readEdits(vaultPath: string): Promise<LexiconEdits> {
  let text: string;
  try {
    text = await readFile(join(vaultPath, FILE), "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw unreadable(errorMessageWithoutPath(cause));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    throw unreadable(errorMessage(cause));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw unreadable("it is not an object of Tags");
  }
  const edits: LexiconEdits = {};
  for (const [tag, value] of Object.entries(parsed)) {
    const entry = (value ?? {}) as Record<string, unknown>;
    edits[tag] = {
      seeds: strings(entry["seeds"]),
      excluded: strings(entry["excluded"]),
    };
  }
  return edits;
}

// Every change reads the whole file, changes one Tag's entry and writes the
// whole file back, so two that both read before either wrote would lose one:
// a Seed that vanishes, or an Exclusion that lets a wrong phrase come back.
// The queue is here, in the callee, so no caller can be the one that forgot
// it (`serialise.ts`; the same shape as `dismissals.ts`).
const serially = serialised();

async function save(vaultPath: string, edits: LexiconEdits): Promise<void> {
  const path = join(vaultPath, FILE);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeAtomically(path, JSON.stringify(edits, null, 2) + "\n");
  } catch (cause) {
    throw new VaultError(
      "writeFailed",
      `Couldn't write ${FILE}: ${errorMessageWithoutPath(cause)}`
    );
  }
}

/** Read, plan, write — inside the queue. A plan of null leaves the file as found. */
function change(
  vaultPath: string,
  plan: (current: TagEdits) => TagEdits | null,
  tag: string
): Promise<void> {
  return serially(async () => {
    const edits = await readEdits(vaultPath);
    const next = plan(edits[tag] ?? NO_EDITS);
    if (next === null) return;
    const rest = { ...edits };
    // A Tag with nothing left to say is not an entry the file should claim.
    if (next.seeds.length === 0 && next.excluded.length === 0) delete rest[tag];
    else rest[tag] = next;
    await save(vaultPath, rest);
  });
}

/** What a typed Term is, or the reason it is refused (ADR 0045 decision 9). */
function termOf(typed: string): string {
  const term = normalisePhrase(typed);
  if (term !== null) return term;
  throw new VaultError(
    "refused",
    wordCount(typed) === 0
      ? "A Seed can't be empty."
      : `A Seed is at most ${MAX_PHRASE_WORDS} words.`
  );
}

/**
 * A Seed: normalised as a derived phrase, so the editor, the phrase table and
 * the query speak one unit. One that no paper contains is still kept — it is
 * the user's claim about what the Tag means. Seeding a Term the user had
 * Excluded clears the Exclusion: they now want it.
 */
export function seedTerm(
  vaultPath: string,
  tag: string,
  typed: string
): Promise<void> {
  // Refused before the queue: nothing to read or write for a Term that is not one.
  const term = termOf(typed);
  return change(
    vaultPath,
    (current) => {
      if (current.seeds.includes(term)) {
        throw new VaultError("refused", `"${term}" is already a Seed.`);
      }
      return {
        seeds: [...current.seeds, term],
        excluded: current.excluded.filter((t) => t !== term),
      };
    },
    tag
  );
}

/** An Exclusion: the Term is never derived back for this Tag. A Seed of it goes too. */
export function excludeTerm(
  vaultPath: string,
  tag: string,
  typed: string
): Promise<void> {
  const term = termOf(typed);
  return change(
    vaultPath,
    (current) =>
      current.excluded.includes(term) && !current.seeds.includes(term)
        ? null
        : {
            seeds: current.seeds.filter((t) => t !== term),
            excluded: current.excluded.includes(term)
              ? current.excluded
              : [...current.excluded, term],
          },
    tag
  );
}

/** The way back from either edit: a Seed removed, an Exclusion lifted. Neither there is not a failure. */
export function restoreTerm(
  vaultPath: string,
  tag: string,
  typed: string
): Promise<void> {
  const term = termOf(typed);
  return change(
    vaultPath,
    (current) =>
      current.seeds.includes(term) || current.excluded.includes(term)
        ? {
            seeds: current.seeds.filter((t) => t !== term),
            excluded: current.excluded.filter((t) => t !== term),
          }
        : null,
    tag
  );
}
