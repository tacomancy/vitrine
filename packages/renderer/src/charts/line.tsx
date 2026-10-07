import type { AcceptRate, AcceptWeek } from "core";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import styles from "./line.module.css";

/**
 * A Scout's accept rate, one point per week (ADR 0042 decision 2). The core
 * decides what is a point — a week under the floor arrives with `rate: null` —
 * and sends the weeks only inside a rate it can say, so this draws exactly
 * what it is handed and withholds nothing of its own, as the matrix does. A
 * gap is the line breaking and a point missing, never a zero. Colour is a class
 * name the CSS Module binds to a token (#141).
 */

const WIDTH = 480;
const HEIGHT = 96;
const PAD = { top: 6, right: 8, bottom: 6, left: 8 };
const GRID = [1, 0.5, 0];

/** *16 Sep*, as the Queue's rail words a date. */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export const percent = (rate: number) => `${Math.round(rate * 100)}%`;

export function AcceptLine({ rate }: { rate: AcceptRate }) {
  if (rate.kind !== "rate") {
    return (
      <p className={styles.why}>
        {rate.kind === "unavailable" ? rate.reason : "Nothing triaged yet."}
      </p>
    );
  }
  const { weeks } = rate;
  if (weeks.every((w) => w.rate === null)) {
    return (
      <p className={styles.why}>
        {`No week has ${rate.weekFloor} or more triaged items yet, so there is no line.`}
      </p>
    );
  }
  // A week is a slot of equal width with its point at the middle, so the left
  // edge is where the window begins and the right edge is now.
  const x = scaleLinear()
    .domain([0, weeks.length])
    .range([PAD.left, WIDTH - PAD.right]);
  const y = scaleLinear()
    .domain([0, 1])
    .range([HEIGHT - PAD.bottom, PAD.top]);
  // `defined` breaks the path at a gap, so one `d` carries every run.
  const path = line<AcceptWeek>()
    .defined((w) => w.rate !== null)
    .x((_, i) => x(i + 0.5))
    .y((w) => y(w.rate!));
  return (
    <figure className={styles.figure}>
      <div className={styles.plot}>
        <div className={styles.yAxis} aria-hidden="true">
          {GRID.map((v) => (
            <span
              key={v}
              className={styles.yLabel}
              style={{ top: `${(y(v) / HEIGHT) * 100}%` }}
            >
              {percent(v)}
            </span>
          ))}
        </div>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="group"
          aria-label="Accept rate by week"
        >
          {GRID.map((v) => (
            <line
              key={v}
              className={styles.grid}
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(v)}
              y2={y(v)}
            />
          ))}
          <path data-line className={styles.line} d={path(weeks) ?? ""} />
          {weeks.map((w, i) => {
            if (w.rate === null) return null;
            const words = `week of ${shortDate(w.start)}: ${percent(w.rate)} of ${w.triaged} triaged`;
            return (
              <g key={w.start} role="img" aria-label={words}>
                <title>{words}</title>
                {/* A wider target than the dot, so the hover that carries the
                    point's n is easy to land. */}
                <circle
                  className={styles.hit}
                  cx={x(i + 0.5)}
                  cy={y(w.rate)}
                  r={10}
                />
                <circle
                  className={styles.point}
                  cx={x(i + 0.5)}
                  cy={y(w.rate)}
                  r={3.5}
                />
              </g>
            );
          })}
        </svg>
        <div className={styles.xAxis} aria-hidden="true">
          <span>{weeks.length} weeks ago</span>
          <span>now</span>
        </div>
      </div>
      <figcaption className={styles.headline}>
        {`${percent(rate.rate)} over ${weeks.length} weeks · ${rate.triaged} triaged`}
      </figcaption>
    </figure>
  );
}
