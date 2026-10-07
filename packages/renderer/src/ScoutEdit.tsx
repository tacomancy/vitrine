import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { ActivityRow, RunSummary } from "core";
import { AssignedQuestions, questionChoices } from "./AssignedQuestions";
import { runWords } from "./run-words";
import styles from "./ScoutActivity.module.css";
import { useTRPC } from "./trpc";
import { WarningLine } from "./VaultStatusLines";

export type ScoutRow = Extract<ActivityRow, { kind: "scout" }>;

/**
 * A row's *edit*: the fields the Queue's form writes and that a Scout has —
 * a Query and the Questions it is Assigned to — opened in the row, so that
 * mending a poor Scout never means leaving what it just showed (spec #511
 * stories 48 and 49). It is not a second form: it is the same picker, and
 * what it saves goes through the same `scouts.save`.
 */
export function ScoutEdit({
  row,
  onAct,
  onSaved,
  onEditOnForm,
  onClose,
}: {
  row: ScoutRow;
  /** Called as the save is sent, before anything it changes is read back: the table takes its order here. */
  onAct: () => void;
  /** What the save did, for the row to say once the form has gone. */
  onSaved: (said: string) => void;
  /** The form is where a page's address is changed; this opens it on this Scout. */
  onEditOnForm: () => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const questions = useQuery(
    trpc.questions.list.queryOptions({ order: "newest" })
  );
  // A page has no Query to edit here: its address is the form's (ADR 0042
  // decision 5), so the field is not offered rather than offered and refused.
  const queryWas = row.source.kind === "arxiv" ? row.source.query : null;
  const arxiv = queryWas !== null;
  const [query, setQuery] = useState(queryWas ?? "");
  const [assigned, setAssigned] = useState(row.assigned);
  // A refusal is the user's act turned down, so it is said here, where their
  // typing is, and the form stays open with it (ADR 0033 decision 1).
  const [refused, setRefused] = useState<string | null>(null);
  const save = useMutation(
    trpc.scouts.save.mutationOptions({
      onSuccess: ({ run }) => {
        void queryClient.invalidateQueries(trpc.scouts.pathFilter());
        onSaved(
          savedWords(run, arxiv && query.trim() !== queryWas, row.paused)
        );
        onClose();
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
    save.mutate({
      id: row.id,
      name: row.name,
      watching: row.source.kind,
      query: row.source.kind === "arxiv" ? query : row.source.url,
      cadence: row.cadence,
      assigned,
      lane: row.lane,
      searchBackTo: null,
    });
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
          would show as bare ids, and a list that failed would pass for one
          with nothing to offer. What it is Assigned to is kept either way. */}
      {questions.isError && (
        <WarningLine label="not read">{questions.error.message}</WarningLine>
      )}
      {questions.data !== undefined && (
        <AssignedQuestions
          questions={questionChoices(questions.data)}
          assigned={assigned}
          onChange={setAssigned}
        />
      )}
      {refused !== null && <p role="alert">{refused}</p>}
      <p className={styles.formActions}>
        <button type="submit" disabled={!ready || save.isPending}>
          Save
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
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
