import { VaultError } from "./errors.js";
import {
  attention,
  lexiconOf,
  MEASURED_MONTHS,
  STALE_DAYS,
  type SyncResult,
} from "./lexicon.js";
import {
  readMeasurements,
  recordConsent,
  recordMeasurement,
} from "./measurements.js";
import { OpenAlexError, type OpenAlexClient } from "./openalex.js";
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

const DAY_MS = 86_400_000;

/**
 * *Sync now* (ADR 0045 decisions 4 and 10): measure every placed Tag at the
 * default depth that has no Measurement, was measured under another query, or
 * was measured more than a week ago, most papers first.
 *
 * The consent gate lives here, not in the caller: a vault that has never
 * synced refuses to send anything until `confirm` says the user was shown
 * what is sent and to whom. The consent is written before the first request.
 */
export async function syncLexicons(deps: {
  index: VaultIndex;
  vaultPath: string;
  client: OpenAlexClient;
  now: Date;
  confirm: boolean;
}): Promise<SyncResult> {
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
  const due = attention(index, store).tags.flatMap((t) => {
    if (t.reason === "few-papers") return [];
    const view = lexiconOf(index, store, t.tag);
    if (view.query === null) return [];
    const have = store.measurements.find((m) => m.tag === t.tag);
    const fresh =
      have !== undefined &&
      have.query === view.query &&
      now.getTime() - Date.parse(have.measuredAt) <= STALE_DAYS * DAY_MS;
    return fresh
      ? []
      : [
          {
            tag: t.tag,
            terms: view.terms.map((x) => x.term),
            query: view.query,
          },
        ];
  });

  const result: SyncResult = { measured: 0, failed: [], waiting: 0 };
  for (const [i, { tag, terms, query }] of due.entries()) {
    try {
      const counts = await client.monthlyCounts(terms, months);
      await recordMeasurement(vaultPath, {
        tag,
        query,
        months: months.map((month, at) => ({ month, count: counts[at]! })),
        measuredAt: now.toISOString(),
      });
      result.measured += 1;
    } catch (cause) {
      if (!(cause instanceof OpenAlexError)) throw cause;
      result.failed.push({ tag, kind: cause.kind });
      // The budget is spent for every Tag after this one too; the rest wait.
      if (cause.kind === "rate_limited") {
        result.waiting = due.length - i;
        break;
      }
    }
  }
  return result;
}
