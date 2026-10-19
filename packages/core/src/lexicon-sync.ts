import { VaultError } from "./errors.js";
import {
  attention,
  isDue,
  lexiconOf,
  MEASURED_MONTHS,
  type SyncResult,
} from "./lexicon.js";
import {
  readMeasurements,
  recordConsent,
  recordFailure,
  recordMeasurement,
} from "./measurements.js";
import { readEdits } from "./lexicon-edits.js";
import { OpenAlexError, type OpenAlexClient } from "./openalex.js";
import { serialised } from "./serialise.js";
import type { VaultIndex } from "./vault-index.js";

/** The last `n` complete months before `now`, oldest first. The current month is partial and is never one of them. */
export function completeMonths(now: Date, n = MEASURED_MONTHS): string[] {
  const months: string[] = [];
  for (let back = n; back >= 1; back--) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)
    );
    months.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    );
  }
  return months;
}

// Two syncs at once (the one on open and a *Sync now* pressed during it) would
// each read the store before the other's Measurements landed and ask for the
// same Tags twice, spending the keyless budget twice. Queued here, the second
// reads what the first stored and finds nothing due.
const oneAtATime = serialised();

// The progress of a sync in flight, for the panel's *measuring n of m*. Kept
// in memory beside the queue it describes: it is true only while the sync is
// running, so a restart rightly shows none.
const running = new Map<string, { done: number; of: number }>();

export const measuringOf = (vaultPath: string) =>
  running.get(vaultPath) ?? null;

type Deps = {
  index: VaultIndex;
  vaultPath: string;
  client: OpenAlexClient;
  now: Date;
  confirm: boolean;
  /** Called as each Tag settles, so what shows `measuringOf` can re-read. */
  onProgress?: () => void;
};

/**
 * *Sync now* (ADR 0045 decisions 2, 4 and 10): measure every placed Tag that
 * has no Measurement, was measured under another query, or was measured more
 * than a week ago, most papers first — at the default depth and at any depth
 * the page has since been viewed at. A rolled-up parent is its own Tag with
 * its own query, so each depth viewed adds its Tags to the queue, once.
 *
 * The consent gate lives here, not in the caller: a vault that has never
 * synced refuses to send anything until `confirm` says the user was shown
 * what is sent and to whom. The consent is written before the first request.
 */
export function syncLexicons(deps: Deps): Promise<SyncResult> {
  return oneAtATime(() => sync(deps));
}

/**
 * The sync a vault that has already consented runs when it opens (ADR 0045
 * decision 4): the same queue as *Sync now*, so it makes no request when
 * nothing is stale, pending or unmeasured. A vault that never pressed *Sync
 * now* returns null having sent nothing. There is no timer behind it; a vault
 * left open is not asked again until it is next opened or the user presses.
 */
export async function syncWhenOpened(
  deps: Omit<Deps, "confirm"> & {
    /** Resolves once the Index has read the papers; asked only of a vault that consented, so one that never did is not made to wait or to sweep again. */
    indexed: () => Promise<void>;
  }
): Promise<SyncResult | null> {
  return oneAtATime(async () => {
    const { measurements, problem } = await readMeasurements(deps.vaultPath);
    if (problem !== null || measurements.consentedAt === null) return null;
    await deps.indexed();
    return sync({ ...deps, confirm: false });
  });
}

async function sync(deps: Deps): Promise<SyncResult> {
  const { index, vaultPath, client, now } = deps;
  const first = await readMeasurements(vaultPath);
  if (first.problem !== null) throw new VaultError("unreadable", first.problem);
  if (first.measurements.consentedAt === null) {
    if (!deps.confirm) {
      throw new VaultError(
        "refused",
        "Nothing has been synced yet, and Sync now sends your Tags' Terms to OpenAlex: confirm that first."
      );
    }
    await recordConsent(vaultPath, now.toISOString());
  }

  const store = first.measurements;
  const months = completeMonths(now);
  // The Seeds and Exclusions are part of what a Tag is measured as: without
  // them the query sent would not be the one the editor shows (#652).
  const edits = await readEdits(vaultPath);
  const byDefault = attention(index, store, undefined, edits, now);
  const depths = new Set([
    byDefault.depth,
    ...store.depths.map((d) => Math.min(d, byDefault.deepest)),
  ]);
  const queued = new Map<
    string,
    { tag: string; papers: number; depth: number; query: string }
  >();
  for (const depth of depths) {
    for (const t of attention(index, store, depth, edits, now).tags) {
      // The same Tag at two depths is the one Tag: a leaf shallower than the
      // depth is itself at every depth above its own.
      if (isDue(t, now) && !queued.has(t.tag)) {
        queued.set(t.tag, {
          tag: t.tag,
          papers: t.papers,
          depth,
          query: t.query!,
        });
      }
    }
  }
  const due = [...queued.values()]
    .sort((a, b) => b.papers - a.papers || (a.tag < b.tag ? -1 : 1))
    .map(({ tag, depth, query }) => ({
      tag,
      query,
      terms: lexiconOf(index, store, tag, depth, edits).terms.map(
        (x) => x.term
      ),
    }));

  const result: SyncResult = { measured: 0, failed: [], waiting: 0 };
  if (due.length > 0) running.set(vaultPath, { done: 0, of: due.length });
  try {
    await measureAll();
  } finally {
    running.delete(vaultPath);
    deps.onProgress?.();
  }
  return result;

  async function measureAll() {
    for (const [i, { tag, terms, query }] of due.entries()) {
      deps.onProgress?.();
      if (!(await measureOne(tag, terms, query))) {
        // The budget is spent for every Tag after this one too; the rest wait.
        result.waiting = due.length - i;
        break;
      }
      running.set(vaultPath, { done: i + 1, of: due.length });
    }
  }

  /** False when the sync should stop: the rate limit has been reached. */
  async function measureOne(tag: string, terms: string[], query: string) {
    try {
      const counts = await client.monthlyCounts(terms, months);
      await recordMeasurement(vaultPath, {
        tag,
        query,
        months: months.map((month, at) => ({ month, count: counts[at]! })),
        measuredAt: now.toISOString(),
      });
      result.measured += 1;
      return true;
    } catch (cause) {
      if (!(cause instanceof OpenAlexError)) throw cause;
      result.failed.push({ tag, kind: cause.kind });
      // Stored, not only returned: the sync on open has no caller to tell, and
      // a Tag that failed must not look like one nobody asked about. Its last
      // Measurement is left exactly as it was.
      await recordFailure(vaultPath, {
        tag,
        kind: cause.kind,
        at: now.toISOString(),
      });
      return cause.kind !== "rate_limited";
    }
  }
}
