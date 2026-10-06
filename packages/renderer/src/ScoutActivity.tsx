import { useQuery } from "@tanstack/react-query";
import type { ActivityRow } from "core";
import { FirstSlot } from "./FirstSlot";
import styles from "./ScoutActivity.module.css";
import { VoiceLine } from "./ScoutVoice";
import { useTRPC } from "./trpc";
import { useVaultStatusLines, WarningLine } from "./VaultStatusLines";

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
  const rows = activity.data?.rows ?? [];

  return (
    <section className={styles.page} aria-labelledby="scout-activity-title">
      <div className={styles.header}>
        <h1 id="scout-activity-title" className={styles.title}>
          Scout Activity
        </h1>
      </div>
      {rows.length === 0 && (
        <NoRows
          failed={activity.isError}
          answered={activity.data !== undefined}
          onNewScout={onNewScout}
        />
      )}
      {rows.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.table} aria-label="Scouts">
            <thead>
              <tr>
                <th scope="col">Scout</th>
                <th scope="col">Watching</th>
                <th scope="col">Cadence</th>
                <th scope="col">Last run</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row
                  key={
                    row.kind === "scout"
                      ? `scout:${row.id}`
                      : `file:${row.file}`
                  }
                  row={row}
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

function Row({ row }: { row: ActivityRow }) {
  if (row.kind === "unreadable") {
    // Nothing is known of a file that will not parse but its name and why, so
    // the columns that would say more are left empty rather than guessed at.
    return (
      <tr>
        <th scope="row">
          <span className={styles.who}>
            <span className={styles.file}>{row.file}</span>
            <VoiceLine health={row.health} />
          </span>
        </th>
        <td colSpan={3} />
      </tr>
    );
  }
  const watching =
    row.source.kind === "arxiv"
      ? `arXiv · ${row.source.query}`
      : row.source.url;
  return (
    <tr>
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
    </tr>
  );
}
