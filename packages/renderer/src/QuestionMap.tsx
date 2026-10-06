import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Matrix as MatrixData } from "core";
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
  // The page's one depth (ADR 0041 decision 8). Undefined asks for the
  // core's default, the deepest Tag in use; a choice is only a request
  // parameter, so nothing is stored and a reload starts at the default. The
  // previous answer stays up while the next arrives, so the gate below does
  // not flip to *not yet* — and unmount the control — on every change.
  const [depth, setDepth] = useState<number>();
  const input = depth === undefined ? undefined : { depth };
  const readings = useQuery({
    ...trpc.questionMap.readings.queryOptions(input),
    placeholderData: keepPreviousData,
  });
  const matrix = useQuery({
    ...trpc.questionMap.matrix.queryOptions(input),
    placeholderData: keepPreviousData,
  });
  const unread = useQuery(trpc.questionMap.unread.queryOptions());
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
    incomplete: coverage.isError || readings.isError || unread.isError,
    answered:
      coverage.data !== undefined &&
      readings.data !== undefined &&
      unread.data !== undefined,
    read: behind && status.read === "full" ? "reading" : status.read,
  });

  // Material is distinct across rows, as the matrix counts it, so a paper
  // two Questions share is one source.
  const sources = new Set(
    coverage.data?.rows.flatMap((r) => r.material.map((m) => m.path))
  ).size;
  const rows = coverage.data?.rows.length ?? 0;
  const skipped =
    (unread.data?.partial.length ?? 0) + (unread.data?.unreadable.length ?? 0);
  const noColumns = rows > 0 && sources === 0;
  const readingsSlot = (
    <div data-slot="readings">
      {/* Both reads keep their previous answer while a new depth is on its
          way; the strip waits for the one that matches the matrix, so the
          page is never at two depths at once. */}
      {readings.data !== undefined &&
        readings.data.depth === matrix.data?.depth && (
          <ReadingsStrip
            readings={readings.data}
            reviewable={reviewable}
            onReview={review}
          />
        )}
    </div>
  );

  return (
    <section className={styles.page} aria-labelledby="question-map-title">
      <div className={styles.header}>
        <h1 id="question-map-title" className={styles.title}>
          Question Map
        </h1>
        {voice === "claim" && matrix.data !== undefined && (
          <DepthControl
            deepest={matrix.data.deepest}
            depth={depth ?? matrix.data.depth}
            onChange={setDepth}
          />
        )}
      </div>
      {voice !== "claim" ? (
        <FirstSlot voice={voice} claim="">
          {null}
        </FirstSlot>
      ) : (
        <div className={styles.slots}>
          {/* With nothing attached the matrix has nothing to say, so the
              reading that does leads (ADR 0041 decision 14). */}
          {noColumns && readingsSlot}
          <div data-slot="matrix">
            {rows === 0 ? (
              <FirstSlot
                voice="claim"
                claim="No open questions to map."
                warrant={`read ${rows} of ${rows + skipped} questions · just now`}
              />
            ) : noColumns ? (
              <FirstSlot
                voice="claim"
                claim="The matrix has no columns."
                warrant={`${plural(rows, "open question", "open questions")} read · 0 sources attached`}
              />
            ) : (
              <MatrixSlot
                data={matrix.data}
                reviewable={reviewable}
                onReview={review}
              />
            )}
          </div>
          {!noColumns && readingsSlot}
          <div data-slot="origins">
            <Origins />
          </div>
          <div data-slot="review">
            <CandidateReview request={request} />
          </div>
        </div>
      )}
      {(status.hasLines ||
        skipped > 0 ||
        coverage.isError ||
        readings.isError ||
        unread.isError) && (
        <footer className={styles.footer}>
          {skipped > 0 && unread.data !== undefined && (
            <details className={styles.unreadableDetails}>
              <summary className={styles.footerLine}>
                {skipped} {skipped === 1 ? "file" : "files"} could not be read
              </summary>
              <ul className={styles.unreadable}>
                {[...unread.data.partial, ...unread.data.unreadable].map(
                  (file) => (
                    <li key={file.path}>
                      <span>{file.path}</span>
                      <span className={styles.reason}>{file.reason}</span>
                    </li>
                  )
                )}
              </ul>
            </details>
          )}
          {status.lines}
          {coverage.isError && (
            <WarningLine label="not read">{coverage.error.message}</WarningLine>
          )}
          {readings.isError && (
            <WarningLine label="not read">{readings.error.message}</WarningLine>
          )}
          {unread.isError && (
            <WarningLine label="not read">{unread.error.message}</WarningLine>
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
 * drawn (ADR 0041 decision 14); the page says why in place of it.
 */
function MatrixSlot({
  data,
  reviewable,
  onReview,
}: {
  data: MatrixData | undefined;
  reviewable: ReadonlySet<string>;
  onReview: (path: string) => void;
}) {
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

/**
 * One button per depth from 1 to the deepest in use. A single depth leaves
 * nothing to choose, so the control is not drawn.
 */
function DepthControl({
  deepest,
  depth,
  onChange,
}: {
  deepest: number;
  depth: number;
  onChange: (depth: number) => void;
}) {
  if (deepest < 2) return null;
  return (
    <div className={styles.depth} role="group" aria-label="Depth">
      <span className={styles.depthLabel}>Depth</span>
      {Array.from({ length: deepest }, (_, i) => i + 1).map((d) => (
        <button
          key={d}
          type="button"
          className={styles.depthOption}
          aria-pressed={d === depth}
          onClick={() => onChange(d)}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
