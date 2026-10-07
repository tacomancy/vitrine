import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { RunSummary, ScoutRow } from "core";
import { AssignedQuestions, type QuestionChoice } from "./AssignedQuestions";
import { runWords } from "./run-words";
import styles from "./ScoutActivity.module.css";
import { useTRPC } from "./trpc";

/**
 * A row's *edit*: the fields the Queue's form writes and that a Scout has —
 * a Query and the Questions it is Assigned to — opened in the row, so that
 * mending a poor Scout never means leaving what it just showed (spec #511
 * stories 48 and 49). It is not a second form: it is the same picker, and
 * what it saves goes through the same `scouts.save`.
 */
export function ScoutEdit({
  row,
  questions,
  onAct,
  onSaved,
  onEditOnForm,
  onClose,
}: {
  row: ScoutRow;
  /**
   * The Questions a Scout may be Assigned to: `choices` is null until they
   * have been read, and `failed` once a read has not answered. The page says
   * why on its footer (ADR 0033 decision 2); the form says what it does
   * without them.
   */
  questions: { choices: QuestionChoice[] | null; failed: boolean };
  /** Called as the save is sent, before anything it changes is read back: the table takes its order here. */
  onAct: () => void;
  /** What the save did, for the row to say whether or not the form is still there. */
  onSaved: (said: string) => void;
  /** The form is where a page's address is changed; this opens it on this Scout. */
  onEditOnForm: () => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // A page has no Query to edit here: its address is the form's (ADR 0042
  // decision 5), so the field is not offered rather than offered and refused.
  const savedQuery = row.source.kind === "arxiv" ? row.source.query : null;
  const arxiv = savedQuery !== null;
  const [query, setQuery] = useState(savedQuery ?? "");
  const [assigned, setAssigned] = useState(row.assigned);
  // A refusal is the user's act turned down, so it is said here, where their
  // typing is, and the form stays open with it (ADR 0033 decision 1).
  const [refused, setRefused] = useState<string | null>(null);
  // A save that changes the Query runs the Scout before it answers, which can
  // take minutes, and Cancel, Escape and `e` stay live meanwhile. What a save
  // did is said whether or not the form is still there; closing the form is
  // `mutate`'s own callback below, which does not fire once the form has gone.
  const save = useMutation(
    trpc.scouts.save.mutationOptions({
      onSuccess: ({ run }) => {
        void queryClient.invalidateQueries(trpc.scouts.pathFilter());
        onSaved(
          savedWords(run, arxiv && query.trim() !== savedQuery, row.paused)
        );
      },
      onError: (error) => setRefused(error.message),
    })
  );
  const ready = !arxiv || query.trim() !== "";

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || save.isPending) return;
    setRefused(null);
    onAct();
    // The whole of what the Queue's form writes, from what the row carries:
    // the form's save rewrites the name, cadence and Lane with the Query, so
    // sending less would not be the same write.
    save.mutate(
      {
        id: row.id,
        name: row.name,
        watching: row.source.kind,
        query: row.source.kind === "arxiv" ? query : row.source.url,
        cadence: row.cadence,
        assigned,
        lane: row.lane,
        searchBackTo: null,
      },
      { onSuccess: onClose }
    );
  }

  return (
    <form
      className={styles.edit}
      aria-label={`Edit ${row.name}`}
      onKeyDown={onKeyDown}
      onSubmit={submit}
    >
      {arxiv ? (
        <label>
          Query
          <textarea
            rows={2}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : (
        <p className={styles.line}>
          Its address is changed on the form.{" "}
          <button type="button" onClick={onEditOnForm}>
            open the form
          </button>
        </p>
      )}
      {/* Drawn once the Questions have been read: before that the Scout's own
          would show as bare ids. What it is Assigned to is kept either way. */}
      {questions.choices !== null && (
        <AssignedQuestions
          questions={questions.choices}
          assigned={assigned}
          onChange={setAssigned}
        />
      )}
      {questions.failed && (
        <p className={styles.line}>
          The Questions could not be read, so none are offered. What this Scout
          is Assigned to is kept.
        </p>
      )}
      {refused !== null && <p role="alert">{refused}</p>}
      <p className={styles.formActions}>
        <button type="submit" disabled={!ready || save.isPending}>
          Save
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        {/* Progress, with no live region of its own (ADR 0033 decision 1). */}
        {save.isPending && <span>saving…</span>}
      </p>
    </form>
  );
}

/**
 * What a save did, said on the row. An edited Query runs the Scout at once, in
 * the core, so the run is the answer's to report; a Query that changed on a
 * paused Scout did not run, and saying so keeps *Saved.* from reading as if it
 * had.
 */
function savedWords(
  run: RunSummary | null,
  queryChanged: boolean,
  paused: boolean
): string {
  if (run !== null) {
    return run.outcome === "failed"
      ? `Saved. It ran at once. ${runWords(run)}`
      : `Saved. It ran at once: ${runWords(run)}.`;
  }
  return queryChanged && paused
    ? "Saved. It is paused, so it did not run."
    : "Saved.";
}
