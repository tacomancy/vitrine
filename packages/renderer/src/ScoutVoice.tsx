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
