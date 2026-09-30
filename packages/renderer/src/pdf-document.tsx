import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./PdfDocument.module.css";

/**
 * The page renderer, and the only file that imports `pdfjs-dist` (spec #416
 * "The engine and where it lives"; `docs/architecture.md` § Decided, PDF).
 * It draws — a canvas, a text layer, and whatever the caller lays over the
 * page — and reads nothing the core needs: PDFium in the core is the only
 * reader of a PDF, and what PDF.js knows about a paper is never stored.
 *
 * Kept behind this one component so the Reader's tests can stand a fake in
 * its place (jsdom cannot draw a canvas) and so PDF.js can be swapped by
 * rewriting this file.
 */

/** A page's box in PDF user space, in points: what an overlay's geometry is drawn against. */
export type PageGeometry = {
  /** 1-based. */
  number: number;
  x0: number;
  y0: number;
  width: number;
  height: number;
};

/**
 * What the reader has selected, as an *intent's* geometry: a 1-based page
 * and `[left, bottom, right, top]` rectangles in PDF user space, one per
 * line the drag covers. Where, and nothing more — which characters that is
 * belongs to the core (ADR 0007 decision 6).
 */
export type PageSelection = { page: number; rects: number[][] };

export type PdfDocumentProps = {
  /** The core's `/pdf/<path>` for this paper. */
  url: string;
  /** The bearer token, sent as a header PDF.js's own fetches carry. */
  token: string;
  /** Where to open: a 1-based page and how far down it, 0 to 1. */
  start: { page: number; offset: number };
  /** Drawn inside each page once its geometry is known. */
  overlay: (page: PageGeometry) => ReactNode;
  /** Where the reader is, once they have stopped moving. */
  onMove: (at: { page: number; offset: number }) => void;
  /** The document could not be opened, in words that carry no path. */
  onFailed: (reason: string) => void;
  /** The reader selected text, or let go of the selection (null). */
  onSelect: (selection: PageSelection | null) => void;
};

/** Page width in CSS pixels: the calm measure the Reader reads at, not the window's. */
const WIDTH = 760;

/**
 * Only the kinds the app draws itself are held back from the bitmap:
 * text markup and sticky notes. Ink, shapes, stamps and free text stay
 * exactly as the PDF has them (stories 76–77), so the pencil is never
 * redrawn by anything of ours. (Free text is a sidecar block too, so the
 * overlay outlines it for identity's sake, but its words are the bitmap's.)
 * The set mirrors the core's `DRAWN` minus free text. PDF.js has no per-subtype switch, but it
 * brackets each annotation's operations with `beginAnnotation` /
 * `endAnnotation` and lets a render skip operations by index — so the
 * operations of those subtypes are skipped and the rest run.
 */
const OVERLAID = new Set([
  "Highlight",
  "Underline",
  "StrikeOut",
  "Squiggly",
  "Text",
]);

let configured = false;
async function pdfjs() {
  const lib = await import("pdfjs-dist");
  if (!configured) {
    // Same-origin, so the core's `default-src 'self'` admits it (§ Decided,
    // Renderer): no blob: worker and no fake worker on the main thread.
    lib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    configured = true;
  }
  return lib;
}

async function skippedOperations(
  lib: typeof import("pdfjs-dist"),
  page: PDFPageProxy
) {
  const [ops, annotations] = await Promise.all([
    page.getOperatorList({ annotationMode: lib.AnnotationMode.ENABLE }),
    page.getAnnotations({ intent: "display" }),
  ]);
  const held = new Set<string>(
    annotations
      .filter((a: { subtype: string }) => OVERLAID.has(a.subtype))
      .map((a: { id: string }) => a.id)
  );
  const skip = new Set<number>();
  let holding = false;
  ops.fnArray.forEach((fn: number, i: number) => {
    if (fn === lib.OPS.beginAnnotation) {
      holding = held.has((ops.argsArray[i] as [string])[0]);
    }
    if (holding) skip.add(i);
    if (fn === lib.OPS.endAnnotation) holding = false;
  });
  return skip;
}

export function PdfDocument({
  url,
  token,
  start,
  overlay,
  onMove,
  onFailed,
  onSelect,
}: PdfDocumentProps) {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [first, setFirst] = useState<PageGeometry | null>(null);

  useEffect(() => {
    let dead = false;
    let loading: { destroy: () => Promise<void> } | null = null;
    void (async () => {
      try {
        const lib = await pdfjs();
        const task = lib.getDocument({
          url,
          httpHeaders: { authorization: `Bearer ${token}` },
          // Pieces on demand, so a very large paper is never held whole.
          disableAutoFetch: true,
          rangeChunkSize: 1 << 18,
        });
        loading = task;
        const opened = await task.promise;
        if (dead) return void task.destroy();
        const page = await opened.getPage(1);
        const box = page.view as [number, number, number, number];
        setFirst({
          number: 1,
          x0: box[0],
          y0: box[1],
          width: box[2] - box[0],
          height: box[3] - box[1],
        });
        setDoc({ pdf: opened, lib });
      } catch (cause) {
        if (!dead) onFailed(reasonOf(cause));
      }
    })();
    return () => {
      dead = true;
      void loading?.destroy();
    };
  }, [url, token, onFailed]);

  // Opened once, where it was asked to be. Later moves are the reader's.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (doc === null || placed.current) return;
    placed.current = true;
    const at = scroller.current?.querySelector<HTMLElement>(
      `[data-page="${start.page}"]`
    );
    if (at && scroller.current) {
      scroller.current.scrollTop =
        at.offsetTop + start.offset * at.offsetHeight;
    }
  }, [doc, start.page, start.offset]);

  // Report where the reader is when they stop, not on every frame.
  useEffect(() => {
    const el = scroller.current;
    if (!el || doc === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = () => {
      const pages = [...el.querySelectorAll<HTMLElement>("[data-page]")];
      const top = el.scrollTop;
      const here =
        [...pages].reverse().find((p) => p.offsetTop <= top + 1) ?? pages[0];
      if (!here) return;
      onMove({
        page: Number(here.dataset["page"]),
        offset: Math.min(
          Math.max((top - here.offsetTop) / Math.max(here.offsetHeight, 1), 0),
          1
        ),
      });
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(settled, 500);
    };
    el.addEventListener("scroll", onScroll);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
    };
  }, [doc, onMove]);

  // Read when the drag or the keys are done, not on every selection change:
  // the bar that offers a highlight should not flicker while the reader drags.
  const selected = () => onSelect(selectionOf(scroller.current));

  return (
    <div
      className={styles.scroller}
      ref={scroller}
      data-testid="pdf-scroller"
      onMouseUp={selected}
      onKeyUp={selected}
    >
      {doc !== null &&
        first !== null &&
        Array.from({ length: doc.pdf.numPages }, (_, i) => (
          <Page
            key={i + 1}
            number={i + 1}
            doc={doc}
            guess={first}
            overlay={overlay}
          />
        ))}
    </div>
  );
}

/**
 * The current selection as page-space rectangles, on the page it starts in.
 * A selection running on to the next page is taken as far as its first: one
 * highlight is one page's, and the reader can make another.
 */
function selectionOf(root: HTMLElement | null): PageSelection | null {
  const selection = window.getSelection();
  if (root === null || selection === null || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const start =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const wrapper = start?.closest<HTMLElement>("[data-page]");
  if (!wrapper || !root.contains(wrapper)) return null;
  const at = wrapper.getBoundingClientRect();
  const view = wrapper.dataset;
  const width = Number(view["pdfWidth"]);
  const height = Number(view["pdfHeight"]);
  const x0 = Number(view["pdfX0"]);
  const y0 = Number(view["pdfY0"]);
  if (!(at.width > 0 && at.height > 0 && width > 0 && height > 0)) return null;
  const rects = [...range.getClientRects()]
    // A rect wholly outside this page belongs to the next one.
    .filter(
      (r) =>
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > at.top &&
        r.top < at.bottom &&
        r.right > at.left &&
        r.left < at.right
    )
    .map((r) => [
      x0 + ((r.left - at.left) / at.width) * width,
      y0 + height - ((r.bottom - at.top) / at.height) * height,
      x0 + ((r.right - at.left) / at.width) * width,
      y0 + height - ((r.top - at.top) / at.height) * height,
    ]);
  return rects.length === 0
    ? null
    : { page: Number(wrapper.dataset["page"]), rects };
}

type LoadedDoc = {
  pdf: PDFDocumentProxy;
  lib: typeof import("pdfjs-dist");
};

const reasonOf = (cause: unknown) => {
  const name = (cause as { name?: string })?.name;
  if (name === "PasswordException") return "it is protected by a password";
  if (name === "InvalidPDFException") return "it is damaged, or is not a PDF";
  return "the page renderer could not open it";
};

function Page({
  number,
  doc,
  guess,
  overlay,
}: {
  number: number;
  doc: LoadedDoc;
  guess: PageGeometry;
  overlay: PdfDocumentProps["overlay"];
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [geometry, setGeometry] = useState<PageGeometry>({ ...guess, number });

  // A page is drawn when it is near the viewport and not before: a paper of
  // four hundred pages is four hundred boxes and a handful of canvases.
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const watching = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && setSeen(true),
      { rootMargin: "1200px 0px" }
    );
    watching.observe(el);
    return () => watching.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) return;
    let dead = false;
    let cancel: (() => void) | undefined;
    void (async () => {
      const page = await doc.pdf.getPage(number);
      if (dead) return;
      const box = page.view as [number, number, number, number];
      const width = box[2] - box[0];
      setGeometry({
        number,
        x0: box[0],
        y0: box[1],
        width,
        height: box[3] - box[1],
      });
      const scale = WIDTH / width;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const el = canvas.current!;
      el.width = Math.floor(viewport.width * ratio);
      el.height = Math.floor(viewport.height * ratio);
      const skip = await skippedOperations(doc.lib, page);
      if (dead) return;
      const task = page.render({
        canvas: el,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        annotationMode: doc.lib.AnnotationMode.ENABLE,
        operationsFilter: (i) => !skip.has(i),
      });
      cancel = () => task.cancel();
      await task.promise;
      if (dead || !text.current) return;
      text.current.replaceChildren();
      text.current.style.setProperty("--scale-factor", String(scale));
      text.current.style.setProperty("--total-scale-factor", String(scale));
      await new doc.lib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: text.current,
        viewport,
      }).render();
    })().catch((cause: unknown) => {
      // A cancelled render is the page leaving, not a failure; anything else
      // would leave a blank sheet that looks like a blank page.
      if (
        (cause as { name?: string })?.name !== "RenderingCancelledException"
      ) {
        if (!dead) setFailed(true);
      }
    });
    return () => {
      dead = true;
      cancel?.();
    };
  }, [seen, doc, number]);

  return (
    <div
      ref={wrapper}
      className={styles.page}
      data-page={number}
      data-pdf-x0={geometry.x0}
      data-pdf-y0={geometry.y0}
      data-pdf-width={geometry.width}
      data-pdf-height={geometry.height}
      style={{ aspectRatio: `${geometry.width} / ${geometry.height}` }}
    >
      <canvas ref={canvas} className={styles.canvas} />
      {/* Under the text layer, so a selection is never taken by an overlay. */}
      {overlay(geometry)}
      <div ref={text} className={`textLayer ${styles.text}`} />
      {failed && (
        <p className={styles.failed} role="status">
          This page could not be drawn.
        </p>
      )}
    </div>
  );
}
