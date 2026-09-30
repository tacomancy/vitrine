import type { ReaderAnnotation } from "core";
import { markOfConnection, type Tick } from "./Connections";
import { useEffect, useRef } from "react";
import { snapColour } from "./highlight-colour";
import styles from "./Reader.module.css";
import type { PageGeometry } from "./pdf-document";

/**
 * The app's own drawing of a page's text markup and notes (spec #416 "The
 * Reader surface"), from the core's records and in the PDF's user space, so
 * that each mark is an element of ours — the thing hover, selection and a
 * backlink count attach to — rather than pixels the PDF engine painted.
 * Ink and shapes are not here: they stay in the page bitmap (story 77).
 *
 * The colour is drawn by a class (`snapColour`), the `?` glyph and its label
 * carry a `Q:` highlight so a yellow one is not read as a question by colour
 * alone (story 79), and every note and quote is a React text node — plain
 * text, never parsed for links (story 89).
 */

type Box = { x: number; y: number; w: number; h: number };

/** A quad's bounding box, in view coordinates (PDF y runs up; the view's runs down). */
function boxOf(quad: number[]): Box {
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  const x = Math.min(...xs);
  return {
    x,
    y: -Math.max(...ys),
    w: Math.max(...xs) - x,
    h: Math.max(...ys) - Math.min(...ys),
  };
}

const titleOf = (a: ReaderAnnotation) =>
  [a.quote, a.note].filter((part) => part !== "").join(" — ");

export function AnnotationOverlay({
  page,
  annotations,
  arrivedOn,
  ticks,
}: {
  page: PageGeometry;
  annotations: ReaderAnnotation[];
  arrivedOn: string | null;
  ticks: Tick[];
}) {
  const here = annotations.filter((a) => a.page === page.number - 1);
  return (
    <>
      <svg
        className={styles.overlay}
        viewBox={`${page.x0} ${-(page.y0 + page.height)} ${page.width} ${page.height}`}
        aria-label={`Annotations on page ${page.number}`}
        role="group"
      >
        {here.map((a) => (
          <Mark key={a.id} a={a} arrived={a.block === arrivedOn} />
        ))}
      </svg>
      <Gutter page={page} annotations={here} ticks={ticks} />
    </>
  );
}

/**
 * One neutral tick beside the page for each highlight something points at,
 * at that highlight's depth (spec #416 stories 80–82). It lives outside the
 * page's box, so the text never reflows for it and nothing is drawn on the
 * text; its glyph says who points and only an open Question's is amber.
 * Nothing is drawn for a highlight nothing points at.
 */
function Gutter({
  page,
  annotations,
  ticks,
}: {
  page: PageGeometry;
  annotations: ReaderAnnotation[];
  ticks: Tick[];
}) {
  const wanted = new Map(ticks.map((t) => [t.block, t.connection]));
  return (
    <div className={styles.gutter}>
      {annotations.flatMap((a) => {
        const connection = wanted.get(a.block);
        // The top of the highest quad: PDF y runs up, the page's top is y0 + height.
        const top = Math.max(
          ...a.quads.flatMap((q) => [q[1]!, q[3]!, q[5]!, q[7]!])
        );
        if (connection === undefined || !Number.isFinite(top)) return [];
        const mark = markOfConnection(connection);
        const open = connection.kind === "question" && connection.open;
        return (
          <span
            key={a.id}
            data-tick={a.block}
            role="img"
            aria-label={`a ${mark.label} points at this highlight`}
            className={open ? `${styles.tick} ${styles.open}` : styles.tick}
            style={{
              top: `${((page.y0 + page.height - top) / page.height) * 100}%`,
            }}
          >
            {mark.glyph}
          </span>
        );
      })}
    </div>
  );
}

function Mark({ a, arrived }: { a: ReaderAnnotation; arrived: boolean }) {
  const ref = useRef<SVGGElement>(null);
  // An Address that named this block puts it in front of the reader.
  useEffect(() => {
    if (arrived) ref.current?.scrollIntoView({ block: "center" });
  }, [arrived]);
  const boxes = a.quads.map(boxOf);
  const first = boxes[0];
  if (first === undefined) return null;
  return (
    <g
      ref={ref}
      className={[styles.mark, styles[snapColour(a.color)], styles[a.kind]]
        .filter(Boolean)
        .join(" ")}
      data-block={a.block}
      aria-current={arrived ? "location" : undefined}
      role="img"
      aria-label={`${a.question ? "Question: " : ""}${titleOf(a)}`}
    >
      <title>{titleOf(a)}</title>
      {boxes.map((b, i) => (
        <MarkShape key={i} kind={a.kind} b={b} arrived={arrived} />
      ))}
      {a.question && (
        <g className={styles.questionGlyph}>
          <text x={first.x - 11} y={first.y + 9} className={styles.glyph}>
            ?
          </text>
        </g>
      )}
    </g>
  );
}

function MarkShape({
  kind,
  b,
  arrived,
}: {
  kind: ReaderAnnotation["kind"];
  b: Box;
  arrived: boolean;
}) {
  const ring = arrived ? styles.arrived : undefined;
  switch (kind) {
    case "underline":
    case "squiggly":
      return (
        <line
          className={`${styles.stroke} ${ring ?? ""}`}
          x1={b.x}
          x2={b.x + b.w}
          y1={b.y + b.h}
          y2={b.y + b.h}
        />
      );
    case "strikeout":
      return (
        <line
          className={`${styles.stroke} ${ring ?? ""}`}
          x1={b.x}
          x2={b.x + b.w}
          y1={b.y + b.h / 2}
          y2={b.y + b.h / 2}
        />
      );
    default:
      // A highlight's fill, a sticky note's marker, a text box's outline:
      // one rectangle, told apart by the class of its kind.
      return (
        <rect
          className={`${styles.fill} ${ring ?? ""}`}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={1}
        />
      );
  }
}
