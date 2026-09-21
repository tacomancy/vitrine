import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { createEvents } from "./events.js";
import type { Host } from "./host.js";
import { createQuestionService } from "./questions.js";
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
  /**
   * The index's seams (`vault-index.ts`): the chunk size a test shortens,
   * the `positionsOf` registry, and the after-commit listeners the event
   * stream (#188) and the test harness hang off.
   */
  index?: IndexOptions;
};

export type App = {
  app: Hono;
  /** Tear down the open vault's resources: the watcher and the index handle. */
  close: () => void;
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
  index,
}: AppOptions): App {
  const app = new Hono();
  const events = createEvents();
  // The index's after-commit listeners feed the stream first, then whatever
  // the caller hung there (the test harness): both see the committed rows.
  const vault = createVaultService({
    host,
    appSupportDir,
    settleMs,
    index: {
      ...index,
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
  };

  // The renderer is served from the Vite dev server in development and from
  // this process in production; CORS keeps the former working. The bearer
  // token, not the origin, is what guards the API.
  app.use("/trpc/*", cors());
  // Auth runs before the router so an unauthenticated request never reaches
  // procedure code.
  app.use("/trpc/*", bearerAuth({ token }));
  app.use("/trpc/*", trpcServer({ router, createContext: () => context }));

  return { app, close: () => vault.close() };
}
