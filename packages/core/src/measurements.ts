import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeAtomically } from "./atomic-write.js";
import { errorMessage, errorMessageWithoutPath, VaultError } from "./errors.js";
import type { OpenAlexErrorKind } from "./openalex.js";
import { serialised } from "./serialise.js";

/**
 * `.vitrine/measurements.json` (ADR 0045 decisions 1 and 4; `docs/
 * architecture.md` § Lexicon): the field's monthly counts for each measured
 * Tag, and whether the user has ever pressed *Sync now*. App state, not the
 * Index: re-fetching costs budget, so a rebuilt Index must not lose it.
 *
 * Growth is never stored. The counts are, so the definition can change
 * without a request.
 */

/** One Tag's Measurement: what was asked, what came back, and when. */
export type Measurement = {
  /** Canonical Tag path as measured, which at any depth is the Tag's own name. */
  tag: string;
  /** The compiled OpenAlex query, verbatim (a later ticket compares it for *re-measure pending*). */
  query: string;
  /** Oldest first: one count per complete month, `YYYY-MM`. */
  months: Array<{ month: string; count: number }>;
  measuredAt: string;
};

/** Why a Tag's last attempt to measure failed; its Measurement is untouched. */
export type Failure = { tag: string; kind: OpenAlexErrorKind; at: string };

export type Measurements = {
  /** When *Sync now* was first confirmed; null while the vault has never synced (ADR 0045 decision 4). */
  consentedAt: string | null;
  /**
   * The non-default depths the page has been viewed at, so a sync measures
   * them too (ADR 0045 decision 2): queued once viewed, then kept.
   */
  depths: number[];
  measurements: Measurement[];
  /**
   * The Tags whose newest attempt failed. Stored beside the Measurement they
   * leave standing, so a failure outlives the sync that saw it — one on open
   * has no caller to return it to — and a broken sync never looks like a quiet
   * field. A success for the Tag clears its row.
   */
  failures: Failure[];
};

// A stored kind the panel has no words for would render as nothing, so an
// unknown one is dropped like any other malformed row.
const KINDS: OpenAlexErrorKind[] = ["network", "http", "rate_limited", "parse"];

const FILE = ".vitrine/measurements.json";
export const NONE: Measurements = {
  consentedAt: null,
  depths: [],
  measurements: [],
  failures: [],
};

export type ReadMeasurements = {
  measurements: Measurements;
  /** Null when the file parsed, or was simply not there yet. */
  problem: string | null;
};

/**
 * Read as found: a file that is not there is a vault that never synced, and
 * one that does not parse is reported rather than read as empty — an empty
 * store would make the next sync look like the first, and ask for consent
 * the user already gave.
 */
export async function readMeasurements(
  vaultPath: string
): Promise<ReadMeasurements> {
  let text: string;
  try {
    text = await readFile(join(vaultPath, FILE), "utf8");
  } catch {
    return { measurements: NONE, problem: null };
  }
  try {
    const parsed = JSON.parse(text) as Partial<Measurements>;
    const consentedAt =
      typeof parsed.consentedAt === "string" ? parsed.consentedAt : null;
    const list = Array.isArray(parsed.measurements) ? parsed.measurements : [];
    const depths = Array.isArray(parsed.depths)
      ? parsed.depths.filter((d) => Number.isInteger(d) && d >= 1)
      : [];
    return {
      measurements: {
        consentedAt,
        depths,
        measurements: list.filter(wellFormed),
        failures: Array.isArray(parsed.failures)
          ? parsed.failures.filter(
              (f): f is Failure =>
                typeof f?.tag === "string" &&
                KINDS.includes(f?.kind as OpenAlexErrorKind) &&
                typeof f?.at === "string"
            )
          : [],
      },
      problem: null,
    };
  } catch (cause) {
    return {
      measurements: NONE,
      problem: `${FILE} could not be read: ${errorMessage(cause)}`,
    };
  }
}

const wellFormed = (m: unknown): m is Measurement => {
  if (typeof m !== "object" || m === null) return false;
  const row = m as Partial<Measurement>;
  return (
    typeof row.tag === "string" &&
    typeof row.query === "string" &&
    typeof row.measuredAt === "string" &&
    Array.isArray(row.months) &&
    row.months.every(
      (x) => typeof x?.month === "string" && typeof x?.count === "number"
    )
  );
};

// One queue for every change: the file is read, one part changed and the
// whole written back, so a sync recording a Measurement and a consent landing
// together would lose one. It lives here, not in the callers.
const serially = serialised();

/** Record the consent once; later calls leave the first date. */
export function recordConsent(vaultPath: string, at: string): Promise<void> {
  return change(vaultPath, (m) =>
    m.consentedAt === null ? { ...m, consentedAt: at } : null
  );
}

/** Remember that the page was viewed at this depth; a depth already kept writes nothing. */
export function recordViewedDepth(
  vaultPath: string,
  depth: number
): Promise<void> {
  return change(vaultPath, (m) =>
    m.depths.includes(depth)
      ? null
      : { ...m, depths: [...m.depths, depth].sort((a, b) => a - b) }
  );
}

/** Replace the Tag's Measurement (a Tag has one row; the newest). */
export function recordMeasurement(
  vaultPath: string,
  measurement: Measurement
): Promise<void> {
  return change(vaultPath, (m) => ({
    ...m,
    measurements: [
      ...m.measurements.filter((x) => x.tag !== measurement.tag),
      measurement,
    ],
    failures: m.failures.filter((x) => x.tag !== measurement.tag),
  }));
}

/** Note that the Tag could not be measured, keeping whatever it was last measured as. */
export function recordFailure(
  vaultPath: string,
  failure: Failure
): Promise<void> {
  return change(vaultPath, (m) => ({
    ...m,
    failures: [...m.failures.filter((x) => x.tag !== failure.tag), failure],
  }));
}

function change(
  vaultPath: string,
  plan: (m: Measurements) => Measurements | null
): Promise<void> {
  return serially(async () => {
    const { measurements, problem } = await readMeasurements(vaultPath);
    if (problem !== null) {
      throw new VaultError(
        "writeFailed",
        `${FILE} could not be read, and what it holds would be lost by writing over it. Fix or remove it, then try again.`
      );
    }
    const next = plan(measurements);
    if (next === null) return;
    const path = join(vaultPath, FILE);
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeAtomically(path, JSON.stringify(next, null, 2) + "\n");
    } catch (cause) {
      throw new VaultError(
        "writeFailed",
        `Couldn't write ${FILE}: ${errorMessageWithoutPath(cause)}`
      );
    }
  });
}

/** The last 12 and the 12 before them, from a Measurement's 24 months. */
export function yearCounts(m: Measurement): {
  last12: number;
  prior12: number;
} {
  const counts = m.months.map((x) => x.count);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    last12: sum(counts.slice(-12)),
    prior12: sum(counts.slice(-24, -12)),
  };
}
