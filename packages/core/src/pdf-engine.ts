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

export type PdfEngine = {
  /** Read a PDF's title and author from its bytes; rejects `PdfUnreadable`. */
  metadata: (bytes: Uint8Array) => Promise<PdfMetadata>;
  /** Stop the worker; a later job starts another. */
  close: () => Promise<void>;
};

type Reply = {
  id: number;
  result: PdfMetadata | { unreadable: string };
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
  const run = (bytes: Uint8Array) =>
    new Promise<PdfMetadata>((resolve, reject) => {
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
                  resolve(reply.result);
                }
              };
              worker ??= start();
              // A copy: transferring would detach the caller's buffer.
              worker.postMessage({ id, bytes: Uint8Array.from(bytes) });
            })
        );
    });

  return {
    metadata: run,
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
