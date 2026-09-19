// Shared by the router suites: a core constructed in-process with a fake
// host and a temp app-support folder, called as a plain request.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import type { Host } from "./host.js";

export const token = "test-token";
export const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures"
);

/** A host whose chooser always answers the same way. */
export function fakeHost(picked: string | null): Host {
  return { pickFolder: () => Promise.resolve(picked) };
}

export async function tmp(prefix: string) {
  return mkdtemp(join(tmpdir(), `vitrine-${prefix}-`));
}

export type Reply<T> = {
  result?: { data: T };
  error?: { message: string; data: { kind?: string; code?: string } };
};

export async function core(opts: { host?: Host; appSupportDir?: string } = {}) {
  const appSupportDir = opts.appSupportDir ?? (await tmp("support"));
  const app = createApp({
    token,
    host: opts.host ?? fakeHost(null),
    appSupportDir,
  });
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  return {
    appSupportDir,
    query: async <T>(path: string, input?: unknown) => {
      const url =
        input === undefined
          ? `/trpc/${path}`
          : `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
      const res = await app.request(url, { headers });
      return (await res.json()) as Reply<T>;
    },
    mutate: async <T>(path: string, input?: unknown) => {
      const res = await app.request(`/trpc/${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(input ?? {}),
      });
      return (await res.json()) as Reply<T>;
    },
  };
}
