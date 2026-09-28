import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Loop } from "core";
import { useState } from "react";
import styles from "./Hypothesis.module.css";
import rq from "./ResearchQuestion.module.css";
import { MONTHS } from "./rows";
import { useTRPC } from "./trpc";

/**
 * Closing the loop (#338; ADR 0031 decision 8; spec #327 stories 64–70,
 * 74, 75): the result written one hop up, to the object the Hypothesis was
 * promoted from. Offered only when the core says the state is closable and
 * there is one parent to write to — never automatically, because the state
 * is live and a write into another file is the user's to make.
 *
 * What it shows is read from that parent, never from this page: the newest
 * line naming this Hypothesis there, and whether its result still matches
 * the word closing now would write. When it does not, the page says so
 * plainly and offers to close again, which appends — the old line is true
 * of its date and stays.
 */
export function LoopLine({
  loop,
  path,
  hash,
}: {
  loop: Loop;
  path: string;
  hash: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  const close = useMutation(
    trpc.hypotheses.closeLoop.mutationOptions({
      onSuccess: () => {
        setRefusal(null);
        void queryClient.invalidateQueries(trpc.hypotheses.page.pathFilter());
        // The parent's own surfaces read the line too: the Inbox row says
        // *answered — <result>*, a Research Question lists it.
        void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
        void queryClient.invalidateQueries(
          trpc.researchQuestions.page.pathFilter()
        );
      },
      onError: (error) =>
        setRefusal(`could not close the loop: ${error.message}`),
    })
  );
  const offer = (label: string) => (
    <button
      type="button"
      className={`${rq.edit} ${styles.offer}`}
      disabled={close.isPending}
      onClick={() => close.mutate({ path, basedOn: hash })}
    >
      {label}
    </button>
  );

  return (
    <section className={styles.loop} aria-label="The loop">
      {loop.status === "none" && (
        // Once, and quietly: a hand-made Hypothesis is not broken (story 74).
        <p className={styles.offerNote}>
          written directly — there is nothing to write back to
        </p>
      )}
      {loop.status === "unresolved" && (
        <p className={rq.refusal}>cannot write back: {loop.reason}</p>
      )}
      {loop.status === "open" &&
        loop.closable &&
        offer(
          `close the loop — write ${loop.result} to ${nameOf(loop.parent.path)}`
        )}
      {loop.status === "closed" &&
        (loop.written.result === loop.result ? (
          <p className={styles.loopClosed}>
            loop closed — {loop.written.result}, written to{" "}
            {nameOf(loop.parent.path)} on {dayOf(loop.written.date)}
          </p>
        ) : (
          <>
            <p className={styles.loopMoved}>
              the line written to {nameOf(loop.parent.path)} on{" "}
              {dayOf(loop.written.date)} says {loop.written.result}; the state
              is now {loop.result}, so it no longer matches
            </p>
            {loop.closable &&
              offer(`close the loop again — append ${loop.result}`)}
          </>
        ))}
      {refusal !== null && (
        <p role="status" className={rq.refusal}>
          {refusal}
        </p>
      )}
    </section>
  );
}

/** A vault-relative path as the parent is named on screen: its file name. */
const nameOf = (path: string) =>
  (path.split("/").at(-1) ?? path).replace(/\.md$/, "");

/**
 * `2026-09-30` → `30 September 2026`. The line carries a day, not an
 * instant, so it is read as written rather than through a time zone that
 * could move it to the day before.
 */
function dayOf(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}
