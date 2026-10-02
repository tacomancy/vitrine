import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.js";
import type { Host } from "./host.js";

export type StartOptions = {
  /** Where the built renderer lives; served at `/` when given. */
  staticDir?: string;
  /** Who shows the folder chooser. Absent, the chooser is always cancelled. */
  host?: Host;
  /** The core's own state folder; defaults to the app's Application Support. */
  appSupportDir?: string;
  /** The computer name a linked Artifact records (ADR 0035 decision 5); the shell supplies the Mac's. */
  machine?: string;
  /** The name a highlight's `/T` carries (#441); the shell supplies the account's full name. */
  author?: string;
  /** Where the arXiv client asks; only a demo's stand-in server sets it, so the default is the real API. */
  arxiv?: { endpoint: string };
};

// Where macOS expects an app's own files (docs/architecture.md § Vault layout).
const DEFAULT_APP_SUPPORT_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "Vitrine"
);

// A core with no host — started by hand, or later the iPad's — has no chooser.
const NO_HOST: Host = {
  pickFolder: () => Promise.resolve(null),
  pickFile: () => Promise.resolve(null),
  reveal: () => {},
  trash: () => Promise.resolve(),
};

// `blob:` because an Artifact is drawn from an object URL: an `<img>` cannot
// carry the bearer header, and the token never travels in a URL (#366).
//
// `worker-src 'self'` is the page renderer's (#424): PDF.js parses on a
// worker it loads from the bundle's own origin, so the policy needs no
// `blob:` worker and no `unsafe-eval` — said outright rather than left to
// `default-src`, so that narrowing the default one day cannot take the
// Reader's worker with it unnoticed. The paper's bytes are a same-origin
// fetch under the bearer header, which `default-src` already admits.
const CSP = "default-src 'self'; img-src 'self' data: blob:; worker-src 'self'";

export type RunningCore = {
  port: number;
  token: string;
  close: () => Promise<void>;
  /** The shell saw the window come to the front (#243). */
  focused: () => Promise<void>;
};

/**
 * Bind the core to loopback on a port the OS picks, so nothing off the machine
 * can reach it and two instances never fight over a fixed number.
 */
export function startCore(options: StartOptions = {}): Promise<RunningCore> {
  const token = randomBytes(32).toString("base64url");
  const { app, close, release, focused } = createApp({
    token,
    host: options.host ?? NO_HOST,
    appSupportDir: options.appSupportDir ?? DEFAULT_APP_SUPPORT_DIR,
    ...(options.machine === undefined ? {} : { machine: options.machine }),
    ...(options.author === undefined ? {} : { author: options.author }),
    ...(options.arxiv === undefined ? {} : { arxiv: options.arxiv }),
  });
  // The last-resort teardown for an exit nothing else caught: an `exit`
  // handler cannot await, so it drops the handles and splices nothing.
  // The orderly path — which splices what the queue owes (#217) — is
  // `RunningCore.close` below; the shell asks for it with `close` before it
  // quits (#276), since `app.quit()` would otherwise kill this process and
  // leave the handler above as the only teardown there was.
  process.once("exit", release);
  if (options.staticDir !== undefined) {
    // The bundle is served from the same origin as the API, so the renderer
    // needs nothing beyond 'self'. Set here rather than in index.html because
    // a meta CSP would also apply under the Vite dev server and break HMR.
    app.use("/*", async (c, next) => {
      await next();
      c.header("Content-Security-Policy", CSP);
    });
    app.use("/*", serveStatic({ root: options.staticDir }));
  }

  return new Promise((resolve) => {
    const server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
      (info) => {
        resolve({
          port: info.port,
          token,
          focused,
          close: async () => {
            // The vault first: its splice is what a close is for (#217).
            await close();
            // Then the sockets, dropped rather than drained. `server.close`
            // waits for every open connection, and `events.subscribe` is a
            // subscription that ends when the renderer goes — so draining
            // would mean a close that never resolves and a shell left
            // waiting out its whole bound at every quit (#276). Guarded
            // because `serve` is typed for HTTP/2 too; ours is plain HTTP.
            if ("closeAllConnections" in server) server.closeAllConnections();
            await new Promise<void>((done, fail) => {
              server.close((err) => (err ? fail(err) : done()));
            });
          },
        });
      }
    );
  });
}
