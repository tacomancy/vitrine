import type { IngestSummary } from "./ingest.js";
import type { PdfFault } from "./pdf-folder.js";
import type { VaultChanged } from "./vault-index.js";
import type { Vault } from "./vault.js";

/**
 * Everything the core pushes to a renderer, on one stream (ADR 0013 decision
 * 11; `docs/architecture.md` § Watcher and Ingest). `ingestLanded` and
 * `scoutFinished` join with their beats.
 */
export type CoreEvent =
  | VaultChanged
  | { type: "vaultStatus" }
  | { type: "vaultSwitched"; vault: Vault }
  // The PDF folder was checked (#379): its fault, or null once it resolves.
  | { type: "pdfFolder"; fault: PdfFault | null }
  // An Ingest run took something in (#419): the footer's one line, and the
  // Sources it wrote to. Never raised for a run that took nothing.
  | {
      type: "ingestLanded";
      runId: string;
      summary: IngestSummary;
      sources: string[];
    };

export type Events = {
  emit: (event: CoreEvent) => void;
  /** Every event from this call until the signal aborts; nothing is replayed. */
  subscribe: (signal: AbortSignal | undefined) => AsyncIterable<CoreEvent>;
};

/** The in-process bus behind `events.subscribe`: one subscriber per connected renderer. */
export function createEvents(): Events {
  const subscribers = new Set<(event: CoreEvent) => void>();
  return {
    emit: (event) => {
      for (const deliver of subscribers) deliver(event);
    },
    subscribe: (signal) => {
      // Registered here, not when the stream first pulls: an event raised
      // between the procedure resolving and the SSE producer's first read
      // would otherwise be lost, and the renderer told nothing.
      const queue: CoreEvent[] = [];
      let wake: (() => void) | null = null;
      const deliver = (event: CoreEvent) => {
        queue.push(event);
        wake?.();
      };
      subscribers.add(deliver);
      signal?.addEventListener("abort", () => wake?.(), { once: true });
      return {
        [Symbol.asyncIterator]: async function* () {
          try {
            while (!signal?.aborted) {
              const event = queue.shift();
              if (event !== undefined) {
                yield event;
                continue;
              }
              await new Promise<void>((resolve) => (wake = resolve));
              wake = null;
            }
          } finally {
            subscribers.delete(deliver);
          }
        },
      };
    },
  };
}
