import type { RunSummary } from "core";

/**
 * What a run did, in one phrase: the Queue's *Run now* and a Scout Activity
 * row's save of an edited Query both say it, so one run is never worded two
 * ways. A failed run names its kind only; why it failed is the Scout's Voice,
 * which the core words and no surface rewords (ADR 0032 decision 7).
 */
export function runWords(summary: RunSummary): string {
  return summary.outcome === "failed"
    ? `This run failed: ${summary.errorKind}.`
    : [
        `${summary.new} new`,
        ...(summary.held > 0 ? [`${summary.held} already in your vault`] : []),
        ...(summary.truncated > 0
          ? [`stopped at 500 — ${summary.truncated} more matched`]
          : []),
      ].join(" · ");
}
