import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Scout } from "core";

/** What the form edits of a Scout, as the wire carries it (dates arrive as strings). */
type Editable = Pick<
  Scout,
  "id" | "name" | "query" | "cadence" | "assigned" | "lane"
>;
import { useEffect, useRef, useState } from "react";
import { StatusGlyph } from "./StatusGlyph";
import styles from "./ScoutQueue.module.css";
import { useTRPC } from "./trpc";

/** A Question the picker or the header can name: open ones are offered, others only when already assigned. */
export type QuestionChoice = {
  id: string;
  question: string;
  status: "open" | "promoted" | "answered" | "abandoned";
};

const DAY_MS = 24 * 3_600_000;
/** The default *also search back to* (ADR 0016 decision 5), a day-granular date. */
const BACK_DAYS = 90;

/**
 * Make or edit a Scout (#451; `docs/architecture.md` § Scouts, *Form*). It
 * opens in the centre pane in place of the stack, so the stack's keyboard is
 * never left under an overlay, and Esc gives the pane back. Save needs only a
 * name and a non-empty Query: *try* informs it and never gates it, because
 * arXiv being down must not stop anyone writing a Scout.
 */
export function ScoutForm({
  scout,
  questions,
  onDone,
}: {
  /** The Scout being edited; absent for a new one. */
  scout?: Editable;
  questions: QuestionChoice[];
  onDone: (savedId: string | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState(scout?.name ?? "");
  const [query, setQuery] = useState(scout?.query ?? "");
  const [cadence, setCadence] = useState(scout?.cadence ?? "daily");
  const [lane, setLane] = useState(scout?.lane ?? "review");
  const [assigned, setAssigned] = useState<string[]>(scout?.assigned ?? []);
  const [back, setBack] = useState(() =>
    new Date(Date.now() - BACK_DAYS * DAY_MS).toISOString().slice(0, 10)
  );
  const [said, setSaid] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const save = useMutation(
    trpc.scouts.save.mutationOptions({
      onSuccess: ({ id }) => {
        void queryClient.invalidateQueries(trpc.scouts.pathFilter());
        onDone(id);
      },
      onError: (error) => setSaid(error.message),
    })
  );
  const tried = useMutation(trpc.scouts.tryQuery.mutationOptions());

  // Open Questions only are offered (spec #447 story 5); one the Scout is
  // already assigned to stays on the list even when it has closed, so the
  // researcher can take it off and the file is never rewritten behind them.
  const choices = questions.filter(
    (q) => q.status === "open" || assigned.includes(q.id)
  );
  const unknown = assigned.filter((id) => !questions.some((q) => q.id === id));
  const ready = name.trim() !== "" && query.trim() !== "";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || save.isPending) return;
    save.mutate({
      ...(scout === undefined ? {} : { id: scout.id }),
      name,
      query,
      cadence,
      assigned,
      lane,
      searchBackTo:
        scout === undefined && back !== ""
          ? new Date(`${back}T00:00:00Z`).toISOString()
          : null,
    });
  }

  const result = tried.data;
  return (
    <form
      className={styles.form}
      aria-label={scout === undefined ? "New Scout" : `Edit ${scout.name}`}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDone(null);
        }
      }}
    >
      <label>
        Name
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Query
        <textarea
          value={query}
          rows={2}
          onChange={(e) => {
            setQuery(e.target.value);
            // What was tried was the old text.
            tried.reset();
          }}
        />
      </label>
      <p className={styles.try}>
        <button
          type="button"
          disabled={query.trim() === "" || tried.isPending}
          onClick={() => tried.mutate({ query })}
        >
          Try
        </button>{" "}
        {tried.isPending && <span>trying…</span>}
        {tried.isError && <span>{tried.error.message}</span>}
        {result?.outcome === "failed" && <span>{result.sentence}</span>}
        {result?.outcome === "found" && result.total === 0 && (
          <span>0 results across all of arXiv for this query</span>
        )}
        {result?.outcome === "found" && result.total > 0 && (
          <span>
            {result.total} results across all of arXiv
            <ol aria-label="First results">
              {result.titles.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
            </ol>
          </span>
        )}
      </p>
      <label>
        Cadence
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value as Scout["cadence"])}
        >
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
          <option value="monthly">monthly</option>
        </select>
      </label>
      <label>
        Starting lane
        <select
          value={lane}
          onChange={(e) => setLane(e.target.value as Scout["lane"])}
        >
          <option value="review">Review</option>
          <option value="skim">Skim</option>
        </select>
      </label>
      {scout === undefined && (
        <label>
          Also search back to
          <input
            type="date"
            value={back}
            onChange={(e) => setBack(e.target.value)}
          />
        </label>
      )}
      <fieldset>
        <legend>Assigned Questions</legend>
        {choices.length === 0 && unknown.length === 0 && (
          <p className={styles.line}>no open Questions</p>
        )}
        {choices.map((q) => (
          <label key={q.id} className={styles.choice}>
            <input
              type="checkbox"
              checked={assigned.includes(q.id)}
              onChange={(e) =>
                setAssigned((was) =>
                  e.target.checked
                    ? [...was, q.id]
                    : was.filter((id) => id !== q.id)
                )
              }
            />
            <StatusGlyph status={q.status} /> {q.question}
          </label>
        ))}
        {unknown.map((id) => (
          <label key={id} className={styles.choice}>
            <input
              type="checkbox"
              checked
              onChange={() => setAssigned((was) => was.filter((a) => a !== id))}
            />
            {id}
          </label>
        ))}
      </fieldset>
      {said !== null && <p role="status">{said}</p>}
      <p className={styles.actions}>
        <button type="submit" disabled={!ready || save.isPending}>
          Save
        </button>{" "}
        <button type="button" onClick={() => onDone(null)}>
          Cancel
        </button>{" "}
        <kbd>Esc</kbd> back to the stack
      </p>
    </form>
  );
}
