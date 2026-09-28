import type { watch as fsWatch } from "node:fs";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { createEvents } from "./events.js";
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
  /** The watcher's settle window in ms; tests shorten it as they pin `now`. */
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
  settleMs,
  coalesceMs,
  stalledOpenDays,
  watch,
  probeTimeoutMs,
  index,
}: AppOptions): App {
  const app = new Hono();
  const events = createEvents();
  // The stream is fed before whatever the caller hung on the same seam
  // (the test harness), so a test's listener runs after the renderer's.
  const historyWindowMs = coalesceMs ?? COALESCE_MS;
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
    index: {
      ...index,
      // The Kinds with a Position (§ Index): the Research Question's
      // `## Working answer`, the Hypothesis's claim, design notes and
      // criteria, and the Experiment's design and observations. A test's stand-in may add to or override the registry,
      // never lose it.
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
  const context: Context = {
    vault,
    questions: createQuestionService({ vault, now, newId }),
    events,
    now: now ?? (() => new Date()),
    coalesceMs: historyWindowMs,
    stalledOpenDays: stalledOpenDays ?? STALLED_OPEN_DAYS,
    newId: newId ?? randomId,
  };

  // The renderer is served from the Vite dev server in development and from
  // this process in production; CORS keeps the former working. The bearer
  // token, not the origin, is what guards the API.
  app.use("/trpc/*", cors());
  // Auth runs before the router so an unauthenticated request never reaches
  // procedure code.
  app.use("/trpc/*", bearerAuth({ token }));
  app.use("/trpc/*", trpcServer({ router, createContext: () => context }));

  return {
    app,
    close: () => vault.close(),
    release: () => vault.release(),
    focused: () => vault.focused(),
  };
}
