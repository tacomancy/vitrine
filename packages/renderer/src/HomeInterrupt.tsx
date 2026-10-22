import { useState } from "react";
import { Button } from "./Form";
import type { ActivityRow, ScoutRow } from "core";
import styles from "./Home.module.css";
import { RefusalLine } from "./refusal-line";
import { scoutKey, useRowActs, type RowActs } from "./row-acts";
import { hashOf, SCOUTS } from "./router";

type Unreadable = Extract<ActivityRow, { kind: "unreadable" }>;

/**
 * The interrupt: the one place on Home that raises its voice, and still only
 * to a polite `status` (ADR 0033 decision 1) — a Scout being broken is a state
 * the researcher is in, not a refusal of something they just did. Each broken
 * Scout is named with the core's fault sentence verbatim (ADR 0032 decision
 * 7), so Home, Loose Ends and Scout Activity cannot describe one fault three
 * ways, and with what it last did, so the researcher can see how long it has
 * looked identical to a quiet field.
 *
 * *Broken* is the Voice `wrong` and nothing else: a paused Scout and one
 * waiting on a key speak `not yet`, so they are named in the claim above and
 * never here. The block is gone the moment nothing is `wrong`; a Scout just
 * paused from it stays as one line with its *undo*, because pausing is what
 * made it stop being true and the researcher is owed the way back.
 */
export function HomeInterrupt({ rows }: { rows: ActivityRow[] }) {
  const acts = useRowActs(
    // Nothing here is re-sorted under the cursor, so there is no order to hold.
    () => undefined
  );
  // The rows paused from here, as they were when broken: once paused they are
  // no longer `wrong`, so the next read would take away the line that carries
  // their *undo*.
  const [paused, setPaused] = useState<ReadonlyMap<string, ScoutRow>>(
    new Map()
  );

  const broken = rows.filter(
    (row): row is ScoutRow | Unreadable =>
      row.health.voice === "wrong" &&
      (row.kind === "scout" || row.kind === "unreadable")
  );
  const brokenScouts = broken.filter((r): r is ScoutRow => r.kind === "scout");
  const stillBroken = new Set(brokenScouts.map((r) => r.id));
  const undoable = [...paused.values()].filter((r) => !stillBroken.has(r.id));
  const files = broken.filter((r): r is Unreadable => r.kind === "unreadable");

  if (broken.length === 0 && undoable.length === 0) return null;

  const pause = (row: ScoutRow) => {
    setPaused((was) => new Map(was).set(row.id, row));
    acts.pauseOrResume(row);
  };
  const undo = (row: ScoutRow) => {
    setPaused((was) => {
      const next = new Map(was);
      next.delete(row.id);
      return next;
    });
    // The snapshot was taken before the pause, so it still says unpaused.
    acts.pauseOrResume({ ...row, paused: true });
  };

  return (
    <section
      className={styles.interrupt}
      role="status"
      aria-label="Scouts that are not working"
    >
      <ul className={styles.broken}>
        {brokenScouts.map((row) => (
          <li key={row.id} className={styles.brokenRow}>
            <span className={styles.brokenName}>{row.name}</span>
            <span className={styles.sentence}>
              {row.health.voice === "wrong" ? row.health.sentence : ""}
            </span>
            <span className={styles.facts}>
              {row.lastRun === null
                ? "has not checked yet"
                : `last checked ${row.lastRun.ago}`}{" "}
              · found {row.volume.proposals} in the last 30 days
            </span>
            <span className={styles.acts}>
              <Button
                aria-label={`${row.name}: run now`}
                onClick={() => acts.runNow(row)}
              >
                run now
              </Button>
              <Button
                aria-label={`${row.name}: pause`}
                onClick={() => pause(row)}
              >
                pause
              </Button>
            </span>
            <Said name={row.name} id={row.id} acts={acts} />
          </li>
        ))}
        {files.map((row) => (
          <li key={row.file} className={styles.brokenRow}>
            <span className={styles.brokenName}>{row.file}</span>
            <span className={styles.sentence}>
              {row.health.voice === "wrong" ? row.health.sentence : ""}
            </span>
            <span className={styles.acts}>
              <a
                className={styles.act}
                href={hashOf(SCOUTS)}
                aria-label={`${row.file}: open`}
              >
                open
              </a>
            </span>
          </li>
        ))}
        {undoable.map((row) => (
          <li key={row.id} className={styles.brokenRow}>
            <span className={styles.brokenName}>{row.name}</span>
            <Said name={row.name} id={row.id} acts={acts} />
            <span className={styles.acts}>
              <Button
                aria-label={`${row.name}: undo`}
                onClick={() => undo(row)}
              >
                undo
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.closing}>
        This is the only thing on Home that will interrupt you.
      </p>
    </section>
  );
}

/**
 * What an act on this Scout did. A refusal is the user's act turned down and
 * so an alert, through the one refusal module; the Scout is named in it
 * because the line is read apart from its row. What the core refused with has
 * no machine path in it (ADR 0028), so it is passed on as it came.
 */
function Said({ name, id, acts }: { name: string; id: string; acts: RowActs }) {
  const said = acts.said.get(scoutKey(id));
  if (said === undefined) return null;
  if (said.refused)
    return (
      <RefusalLine
        refusal={{ words: `${name}: ${said.text}`, count: said.count }}
        className={styles.said}
      />
    );
  return (
    <p key={said.count} className={styles.said}>
      {said.text}
    </p>
  );
}
