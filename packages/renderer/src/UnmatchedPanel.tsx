import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { closeUnmatchedPanel, useUnmatchedPanelOpen } from "./ingest-line";
import { UnmatchedRows } from "./LooseEnds";
import styles from "./UnmatchedPanel.module.css";
import { useTRPC } from "./trpc";

/**
 * The annotations an Ingest could not re-match (spec #416 story 58), opened
 * from the footer line and from nowhere else. It holds no rows of its own:
 * it reads Loose Ends' and draws them with the dashboard's own component,
 * so the two cannot disagree about what is waiting or how it is resolved.
 */
export function UnmatchedPanel() {
  const open = useUnmatchedPanelOpen();
  if (!open) return null;
  return <Panel />;
}

function Panel() {
  const trpc = useTRPC();
  const ends = useQuery(trpc.looseEnds.rows.queryOptions());
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeUnmatchedPanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const rows = (ends.data?.groups ?? [])
    .flatMap((g) => g.rows)
    .filter(
      (row) =>
        row.kind === "unmatched-annotation" || row.kind === "document-changed"
    );
  return (
    <section
      className={styles.panel}
      role="dialog"
      aria-label="Could not be re-matched"
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Could not be re-matched</h2>
        <button
          type="button"
          className={styles.close}
          onClick={closeUnmatchedPanel}
        >
          close
        </button>
      </header>
      <div className={styles.body}>
        {ends.isError && (
          <p className={styles.empty} role="alert">
            {ends.error.message}
          </p>
        )}
        {ends.isSuccess && rows.length === 0 && (
          <p className={styles.empty}>Nothing is waiting for a decision.</p>
        )}
        <UnmatchedRows rows={rows} />
      </div>
    </section>
  );
}
