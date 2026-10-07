import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type {
  AcceptRate,
  ActivityRow,
  Cost,
  FleetSource,
  Health,
  ReviewDepth,
  Scout,
  ScoutRunCost,
  Volume,
} from "core";
import { CadenceMenu } from "./CadenceMenu";
import { AcceptLine, percent } from "./charts/line";
import { useChosenInView } from "./chosen";
import { FirstSlot } from "./FirstSlot";
import { pushRoute, scoutStack } from "./router";
import styles from "./ScoutActivity.module.css";
import { NOTHING_PENDING, VoiceLine } from "./ScoutVoice";
import { useTRPC } from "./trpc";
import { useVaultStatusLines, WarningLine } from "./VaultStatusLines";

type Column =
  "scout" | "watching" | "cadence" | "last run" | "proposed" | "cost";
type Sort = { column: Column; descending: boolean };

/** Faster first: ascending reads *how often it looks*, which is not the alphabet. */
const CADENCE_RANK = { daily: 0, weekly: 1, monthly: 2 } as const;

/** The row header and its seven cells: what a row that spans the table, or the file that will not parse, must add up to. */
const COLUMNS = 8;

/** The set with `key` in it if it was not, and out of it if it was. */
function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

const scoutKey = (id: string) => `scout:${id}`;
const keyOf = (row: ActivityRow) =>
  row.kind === "scout" ? scoutKey(row.id) : `file:${row.file}`;

/**
 * What an act on a row did, said on the row it was about and left there: no
 * row disappears from under the cursor, and what happened is not a toast that
 * has gone by the time it is wanted (spec #511 story 58). A refusal is the
 * user's act turned down and so an alert; anything else is the app saying where
 * things now stand (ADR 0033 decision 1).
 */
type Said = { text: string; refused: boolean };

/**
 * A column's value for a row, or null where the row has none to give — a file
 * that will not parse has no cadence, and a Scout that never ran has no last
 * run. Null sorts last in both directions: *no value* is not a smallest one,
 * and putting it first on a descending sort would lead the table with what
 * says least.
 */
function valueOf(row: ActivityRow, column: Column): string | number | null {
  if (column === "scout") {
    return row.kind === "scout" ? row.name : row.file;
  }
  if (row.kind === "unreadable") return null;
  switch (column) {
    case "watching":
      return row.source.kind === "arxiv" ? row.source.query : row.source.url;
    case "cadence":
      return CADENCE_RANK[row.cadence];
    case "last run":
      return row.lastRun === null ? null : Date.parse(row.lastRun.finished);
    case "proposed":
      return row.volume.proposals;
    // *No model call* and *unpriced* have no figure to put in order.
    case "cost":
      return row.cost.kind === "cost" ? row.cost.perRun : null;
  }
}

/** The core's order (by need) until a header is clicked; then a stable sort on that column, so ties keep the order by need. */
function sorted(rows: ActivityRow[], sort: Sort | null): ActivityRow[] {
  if (sort === null) return rows;
  const direction = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = valueOf(a, sort.column);
    const y = valueOf(b, sort.column);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return (
      direction *
      (typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y)))
    );
  });
}

/**
 * The rows in the order the researcher was looking at when they acted, so a
 * Scout the act has just changed is not carried up or down the table by it: a
 * pause makes a Scout one that is not looking, which the core's sort by need
 * puts above those that are (spec #511 story 58). A row the order was not taken
 * of — a Scout made since — follows the rest, in the order it came.
 */
function inPlace(rows: ActivityRow[], held: readonly string[] | null) {
  if (held === null) return rows;
  const place = new Map(held.map((key, index) => [key, index]));
  return [...rows].sort(
    (a, b) =>
      (place.get(keyOf(a)) ?? held.length) -
      (place.get(keyOf(b)) ?? held.length)
  );
}

/**
 * Scout Activity (brief § Scout Activity, Prompt 10; ADR 0042): are the
 * Scouts earning their keep. One read, `scouts.activity`, says everything the
 * screen shows. A Scout's Voice, Warrant and fault sentence are the core's,
 * drawn as the Queue's rail draws them (ADR 0032 decision 7); this file words
 * only its own labels and the empty fleet.
 */
export function ScoutActivity({ onNewScout }: { onNewScout: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const activity = useQuery(trpc.scouts.activity.queryOptions());
  const status = useVaultStatusLines();
  // Parent-level, so a key on the chosen row can drive it as the row's button
  // does; the row is the one thing in the window that re-reads from it.
  const [said, setSaid] = useState<ReadonlyMap<string, Said>>(new Map());
  function say(key: string, note: Said) {
    setSaid((was) => new Map(was).set(key, note));
  }
  const changeCadence = useMutation(
    trpc.scouts.setCadence.mutationOptions({
      onSuccess: ({ dueAtNextCheck }, { scoutId, cadence }) => {
        // Said from the write's own answer, which asked the scheduler: a row
        // that said a run was coming would otherwise be guessing at it.
        say(scoutKey(scoutId), {
          refused: false,
          text: `Cadence is now ${cadence}.${dueAtNextCheck ? " It is due at the next check." : ""}`,
        });
        void queryClient.invalidateQueries(trpc.scouts.pathFilter());
      },
      onError: (error, { scoutId }) =>
        say(scoutKey(scoutId), { refused: true, text: error.message }),
    })
  );
  const pause = useMutation(
    trpc.scouts.setPaused.mutationOptions({
      onSuccess: (_done, { scoutId, paused }) => {
        say(scoutKey(scoutId), {
          refused: false,
          text: paused
            ? "Paused. It will not run until you resume it."
            : "Resumed. It runs again when it is due.",
        });
        void queryClient.invalidateQueries(trpc.scouts.pathFilter());
      },
      onError: (error, { scoutId }) =>
        say(scoutKey(scoutId), { refused: true, text: error.message }),
    })
  );
  const [sort, setSort] = useState<Sort | null>(null);
  // Held by the row's key and not its place, so a re-sort leaves the choice on
  // the Scout it was on.
  const [chosen, setChosen] = useState<string | null>(null);
  // Nothing starts open: *edit* and the line weigh the same on every row, so
  // no row is singled out by being expanded (ADR 0042 decision 8). Held by the
  // row's key, as the choice is, so a re-sort leaves a row open.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  // Which rows have their cadence menu open, held by key for the same reason.
  const [choosing, setChoosing] = useState<ReadonlySet<string>>(new Set());
  // Taken when a row is acted on and let go when a column is asked for, so the
  // table only ever re-sorts by need when the researcher arrives or asks.
  const [held, setHeld] = useState<readonly string[] | null>(null);
  const rows = inPlace(sorted(activity.data?.rows ?? [], sort), held);
  const chosenIndex = rows.findIndex((row) => keyOf(row) === chosen);
  const chosenId = chosenIndex === -1 ? undefined : rowId(chosenIndex);
  useChosenInView(chosenId);

  function hold() {
    setHeld(rows.map(keyOf));
  }

  function onSort(column: Column) {
    setHeld(null);
    setSort((was) =>
      was?.column === column
        ? { column, descending: !was.descending }
        : { column, descending: false }
    );
  }

  const headerProps = { sort, onSort };

  function toggle(key: string) {
    setOpened((was) => toggled(was, key));
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select")
    ) {
      return;
    }
    let next: number;
    if (event.key === "Enter") {
      // Only on the group itself: Enter on a button or link inside it is that
      // control's own.
      const row = rows[chosenIndex];
      if (target === event.currentTarget && row?.kind === "scout") {
        event.preventDefault();
        toggle(keyOf(row));
      }
      return;
    }
    if (event.key === "j" || event.key === "ArrowDown") {
      next = Math.min(chosenIndex + 1, rows.length - 1);
    } else if (event.key === "k" || event.key === "ArrowUp") {
      next = Math.max(chosenIndex - 1, 0);
    } else return;
    event.preventDefault();
    const row = rows[next];
    if (row !== undefined) setChosen(keyOf(row));
  }

  return (
    <section className={styles.page} aria-labelledby="scout-activity-title">
      <div className={styles.header}>
        <h1 id="scout-activity-title" className={styles.title}>
          Scout Activity
        </h1>
        {activity.data !== undefined && (
          <div className={styles.facts}>
            <SourceHealth fleet={activity.data.fleet} />
            {rows.length > 0 && <FleetReview review={activity.data.review} />}
          </div>
        )}
      </div>
      {rows.length === 0 && (
        <NoRows
          failed={activity.isError}
          answered={activity.data !== undefined}
          onNewScout={onNewScout}
        />
      )}
      {rows.length > 0 && (
        // A group, not a grid: the table keeps its own roles, and the group is
        // what holds the keyboard and names the row it is on (ADR 0030).
        <div
          className={styles.scroll}
          role="group"
          aria-label="Scout rows"
          aria-activedescendant={chosenId}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <table className={styles.table} aria-label="Scouts">
            <thead>
              <tr>
                <SortHeader column="scout" label="Scout" {...headerProps} />
                <SortHeader
                  column="watching"
                  label="Watching"
                  {...headerProps}
                />
                <SortHeader column="cadence" label="Cadence" {...headerProps} />
                <SortHeader
                  column="last run"
                  label="Last run"
                  {...headerProps}
                />
                <th scope="col">Accept rate</th>
                <SortHeader
                  column="proposed"
                  label="Proposed"
                  {...headerProps}
                />
                <SortHeader column="cost" label="Cost / run" {...headerProps} />
                <th scope="col">In Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Row
                  key={keyOf(row)}
                  row={row}
                  id={rowId(index)}
                  chosen={index === chosenIndex}
                  open={opened.has(keyOf(row))}
                  choosing={choosing.has(keyOf(row))}
                  said={said.get(keyOf(row))}
                  onToggle={() => toggle(keyOf(row))}
                  onChoose={() => setChosen(keyOf(row))}
                  onToggleCadence={() =>
                    setChoosing((was) => toggled(was, keyOf(row)))
                  }
                  onPickCadence={(cadence) => {
                    if (row.kind !== "scout") return;
                    setChoosing((was) => toggled(was, keyOf(row)));
                    // The cadence it has is no change, and a write that did
                    // nothing would only rewrite the file.
                    if (cadence === row.cadence) return;
                    hold();
                    changeCadence.mutate({ scoutId: row.id, cadence });
                  }}
                  onPause={() => {
                    if (row.kind === "scout") {
                      hold();
                      pause.mutate({ scoutId: row.id, paused: !row.paused });
                    }
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* The footer channel, as every Dashboard draws it: only when there is
          something to say, and polite — a state the app is in, not a refusal
          of something the user did (ADR 0033). The reason a read failed is
          said here and nowhere else. */}
      {(status.hasLines || activity.isError) && (
        <footer className={styles.footer}>
          {status.lines}
          {activity.isError && (
            <WarningLine label="not read">{activity.error.message}</WarningLine>
          )}
        </footer>
      )}
    </section>
  );
}

/** A column header that sorts, its direction said by `aria-sort` and a glyph and never by colour. */
function SortHeader({
  column,
  label,
  sort,
  onSort,
}: {
  column: Column;
  label: string;
  sort: Sort | null;
  onSort: (column: Column) => void;
}) {
  return (
    <th
      scope="col"
      aria-sort={
        sort?.column !== column
          ? undefined
          : sort.descending
            ? "descending"
            : "ascending"
      }
    >
      <button
        type="button"
        className={styles.sort}
        onClick={() => onSort(column)}
      >
        {label}
      </button>
    </th>
  );
}

// For aria-activedescendant: a position, unique in the document.
const rowId = (index: number) => `scout-activity-row-${index}`;

/**
 * *10 parsing cleanly · 1 not parsing · 1 no key*: faults counted, and a count
 * of none left unsaid (ADR 0042 decision 8). It is one line of facts in the
 * header's own type, with no colour, so a fleet of working Scouts that found
 * nothing is never a number to feel bad about.
 */
function SourceHealth({ fleet }: { fleet: FleetSource }) {
  const parts = [
    [fleet.parsingCleanly, "parsing cleanly"],
    [fleet.notParsing, "not parsing"],
    [fleet.notReached, "not reached"],
    [fleet.keyRejected, "key rejected"],
    [fleet.noKey, "no key"],
  ].flatMap(([count, words]) => (count === 0 ? [] : [`${count} ${words}`]));
  if (parts.length === 0) return null;
  return (
    <p className={styles.health} aria-label="Source health">
      {parts.join(" · ")}
    </p>
  );
}

/**
 * The first slot, where the rows would begin, in one of ADR 0032's three
 * Voices (ADR 0033 decision 3). A failed read is *wrong* and is asked first,
 * so it can never pass for a fleet with no Scouts in it; a read still on its
 * way has not looked yet; and a fleet with nothing in it is not yet a fleet,
 * and offers to be one.
 */
function NoRows({
  failed,
  answered,
  onNewScout,
}: {
  failed: boolean;
  answered: boolean;
  onNewScout: () => void;
}) {
  if (failed) return <FirstSlot voice="wrong" claim="" />;
  if (!answered) return <FirstSlot voice="not yet" claim="" />;
  return (
    <FirstSlot
      voice="not yet"
      claim=""
      fragment="no scouts yet"
      action={
        <button type="button" className={styles.action} onClick={onNewScout}>
          new scout
        </button>
      }
    />
  );
}

/** A rate says what it rests on; one that cannot be said says why, and nothing judged is not 0% (ADR 0042 decisions 2 and 3). */
function rateWords(rate: AcceptRate): string {
  switch (rate.kind) {
    case "rate":
      return `${percent(rate.rate)} · ${rate.triaged} triaged`;
    case "nothing triaged":
      return "nothing triaged yet";
    case "unavailable":
      return rate.reason;
  }
}

/**
 * One line of facts, each kept whole: a line wraps only between facts, never
 * inside *median 3 days ago*, and the separator trails the fact before it so a
 * wrap can never leave a dot on a line of its own.
 */
function Facts({ facts }: { facts: string[] }) {
  return (
    <>
      {facts.map((fact, index) => (
        <Fragment key={fact}>
          {index > 0 && " "}
          <span className={styles.fact}>
            {index < facts.length - 1 ? `${fact} ·` : fact}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * What waits in Review, as neutral facts in plain words (ADR 0042 decision
 * 7): the pending figure with its age, the median and the oldest. The ages
 * sit with the pending ones because they describe them — a deferred row has
 * no place in the stack — and nothing here carries a colour.
 */
const pendingFacts = (depth: ReviewDepth): string[] =>
  depth.median === null || depth.oldest === null
    ? []
    : [
        `${depth.pending} pending`,
        `median ${depth.median.ago}`,
        `oldest ${depth.oldest.ago}`,
      ];

const deferredFact = (depth: ReviewDepth): string[] =>
  depth.deferred === 0 ? [] : [`${depth.deferred} deferred`];

/**
 * A Scout's stack, and the link that opens it in the Queue: the figure and the
 * stack it counts are one hop apart, so they share a cell. Deferred is counted
 * apart, after the pending figure and its ages, and is said whatever else is.
 * With nothing pending the Scout speaks in its Voice as the Queue's empty state
 * does (ADR 0032): a clean run claims *nothing pending*; a Scout that has not
 * looked or whose check failed says nothing of the stack, because the Voice
 * beside its name is already saying why, and a bare 0 under a broken Scout
 * would read as a quiet field.
 */
function ReviewCell({
  depth,
  health,
  children,
}: {
  depth: ReviewDepth;
  health: Health;
  children: ReactNode;
}) {
  const parts = [
    ...(depth.pending > 0
      ? pendingFacts(depth)
      : health.voice === "claim"
        ? [NOTHING_PENDING]
        : []),
    ...deferredFact(depth),
  ];
  return (
    <td className={styles.wraps}>
      {parts.length > 0 && <Parts of={parts} />}
      <span className={styles.toQueue}>{children}</span>
    </td>
  );
}

/**
 * The fleet's stack, each Proposal counted once, and Skim named for what it
 * is: a feed, which has no depth to count. A fleet with nothing pending says
 * so in words; it makes no claim that the field is quiet, which only a
 * warranted Voice may (ADR 0032 decision 8), so a fleet with a broken Scout is
 * never reassured by a header.
 */
function FleetReview({ review }: { review: ReviewDepth }) {
  const [first = "none pending", ...ages] = pendingFacts(review);
  return (
    <p className={styles.health} aria-label="Review depth">
      <Facts
        facts={[
          `Review: ${first}`,
          ...ages,
          ...deferredFact(review),
          "Skim is a feed and has no depth",
        ]}
      />
    </p>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const thousands = (n: number) => n.toLocaleString("en-US");

/** A figure of several parts, one to a line: a narrow column stacks them, and none is ever printed over its neighbour. */
function Parts({ of }: { of: string[] }) {
  return (
    <ul className={styles.parts}>
      {of.map((part) => (
        <li key={part}>{part}</li>
      ))}
    </ul>
  );
}

/** What a Scout found over the thirty days, then a part for each thing worth knowing about it and none for a count of nothing (ADR 0042 decision 10). */
const volumeParts = (volume: Volume): string[] => [
  `${volume.proposals} / 30d`,
  ...(volume.held > 0 ? [`${volume.held} already in your vault`] : []),
  ...(volume.alsoFoundElsewhere > 0
    ? [`${volume.alsoFoundElsewhere} also found elsewhere`]
    : []),
];

/** Cents to the cent, and a smaller sum to the figure that shows it: a $0.0054 run is not `$0.01`. */
const dollars = (usd: number) => `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;

/**
 * *no model call* is not `$0.00`: a read that costs nothing and a spend of
 * nothing are different claims. A model the price table does not know is
 * *unpriced*, never a guess, and the runs a mean rests on are named as a
 * rate's items are (ADR 0042 decision 6).
 */
function costParts(cost: Cost): string[] {
  switch (cost.kind) {
    case "no model call":
      return ["no model call"];
    case "unpriced":
      return ["unpriced", plural(cost.runs, "run")];
    case "cost":
      return [
        dollars(cost.perRun),
        plural(cost.runs, "run"),
        ...(cost.unpriced > 0 ? [`${cost.unpriced} unpriced`] : []),
      ];
  }
}

/** What one run spent, after when it was: its model, its tokens and, where the model is priced, what that cost. */
const runParts = (run: ScoutRunCost): string[] => [
  ...(run.model === null ? [] : [run.model]),
  `${thousands(run.tokens.input)} in`,
  `${thousands(run.tokens.output)} out`,
  ...(run.tokens.cacheRead > 0
    ? [`${thousands(run.tokens.cacheRead)} cached`]
    : []),
  run.costUsd === null ? "unpriced" : dollars(run.costUsd),
];

/** The runs the row's *cost / run* is the mean of, newest first as the core orders them; read only once the row is opened. */
function Runs({ scoutId, name }: { scoutId: string; name: string }) {
  const trpc = useTRPC();
  const runs = useQuery(trpc.scouts.runCosts.queryOptions({ scoutId }));
  if (runs.isError) {
    return <WarningLine label="not read">{runs.error.message}</WarningLine>;
  }
  if (runs.data === undefined) return null;
  if (runs.data.length === 0) {
    return (
      <p className={styles.runs}>
        No run in the last thirty days called a model.
      </p>
    );
  }
  return (
    <ul className={styles.runs} aria-label={`${name} runs`}>
      {runs.data.map((run) => (
        <li key={run.runId}>
          <time dateTime={run.finished}>{run.ago}</time>
          {` · ${runParts(run).join(" · ")}`}
        </li>
      ))}
    </ul>
  );
}

function Row({
  row,
  id,
  chosen,
  open,
  choosing,
  said,
  onToggle,
  onChoose,
  onToggleCadence,
  onPickCadence,
  onPause,
}: {
  row: ActivityRow;
  id: string;
  chosen: boolean;
  open: boolean;
  choosing: boolean;
  said: Said | undefined;
  onToggle: () => void;
  onChoose: () => void;
  onToggleCadence: () => void;
  onPickCadence: (cadence: Scout["cadence"]) => void;
  onPause: () => void;
}) {
  const [showRuns, setShowRuns] = useState(false);
  if (row.kind === "unreadable") {
    // Nothing is known of a file that will not parse but its name and why, so
    // the columns that would say more are left empty rather than guessed at.
    return (
      <tr id={id} data-chosen={chosen || undefined} onClick={onChoose}>
        <th scope="row">
          <span className={styles.who}>
            <span className={styles.file}>{row.file}</span>
            <VoiceLine health={row.health} />
          </span>
        </th>
        <td colSpan={COLUMNS - 1} />
      </tr>
    );
  }
  const watching =
    row.source.kind === "arxiv"
      ? `arXiv · ${row.source.query}`
      : row.source.url;
  const detail = `${id}-detail`;
  const rate = rateWords(row.acceptRate);
  // A click anywhere on the row opens it, as prototype 10's does. The rate's
  // own button is the control a keyboard or a screen reader reaches, so it
  // toggles on its own click and the row leaves it alone. (The *queue* link
  // needs no exception: it leaves the page.)
  function onRowClick(event: MouseEvent) {
    onChoose();
    if (!(event.target instanceof Element && event.target.closest("button"))) {
      onToggle();
    }
  }
  return (
    <>
      {/* No class carries how the Scout is doing: the Voice beside the name is
          the whole of it, and a tint would be a threshold the app has no way
          to defend (ADR 0042 decision 8). */}
      <tr id={id} data-chosen={chosen || undefined} onClick={onRowClick}>
        <th scope="row">
          <span className={styles.who}>
            <span className={styles.name}>{row.name}</span>
            {/* The Queue's own component on the core's own derivation, so a
              Scout's Voice and Warrant are never worded here (ADR 0032
              decision 7). */}
            <VoiceLine health={row.health} />
            {/* The same buttons on every row, so *edit* weighs no more on the
                row that is doing worst than on the one that is doing best
                (ADR 0042 decision 8). */}
            <span className={styles.actions}>
              <button
                type="button"
                className={styles.act}
                aria-label={`${row.name}: ${row.paused ? "resume" : "pause"}`}
                onClick={onPause}
              >
                {row.paused ? "resume" : "pause"}
              </button>
            </span>
          </span>
        </th>
        {/* The column cuts a long Query to one line; the cut is only to the
          eye, and the whole of it is here for whoever hovers. */}
        <td className={styles.watching} title={watching}>
          {watching}
        </td>
        <td>
          <button
            type="button"
            className={styles.open}
            aria-haspopup="menu"
            aria-expanded={choosing}
            aria-label={`${row.name}: cadence, ${row.cadence}`}
            onClick={onToggleCadence}
          >
            {row.cadence}
          </button>
        </td>
        <td>
          {row.lastRun === null ? (
            "not yet"
          ) : (
            <time dateTime={row.lastRun.finished}>{row.lastRun.ago}</time>
          )}
        </td>
        <td className={styles.wraps}>
          <button
            type="button"
            className={styles.open}
            aria-expanded={open}
            aria-controls={open ? detail : undefined}
            aria-label={`${row.name}: accept rate, ${rate}`}
            onClick={onToggle}
          >
            {rate}
          </button>
        </td>
        <td className={styles.wraps}>
          <Parts of={volumeParts(row.volume)} />
        </td>
        <td className={styles.wraps}>
          <Parts of={costParts(row.cost)} />
          {/* A Scout that never called a model has no runs to list: the figure
              already says so. */}
          {row.cost.kind !== "no model call" && (
            <button
              type="button"
              className={styles.link}
              aria-expanded={showRuns}
              aria-label={`${row.name}: each run`}
              onClick={() => setShowRuns((was) => !was)}
            >
              each run
            </button>
          )}
        </td>
        <ReviewCell depth={row.review} health={row.health}>
          <a
            href={`#/scouts?scout=${encodeURIComponent(row.id)}`}
            className={styles.link}
            aria-label={`${row.name}: open its stack in the Queue`}
            onClick={(event) => {
              event.preventDefault();
              pushRoute(scoutStack(row.id));
            }}
          >
            queue
          </a>
        </ReviewCell>
      </tr>
      {said !== undefined && (
        <tr>
          <td className={styles.note} colSpan={COLUMNS}>
            <p role={said.refused ? "alert" : "status"}>{said.text}</p>
          </td>
        </tr>
      )}
      {choosing && (
        <tr>
          <td className={styles.detail} colSpan={COLUMNS}>
            <CadenceMenu
              name={row.name}
              cadence={row.cadence}
              dueUnder={row.dueUnder}
              onPick={onPickCadence}
            />
          </td>
        </tr>
      )}
      {open && (
        <tr id={detail}>
          <td className={styles.detail} colSpan={COLUMNS}>
            <AcceptLine rate={row.acceptRate} />
          </td>
        </tr>
      )}
      {showRuns && row.cost.kind !== "no model call" && (
        <tr>
          <td className={styles.detail} colSpan={COLUMNS}>
            <Runs scoutId={row.id} name={row.name} />
          </td>
        </tr>
      )}
    </>
  );
}
