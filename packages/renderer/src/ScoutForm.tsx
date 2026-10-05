import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Scout, TriedPage } from "core";

/** What the form edits of a Scout, as the wire carries it (dates arrive as strings). */
type Editable = Pick<
  Scout,
  "id" | "name" | "query" | "cadence" | "assigned" | "lane" | "source"
>;
import { useEffect, useRef, useState } from "react";
import { pushRoute, SETTINGS } from "./router";
import { StatusGlyph } from "./StatusGlyph";
import styles from "./ScoutQueue.module.css";
import { useTRPC } from "./trpc";

/** A Question the picker or the header can name: open ones are offered, others only when already assigned. */
export type QuestionChoice = {
  id: string;
  question: string;
  status: "open" | "promoted" | "answered" | "abandoned";
};

/**
 * What the form holds, kept by the window and not by the form: *Add a key*
 * leaves for Settings, and a form that held these itself would come back
 * empty (ADR 0025 decision 3 — the regression it names as silent).
 */
export type FormValues = {
  name: string;
  watching: "arxiv" | "watched";
  query: string;
  cadence: Scout["cadence"];
  lane: Scout["lane"];
  assigned: string[];
  back: string;
};

/** The form as the window keeps it: which Scout, or null for a new one, and what has been typed. */
export type ScoutDraft = { edit: string | null; values: FormValues | null };

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
  values,
  onChange,
  questions,
  onDone,
}: {
  /** The Scout being edited; absent for a new one. */
  scout?: Editable;
  /** What was typed before the form last left the screen. */
  values: FormValues | null;
  onChange: (values: FormValues) => void;
  questions: QuestionChoice[];
  onDone: (savedId: string | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState(values?.name ?? scout?.name ?? "");
  const [watching, setWatching] = useState(
    values?.watching ?? scout?.source.kind ?? "arxiv"
  );
  const [query, setQuery] = useState(values?.query ?? scout?.query ?? "");
  const [cadence, setCadence] = useState(
    values?.cadence ?? scout?.cadence ?? "daily"
  );
  const [lane, setLane] = useState(values?.lane ?? scout?.lane ?? "review");
  const [assigned, setAssigned] = useState<string[]>(
    values?.assigned ?? scout?.assigned ?? []
  );
  const [back, setBack] = useState(
    () =>
      values?.back ??
      new Date(Date.now() - BACK_DAYS * DAY_MS).toISOString().slice(0, 10)
  );
  useEffect(
    () => onChange({ name, watching, query, cadence, lane, assigned, back }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onChange` is new each render
    [name, watching, query, cadence, lane, assigned, back]
  );
  const page = watching === "watched";
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
  const triedPage = useMutation(trpc.scouts.tryWatched.mutationOptions());

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
      watching,
      query,
      cadence,
      assigned,
      lane,
      // A page has no date window: its first run proposes all it lists.
      searchBackTo:
        scout === undefined && !page && back !== ""
          ? new Date(`${back}T00:00:00Z`).toISOString()
          : null,
    });
  }

  // On the document, so Esc still returns after a click moves focus off the form.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const result = tried.data;
  const pageResult = triedPage.data;
  return (
    <form
      className={styles.form}
      aria-label={scout === undefined ? "New Scout" : `Edit ${scout.name}`}
      onSubmit={submit}
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
        Watching
        {/* What a Scout watches is fixed when it is made: an edit that
            changed it would turn one Scout's history into another's. */}
        <select
          value={watching}
          disabled={scout !== undefined}
          onChange={(e) => {
            setWatching(e.target.value as FormValues["watching"]);
            tried.reset();
            triedPage.reset();
          }}
        >
          <option value="arxiv">arXiv</option>
          <option value="watched">a web page</option>
        </select>
      </label>
      {!page && (
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
      )}
      {page && (
        <label>
          Address
          <input
            type="url"
            value={query}
            placeholder="https://"
            onChange={(e) => {
              setQuery(e.target.value);
              triedPage.reset();
            }}
          />
        </label>
      )}
      {!page && (
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
      )}
      {page && (
        <p className={styles.try}>
          <button
            type="button"
            disabled={query.trim() === "" || triedPage.isPending}
            onClick={() => triedPage.mutate({ address: query })}
          >
            Try
          </button>{" "}
          {triedPage.isPending && <span>trying…</span>}
          {triedPage.isError && <span>{triedPage.error.message}</span>}
          {pageResult !== undefined && <PageResult result={pageResult} />}
        </p>
      )}
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
      {scout === undefined && !page && (
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

/** What *try* learned about a page, in the words the Scout would use for it. */
function PageResult({ result }: { result: TriedPage }) {
  if (result.outcome === "failed") return <span>{result.sentence}</span>;
  if (result.outcome === "no-key") {
    return (
      <span>
        {result.sentence}{" "}
        {/* The form is kept by the window, so back returns to it as left. */}
        <button type="button" onClick={() => pushRoute(SETTINGS)}>
          Add a key
        </button>
      </span>
    );
  }
  return (
    <span>
      {result.via === "feed"
        ? `${result.total} found · a feed was found · no model call`
        : `${result.total} found · ${result.verified} verified · ${result.dropped} dropped`}
      {result.via === "model" && result.tokens !== null && (
        <span>
          {" "}
          · {result.tokens.input.toLocaleString("en-US")} in ·{" "}
          {result.tokens.output.toLocaleString("en-US")} out
          {result.costUsd !== null && ` · $${result.costUsd.toFixed(4)}`}
        </span>
      )}
      <ol aria-label="First results">
        {result.titles.map((title, i) => (
          <li key={i}>{title}</li>
        ))}
      </ol>
    </span>
  );
}
