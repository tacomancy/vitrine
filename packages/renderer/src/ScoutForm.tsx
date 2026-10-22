import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Scout, TriedPage, Venue } from "core";

/** What the form edits of a Scout, as the wire carries it (dates arrive as strings). */
type Editable = Pick<
  Scout,
  | "id"
  | "name"
  | "query"
  | "tags"
  | "venues"
  | "cadence"
  | "assigned"
  | "lane"
  | "source"
  | "cap"
  | "reviewDays"
  | "skimDays"
>;

/** The core's defaults (`DEFAULT_REVIEW_DAYS`, `DEFAULT_SKIM_DAYS`): the renderer takes types from `core` and no values. */
const REVIEW_DAYS_DEFAULT = "14";
const SKIM_DAYS_DEFAULT = "30";

/** A number of the file as the form's text: a default is left empty (shown as the placeholder) so a save never writes it back. */
const queueText = (value: number | null | undefined, standard?: string) =>
  value === null || value === undefined || String(value) === standard
    ? ""
    : String(value);
import { useEffect, useRef, useState } from "react";
import {
  ActionRow,
  Button,
  FieldRow,
  FormSection,
  SegmentedRow,
  Input,
  Select,
  TextArea,
  Unlocks,
} from "./Form";
import { TagsFilter } from "./TagsFilter";
import { VenueAllowlist } from "./VenueAllowlist";
import { AssignedQuestions, type QuestionChoice } from "./AssignedQuestions";
import { RefusalLine, useRefusal } from "./refusal-line";
import { pushRoute, SETTINGS } from "./router";
import styles from "./ScoutQueue.module.css";
import { useTRPC } from "./trpc";

/**
 * What the form holds, kept by the window and not by the form: *Add a key*
 * leaves for Settings, and a form that held these itself would come back
 * empty (ADR 0025 decision 3 — the regression it names as silent).
 */
export type FormValues = {
  name: string;
  watching: "arxiv" | "openalex" | "watched";
  query: string;
  /** Which Filter the form is on; the other's text is kept, so switching back loses nothing. */
  filter: "query" | "tags";
  tags: string[];
  /** An OpenAlex Scout's allowlist; empty is every journal and conference. */
  venues: Venue[];
  cadence: Scout["cadence"];
  lane: Scout["lane"];
  assigned: string[];
  back: string;
  cap: string;
  reviewDays: string;
  skimDays: string;
};

/** The form as the window keeps it: which Scout, or null for a new one, and what has been typed. */
export type ScoutDraft = {
  edit: string | null;
  values: FormValues | null;
  /** A Question to start a new Scout Assigned to (*brief a scout* on a coverage gap); every other default is the form's own. Spent once the form has written its values. */
  assigning?: string;
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
  values,
  onChange,
  questions,
  assigning,
  onDone,
}: {
  /** The Scout being edited; absent for a new one. */
  scout?: Editable;
  /** What was typed before the form last left the screen. */
  values: FormValues | null;
  onChange: (values: FormValues) => void;
  questions: QuestionChoice[];
  /** A Question a new Scout starts Assigned to. */
  assigning?: string | undefined;
  onDone: (savedId: string | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState(values?.name ?? scout?.name ?? "");
  const [watching, setWatching] = useState(
    values?.watching ?? scout?.source.kind ?? "arxiv"
  );
  const [query, setQuery] = useState(values?.query ?? scout?.query ?? "");
  const [filter, setFilter] = useState<FormValues["filter"]>(
    values?.filter ?? (scout?.tags === undefined ? "query" : "tags")
  );
  const [tags, setTags] = useState<string[]>(values?.tags ?? scout?.tags ?? []);
  const [venues, setVenues] = useState<Venue[]>(
    values?.venues ?? scout?.venues ?? []
  );
  const [cadence, setCadence] = useState(
    values?.cadence ?? scout?.cadence ?? "daily"
  );
  const [lane, setLane] = useState(values?.lane ?? scout?.lane ?? "review");
  const [assigned, setAssigned] = useState<string[]>(
    values?.assigned ??
      scout?.assigned ??
      (assigning === undefined ? [] : [assigning])
  );
  const [back, setBack] = useState(
    () =>
      values?.back ??
      new Date(Date.now() - BACK_DAYS * DAY_MS).toISOString().slice(0, 10)
  );
  const opening = {
    cap: queueText(scout?.cap),
    reviewDays: queueText(scout?.reviewDays, REVIEW_DAYS_DEFAULT),
    skimDays: queueText(scout?.skimDays, SKIM_DAYS_DEFAULT),
  };
  const [cap, setCap] = useState(values?.cap ?? opening.cap);
  const [reviewDays, setReviewDays] = useState(
    values?.reviewDays ?? opening.reviewDays
  );
  const [skimDays, setSkimDays] = useState(
    values?.skimDays ?? opening.skimDays
  );
  useEffect(
    () =>
      onChange({
        name,
        watching,
        query,
        filter,
        tags,
        venues,
        cadence,
        lane,
        assigned,
        back,
        cap,
        reviewDays,
        skimDays,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onChange` is new each render
    [
      name,
      watching,
      query,
      filter,
      tags,
      venues,
      cadence,
      lane,
      assigned,
      back,
      cap,
      reviewDays,
      skimDays,
    ]
  );
  const page = watching === "watched";
  const openalex = watching === "openalex";
  // A refused Save is the user's act turned down, so it is an alert, said where
  // their typing is with the form still open (ADR 0033 decision 1 and its
  // 2026-10-15 Update). Its look is the form's own register: no class, unstyled.
  const refusal = useRefusal();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const save = useMutation(
    trpc.scouts.save.mutationOptions({
      onSuccess: ({ id }) => {
        void queryClient.invalidateQueries(trpc.scouts.pathFilter());
        onDone(id);
      },
      onError: (error) => refusal.say(error.message),
    })
  );
  const tried = useMutation(trpc.scouts.tryQuery.mutationOptions());
  const triedTags = useMutation(trpc.scouts.tryTags.mutationOptions());
  const triedPage = useMutation(trpc.scouts.tryWatched.mutationOptions());

  const byTags = !page && filter === "tags";
  const missing = [
    ...(name.trim() === "" ? ["a name"] : []),
    ...(byTags
      ? tags.length === 0
        ? ["a Tag"]
        : []
      : query.trim() === ""
        ? [page ? "an Address" : "a Query"]
        : []),
  ];
  const ready = missing.length === 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || save.isPending) return;
    refusal.forget();
    save.mutate({
      ...(scout === undefined ? {} : { id: scout.id }),
      name,
      watching,
      // A Scout has Tags or a Query: the one not in use is sent empty, and
      // an empty list is how an existing Tag Scout is switched back to a Query.
      query: byTags ? "" : query,
      ...(byTags ? { tags } : scout?.tags === undefined ? {} : { tags: [] }),
      // An allowlist is sent when there is one, and when emptying a saved
      // one: the core leaves a key alone it is not told about.
      ...(openalex && (venues.length > 0 || scout?.venues !== undefined)
        ? { venues }
        : {}),
      cadence,
      assigned,
      lane,
      // A page has no date window: its first run proposes all it lists.
      searchBackTo:
        scout === undefined && !page && back !== ""
          ? new Date(`${back}T00:00:00Z`).toISOString()
          : null,
      // Only what was touched: the core leaves a key alone it is not told
      // about, and an emptied field (null) takes its key away.
      ...(cap === opening.cap ? {} : { cap: cap.trim() === "" ? null : cap }),
      ...(reviewDays === opening.reviewDays
        ? {}
        : { reviewDays: reviewDays.trim() === "" ? null : reviewDays }),
      ...(skimDays === opening.skimDays
        ? {}
        : { skimDays: skimDays.trim() === "" ? null : skimDays }),
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

  const attempt = byTags ? triedTags : tried;
  const result = attempt.data;
  const pageResult = triedPage.data;
  const tryable = byTags ? tags.length > 0 : query.trim() !== "";
  const where = openalex
    ? "journals and conferences in OpenAlex"
    : "all of arXiv";
  // What *try* is told of the allowlist, so it counts what a run would.
  const asked = openalex && venues.length > 0 ? { venues } : {};
  const needed = byTags ? "a Tag" : page ? "an Address" : "a Query";
  return (
    <form
      className={styles.form}
      aria-label={scout === undefined ? "New Scout" : `Edit ${scout.name}`}
      onSubmit={submit}
    >
      <FormSection title="What it watches">
        <FieldRow label="Name">
          {(field) => (
            <Input
              {...field}
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </FieldRow>
        <FieldRow
          label="Watching"
          // What a Scout watches is fixed when it is made: an edit that
          // changed it would turn one Scout's history into another's.
          note={
            scout === undefined
              ? openalex
                ? OPENALEX_NOTE
                : undefined
              : `A Scout keeps its kind of source. To watch ${page ? "arXiv" : openalex ? "another source" : "a page"} instead, make a new Scout.`
          }
        >
          {(field) => (
            <Select
              {...field}
              value={watching}
              disabled={scout !== undefined}
              onChange={(e) => {
                setWatching(e.target.value as FormValues["watching"]);
                tried.reset();
                triedTags.reset();
                triedPage.reset();
              }}
            >
              <option value="arxiv">arXiv</option>
              <option value="openalex">OpenAlex</option>
              <option value="watched">a web page</option>
            </Select>
          )}
        </FieldRow>
        {!page && (
          <SegmentedRow
            label="Filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "query", label: "by Query" },
              { value: "tags", label: "by Tags" },
            ]}
          />
        )}
        {byTags && (
          <TagsFilter
            chosen={tags}
            source={openalex ? "openalex" : "arxiv"}
            onChange={(next) => {
              setTags(next);
              // What was tried was the old list.
              triedTags.reset();
            }}
          />
        )}
        {!page && !byTags && (
          <FieldRow label="Query">
            {(field) => (
              <TextArea
                {...field}
                value={query}
                rows={2}
                onChange={(e) => {
                  setQuery(e.target.value);
                  // What was tried was the old text.
                  tried.reset();
                }}
              />
            )}
          </FieldRow>
        )}
        {page && (
          <FieldRow
            label="Address"
            note={
              scout === undefined
                ? undefined
                : "Changing the page points this Scout at another one: the next check reads it as a first look, and everything it lists arrives as Retroactive. Its Proposals, stubs and Accept rate go on."
            }
          >
            {(field) => (
              <Input
                {...field}
                type="url"
                value={query}
                placeholder="https://"
                onChange={(e) => {
                  setQuery(e.target.value);
                  triedPage.reset();
                }}
              />
            )}
          </FieldRow>
        )}
        <ActionRow>
          <Button
            disabled={
              !tryable || (page ? triedPage.isPending : attempt.isPending)
            }
            onClick={() =>
              page
                ? triedPage.mutate({ address: query })
                : byTags
                  ? triedTags.mutate({
                      tags,
                      watching: openalex ? "openalex" : "arxiv",
                      ...asked,
                    })
                  : tried.mutate({
                      query,
                      watching: openalex ? "openalex" : "arxiv",
                      ...asked,
                    })
            }
          >
            Try
          </Button>
          {!tryable && <Unlocks>Try needs {needed}.</Unlocks>}
          {!page && (
            <>
              {attempt.isPending && <span>trying…</span>}
              {attempt.isError && (
                <span role="alert">{attempt.error.message}</span>
              )}
              {result?.outcome === "failed" && (
                <span role="alert">{result.sentence}</span>
              )}
              {result?.outcome === "found" && result.total === 0 && (
                <span role="status">
                  0 results across {where} for this query
                </span>
              )}
              {result?.outcome === "found" && result.total > 0 && (
                <span role="status">
                  {result.total} results across {where}
                  {result.creditsLeft != null &&
                    ` · ${result.creditsLeft.toLocaleString("en-US")} credits left today`}
                  <ol aria-label="First results" className={styles.titles}>
                    {result.titles.map((title, i) => (
                      <li key={i}>{title}</li>
                    ))}
                  </ol>
                </span>
              )}
            </>
          )}
          {page && (
            <>
              {triedPage.isPending && <span>trying…</span>}
              {triedPage.isError && (
                <span role="alert">{triedPage.error.message}</span>
              )}
              {pageResult !== undefined && <PageResult result={pageResult} />}
            </>
          )}
        </ActionRow>
      </FormSection>
      {openalex && (
        <VenueAllowlist
          venues={venues}
          onChange={(next) => {
            setVenues(next);
            // What was tried was the old list.
            tried.reset();
            triedTags.reset();
          }}
        />
      )}
      <FormSection title="When">
        <FieldRow label="Cadence">
          {(field) => (
            <Select
              {...field}
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Scout["cadence"])}
            >
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
            </Select>
          )}
        </FieldRow>
        <FieldRow label="Starting lane">
          {(field) => (
            <Select
              {...field}
              value={lane}
              onChange={(e) => setLane(e.target.value as Scout["lane"])}
            >
              <option value="review">Review</option>
              <option value="skim">Skim</option>
            </Select>
          )}
        </FieldRow>
        {scout === undefined && !page && (
          <FieldRow label="Also search back to">
            {(field) => (
              <Input
                {...field}
                type="date"
                value={back}
                onChange={(e) => setBack(e.target.value)}
              />
            )}
          </FieldRow>
        )}
      </FormSection>
      <FormSection title="Queue behaviour">
        <AssignedQuestions
          questions={questions}
          assigned={assigned}
          onChange={setAssigned}
        />
        <FieldRow
          label="Cap"
          note="Empty means no Cap. A Cap is not active until this Scout has enough triage behind it to rank by; until then it keeps everything."
        >
          {(field) => (
            <Input
              {...field}
              inputMode="numeric"
              value={cap}
              placeholder="none"
              onChange={(e) => setCap(e.target.value)}
            />
          )}
        </FieldRow>
        <FieldRow
          label="Review days"
          note={`Empty keeps ${REVIEW_DAYS_DEFAULT} days.`}
        >
          {(field) => (
            <Input
              {...field}
              inputMode="numeric"
              value={reviewDays}
              placeholder={REVIEW_DAYS_DEFAULT}
              onChange={(e) => setReviewDays(e.target.value)}
            />
          )}
        </FieldRow>
        <FieldRow
          label="Skim days"
          note={`Empty keeps ${SKIM_DAYS_DEFAULT} days.`}
        >
          {(field) => (
            <Input
              {...field}
              inputMode="numeric"
              value={skimDays}
              placeholder={SKIM_DAYS_DEFAULT}
              onChange={(e) => setSkimDays(e.target.value)}
            />
          )}
        </FieldRow>
      </FormSection>
      <RefusalLine refusal={refusal} />
      <div className={styles.formActions}>
        <Button tier="primary" disabled={!ready || save.isPending}>
          Save
        </Button>
        <Button onClick={() => onDone(null)}>Cancel</Button>
        {/* Names what Save lacks; a disabled button alone says nothing. */}
        {!ready && <Unlocks>Save needs {missing.join(" and ")}.</Unlocks>}
        <span className={styles.escape}>
          <kbd>Esc</kbd> back to the stack
        </span>
      </div>
    </form>
  );
}

/** ADR 0051 decision 3: the card says *journal* or *conference*, so a work found only as a preprint is not here, and that must not be read as a gap in the search. */
const OPENALEX_NOTE =
  "OpenAlex searches journals and conferences only. A work that only exists as a preprint will not appear; an arXiv Scout is where to find those.";

/** What *try* learned about a page, in the words the Scout would use for it. */
function PageResult({ result }: { result: TriedPage }) {
  if (result.outcome === "failed") {
    return <span role="alert">{result.sentence}</span>;
  }
  if (result.outcome === "no-key") {
    return (
      <span role="alert">
        {result.sentence}{" "}
        {/* The form is kept by the window, so back returns to it as left. */}
        <Button onClick={() => pushRoute(SETTINGS)}>Add a key</Button>
      </span>
    );
  }
  return (
    <span role="status">
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
