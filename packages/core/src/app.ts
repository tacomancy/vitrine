import type { watch as fsWatch } from "node:fs";
import { hostname } from "node:os";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { artifactBytes } from "./artifact.js";
import { pdfBytes } from "./reader.js";
import { createArxivClient, type ArxivOptions } from "./arxiv.js";
import { createMemoryCredentialStore } from "./credentials.js";
import { createAnthropicProvider } from "./model-provider.js";
import { createProviderSettings } from "./providers.js";
import type { WatchedDeps } from "./watched.js";
import { createEvents } from "./events.js";
import { checkDue } from "./scout-schedule.js";
import { createPdfEngine } from "./pdf-engine.js";
import type { Host } from "./host.js";
import { STALLED_OPEN_DAYS } from "./loose-ends.js";
import { createQuestionService, randomId } from "./questions.js";
import { KIND as HYPOTHESIS, hypothesisPositions } from "./hypothesis.js";
import { KIND as EXPERIMENT, experimentPositions } from "./experiment.js";
import { COALESCE_MS } from "./page-write.js";
import {
  KIND as RESEARCH_QUESTION,
  researchQuestionPositions,
} from "./research-question.js";
import { router, type Context } from "./router.js";
import { createVaultService } from "./vault.js";
import type { IndexOptions } from "./vault-index.js";

const HOURLY_MS = 60 * 60 * 1000;

export type AppOptions = {
  /** Session token minted at core start; every /trpc request must carry it. */
  token: string;
  /** The shell-side counterpart that shows dialogs on the core's behalf. */
  host: Host;
  /** The core's own state folder; a temp folder in tests. */
  appSupportDir: string;
  /** The clock and id source; tests pin them so a written file is predictable. */
  now?: () => Date;
  newId?: () => string;
  /**
   * The computer name a linked Artifact records as where it was linked from
   * (ADR 0035 decision 5). The shell supplies the Mac's; tests pass any
   * string. Absent — a core started by hand — the host name stands in.
   */
  machine?: string;
  /** The watcher's settle window in ms; tests shorten it as they pin `now`, to no less than 200 ms (`MIN_SETTLE_MS`, `vault-watcher.ts`). */
  settleMs?: number;
  /** Position history's coalescing window in ms (ADR 0006 decision 5); tests shorten it. */
  coalesceMs?: number;
  /** How many open days a promoted Research Question may sit unsourced (#243); tests shorten it. */
  stalledOpenDays?: number;
  /** `fs.watch`, or a test's wrapper of it that fails a watch or refuses one (#190). */
  watch?: typeof fsWatch;
  /** How long the watcher's probe may go unanswered before it gives up; tests shorten it (#272). */
  probeTimeoutMs?: number;
  /**
   * The index's seams (`vault-index.ts`): the chunk size a test shortens,
   * the `positionsOf` registry, and the after-commit listeners the event
   * stream (#188) and the test harness hang off.
   */
  index?: IndexOptions;
  /** A stand-in for the PDF engine's worker; tests use one that traps (#418). */
  pdfWorker?: URL;
  /** Who a highlight made in the Reader is by (`/T`); the login's name when absent. */
  author?: string;
  /** The arXiv client's `fetch`, clock and endpoint; tests and the demo's stand-in server replace them, nothing else does. */
  arxiv?: Partial<ArxivOptions>;
  /**
   * What reading a page needs — its `fetch`, the `ModelProvider`, the
   * `CredentialStore` — replaced by tests and the demo's stand-ins. Absent,
   * the real fetch and Anthropic stand in, and the store is an empty in-memory
   * one — `start.ts` is what hands in the Keychain's.
   */
  watched?: Partial<Omit<WatchedDeps, "model">> & {
    /** A fixed model id, in place of the one Settings keeps in `providers.json`. */
    model?: string;
  };
  /**
   * How often, in ms, Scouts that are due are run while a vault is open; the
   * check also runs when one opens (ADR 0016 decision 3). Defaults to an
   * hour. `null` turns scheduled runs off: a test that does not drive them
   * must not find its Scouts already run, and one that does asks for the
   * check by name (`scouts.checkDue`) or passes the interval it wants.
   */
  scoutCheckMs?: number | null;
};

export type App = {
  app: Hono;
  /**
   * Tear down the open vault's resources: the watcher, the two database
   * handles, and — first — the splice of anything the queue still owes
   * (#217), which is why this resolves rather than returning.
   */
  close: () => Promise<void>;
  /** The synchronous last resort for an exit handler; nothing is spliced (`vault.ts`). */
  release: () => void;
  /** The shell reporting that the window came to the front: today is an open day (#243). */
  focused: () => Promise<void>;
};

/**
 * The core as a plain Hono app, constructible in-process so tests can call
 * procedures with `app.request(...)` and no socket.
 */
export function createApp({
  token,
  host,
  appSupportDir,
  now,
  newId,
  machine,
  settleMs,
  coalesceMs,
  stalledOpenDays,
  watch,
  probeTimeoutMs,
  index,
  pdfWorker,
  author,
  arxiv,
  watched,
  scoutCheckMs = HOURLY_MS,
}: AppOptions): App {
  const app = new Hono();
  const events = createEvents();
  // The stream is fed before whatever the caller hung on the same seam
  // (the test harness), so a test's listener runs after the renderer's.
  const historyWindowMs = coalesceMs ?? COALESCE_MS;
  // The worker starts with the first PDF it is asked to read, not with the
  // core, so a vault of no PDFs never pays for a WebAssembly heap.
  const pdfs = {
    engine: createPdfEngine(pdfWorker ? { workerUrl: pdfWorker } : {}),
    unreadable: new Map(),
    fingerprints: new Map(),
  };
  const vault = createVaultService({
    host,
    appSupportDir,
    settleMs,
    watch,
    probeTimeoutMs,
    ...(now ? { now } : {}),
    // The window a page save coalesces by is the window an Obsidian edit
    // must be quiet for before it is spliced (#217): one number, one seam.
    coalesceMs: historyWindowMs,
    onSwitched: (switched) =>
      events.emit({ type: "vaultSwitched", vault: switched }),
    onPdfFolder: (fault) => events.emit({ type: "pdfFolder", fault }),
    onRunClosed: (run) => events.emit({ type: "scoutFinished", ...run }),
    onOpened: () => void checkScouts(),
    pdfs,
    ...(author === undefined ? {} : { author }),
    newId: newId ?? randomId,
    spawnQuestion: (q) =>
      context.questions.capture(q.text, {
        context: q.context ?? "ingest",
        source: q.source,
        page: q.page,
        annotation: q.annotation,
        quote: q.quote,
      }),
    onIngest: (run) => {
      const { summary } = run;
      // A clean run says nothing (story 16): a run that only re-found what it
      // knew, or only raised the document-changed event, is not a footer line.
      if (
        summary.new + summary.questions + summary.removed + summary.unmatched >
        0
      ) {
        events.emit({
          type: "ingestLanded",
          runId: (newId ?? randomId)(),
          summary,
          sources: run.sources,
        });
      }
      for (const source of run.changed) {
        events.emit({ type: "documentChanged", source });
      }
    },
    index: {
      ...index,
      // The Kinds with a Position (§ Index): the Research Question's
      // `## Working answer`, the Hypothesis's claim, design notes and
      // criteria, and the Experiment's design and observations. A test's
      // stand-in may add to or override the registry, never lose it.
      positionsOf: {
        [RESEARCH_QUESTION]: researchQuestionPositions,
        [HYPOTHESIS]: hypothesisPositions,
        [EXPERIMENT]: experimentPositions,
        ...index?.positionsOf,
      },
      onChanged: async (event) => {
        events.emit(event);
        await index?.onChanged?.(event);
      },
      onStatus: async () => {
        events.emit({ type: "vaultStatus" });
        await index?.onStatus?.();
      },
    },
  });
  // Fire-and-forget by design: a check is minutes of 3 s-gapped requests, and
  // each run raises `scoutFinished` when it ends. A failure that is not
  // arXiv's reaches the core's log; the run rows carry the rest.
  async function checkScouts(): Promise<void> {
    if (scoutCheckMs === null) return;
    try {
      const opened = await vault.opened();
      if (opened === null) return;
      await checkDue({
        vaultPath: opened.vault.path,
        index: opened.index,
        queue: opened.queue,
        arxiv: context.arxiv,
        watched: context.watched,
        events,
        now: context.now,
      });
    } catch (cause) {
      console.error(
        `vitrine-core: the Scout check failed: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    }
  }
  const hourly =
    scoutCheckMs === null
      ? null
      : setInterval(() => void checkScouts(), scoutCheckMs);
  // The timer alone must never keep the process alive.
  hourly?.unref();

  const providers = createProviderSettings(appSupportDir);
  const context: Context = {
    pdfs,
    providers,
    vault,
    questions: createQuestionService({ vault, now, newId }),
    events,
    now: now ?? (() => new Date()),
    arxiv: createArxivClient({
      fetch: arxiv?.fetch ?? fetch,
      clock: arxiv?.clock ?? {
        now: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      ...(arxiv?.endpoint === undefined ? {} : { endpoint: arxiv.endpoint }),
    }),
    watched: {
      fetch: watched?.fetch ?? fetch,
      models: watched?.models ?? createAnthropicProvider(),
      credentials: watched?.credentials ?? createMemoryCredentialStore(),
      model:
        watched?.model === undefined
          ? providers.model
          : () => Promise.resolve(watched.model as string),
      ...(watched?.timeoutMs === undefined
        ? {}
        : { timeoutMs: watched.timeoutMs }),
    },
    machine: machine ?? hostname(),
    coalesceMs: historyWindowMs,
    stalledOpenDays: stalledOpenDays ?? STALLED_OPEN_DAYS,
    newId: newId ?? randomId,
    host,
  };

  // The renderer is served from the Vite dev server in development and from
  // this process in production; CORS keeps the former working. The bearer
  // token, not the origin, is what guards the API.
  app.use("/trpc/*", cors());
  // Auth runs before the router so an unauthenticated request never reaches
  // procedure code.
  app.use("/trpc/*", bearerAuth({ token }));
  app.use("/trpc/*", trpcServer({ router, createContext: () => context }));

  // An Artifact's bytes, for the page to draw from an object URL (#366):
  // behind the same bearer header, since an `<img src>` cannot carry one
  // and the token never travels in a URL. The path after the prefix is
  // vault-relative, each segment percent-encoded.
  app.use("/artifacts/*", cors());
  app.use("/artifacts/*", bearerAuth({ token }));
  app.get("/artifacts/*", async (c) => {
    const opened = await vault.opened();
    let path: string;
    try {
      path = decodeURIComponent(
        new URL(c.req.url).pathname.slice("/artifacts/".length)
      );
    } catch {
      return c.notFound();
    }
    const served =
      opened === null ? null : await artifactBytes(opened.vault.path, path);
    return served ?? c.notFound();
  });

  // A Source's PDF, for PDF.js to draw (#424): behind the bearer header,
  // which PDF.js sends as `httpHeaders`, and with byte ranges so a very
  // large paper is read in pieces. CORS exposes the range headers to the
  // dev server's origin; in the packaged app the page is same-origin.
  app.use(
    "/pdf/*",
    cors({
      exposeHeaders: ["Accept-Ranges", "Content-Range", "Content-Length"],
    })
  );
  app.use("/pdf/*", bearerAuth({ token }));
  app.get("/pdf/*", async (c) => {
    const opened = await vault.opened();
    let path: string;
    try {
      path = decodeURIComponent(
        new URL(c.req.url).pathname.slice("/pdf/".length)
      );
    } catch {
      return c.notFound();
    }
    const served =
      opened === null
        ? null
        : await pdfBytes(opened.vault.path, path, c.req.header("range"));
    return served ?? c.notFound();
  });

  return {
    app,
    close: async () => {
      clearInterval(hourly ?? undefined);
      await vault.close();
      await pdfs.engine.close();
    },
    release: () => vault.release(),
    focused: () => vault.focused(),
  };
}
