import type { IngestSummary } from "core";
import { useSyncExternalStore } from "react";

/**
 * The last Ingest run's summary (spec #416 stories 14–17, 58): the footer
 * line that is the run's only notification. It is window state, not vault
 * state — the core says a run landed and never keeps the sentence — so it
 * lives outside the query cache, which every reconnect invalidates and would
 * refetch into nothing.
 *
 * Runs that land less than one fade apart are one burst and one line, their
 * counts added (`docs/architecture.md` § Annotation identity, *Ingest summary
 * line*). A line with nothing left to decide fades from the last landing; one
 * with something to decide arms no fade and stays until the vault is
 * switched or a later burst replaces it, because the panel it opens is where
 * that decision is made.
 *
 * A landing after the burst replaces the line even when that line still had
 * something to decide: the count is a run's and nothing subtracts a
 * resolution from it, so carrying it forward would sum stale counts. Loose
 * Ends, read from the sidecars, is the record of what is undecided.
 */
export const INGEST_FADE_MS = 8000;

let current: IngestSummary | null = null;
/** When the last landing was; the only thing that says whether a burst is on. */
let lastLanding: number | null = null;
let fade: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: IngestSummary | null) {
  current = next;
  for (const listen of listeners) listen();
}

/** A run landed: add it to the burst it falls in, or start a line of its own. */
export function announceIngest(summary: IngestSummary): void {
  const now = Date.now();
  const inBurst =
    current !== null &&
    lastLanding !== null &&
    now - lastLanding < INGEST_FADE_MS;
  const next: IngestSummary =
    inBurst && current !== null
      ? {
          new: current.new + summary.new,
          questions: current.questions + summary.questions,
          removed: current.removed + summary.removed,
          unmatched: current.unmatched + summary.unmatched,
        }
      : summary;
  lastLanding = now;
  clearTimeout(fade);
  set(next);
  if (next.unmatched === 0) fade = setTimeout(() => set(null), INGEST_FADE_MS);
}

/** Another vault is open; the last one's summary is not about it. */
export function clearIngest(): void {
  clearTimeout(fade);
  lastLanding = null;
  panel = false;
  set(null);
}

let panel = false;

function setPanel(next: boolean) {
  panel = next;
  for (const listen of listeners) listen();
}

/**
 * The Unmatched panel (story 58): opened from the footer summary and only
 * when it has something to decide, so a clean run has no panel to open.
 */
export function openUnmatchedPanel(): void {
  if (current !== null && current.unmatched > 0) setPanel(true);
}
export const closeUnmatchedPanel = (): void => setPanel(false);

export function useUnmatchedPanelOpen(): boolean {
  return useSyncExternalStore(
    (listen) => {
      listeners.add(listen);
      return () => void listeners.delete(listen);
    },
    () => panel
  );
}

export function useIngestSummary(): IngestSummary | null {
  return useSyncExternalStore(
    (listen) => {
      listeners.add(listen);
      return () => void listeners.delete(listen);
    },
    () => current
  );
}

export const ingestLine = (s: IngestSummary) =>
  `${s.new} new · ${s.questions} questions · ${s.removed} removed · ${s.unmatched} could not be re-matched`;
