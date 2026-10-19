import type { AttentionTag, Crossing } from "core";
import { scaleLinear, scaleSqrt } from "d3-scale";
import { useId, useState, type KeyboardEvent } from "react";
import { useChosenInView } from "../chosen";
import styles from "./scatter.module.css";

/**
 * The attention scatter (brief § Panel 2; ADR 0045 decisions 6 and 8): each
 * measured Tag at its papers held across and the field's growth up. The core
 * has already judged which Tags are placed and where the medians fall; this
 * draws exactly that and adds no number of its own.
 *
 * Size is the paper count again, redundant with the x axis by design
 * (ADR 0018 decision 2), and so is the count printed on the point: position
 * and size are never the only channel (ADR 0041 decision 11). Hue lives in
 * the CSS Module, bound by class.
 */

export const growthOf = (growth: number) => {
  const percent = Math.round(growth * 100);
  return `${percent < 0 ? "−" : "+"}${Math.abs(percent)}%`;
};

const W = 640;
const H = 400;
const PAD = { top: 36, right: 24, bottom: 44, left: 56 };

/** Brief § Panel 2's table: coverage across, the field's attention up. */
const QUADRANTS = {
  blind: "Blind spot",
  crowded: "Crowded",
  ahead: "Ahead of the field, or a backwater",
  obscure: "Obscure",
} as const;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export function Scatter({
  tags,
  crossing,
  chosen,
  onChoose,
}: {
  /** Only the measured Tags; the panel keeps the rest in its unplaced list. */
  tags: AttentionTag[];
  crossing: Crossing | null;
  /** The Tag whose Lexicon is open. */
  chosen?: string | undefined;
  onChoose: (tag: string) => void;
}) {
  const prefix = useId();
  const [active, setActive] = useState<number | null>(null);
  // The order the keyboard walks: left to right by papers held, then up.
  const ordered = [...tags].sort(
    (a, b) =>
      a.papers - b.papers || a.growth! - b.growth! || (a.tag < b.tag ? -1 : 1)
  );
  const pointId = (i: number) => `${prefix}-point-${i}`;
  const activeId = active === null ? undefined : pointId(active);
  useChosenInView(activeId);

  // Never an empty grid: a vault with nothing placed shows the list alone.
  if (ordered.length === 0) return null;

  const maxPapers = Math.max(...ordered.map((t) => t.papers));
  const growths = ordered.map((t) => t.growth!);
  const x = scaleLinear()
    .domain([0, maxPapers])
    .range([PAD.left + 20, W - PAD.right - 20])
    .nice();
  const y = scaleLinear()
    .domain([Math.min(0, ...growths), Math.max(0, ...growths)])
    .range([H - PAD.bottom - 36, PAD.top + 36])
    .nice();
  const r = scaleSqrt().domain([0, maxPapers]).range([7, 20]);
  const labelOf = (t: AttentionTag) =>
    `${t.display}: ${plural(t.papers, "paper", "papers")}, growth ${growthOf(t.growth!)}`;

  const onKeyDown = (e: KeyboardEvent) => {
    const last = ordered.length - 1;
    const at = active ?? 0;
    const to: Record<string, number> = {
      ArrowRight: Math.min(at + 1, last),
      ArrowUp: Math.min(at + 1, last),
      ArrowLeft: Math.max(at - 1, 0),
      ArrowDown: Math.max(at - 1, 0),
      Home: 0,
      End: last,
    };
    if (e.key in to) {
      e.preventDefault();
      setActive(to[e.key]!);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setActive(at);
      onChoose(ordered[at]!.tag);
    }
  };

  const cx = crossing === null ? 0 : x(crossing.papers);
  const cy = crossing === null ? 0 : y(crossing.growth);

  return (
    <figure className={styles.figure}>
      <svg
        role="listbox"
        aria-label="Attention: growth of the field against papers held"
        aria-activedescendant={activeId}
        tabIndex={0}
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
        onFocus={() => setActive((was) => was ?? 0)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        <line
          className={styles.axis}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
        />
        <line
          className={styles.axis}
          x1={PAD.left}
          x2={PAD.left}
          y1={PAD.top}
          y2={H - PAD.bottom}
        />
        <text
          className={styles.axisName}
          x={W - PAD.right}
          y={H - 8}
          textAnchor="end"
        >
          papers I hold
        </text>
        <text className={styles.axisName} x={PAD.left} y={PAD.top - 4}>
          field growth, last 12 months against the 12 before
        </text>
        {crossing !== null && (
          <>
            <line
              data-quadrant-line
              className={styles.cross}
              x1={cx}
              x2={cx}
              y1={PAD.top}
              y2={H - PAD.bottom}
            />
            <line
              data-quadrant-line
              className={styles.cross}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={cy}
              y2={cy}
            />
            <text className={styles.quadrant} x={PAD.left + 6} y={PAD.top + 14}>
              {QUADRANTS.blind}
            </text>
            <text
              className={styles.quadrant}
              x={W - PAD.right - 6}
              y={PAD.top + 14}
              textAnchor="end"
            >
              {QUADRANTS.crowded}
            </text>
            <text
              className={styles.quadrant}
              x={W - PAD.right - 6}
              y={H - PAD.bottom - 6}
              textAnchor="end"
            >
              {QUADRANTS.ahead}
            </text>
            <text
              className={styles.quadrant}
              x={PAD.left + 6}
              y={H - PAD.bottom - 6}
            >
              {QUADRANTS.obscure}
            </text>
          </>
        )}
        {ordered.map((t, i) => (
          <g
            key={t.tag}
            id={pointId(i)}
            role="option"
            aria-selected={active === i}
            aria-label={labelOf(t)}
            className={`${styles.point} ${t.tag === chosen ? styles.open : ""} ${active === i ? styles.active : ""}`}
            onClick={() => {
              setActive(i);
              onChoose(t.tag);
            }}
          >
            <title>{labelOf(t)}</title>
            <circle cx={x(t.papers)} cy={y(t.growth!)} r={r(t.papers)} />
            <text
              className={styles.count}
              x={x(t.papers)}
              y={y(t.growth!)}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {t.papers}
            </text>
            <text
              className={styles.name}
              x={x(t.papers)}
              y={y(t.growth!) - r(t.papers) - 4}
              textAnchor="middle"
            >
              {t.display}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className={styles.caption}>
        {crossing === null
          ? "fewer than 4 placed tags — no quadrants, ranked below"
          : `axes cross at the median of ${crossing.placed} placed tags`}
      </figcaption>
    </figure>
  );
}
