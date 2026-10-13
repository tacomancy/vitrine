import type { Health } from "core";
import styles from "./ScoutQueue.module.css";

/**
 * A Scout's Voice where it is short on the rail row and in the header (ADR
 * 0032): rendered from the core's derivation and never worded here. *Wrong*
 * carries the warning glyph and its sentence, never red and never
 * dismissible; *not yet* is the same fragment without the glyph; a quiet
 * field's *claim* carries its Warrant in the slot provenance would sit in.
 * A Scout that found something says nothing, since a quiet field is the only
 * claim that owes evidence.
 */
export function VoiceLine({ health }: { health: Health | undefined }) {
  if (health === undefined) return null;
  if (health.voice === "wrong") {
    return (
      <span className={styles.voice} data-voice="wrong">
        <span role="img" aria-label="not working" className={styles.glyph}>
          ⚠
        </span>
        <span>{health.sentence}</span>
      </span>
    );
  }
  if (health.voice === "not yet") {
    return (
      <span className={styles.voice} data-voice="not yet">
        <span>{health.sentence}</span>
      </span>
    );
  }
  if (health.warrant === null) return null;
  return (
    <span className={styles.voice} data-voice="claim">
      <span>{health.warrant.fragments.join(" · ")}</span>
    </span>
  );
}

/**
 * An empty Review stack, said as a claim (ADR 0032): only a Scout whose last
 * run was clean may say it, and the Queue's empty state and Scout Activity's
 * row use these words so one Scout is never described in two sentences.
 */
export const NOTHING_PENDING = "Nothing pending.";

/**
 * A Scout the researcher dropped, said once for the Queue's header and Scout
 * Activity's dropped row so one Scout is never described in two sentences. It
 * is the *not yet* Voice: a fragment, no full stop, and the reason it is not
 * looking (ADR 0032 decision 3; ADR 0042 decision 1).
 */
export const DROPPED =
  "dropped — it no longer runs; what it found stays in Review";

/**
 * The last run's cost, on the header and nowhere else (ADR 0040 decision 6):
 * the visibility is the guard, so there is no cap and no running total. A
 * run that cost nothing draws nothing.
 */
export function CostLine({ usd }: { usd: number | null }) {
  if (usd === null) return null;
  return (
    <span className={styles.voice}>
      last run cost ${usd < 0.1 ? usd.toFixed(4) : usd.toFixed(2)}
    </span>
  );
}
