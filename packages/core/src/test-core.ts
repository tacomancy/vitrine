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
import type { ArxivClock } from "./arxiv.js";
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

/** A host whose choosers always answer the same way: a folder, and a file. */
export function fakeHost(
  picked: string | null,
  pickedFile: string | null = null
): Host {
  return {
    pickFolder: () => Promise.resolve(picked),
    pickFile: () => Promise.resolve(pickedFile),
    reveal: () => {},
    trash: () => Promise.resolve(),
  };
}

/**
 * An arXiv clock that only moves when someone sleeps on it: the three-second
 * gap is read off it and asserted, never waited for.
 */
export function virtualClock(): ArxivClock & { slept: number[] } {
  let at = 1_000_000;
  const slept: number[] = [];
  return {
    now: () => at,
    sleep: (ms) => {
      slept.push(ms);
      at += ms;
      return Promise.resolve();
    },
    slept,
  };
}

/** The URL a `fetch` was asked for, whichever of its three forms it came in. */
export const urlOf = (input: string | URL | Request): URL =>
  new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  );

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

/**
 * How long a core built here lets the watch probe go unanswered. `vault.open`
 * awaits the probe, and the production bound (5 s, `vault-watcher.ts`) is
 * Vitest's own default: a probe starved by a loaded FSEvents ran the test out
 * before the watcher could give up, and failed as a bare timeout naming no
 * wait. Under it, the give-up runs and says why — *not watching: the watch
 * gave no sign of life* — which `indexed()` and every `current` read carry.
 *
 * Well above what a probe takes when the machine is merely busy — a whole
 * open peaked at 134 ms across 244 opens under #397's stress loop (parallel
 * suites beside shell loops churning `/tmp`). And short enough that an open
 * and an `indexed()` behind it (`NEXT_TIMEOUT_MS`) still fit inside 5 s. The production bound is not this number (ADR 0029, #272).
 */
const HARNESS_PROBE_TIMEOUT_MS = 1000;

// Every core a test file started, so `closeCores` can tear them down: a
// watcher left open keeps reporting into later tests.
const cores: Array<() => Promise<void>> = [];

/** Tear down every core started so far; for a suite's `afterEach`. */
export async function closeCores(): Promise<void> {
  for (const close of cores.splice(0)) await close();
}

/**
 * The core in-process, driven as a caller would drive it: plain requests
 * with the bearer token, no socket. Every test asserts on the reply and on
 * disk, never on how the core got there. `indexed()` waits for the open
 * vault to be current — on status changes, never on a timer, but bounded as
 * a `next()` is (`NEXT_TIMEOUT_MS`) — and `changes` is every `vaultChanged`
 * raised so far.
 */
export async function core(opts: CoreOptions = {}): Promise<{
  appSupportDir: string;
  query: <T>(path: string, input?: unknown) => Promise<Reply<T>>;
  mutate: <T>(path: string, input?: unknown) => Promise<Reply<T>>;
  /** A request as given, no token added: for what the guard does before the router. */
  raw: (path: string, init?: RequestInit) => Promise<Response>;
  /** The window came to the front, as the shell reports it (#243). */
  focused: () => Promise<void>;
  indexed: () => Promise<void>;
  /** Close this core now, as the app's exit does — pending Revisions spliced (#217). */
  close: () => Promise<void>;
  changes: VaultChanged[];
  /** Subscribe to `events.subscribe`; resolves once the stream is connected. */
  events: () => Promise<EventStream>;
}> {
  const appSupportDir = opts.appSupportDir ?? (await tmp("support"));
  const changes: VaultChanged[] = [];
  const statusWaiters: Array<() => void> = [];
  // What `current` last said when it was not ok: what a wait that runs out
  // reports, since "never came current" alone does not say what was missing.
  let notCurrent = "no status was read";
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
  const { app, close, focused } = createApp({
    token,
    host: opts.host ?? fakeHost(null),
    appSupportDir,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.newId ? { newId: opts.newId } : {}),
    ...(opts.author ? { author: opts.author } : {}),
    ...(opts.arxiv ? { arxiv: opts.arxiv } : {}),
    ...(opts.watched ? { watched: opts.watched } : {}),
    // Off unless a test asks: the tracer's Scouts must not run on open.
    scoutCheckMs: opts.scoutCheckMs ?? null,
    machine: opts.machine ?? "this-mac",
    ...(opts.settleMs !== undefined ? { settleMs: opts.settleMs } : {}),
    ...(opts.coalesceMs !== undefined ? { coalesceMs: opts.coalesceMs } : {}),
    ...(opts.stalledOpenDays !== undefined
      ? { stalledOpenDays: opts.stalledOpenDays }
      : {}),
    ...(opts.watch ? { watch: opts.watch } : {}),
    probeTimeoutMs: opts.probeTimeoutMs ?? HARNESS_PROBE_TIMEOUT_MS,
    ...(opts.pdfWorker ? { pdfWorker: opts.pdfWorker } : {}),
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
        const current = reply.result?.data.current;
        if (current?.ok) {
          for (const wake of statusWaiters.splice(0)) wake();
        } else if (current) {
          notCurrent = current.reason;
        }
      },
    },
  });
  cores.push(close);
  return {
    appSupportDir,
    close,
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
    // The shell's focus report, at the seam the shell itself uses (#243).
    focused,
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
      let wake: () => void = () => undefined;
      const current = new Promise<void>((resolve) => {
        wake = resolve;
        statusWaiters.push(resolve);
      });
      const reply = await query<VaultStatus>("vault.status");
      if (reply.error) throw new Error(reply.error.message);
      const now = reply.result!.data.current;
      if (now.ok) return;
      notCurrent = now.reason;
      // Bounded: a status change the core never raises would otherwise hang
      // into a bare Vitest timeout, which names no wait at all (#294).
      let timer: NodeJS.Timeout | undefined;
      const lost = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `waited ${NEXT_TIMEOUT_MS}ms for the vault to be current: ${notCurrent}`
              )
            ),
          NEXT_TIMEOUT_MS
        );
      });
      try {
        await Promise.race([current, lost]);
      } finally {
        clearTimeout(timer);
        // Off the list, as `next()` drops its waiter: nothing waits on it now.
        const at = statusWaiters.indexOf(wake);
        if (at !== -1) statusWaiters.splice(at, 1);
      }
    },
    changes,
  };
}

/**
 * The core's event stream as a caller reads it: `next()` is the next event
 * (of one type, when named), awaited rather than slept for — every wait in a
 * watcher test is on one of these. Bounded, so an event that never comes
 * fails saying which one was lost (`NEXT_TIMEOUT_MS`); a stream that dies under
 * a wait fails with what killed it, which no bound would have told anyone.
 */
export type EventStream = {
  next: <T extends CoreEvent["type"]>(
    type?: T,
    options?: { timeoutMs?: number }
  ) => Promise<Extract<CoreEvent, { type: T }>>;
  close: () => void;
};

/**
 * How long a `next()` waits before it says the event never came. Well under
 * Vitest's 5 s default so this bound always wins that race: a bare `Test timed
 * out` says the test was slow, where a lost event has to say which event was
 * lost (#294, after #292 took an instrumented CI run to tell the two apart).
 *
 * Ten times the widest settle window any suite injects (200 ms,
 * `vault-watcher.test.ts`), so it is a diagnostic and not a new constraint —
 * no wait that passes today comes near it. A test that legitimately needs
 * longer passes its own `timeoutMs`, as the timing tests there pass their own
 * budget to `it`.
 *
 * One wait it is deliberately *not* long enough for: a watcher-driven event on
 * a core built without `settleMs`, which is due at the production `SETTLE_MS`
 * (2 s, `vault-watcher.ts`) and would be called lost here. Inject a small
 * settle window, as every watcher suite does — no suite should be waiting out
 * a production timing constant anyway.
 */
export const NEXT_TIMEOUT_MS = 2000;

/** One outstanding `next()`: handed the event it waited for, or told why not. */
type Waiter = {
  deliver: (event: CoreEvent) => void;
  giveUp: (cause: string) => void;
};

/**
 * What a wait on a stream that has stopped carrying events is told: the cause
 * reads into the sentence, so the body's own reason travels with it rather than
 * being replaced by a bound that was never reached (#308).
 */
const streamDied = (cause: string, awaited: string) =>
  new Error(`the event stream ${cause} while waiting for ${awaited}`);

/**
 * Read tRPC's SSE framing off a fetch Response: each message is `event:`
 * and `data:` lines closed by a blank line; the `connected`, `ping`, and
 * `return` messages carry no event of ours.
 *
 * Exported for `events.test.ts` alone, which drives it over a body it can end
 * or fail on demand: what a dead stream tells a wait cannot be provoked
 * through a live core (#308).
 */
export async function openEventStream(
  request: (signal: AbortSignal) => Promise<Response>
): Promise<EventStream> {
  const controller = new AbortController();
  const res = await request(controller.signal);
  const body: ReadableStream<Uint8Array> | null = res.body;
  if (res.status !== 200 || body === null) {
    throw new Error(`events.subscribe answered ${res.status}`);
  }
  const queue: CoreEvent[] = [];
  const waiters: Waiter[] = [];
  // Why the stream stopped carrying events, once it has; `null` while it is
  // live. Kept because a wait that arrives after the death has nothing else to
  // be told, and would otherwise sit out its bound for an event that can no
  // longer come.
  let stopped: string | null = null;
  const end = (cause: string) => {
    // First cause only: a deliberate `close()` aborts the body, and the abort
    // error it raises must not rewrite what the stream is said to have done.
    if (stopped !== null) return;
    stopped = cause;
    for (const waiter of waiters.splice(0)) waiter.giveUp(cause);
  };
  const drop = (waiter: Waiter) => {
    const at = waiters.indexOf(waiter);
    if (at !== -1) waiters.splice(at, 1);
  };
  let connected: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (connected = resolve));

  const deliver = (event: CoreEvent) => {
    const waiter = waiters.shift();
    if (waiter) waiter.deliver(event);
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
  void consume().then(
    () => end("ended"),
    (cause: unknown) =>
      end(`failed (${cause instanceof Error ? cause.message : String(cause)})`)
  );
  await opened;

  /**
   * The next event of any type: `lost()` once `withinMs` has passed, or what
   * the stream died of if it is no longer carrying events.
   */
  const next = (withinMs: number, awaited: string, lost: () => Error) =>
    new Promise<CoreEvent>((resolve, reject) => {
      const queued = queue.shift();
      if (queued) {
        resolve(queued);
        return;
      }
      // Checked after the queue and never before it: an event delivered before
      // the stream died is still this wait's answer, or the instrument invents
      // a failure of its own.
      if (stopped !== null) {
        reject(streamDied(stopped, awaited));
        return;
      }
      const waiter: Waiter = {
        deliver: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
        giveUp: (cause) => {
          clearTimeout(timer);
          reject(streamDied(cause, awaited));
        },
      };
      const timer = setTimeout(() => {
        // Off the list first: a waiter left behind would be handed the next
        // event that does arrive, and swallow it from the wait that wanted it.
        drop(waiter);
        reject(lost());
      }, withinMs);
      waiters.push(waiter);
    });
  return {
    next: async <T extends CoreEvent["type"]>(
      type?: T,
      { timeoutMs = NEXT_TIMEOUT_MS }: { timeoutMs?: number } = {}
    ) => {
      const awaited = type ?? "any event";
      const seen: Array<CoreEvent["type"]> = [];
      // One deadline for the whole wait, not one per arrival: a stream of
      // unrelated events must not buy the awaited one more time.
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const event = await next(
          Math.max(deadline - Date.now(), 0),
          awaited,
          () =>
            new Error(
              `waited ${timeoutMs}ms on the event stream for ${awaited}: ` +
                (seen.length === 0
                  ? "nothing arrived"
                  : `saw ${seen.join(", ")}`) +
                // Not a guess: `end` answers every waiter itself, so the bound
                // is only ever reached on a live stream. Said outright because
                // "was the stream even alive?" is the question a wait that
                // names nothing leaves open.
                ", and the stream was still open"
            )
        );
        if (type === undefined || event.type === type) {
          return event as Extract<CoreEvent, { type: T }>;
        }
        seen.push(event.type);
      }
    },
    close: () => {
      // Before the abort, which reaches the body as an error: a wait still
      // outstanding can never be satisfied now, so it is given its answer here
      // rather than left to sit out its bound on a live timer and reject into
      // a test that has moved on — and what it is told is that the test closed
      // the stream, not what aborting the body raised.
      end("closed");
      controller.abort();
    },
  };
}

// The app's disposable index and the `.gitignore` that covers it (ADR 0014):
// written by every open, rewritten by every own write, and not vault content.
const INDEX_FILES =
  /^\.vitrine\/((index|queue)\.sqlite(-wal|-shm)?|\.gitignore)$/;

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
