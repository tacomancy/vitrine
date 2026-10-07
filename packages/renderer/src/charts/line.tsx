import type { AcceptRate, AcceptWeek } from "core";
import { scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";
import styles from "./line.module.css";

/**
 * A Scout's accept rate, one point per week (ADR 0042 decision 2). The core
 * has already decided which weeks are points: a week under five triaged
 * items arrives with `rate: null` and is drawn as nothing, so the line breaks
 * there. It is never a zero, which would read as a verdict on a thin week.
 * Colour is a class name the CSS Module binds to a token (#141).
 */

const WIDTH = 480;
const HEIGHT = 96;
const PAD = { top: 8, right: 8, bottom: 8, left: 8 };

const week = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const percent = (rate: number) => `${Math.round(rate * 100)}%`;

/** Why there is no line, in the quiet voice the row's own cell uses. */
function whyNone(headline: AcceptRate): string {
  switch (headline.kind) {
    case "unavailable":
      return headline.reason;
    case "nothing triaged":
      return "Nothing triaged yet.";
    case "rate":
      return "No week has five triaged items yet, so there is no line.";
  }
}

export function AcceptLine({
  weeks,
  headline,
}: {
  weeks: AcceptWeek[];
  headline: AcceptRate;
}) {
  const drawn = weeks.filter((w) => w.rate !== null);
  // An unavailable rate draws no line even where weeks have points: the guard
  // says the items it rests on are missing fields, so the line would be too.
  if (drawn.length === 0 || headline.kind !== "rate") {
    return <p className={styles.why}>{whyNone(headline)}</p>;
  }
  const x = scaleTime()
    .domain([new Date(weeks[0]!.start), new Date(weeks.at(-1)!.start)])
    .range([PAD.left, WIDTH - PAD.right]);
  const y = scaleLinear()
    .domain([0, 1])
    .range([HEIGHT - PAD.bottom, PAD.top]);
  const path = line<AcceptWeek>()
    .defined((w) => w.rate !== null)
    .x((w) => x(new Date(w.start)))
    .y((w) => y(w.rate!));
  // One path per run of points, so a gap is a break the eye can see. The
  // single path `defined` would give is the same shape; segments keep it
  // checkable and let a lone point show as a point and not as nothing.
  const runs: AcceptWeek[][] = [];
  for (const w of weeks) {
    if (w.rate === null) runs.push([]);
    else if (runs.length === 0) runs.push([w]);
    else runs.at(-1)!.push(w);
  }
  return (
    <figure className={styles.figure}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label="Accept rate by week"
      >
        <line
          className={styles.base}
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(0)}
          y2={y(0)}
        />
        {runs
          .filter((run) => run.length > 1)
          .map((run) => (
            <path
              key={run[0]!.start}
              data-line
              className={styles.line}
              d={path(run) ?? ""}
            />
          ))}
        {drawn.map((w) => {
          const words = `week of ${week(w.start)}: ${percent(w.rate!)} of ${w.triaged} triaged`;
          return (
            <g key={w.start} role="img" aria-label={words}>
              <title>{words}</title>
              <circle
                className={styles.point}
                cx={x(new Date(w.start))}
                cy={y(w.rate!)}
                r={3.5}
              />
            </g>
          );
        })}
      </svg>
      <figcaption className={styles.headline}>
        {`${percent(headline.rate)} over 12 weeks · ${headline.triaged} triaged`}
      </figcaption>
    </figure>
  );
}
