import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
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
import type { CoreEvent } from "./events.js";
import type { PositionsOf, VaultChanged } from "./vault-index.js";
import type { VaultStatus } from "./vault.js";

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

export type CoreOptions = Partial<
  Omit<AppOptions, "token" | "index"> & {
    chunkSize: number;
    positionsOf: PositionsOf;
    /** Awaited by the index before its next chunk, as the real listener is (#188). */
    onVaultChanged: (event: VaultChanged) => void | Promise<void>;
    onVaultStatus: () => void | Promise<void>;
  }
>;

// Every core a test file started, so `closeCores` can tear them down: a
// watcher left open keeps reporting into later tests.
const cores: Array<() => void> = [];

/** Tear down every core started so far; for a suite's `afterEach`. */
export function closeCores(): void {
  for (const close of cores.splice(0)) close();
}

/**
 * The core in-process, driven as a caller would drive it: plain requests
 * with the bearer token, no socket. Every test asserts on the reply and on
 * disk, never on how the core got there. `indexed()` waits for the open
 * vault to be current — on status changes, never on a timer — and
 * `changes` is every `vaultChanged` raised so far.
 */
export async function core(opts: CoreOptions = {}): Promise<{
  appSupportDir: string;
  query: <T>(path: string, input?: unknown) => Promise<Reply<T>>;
  mutate: <T>(path: string, input?: unknown) => Promise<Reply<T>>;
  /** A request as given, no token added: for what the guard does before the router. */
  raw: (path: string, init?: RequestInit) => Promise<Response>;
  indexed: () => Promise<void>;
  changes: VaultChanged[];
  /** Subscribe to `events.subscribe`; resolves once the stream is connected. */
  events: () => Promise<EventStream>;
}> {
  const appSupportDir = opts.appSupportDir ?? (await tmp("support"));
  const changes: VaultChanged[] = [];
  const statusWaiters: Array<() => void> = [];
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const query = async <T>(path: string, input?: unknown) => {
    const url =
      input === undefined
        ? `/trpc/${path}`
        : `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await app.request(url, { headers });
    return (await res.json()) as Reply<T>;
  };
  const { app, close } = createApp({
    token,
    host: opts.host ?? fakeHost(null),
    appSupportDir,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.newId ? { newId: opts.newId } : {}),
    ...(opts.settleMs !== undefined ? { settleMs: opts.settleMs } : {}),
    index: {
      chunkSize: opts.chunkSize,
      positionsOf: opts.positionsOf,
      onChanged: async (event) => {
        changes.push(event);
        await opts.onVaultChanged?.(event);
      },
      onStatus: async () => {
        await opts.onVaultStatus?.();
        // Checked here, after the test's own listener, so `indexed()`
        // resolves only once the event that made the vault current has
        // been seen by everyone.
        const reply = await query<VaultStatus>("vault.status");
        if (reply.result?.data.current.ok) {
          for (const wake of statusWaiters.splice(0)) wake();
        }
      },
    },
  });
  cores.push(close);
  return {
    appSupportDir,
    query,
    mutate: async <T>(path: string, input?: unknown) => {
      const res = await app.request(`/trpc/${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(input ?? {}),
      });
      return (await res.json()) as Reply<T>;
    },
    raw: async (path, init) => app.request(path, init),
    events: () =>
      openEventStream(async (signal) =>
        app.request("/trpc/events.subscribe", {
          headers: { ...headers, accept: "text/event-stream" },
          signal,
        })
      ),
    indexed: async () => {
      // Registered before the status is read, so an event that lands
      // during the read is not missed; a waiter left behind by an early
      // return is woken and ignored, nothing more.
      const current = new Promise<void>((wake) => statusWaiters.push(wake));
      const reply = await query<VaultStatus>("vault.status");
      if (reply.error) throw new Error(reply.error.message);
      if (reply.result?.data.current.ok) return;
      await current;
    },
    changes,
  };
}

/**
 * The core's event stream as a caller reads it: `next()` is the next event
 * (of one type, when named), awaited rather than slept for — every wait in a
 * watcher test is on one of these.
 */
export type EventStream = {
  next: <T extends CoreEvent["type"]>(
    type?: T
  ) => Promise<Extract<CoreEvent, { type: T }>>;
  close: () => void;
};

/**
 * Read tRPC's SSE framing off a fetch Response: each message is `event:`
 * and `data:` lines closed by a blank line; the `connected`, `ping`, and
 * `return` messages carry no event of ours.
 */
async function openEventStream(
  request: (signal: AbortSignal) => Promise<Response>
): Promise<EventStream> {
  const controller = new AbortController();
  const res = await request(controller.signal);
  const body: ReadableStream<Uint8Array> | null = res.body;
  if (res.status !== 200 || body === null) {
    throw new Error(`events.subscribe answered ${res.status}`);
  }
  const queue: CoreEvent[] = [];
  const waiters: Array<(event: CoreEvent) => void> = [];
  let connected: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (connected = resolve));

  const deliver = (event: CoreEvent) => {
    const waiter = waiters.shift();
    if (waiter) waiter(event);
    else queue.push(event);
  };
  const consume = async () => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf("\n\n")) !== -1) {
        const message = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        let kind: string | null = null;
        let data = "";
        for (const line of message.split("\n")) {
          if (line.startsWith("event: ")) kind = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (kind === "connected") connected();
        else if (kind === null && data !== "") {
          deliver(JSON.parse(data) as CoreEvent);
        }
      }
    }
  };
  void consume().catch(() => undefined);
  await opened;

  const next = () =>
    new Promise<CoreEvent>((resolve) => {
      const queued = queue.shift();
      if (queued) resolve(queued);
      else waiters.push(resolve);
    });
  return {
    next: async <T extends CoreEvent["type"]>(type?: T) => {
      for (;;) {
        const event = await next();
        if (type === undefined || event.type === type) {
          return event as Extract<CoreEvent, { type: T }>;
        }
      }
    },
    close: () => controller.abort(),
  };
}

// The app's disposable index and the `.gitignore` that covers it (ADR 0014):
// written by every open, rewritten by every own write, and not vault content.
const INDEX_FILES = /^\.vitrine\/(index\.sqlite(-wal|-shm)?|\.gitignore)$/;

/**
 * Every entry under a folder with a hash of each file's bytes, so a test can
 * assert that opening left the folder byte-for-byte as it found it. The
 * index files under `.vitrine/` are left out — `vault-index.test.ts` is
 * where they are looked at — so `.vitrine/` alone is what an open adds.
 */
export async function fingerprint(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (INDEX_FILES.test(rel)) continue;
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

/**
 * A temp copy of one checked-in fixture folder, to open as a vault: an open
 * writes `.vitrine/` into the vault, which must never land in the repo.
 */
export async function fixtureCopy(name: string): Promise<string> {
  const vault = join(await tmp(name), name);
  await cp(join(fixtures, name), vault, {
    recursive: true,
    // Never carry an index a stray in-place open may have left behind.
    filter: (source) => !source.includes("/.vitrine"),
  });
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
