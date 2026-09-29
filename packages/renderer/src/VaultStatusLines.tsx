import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ingestLine, useIngestSummary } from "./ingest-line";
import { useTRPC } from "./trpc";
import styles from "./VaultStatusLines.module.css";

/**
 * The vault's state in every surface's footer channel (`docs/architecture.md`
 * § Index, Status): a build's progress, a watcher that is down for good
 * with its *retry*, and a PDF folder that does not resolve with its *check
 * again* (#379). Nothing when all is well — a footer that is always
 * there would teach the eye to skip it — so the surface asks `hasLines`
 * before drawing the footer at all. A broken watcher must never look like a
 * quiet vault, and it is never red: a fact to act on, not an alarm.
 */
export function useVaultStatusLines(): {
  hasLines: boolean;
  lines: React.ReactNode;
  read: VaultRead;
} {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useQuery(trpc.vault.status.queryOptions());
  const rewatch = useMutation(
    trpc.vault.rewatch.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries(trpc.vault.status.pathFilter()),
    })
  );
  // The PDF folder's fault is sounded here, on every surface, and only
  // stated on Settings (spec #363 story 31) — never a Loose Ends row, which
  // would be a second place to raise it. `pdfFault` rather than
  // `pdfFolder`, so no surface walks the folder to learn it. A read that
  // failed is not a fault of the folder, so it adds no line. *check again*
  // needs no invalidation of its own: the check it runs is raised as
  // `pdfFolder`, which `events.ts` answers.
  const pdfFault = useQuery(trpc.vault.pdfFault.queryOptions()).data ?? null;
  const checkAgain = useMutation(trpc.vault.checkAgain.mutationOptions());
  const ingest = useIngestSummary();
  const indexing = status.data?.indexing ?? null;
  const watching = status.data?.watching ?? { ok: true };
  const read: VaultRead = status.isError
    ? "unknown"
    : status.data === undefined || indexing !== null
      ? "reading"
      : watching.ok
        ? "full"
        : "unwatched";
  return {
    read,
    hasLines:
      status.isError ||
      indexing !== null ||
      !watching.ok ||
      pdfFault !== null ||
      ingest !== null,
    lines: (
      <>
        {/* Without the status the app cannot say the vault was read, so a
            surface cannot claim — and a *not known* with no reason anywhere
            would be a silent failure (ADR 0033). */}
        {status.isError && (
          <WarningLine label="vault state not known">
            {status.error.message}
          </WarningLine>
        )}
        {indexing !== null && (
          <span className={styles.line}>
            <span aria-hidden="true">◐</span> reading the vault ·{" "}
            {thousands(indexing.done)} of {thousands(indexing.total)} files
          </span>
        )}
        {!watching.ok && (
          <WarningLine label="not watching">
            {watching.reason} ·{" "}
            <button
              type="button"
              className={styles.retry}
              disabled={rewatch.isPending}
              onClick={() => rewatch.mutate()}
            >
              retry
            </button>
          </WarningLine>
        )}
        {ingest !== null && (
          <span className={styles.line} role="status">
            {ingestLine(ingest)}
          </span>
        )}
        {pdfFault !== null && (
          <WarningLine label="papers not arriving">
            {pdfFault.reason} ·{" "}
            <button
              type="button"
              className={styles.retry}
              disabled={checkAgain.isPending}
              onClick={() => checkAgain.mutate()}
            >
              check again
            </button>
          </WarningLine>
        )}
      </>
    ),
  };
}

/**
 * One line of the *wrong* Voice in the footer channel (ADR 0033 decision 2):
 * the warning glyph and a short label in the one warm colour, then the
 * reason in the footer's grey. A state the app is in, so polite — `alert` is
 * kept for a refusal of something the user just did (decision 1). Every
 * surface's own failure speaks through this too, so a failure reads the same
 * wherever it is said.
 */
export function WarningLine({
  label,
  children,
}: {
  label: string;
  /** The reason, and whatever the line offers to do about it. */
  children: React.ReactNode;
}) {
  return (
    <span className={styles.line} role="status">
      <span className={styles.warning}>
        <span aria-hidden="true">‖</span> {label}
      </span>{" "}
      — {children}
    </span>
  );
}

/**
 * How far the vault has been read, which is what decides whether an empty
 * surface may make a claim (ADR 0032): only `full` — read in full and
 * watched — warrants *nothing is there*. `reading` has not looked yet;
 * `unwatched` and `unknown` tried and could not say.
 */
export type VaultRead = "full" | "reading" | "unwatched" | "unknown";

/** `1,250`: the one place the chrome shows a count that can reach thousands. */
const thousands = (n: number) => n.toLocaleString("en-US");
