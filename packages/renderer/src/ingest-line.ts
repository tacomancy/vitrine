import type { IngestSummary } from "core";
import { useSyncExternalStore } from "react";

/**
 * The last Ingest run's summary (spec #416 stories 14–17, 58): the footer
 * line that is the run's only notification. It is window state, not vault
 * state — the core says a run landed and never keeps the sentence — so it
 * lives outside the query cache, which every reconnect invalidates and would
 * refetch into nothing.
 *
 * A clean run (nothing could not be re-matched) fades on its own, since a
 * line that stayed would teach the eye to skip the footer; one with
 * something left to decide stays until the vault is switched, because the
 * panel it will open from is where that decision is made.
 */
export const INGEST_FADE_MS = 8000;

let current: IngestSummary | null = null;
let fade: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: IngestSummary | null) {
  current = next;
  for (const listen of listeners) listen();
}

/** A run landed: show its line, and let it go if it left nothing to decide. */
export function announceIngest(summary: IngestSummary): void {
  clearTimeout(fade);
  set(summary);
  if (summary.unmatched === 0)
    fade = setTimeout(() => set(null), INGEST_FADE_MS);
}

/** Another vault is open; the last one's summary is not about it. */
export function clearIngest(): void {
  clearTimeout(fade);
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
