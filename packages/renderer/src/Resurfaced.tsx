import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ListedQuestion } from "core";
import { formatAge } from "./age";
import { FirstSlot } from "./FirstSlot";
import { RefusalLine, useRefusal } from "./refusal-line";
import styles from "./Resurfaced.module.css";
import { hashOf } from "./router";
import { provenanceOf } from "./rows";
import { useTRPC } from "./trpc";

/**
 * *From the notebook* (spec #728): a few open Questions old enough to have
 * been forgotten, as a page to wander through. The core picks them and says
 * nothing about how many there are to pick from, so no figure can appear here.
 * Drawn only when there is something to show; a read that failed is said, in
 * the wrong voice, and is not an empty section.
 */
export function Resurfaced({ vaultPath }: { vaultPath: string }) {
  const trpc = useTRPC();
  // *↻ others* is the seed going up by one: the same date and seed always
  // give the same three, so a reload does not reshuffle.
  const [seed, setSeed] = useState(0);
  const picked = useQuery({
    ...trpc.home.resurfaced.queryOptions({ seed }),
    placeholderData: keepPreviousData,
  });
  // The rows dismissed since they were read, still drawn so *undo* has
  // something to sit beside. The next read does not return them, which is
  // when they go (as Loose Ends' do, #266).
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  // A read that lands is the next read: whatever it returns is the truth, so
  // a mark left from before it must not outlive it (a Question brought back
  // from another window would otherwise draw as dismissed).
  const [seenRead, setSeenRead] = useState(picked.dataUpdatedAt);
  if (picked.dataUpdatedAt !== seenRead) {
    setSeenRead(picked.dataUpdatedAt);
    setDismissed(new Set());
  }
  const refusal = useRefusal();
  const [refusedPath, setRefusedPath] = useState<string | null>(null);

  const onMutate = ({ path }: { path: string }) => {
    refusal.forget();
    setRefusedPath(path);
  };
  const onError = (error: { message: string }) => refusal.say(error.message);
  const dismiss = useMutation(
    trpc.home.dismissResurfaced.mutationOptions({
      onMutate,
      onError,
      onSuccess: (_reply, { path }) =>
        setDismissed((marked) => new Set(marked).add(path)),
    })
  );
  const undo = useMutation(
    trpc.home.undismissResurfaced.mutationOptions({
      onMutate,
      onError,
      onSuccess: (_reply, { path }) =>
        setDismissed((marked) => {
          const rest = new Set(marked);
          rest.delete(path);
          return rest;
        }),
    })
  );

  if (picked.isError) {
    return (
      <FirstSlot
        voice="wrong"
        claim=""
        fragment={`could not read the notebook · ${picked.error.message}`}
      />
    );
  }
  const questions = picked.data?.questions ?? [];
  if (questions.length === 0) return null;

  const now = new Date();
  return (
    <section className={styles.notebook} aria-labelledby="notebook-title">
      <div className={styles.head}>
        <h2 id="notebook-title" className={styles.heading}>
          From the notebook
        </h2>
        <span className={styles.tone}>
          Asked a while ago. Nothing here is owed an answer.
        </span>
        <button
          type="button"
          className={styles.act}
          onClick={() => setSeed((s) => s + 1)}
        >
          ↻ others
        </button>
      </div>
      <ul className={styles.list}>
        {questions.map((q) => (
          <li key={q.path} className={styles.row}>
            <Row
              q={q}
              vaultPath={vaultPath}
              now={now}
              marked={dismissed.has(q.path)}
              onDismiss={() => dismiss.mutate({ path: q.path })}
              onUndo={() => undo.mutate({ path: q.path })}
            />
            {refusedPath === q.path && (
              <RefusalLine refusal={refusal} className={styles.refusal} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({
  q,
  vaultPath,
  now,
  marked,
  onDismiss,
  onUndo,
}: {
  q: ListedQuestion;
  vaultPath: string;
  now: Date;
  marked: boolean;
  onDismiss: () => void;
  onUndo: () => void;
}) {
  // Opening a Question is a route to its Address; the Inbox, which holds the
  // row, takes the keyboard on arrival (ADR 0010).
  const href = hashOf({
    surface: "inbox",
    question: q.path.slice(vaultPath.length + 1),
  });
  return (
    <>
      <a className={styles.question} href={href}>
        {q.question}
      </a>
      <span className={styles.provenance}>{provenanceOf(q)}</span>
      <span className={styles.age}>{formatAge(q.captured, now)}</span>
      {marked ? (
        <button type="button" className={styles.act} onClick={onUndo}>
          undo
        </button>
      ) : (
        <button type="button" className={styles.act} onClick={onDismiss}>
          dismiss
        </button>
      )}
      {marked && (
        <p className={styles.said}>
          dismissing takes it out of the rotation, not out of the vault
        </p>
      )}
    </>
  );
}
