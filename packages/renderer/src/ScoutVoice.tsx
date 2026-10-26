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
        {needsYou(health) && (
          <span
            role="img"
            aria-label="waiting for a key"
            className={styles.glyph}
          >
            ◇
          </span>
        )}
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
 * Whether a Scout needs the researcher (ADR 0053 decision 3): it is *wrong*,
 * or it is waiting on a key it was never given. Nothing else qualifies — not
 * paused, not quiet, not *not yet*, and never a low Accept rate, which is not
 * a Health at all (ADR 0042 decision 8). The rail's marker (drawn by
 * `VoiceLine`) and the line above the list both read this, so a Scout is
 * never marked in one and unnamed in the other.
 */
export function needsYou(
  health: Health | undefined
): health is
  | Extract<Health, { voice: "wrong" }>
  | (Extract<Health, { voice: "not yet" }> & { kind: "credentials" }) {
  return (
    health !== undefined &&
    (health.voice === "wrong" ||
      (health.voice === "not yet" && health.kind === "credentials"))
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

/** A Scout's Voice when the read of its health failed: said in words, never as silence that looks like a quiet field. */
export const HEALTH_UNREAD = "health could not be read";

/** A run's spend, to the precision a small run needs to be seen at all. */
export const dollars = (usd: number) =>
  `$${usd < 0.1 ? usd.toFixed(4) : usd.toFixed(2)}`;
