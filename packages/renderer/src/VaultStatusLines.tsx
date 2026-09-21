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
  return {
    hasLines: indexing !== null || !watching.ok,
    lines: (
      <>
        {indexing !== null && (
          <span className={styles.line}>
            indexing… {thousands(indexing.done)} of {thousands(indexing.total)}
          </span>
        )}
        {!watching.ok && (
          <span className={styles.line}>
            not watching — {watching.reason} ·{" "}
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

/** `1,250`: the one place the chrome shows a count that can reach thousands. */
const thousands = (n: number) => n.toLocaleString("en-US");
