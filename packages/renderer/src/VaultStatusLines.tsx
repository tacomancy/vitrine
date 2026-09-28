import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "./trpc";
import styles from "./VaultStatusLines.module.css";

/**
 * The vault's state in every surface's footer channel (`docs/architecture.md`
 * § Index, Status): a build's progress, and a watcher that is down for good
 * with its *retry*. Nothing when all is well — a footer that is always
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
    hasLines: status.isError || indexing !== null || !watching.ok,
    lines: (
      <>
        {/* Without the status the app cannot say the vault was read, so a
            surface cannot claim — and a *not known* with no reason anywhere
            would be a silent failure (ADR 0033). */}
        {status.isError && (
          <span className={styles.line} role="status">
            <span className={styles.warning}>
              <span aria-hidden="true">‖</span> vault state not known
            </span>{" "}
            — {status.error.message}
          </span>
        )}
        {indexing !== null && (
          <span className={styles.line}>
            <span aria-hidden="true">◐</span> reading the vault ·{" "}
            {thousands(indexing.done)} of {thousands(indexing.total)} files
          </span>
        )}
        {!watching.ok && (
          // A state the app is in, so polite: `alert` is kept for a refusal
          // of something the user just did (ADR 0033).
          <span className={styles.line} role="status">
            <span className={styles.warning}>
              <span aria-hidden="true">‖</span> not watching
            </span>{" "}
            — {watching.reason} ·{" "}
            <button
              type="button"
              className={styles.retry}
              disabled={rewatch.isPending}
              onClick={() => rewatch.mutate()}
            >
              retry
            </button>
          </span>
        )}
      </>
    ),
  };
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
