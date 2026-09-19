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
};

// Where macOS expects an app's own files (docs/architecture.md § Vault layout).
const DEFAULT_APP_SUPPORT_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "Vitrine"
);

// A core with no host — started by hand, or later the iPad's — has no chooser.
const NO_HOST: Host = { pickFolder: () => Promise.resolve(null) };

const CSP = "default-src 'self'; img-src 'self' data:";

export type RunningCore = {
  port: number;
  token: string;
  close: () => Promise<void>;
};

/**
 * Bind the core to loopback on a port the OS picks, so nothing off the machine
 * can reach it and two instances never fight over a fixed number.
 */
export function startCore(options: StartOptions = {}): Promise<RunningCore> {
  const token = randomBytes(32).toString("base64url");
  const app = createApp({
    token,
    host: options.host ?? NO_HOST,
    appSupportDir: options.appSupportDir ?? DEFAULT_APP_SUPPORT_DIR,
  });
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
          close: () =>
            new Promise((done, fail) => {
              server.close((err) => (err ? fail(err) : done()));
            }),
        });
      }
    );
  });
}
