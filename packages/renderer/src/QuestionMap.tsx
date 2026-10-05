import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CandidateReview } from "./CandidateReview";
import { Matrix } from "./charts/matrix";
import { FirstSlot, voiceOf } from "./FirstSlot";
import styles from "./QuestionMap.module.css";
import { Origins } from "./Origins";
import { ReadingsStrip } from "./Readings";
import { useTRPC } from "./trpc";
import { useVaultStatusLines, WarningLine } from "./VaultStatusLines";

/**
 * The Question Map (ADR 0041): one page, a frame of named slots that each
 * later reading fills — the matrix, the four readings, Origins, the review —
 * so no reading touches another's place.
 *
 * Every slot sits behind one gate. Until the vault is read in full, the
 * Index is Current and the watcher is up, the page answers *not yet* in the
 * footer channel's words, because a reading drawn from a half-read vault
 * would show *nothing to map* where the truth is *not looked yet* (ADR 0032;
 * ADR 0041 decision 4). A slot that is empty for want of a reading is
 * therefore never the gate's doing.
 */
export function QuestionMap() {
  const trpc = useTRPC();
  const coverage = useQuery(trpc.questionMap.coverage.queryOptions());
  const readings = useQuery(trpc.questionMap.readings.queryOptions());
  const status = useVaultStatusLines();
  const index = useQuery(trpc.vault.status.queryOptions());
  // The same uncached read the review holds its visit on: a row offers
  // *review links* only if the review has something to show for it.
  const candidates = useQuery({
    ...trpc.questionMap.candidates.queryOptions(),
    gcTime: 0,
  });
  const [request, setRequest] = useState<{ path: string } | null>(null);
  const reviewable = new Set(candidates.data?.map((q) => q.path));
  // A fresh object each click, so choosing the same row again re-enters it.
  const review = (path: string) => setRequest({ path });

  // `read` is the footer channel's reckoning, which knows a build and a
  // dead watcher but not an Index that is merely behind (a settled batch not
  // yet applied): that one is `current`, and it holds the gate too.
  const behind = index.data !== undefined && !index.data.current.ok;
  const voice = voiceOf({
    incomplete: coverage.isError || readings.isError,
    answered: coverage.data !== undefined && readings.data !== undefined,
    read: behind && status.read === "full" ? "reading" : status.read,
  });

  return (
    <section className={styles.page} aria-labelledby="question-map-title">
      <div className={styles.header}>
        <h1 id="question-map-title" className={styles.title}>
          Question Map
        </h1>
      </div>
      {voice !== "claim" ? (
        <FirstSlot voice={voice} claim="">
          {null}
        </FirstSlot>
      ) : (
        <div className={styles.slots}>
          <div data-slot="matrix">
            <MatrixSlot reviewable={reviewable} onReview={review} />
          </div>
          <div data-slot="readings">
            {readings.data !== undefined && (
              <ReadingsStrip
                readings={readings.data}
                reviewable={reviewable}
                onReview={review}
              />
            )}
          </div>
          <div data-slot="origins">
            <Origins />
          </div>
          <div data-slot="review">
            <CandidateReview request={request} />
          </div>
        </div>
      )}
      {(status.hasLines || coverage.isError || readings.isError) && (
        <footer className={styles.footer}>
          {status.lines}
          {coverage.isError && (
            <WarningLine label="not read">{coverage.error.message}</WarningLine>
          )}
          {readings.isError && (
            <WarningLine label="not read">{readings.error.message}</WarningLine>
          )}
        </footer>
      )}
    </section>
  );
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The matrix and the line that states its cut. A grid with no axes is never
 * drawn (ADR 0041 decision 14); the short-page claims are a later ticket's.
 */
function MatrixSlot({
  reviewable,
  onReview,
}: {
  reviewable: ReadonlySet<string>;
  onReview: (path: string) => void;
}) {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.questionMap.matrix.queryOptions());
  if (data === undefined || data.rows.length === 0 || data.columns.length === 0)
    return null;
  // The counts are the core's, taken before its cut; the clause is dropped
  // when no row and no column was left out.
  const cut =
    data.rows.length < data.totals.rows ||
    data.columns.length < data.totals.columns;
  return (
    <>
      <p className={styles.stated}>
        {plural(data.totals.rows, "question", "questions")} ·{" "}
        {plural(data.totals.columns, "tag", "tags")}
        {cut &&
          ` · matrix shows the ${data.rows.length} × ${data.columns.length} heaviest`}
      </p>
      <Matrix matrix={data} reviewable={reviewable} onReview={onReview} />
    </>
  );
}
