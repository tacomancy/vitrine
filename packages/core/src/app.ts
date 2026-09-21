import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
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
  /**
   * The index's seams (`vault-index.ts`): the chunk size a test shortens,
   * the `positionsOf` registry, and the after-commit listeners the event
   * stream (#188) and the test harness hang off.
   */
  index?: IndexOptions;
};

export type App = {
  app: Hono;
  /** Tear down the open vault's resources: the index handle, and the watcher once it lands. */
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
  index,
}: AppOptions): App {
  const app = new Hono();
  const vault = createVaultService({ host, appSupportDir, index });
  const context: Context = {
    vault,
    questions: createQuestionService({ vault, now, newId }),
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
