import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import styles from "./ScoutDropped.module.css";
import { useTRPC } from "./trpc";

/**
 * Dropping a Scout from its row, for the table that draws the rows (ADR 0042
 * decisions 1 and 9). The core has the drop from the click onward, so a row
 * dropped during this visit stays where it is and says so, with *undo* beside
 * it, until the table is next read: nothing disappears from under the cursor,
 * and a slip is one click to take back. That is why a drop does not re-read the
 * table, as *mark deliberate* does not re-read Loose Ends (#266) — a re-read
 * would take the row and the undo with it.
 */
export function useDrops() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // Which Scouts were dropped during this visit, by id. It is this visit's
  // alone: the next read of the table has no row for them.
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  // What the core refused, on the row it was refused about: a drop or an undo
  // that did not land must not pass for one that did.
  const [refused, setRefused] = useState<Readonly<Record<string, string>>>({});
  const forgetRefusal = (scoutId: string) =>
    setRefused((was) => {
      const rest = { ...was };
      delete rest[scoutId];
      return rest;
    });
  const answers = {
    onMutate: ({ scoutId }: { scoutId: string }) => forgetRefusal(scoutId),
    // Only the message: what the core refused with is what the row says.
    onError: (error: { message: string }, { scoutId }: { scoutId: string }) =>
      setRefused((was) => ({ ...was, [scoutId]: error.message })),
  };
  const drop = useMutation(
    trpc.scouts.drop.mutationOptions({
      ...answers,
      onSuccess: (_done, { scoutId }) =>
        setDropped((was) => new Set(was).add(scoutId)),
    })
  );
  const restore = useMutation(
    trpc.scouts.restore.mutationOptions({
      ...answers,
      onSuccess: (_done, { scoutId }) => {
        setDropped((was) => {
          const rest = new Set(was);
          rest.delete(scoutId);
          return rest;
        });
        // The Scout is looking again, so the table has a row for it to read.
        void queryClient.invalidateQueries(trpc.scouts.activity.pathFilter());
      },
    })
  );
  return {
    dropped,
    refused,
    onDrop: (scoutId: string) => drop.mutate({ scoutId }),
    // The undo on a row dropped a moment ago and the *restore* on the line are
    // one act: the key cleared, whichever way the researcher came to it.
    onRestore: (scoutId: string) => restore.mutate({ scoutId }),
  };
}

export type Drops = ReturnType<typeof useDrops>;

/**
 * *drop*, on every Scout's row in the table's own quiet type: it weighs the
 * same on one row as on another, and carries no colour for how the Scout is
 * doing (ADR 0042 decision 8).
 */
export function DropButton({
  name,
  onDrop,
}: {
  name: string;
  onDrop: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.drop}
      aria-label={`${name}: drop`}
      onClick={onDrop}
    >
      drop
    </button>
  );
}

/** What a row says once its Scout is dropped: the one fact that is true of every dropped Scout. */
export const DROPPED =
  "dropped — it no longer runs; what it found stays in Review";

/**
 * What a row says once its Scout is dropped, in place of its figures: what
 * happened across the cells the figures filled, and the way back in the last
 * one, where the row's other link to somewhere else sits.
 */
export function DroppedInPlace({
  cells,
  onUndo,
}: {
  /** How many cells follow the row header, so the row fills the width the figures did. */
  cells: number;
  onUndo: () => void;
}) {
  return (
    <>
      <td colSpan={cells - 1}>
        <span role="status">{DROPPED}</span>
      </td>
      <td>
        <button type="button" className={styles.undo} onClick={onUndo}>
          undo
        </button>
      </td>
    </>
  );
}

/** A refusal of the researcher's own act, said where they are looking and interrupting, as ADR 0033 has it. */
export function DropRefused({ message }: { message: string }) {
  return (
    <p className={styles.refused} role="alert">
      <span className={styles.glyph} aria-hidden="true">
        !
      </span>{" "}
      {message}
    </p>
  );
}

/**
 * The one quiet line at the foot of the table (ADR 0042 decision 9): a count
 * of the dropped, opening to their names with *restore* on each. Absent when
 * none are dropped, since a line that says *0 dropped* is something to look at
 * that has no use. It is the way back once a row has left the screen; the row's
 * own *undo* is the way back while it is still there.
 */
export function DroppedLine({
  dropped,
  onRestore,
}: {
  dropped: Array<{ id: string; name: string }>;
  onRestore: (scoutId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = useId();
  if (dropped.length === 0) return null;
  return (
    <div className={styles.line}>
      <button
        type="button"
        className={styles.count}
        aria-expanded={open}
        aria-controls={open ? list : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        {dropped.length} dropped
      </button>
      {open && (
        <ul id={list} className={styles.names} aria-label="Dropped Scouts">
          {dropped.map((scout) => (
            <li key={scout.id}>
              <span>{scout.name}</span> <span aria-hidden="true">·</span>{" "}
              <button
                type="button"
                className={styles.undo}
                aria-label={`${scout.name}: restore`}
                onClick={() => onRestore(scout.id)}
              >
                restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
