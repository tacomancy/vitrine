import { Worker } from "node:worker_threads";

/**
 * The only module in the core that reads a PDF (ADR 0007 decision 3;
 * `docs/architecture.md` § Decided): PDFium through WebAssembly, in one
 * worker thread, behind one queue. Nothing else imports the bindings, so
 * swapping the engine is a re-implementation of this file and the worker.
 *
 * Why a worker at all: a hostile or damaged file can trap the WebAssembly
 * module, and a trap must cost the one file, never the core (spec #416
 * story 111). The core sees a trap as an ordinary `PdfUnreadable`, and the
 * next job starts a fresh worker.
 */

/** What the PDF's own Info dictionary says; a field it does not carry is absent, never guessed. */
export type PdfMetadata = { title?: string; author?: string };

/**
 * A file the engine could not read. `reason` finishes the sentence "This
 * PDF could not be read because …" and carries no path (ADR 0028): it is
 * shown as written by the *PDF unreadable* row.
 */
export class PdfUnreadable extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * What a file holds that Ingest keeps (`docs/architecture.md` § Annotation
 * identity): `text` covers a sticky note and free text, `stamp` is what
 * iPadOS Markup saves a pencil stroke as (ADR 0007 decision 5), and `shape`
 * is Square, Circle, Line, Polygon and PolyLine. Every other subtype — a
 * link, a popup, a form widget — is not an annotation of the researcher's.
 */
export type AnnotationKind =
  | "highlight"
  | "underline"
  | "strikeout"
  | "squiggly"
  | "text"
  | "freetext"
  | "ink"
  | "stamp"
  | "shape";

/** One annotation exactly as the file has it: raw values, nothing normalised. */
export type PdfAnnotation = {
  kind: AnnotationKind;
  /** 0-based. */
  page: number;
  /** 8 numbers each, PDF user space, as written. */
  quads: number[][];
  /**
   * The characters under the quads; for `text` and `freetext` the /Contents.
   * Empty on ink, stamp, shape, and where the quads cover no text.
   */
  quote: string;
  /** /Contents on the markup kinds; empty elsewhere. */
  note: string;
  /** /C as 0–255 components, or null when the file has none. */
  color: number[] | null;
  /** /NM, when the file has one. */
  nm?: string;
  /** /Rect as `[left, bottom, right, top]`. */
  rect: number[];
  /** /T, when the file has one: what Preview shows as the author. */
  author?: string;
  /** Whether the object carries a normal appearance stream (`/AP /N`). */
  hasAppearance: boolean;
};

export type PdfAnnotations = {
  pages: number;
  /** Trailer /ID[0] as hex; empty when the file has none. */
  fileId: string;
  annotations: PdfAnnotation[];
  /** Each page's characters in reading order; the document fingerprint is made from these. */
  pageText: string[];
};

/**
 * What the Reader asked for, after the core has resolved it (#426). `rects`
 * are `[left, bottom, right, top]` in PDF user space and only say *where*;
 * which characters they cover, and so the quote, is the engine's to decide.
 */
export type HighlightRequest = {
  /** 0-based. */
  page: number;
  rects: number[][];
  /** 0–255 per channel. */
  color: number[];
  note: string;
  /** Becomes `/NM`, and so the identity Ingest finds it by. */
  nm: string;
  author: string;
  /** ISO time for `/CreationDate` and `/M`. */
  at: string;
};

export type HighlightResult =
  | { written: true; bytes: Uint8Array; quote: string; quads: number[][] }
  | { written: false; reason: string };

/**
 * A change to one annotation already in the file (#428). Found by `/NM` when
 * the file carries one, else by its quads on that page — the same two things
 * the sidecar holds for it. Extent is never changed: that is remove and
 * redraw.
 */
export type AmendRequest = {
  /** 0-based. */
  page: number;
  nm: string;
  quads: number[][];
  /** ISO time for `/M`. */
  at: string;
  change: { colour?: number[]; note?: string } | { remove: true };
};

export type AmendResult =
  { written: true; bytes: Uint8Array } | { written: false; reason: string };

export type PdfEngine = {
  /** Read a PDF's title and author from its bytes; rejects `PdfUnreadable`. */
  metadata: (bytes: Uint8Array) => Promise<PdfMetadata>;
  /** Read every annotation of the researcher's, in page order; rejects `PdfUnreadable`. */
  annotations: (bytes: Uint8Array) => Promise<PdfAnnotations>;
  /**
   * The file with one highlight added, as a full rewrite; the input bytes
   * are never touched. Refused, in words a person can read, when the
   * selection covers no characters — an image or a scanned page (ADR 0007
   * decision 6). Rejects `PdfUnreadable`.
   */
  highlight: (
    bytes: Uint8Array,
    request: HighlightRequest
  ) => Promise<HighlightResult>;
  /**
   * The file with one annotation recoloured, re-noted or removed, as a full
   * rewrite; the input bytes are never touched. Refused, in plain words,
   * when the annotation is not in the file. Rejects `PdfUnreadable`.
   */
  amend: (bytes: Uint8Array, request: AmendRequest) => Promise<AmendResult>;
  /** Stop the worker; a later job starts another. */
  close: () => Promise<void>;
};

type Job = "metadata" | "annotations" | "highlight" | "amend";

type Reply = {
  id: number;
  result:
    | PdfMetadata
    | PdfAnnotations
    | HighlightResult
    | AmendResult
    | { unreadable: string };
};

/**
 * `workerUrl` is the test seam: a stand-in worker that traps on demand,
 * since a real file that traps PDFium is not something to commit.
 */
export function createPdfEngine({
  workerUrl = defaultWorker(),
}: { workerUrl?: URL } = {}): PdfEngine {
  let worker: Worker | null = null;
  let settle: ((reply: Reply | PdfUnreadable) => void) | null = null;
  let jobs = 0;

  const start = (): Worker => {
    const started = new Worker(workerUrl);
    started.on("message", (reply: Reply) => settle?.(reply));
    // An error or an exit with a job in flight is the trap: the job is
    // reported unreadable and the worker is dropped, so the next one is
    // fresh. Never retried here — *try again* is the researcher's.
    // An error is followed by an exit; the second must not settle the job
    // that started after the first.
    let dead = false;
    const trapped = () => {
      if (dead) return;
      dead = true;
      if (worker === started) worker = null;
      settle?.(new PdfUnreadable("the reader stopped on it"));
    };
    started.on("error", trapped);
    started.on("exit", trapped);
    return started;
  };

  // One job at a time: the worker holds one WebAssembly heap, and an answer
  // must be matched to the job that asked without a table of them.
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(job: Job, bytes: Uint8Array, args?: unknown) =>
    new Promise<T>((resolve, reject) => {
      queue = queue
        .catch(() => undefined)
        .then(
          () =>
            new Promise<void>((done) => {
              const id = ++jobs;
              settle = (reply) => {
                settle = null;
                done();
                if (reply instanceof PdfUnreadable) return reject(reply);
                if (reply.id !== id) return;
                if ("unreadable" in reply.result) {
                  reject(new PdfUnreadable(reply.result.unreadable));
                } else {
                  resolve(reply.result as T);
                }
              };
              worker ??= start();
              // A copy: transferring would detach the caller's buffer.
              worker.postMessage({
                id,
                job,
                args,
                bytes: Uint8Array.from(bytes),
              });
            })
        );
    });

  return {
    metadata: (bytes) => run<PdfMetadata>("metadata", bytes),
    annotations: (bytes) => run<PdfAnnotations>("annotations", bytes),
    highlight: (bytes, request) =>
      run<HighlightResult>("highlight", bytes, request),
    amend: (bytes, request) => run<AmendResult>("amend", bytes, request),
    close: async () => {
      const going = worker;
      worker = null;
      await going?.terminate();
    },
  };
}

/**
 * `.js` beside this file once built, `.ts` when the core runs from source
 * (Node strips the types; the worker imports no sibling, so nothing else
 * has to resolve).
 */
function defaultWorker(): URL {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return new URL(`./pdf-engine.worker.${extension}`, import.meta.url);
}
