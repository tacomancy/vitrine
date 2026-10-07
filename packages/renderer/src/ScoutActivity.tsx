import { useQuery } from "@tanstack/react-query";
import { Fragment, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { AcceptRate, ActivityRow, FleetSource } from "core";
import { AcceptLine, percent } from "./charts/line";
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
  // Nothing starts open: *edit* and the line weigh the same on every row, so
  // no row is singled out by being expanded (ADR 0042 decision 8). Held by the
  // row's key, as the choice is, so a re-sort leaves a row open.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
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

  function toggle(key: string) {
    setOpened((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
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
                  open={opened.has(keyOf(row))}
                  onToggle={() => toggle(keyOf(row))}
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
      return `${percent(rate.rate)} · ${rate.triaged} triaged`;
    case "nothing triaged":
      return "nothing triaged yet";
    case "unavailable":
      return rate.reason;
  }
}

function Row({
  row,
  id,
  chosen,
  open,
  onToggle,
  onChoose,
}: {
  row: ActivityRow;
  id: string;
  chosen: boolean;
  open: boolean;
  onToggle: () => void;
  onChoose: () => void;
}) {
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
        <td colSpan={5} />
      </tr>
    );
  }
  const watching =
    row.source.kind === "arxiv"
      ? `arXiv · ${row.source.query}`
      : row.source.url;
  const detail = `${id}-detail`;
  // A click anywhere on the row opens it, as prototype 10's does. The link and
  // the rate's own button act for themselves; the button is the one a keyboard
  // or a screen reader reaches, so it toggles on its own click.
  function onRowClick(event: MouseEvent) {
    onChoose();
    if (!(
      event.target instanceof Element && event.target.closest("a, button")
    )) {
      onToggle();
    }
  }
  return (
    <Fragment>
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
        <td>
          <button
            type="button"
            className={styles.open}
            aria-expanded={open}
            aria-controls={open ? detail : undefined}
            aria-label={`${row.name}: accept rate, ${rateWords(row.acceptRate)}`}
            onClick={onToggle}
          >
            {rateWords(row.acceptRate)}
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
      {open && (
        <tr id={detail} className={styles.detail}>
          <td colSpan={6}>
            <AcceptLine rate={row.acceptRate} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}
