import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { router } from "./router.js";

export type AppOptions = {
  /** Session token minted at core start; every /trpc request must carry it. */
  token: string;
};

/**
 * The core as a plain Hono app, constructible in-process so tests can call
 * procedures with `app.request(...)` and no socket.
 */
export function createApp({ token }: AppOptions): Hono {
  const app = new Hono();

  // The renderer is served from the Vite dev server in development and from
  // this process in production; CORS keeps the former working. The bearer
  // token, not the origin, is what guards the API.
  app.use("/trpc/*", cors());
  // Auth runs before the router so an unauthenticated request never reaches
  // procedure code.
  app.use("/trpc/*", bearerAuth({ token }));
  app.use("/trpc/*", trpcServer({ router }));

  return app;
}
