import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { addressOf } from "./kinds";
import styles from "./Origins.module.css";
import { useTRPC } from "./trpc";

/**
 * Where the researcher's Questions were captured from (ADR 0041 decision 2).
 * Two facts a row — Questions produced, Material attached to them — so a
 * high first number over a thin second one reads as a source worth going back
 * to. Nothing about how often a source was read: that is accumulation, and it
 * does not ship. The core ranks and cuts; this only says what was cut and
 * asks for the rest.
 */
export function Origins() {
  const trpc = useTRPC();
  const [all, setAll] = useState(false);
  const origins = useQuery({
    ...trpc.questionMap.origins.queryOptions({ all }),
    // The cut list stays up while the full one loads.
    placeholderData: (previous) => previous,
  });
  if (origins.data === undefined) return null;
  const { rows, total } = origins.data;

  return (
    <section className={styles.origins} aria-labelledby="origins-title">
      <h2 id="origins-title" className={styles.title}>
        Origins
      </h2>
      {rows.length === 0 ? (
        <p className={styles.quiet}>No questions captured yet.</p>
      ) : (
        <ol className={styles.list}>
          {rows.map((row, at) => {
            // A Source, a Research Question or an Experiment opens; anything
            // else is named and left alone.
            const address =
              row.path === null ? null : addressOf(row.kind, row.path);
            return (
              <li key={at} className={styles.row}>
                {address === null ? (
                  <span className={styles.name}>{row.label}</span>
                ) : (
                  <a className={styles.name} href={address}>
                    {row.label}
                  </a>
                )}
                <span className={styles.facts}>
                  {row.questions}{" "}
                  {row.questions === 1 ? "question" : "questions"}
                  {" · "}
                  {row.material} material
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {total > rows.length && (
        <p className={styles.quiet}>
          top {rows.length} of {total} ·{" "}
          <button
            type="button"
            className={styles.more}
            onClick={() => setAll(true)}
          >
            show all {total}
          </button>
        </p>
      )}
    </section>
  );
}
