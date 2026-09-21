import { useQuery } from "@tanstack/react-query";
import styles from "./ResearchQuestion.module.css";
import { useTRPC } from "./trpc";

/**
 * The Research Question view's address (`#/questions/<path>`). The page
 * itself arrives with later tickets; today the surface asks the index for
 * the path and never shows a blank: a path the index does not hold — or one
 * it refuses — is a line naming the path and the reason `vault.status`
 * gives, so a stale link is a message.
 */
export function ResearchQuestion({ path }: { path: string }) {
  const trpc = useTRPC();
  const outline = useQuery(trpc.vault.outline.queryOptions({ path }));
  return (
    <section className={styles.page} aria-labelledby="research-question-title">
      <h1 id="research-question-title" className={styles.title}>
        Research Question view
      </h1>
      {outline.isError && (
        <p className={styles.absent}>
          {path} — {outline.error.message}
        </p>
      )}
      {outline.data?.readable === false && (
        <p className={styles.absent}>
          {outline.data.path} — {outline.data.reason}
        </p>
      )}
      {outline.data?.readable === true && (
        <p className={styles.absent}>{outline.data.path}</p>
      )}
    </section>
  );
}
