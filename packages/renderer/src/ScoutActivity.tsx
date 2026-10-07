import { useQuery } from "@tanstack/react-query";
import { Fragment, useState, type KeyboardEvent } from "react";
import type {
  AcceptRate,
  ActivityRow,
  Cost,
  FleetSource,
  ScoutRunCost,
  Volume,
} from "core";
import { useChosenInView } from "./chosen";
import { FirstSlot } from "./FirstSlot";
import { pushRoute, scoutStack } from "./router";
import styles from "./ScoutActivity.module.css";
import { VoiceLine } from "./ScoutVoice";
import { useTRPC } from "./trpc";
import { useVaultStatusLines, WarningLine } from "./VaultStatusLines";

type Column = "scout" | "watching" | "cadence" | "last run";
type Sort = { column: Column; descending: boolean };

/** Faster first: ascending reads *how often it looks*, which is not the alphabet. */
const CADENCE_RANK = { daily: 0, weekly: 1, monthly: 2 } as const;

const keyOf = (row: ActivityRow) =>
  row.kind === "scout" ? `scout:${row.id}` : `file:${row.file}`;

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
 * Scout Activity (brief § Scout Activity, Prompt 10; ADR 0042): are the
 * Scouts earning their keep. One read, `scouts.activity`, says everything the
 * screen shows. A Scout's Voice, Warrant and fault sentence are the core's,
 * drawn as the Queue's rail draws them (ADR 0032 decision 7); this file words
 * only its own labels and the empty fleet.
 */
export function ScoutActivity({ onNewScout }: { onNewScout: () => void }) {
  const trpc = useTRPC();
  const activity = useQuery(trpc.scouts.activity.queryOptions());
  const status = useVaultStatusLines();
  const [sort, setSort] = useState<Sort | null>(null);
  // Held by the row's key and not its place, so a re-sort leaves the choice on
  // the Scout it was on.
  const [chosen, setChosen] = useState<string | null>(null);
  const rows = sorted(activity.data?.rows ?? [], sort);
  const chosenIndex = rows.findIndex((row) => keyOf(row) === chosen);
  const chosenId = chosenIndex === -1 ? undefined : rowId(chosenIndex);
  useChosenInView(chosenId);

  function onSort(column: Column) {
    setSort((was) =>
      was?.column === column
        ? { column, descending: !was.descending }
        : { column, descending: false }
    );
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
          <SourceHealth fleet={activity.data.fleet} />
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
                {(
                  [
                    ["scout", "Scout"],
                    ["watching", "Watching"],
                    ["cadence", "Cadence"],
                    ["last run", "Last run"],
                  ] as const
                ).map(([column, label]) => (
                  <th
                    key={column}
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
                ))}
                <th scope="col">Accept rate</th>
                <th scope="col">Found, 30 days</th>
                <th scope="col">Cost / run</th>
                <th scope="col">
                  <span className={styles.srOnly}>Runs</span>
                </th>
                <th scope="col">
                  <span className={styles.srOnly}>Queue</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Row
                  key={keyOf(row)}
                  row={row}
                  id={rowId(index)}
                  chosen={index === chosenIndex}
                  onChoose={() => setChosen(keyOf(row))}
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
      return `${Math.round(rate.rate * 100)}% · ${rate.triaged} triaged`;
    case "nothing triaged":
      return "nothing triaged yet";
    case "unavailable":
      return rate.reason;
  }
}

/** *5 new · 2 already in your vault · 1 also found elsewhere*: a part with nothing to say is left unsaid, and the count of new is always there (ADR 0042 decision 10). */
function volumeWords(volume: Volume): string {
  return [
    `${volume.proposals} new`,
    ...(volume.held > 0 ? [`${volume.held} already in your vault`] : []),
    ...(volume.alsoFoundElsewhere > 0
      ? [`${volume.alsoFoundElsewhere} also found elsewhere`]
      : []),
  ].join(" · ");
}

/** Cents to the cent, and a smaller sum to the figure that shows it: a $0.0054 run is not `$0.01`. */
const dollars = (usd: number) => `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;

/**
 * *no model call* is not `$0.00`: a read that costs nothing and a read that
 * cost nothing *measured* are different claims. A figure the price table
 * could not make says *unpriced*, and never a guess (ADR 0042 decision 6).
 */
function costWords(cost: Cost): string {
  if (cost.kind === "no model call") return "no model call";
  if (cost.perRun === null) return "unpriced";
  return `${dollars(cost.perRun)} / run${
    cost.unpriced > 0 ? ` · ${cost.unpriced} unpriced` : ""
  }`;
}

const tokensWords = (tokens: NonNullable<ScoutRunCost["tokens"]>) =>
  `${tokens.input.toLocaleString("en-US")} in · ${tokens.output.toLocaleString("en-US")} out`;

function runWords(run: ScoutRunCost): string {
  if (run.tokens === null) return "no model call";
  return `${tokensWords(run.tokens)} · ${run.costUsd === null ? "unpriced" : dollars(run.costUsd)}`;
}

/** Each run of a Scout, newest first as the core orders them; read only once the row is opened. */
function Runs({ scoutId, name }: { scoutId: string; name: string }) {
  const trpc = useTRPC();
  const runs = useQuery(trpc.scouts.runCosts.queryOptions({ scoutId }));
  if (runs.isError) return <p>{runs.error.message}</p>;
  if (runs.data === undefined) return null;
  if (runs.data.length === 0) return <p>No runs yet.</p>;
  return (
    <ul className={styles.runs} aria-label={`${name} runs`}>
      {runs.data.map((run) => (
        <li key={run.runId}>
          <time dateTime={run.finished}>
            {new Date(run.finished).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>{" "}
          · {runWords(run)}
        </li>
      ))}
    </ul>
  );
}

function Row({
  row,
  id,
  chosen,
  onChoose,
}: {
  row: ActivityRow;
  id: string;
  chosen: boolean;
  onChoose: () => void;
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
        <td colSpan={8} />
      </tr>
    );
  }
  const watching =
    row.source.kind === "arxiv"
      ? `arXiv · ${row.source.query}`
      : row.source.url;
  return (
    // No class carries how the Scout is doing: the Voice beside the name is
    // the whole of it, and a tint would be a threshold the app has no way to
    // defend (ADR 0042 decision 8).
    <Fragment>
      <tr id={id} data-chosen={chosen || undefined} onClick={onChoose}>
        <th scope="row">
          <span className={styles.who}>
            <span className={styles.name}>{row.name}</span>
            {/* The Queue's own component on the core's own derivation, so a
              Scout's Voice and Warrant are never worded here (ADR 0032
              decision 7). */}
            <VoiceLine health={row.health} />
          </span>
        </th>
        {/* The column cuts a long Query to one line; the cut is only to the
          eye, and the whole of it is here for whoever hovers. */}
        <td className={styles.watching} title={watching}>
          {watching}
        </td>
        <td>{row.cadence}</td>
        <td>
          {row.lastRun === null ? (
            "not yet"
          ) : (
            <time dateTime={row.lastRun.finished}>{row.lastRun.ago}</time>
          )}
        </td>
        <td>{rateWords(row.acceptRate)}</td>
        <td>{volumeWords(row.volume)}</td>
        <td>{costWords(row.cost)}</td>
        <td>
          <button
            type="button"
            className={styles.link}
            aria-expanded={showRuns}
            aria-label={`${row.name}: ${showRuns ? "hide" : "show"} runs`}
            onClick={() => setShowRuns((was) => !was)}
          >
            runs
          </button>
        </td>
        <td>
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
        </td>
      </tr>
      {showRuns && (
        <tr>
          <td colSpan={9}>
            <Runs scoutId={row.id} name={row.name} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}
