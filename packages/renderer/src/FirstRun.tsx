import { useMutation, useQueryClient } from "@tanstack/react-query";
import styles from "./FirstRun.module.css";
import { useTRPC } from "./trpc";

/**
 * What a launch with no vault shows. It says what Vitrine will and won't do
 * to a folder, then offers the one thing there is to do.
 */
export function FirstRun() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const pick = useMutation(
    trpc.vault.pick.mutationOptions({
      onSuccess: (vault) => {
        // A cancelled chooser returns null: nothing changed, nothing to refetch.
        if (vault) void queryClient.invalidateQueries(trpc.vault.current.queryFilter());
      },
    })
  );

  return (
    <section className={styles.firstRun}>
      <div className={styles.column}>
        <p className={styles.promise}>
          Your files stay plain Markdown on disk. Vitrine keeps its own state in
          one folder beside them, and touches nothing else.
        </p>
        <button
          type="button"
          className={styles.action}
          onClick={() => pick.mutate()}
          disabled={pick.isPending}
        >
          Open a vault
        </button>
        {pick.isError && (
          <p className={styles.message} role="alert">
            {pick.error.message}
          </p>
        )}
      </div>
    </section>
  );
}
