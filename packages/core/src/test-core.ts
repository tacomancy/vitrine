import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type AppOptions } from "./app.js";
import type { Host } from "./host.js";
import { readOutline, type WriteResult } from "./vault-files.js";

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

// Helpers the vault-files tests share: a temp vault, a corpus copy, and the
// hash a caller carries into a write.

export const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export const hashOf = async (path: string) => sha256(await readFile(path));
export const bytes = (path: string) => readFile(path, "utf8");

/** A temp vault holding these files, written as given. */
export async function vaultWith(
  files: Record<string, string>
): Promise<string> {
  const vault = await tmp("vault");
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(vault, name, ".."), { recursive: true });
    await writeFile(join(vault, name), content);
  }
  return vault;
}

/** A temp vault holding a copy of one Obsidian-corpus file, untouched by Obsidian since. */
export async function corpusCopy(
  name: string
): Promise<{ vault: string; original: string }> {
  const vault = await tmp("corpus-copy");
  await copyFile(join(fixtures, "obsidian-corpus", name), join(vault, name));
  return { vault, original: await readFile(join(vault, name), "utf8") };
}

/** The hash a caller carries into a write: what the read gave it. */
export async function basedOn(vault: string, path: string): Promise<string> {
  const read = await readOutline(vault, path);
  if (!read.readable) throw new Error(`unreadable: ${read.reason}`);
  return read.hash;
}

export function written(result: WriteResult) {
  if (!result.written) {
    throw new Error(`refused: ${result.reason} — ${result.detail}`);
  }
  return result;
}

export function refused(result: WriteResult) {
  if (result.written) throw new Error("expected a refusal");
  return result;
}
