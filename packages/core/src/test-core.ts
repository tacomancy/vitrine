import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type AppOptions } from "./app.js";
import type { Host } from "./host.js";

const token = "test-token";
export const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures"
);

/** A host whose chooser always answers the same way. */
export function fakeHost(picked: string | null): Host {
  return { pickFolder: () => Promise.resolve(picked) };
}

export async function tmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `vitrine-${prefix}-`));
}

/** What a tRPC reply looks like on the wire, as far as a test needs. */
export type Reply<T> = {
  result?: { data: T };
  error?: { message: string; data: { kind?: string } };
};

/**
 * The core in-process, driven as a caller would drive it: plain requests
 * with the bearer token, no socket. Every test asserts on the reply and on
 * disk, never on how the core got there.
 */
export async function core(
  opts: Partial<Omit<AppOptions, "token">> = {}
): Promise<{
  appSupportDir: string;
  query: <T>(path: string, input?: unknown) => Promise<Reply<T>>;
  mutate: <T>(path: string, input?: unknown) => Promise<Reply<T>>;
}> {
  const appSupportDir = opts.appSupportDir ?? (await tmp("support"));
  const app = createApp({
    ...opts,
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

/**
 * Every entry under a folder with a hash of each file's bytes, so a test can
 * assert that opening left the folder byte-for-byte as it found it.
 */
export async function fingerprint(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (entry.isDirectory()) {
        out.push(`${rel}/`);
        await walk(full);
      } else {
        const hash = createHash("sha256")
          .update(await readFile(full))
          .digest("hex");
        out.push(`${rel}:${hash}`);
      }
    }
  }
  await walk(root);
  return out.sort();
}
