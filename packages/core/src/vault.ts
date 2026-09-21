import type { watch as fsWatch } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { errorMessage, VaultError } from "./errors.js";
import type { Host } from "./host.js";
import { SETTLE_MS, watchVault, type Watcher } from "./vault-watcher.js";
import {
  IndexOpenError,
  openIndex,
  type IndexOptions,
  type IndexStatus,
  type VaultIndex,
} from "./vault-index.js";

export type Vault = { name: string; path: string };

/** Whether changes made outside the app are reaching the index; false is *Not watching* (`CONTEXT.md`). */
export type Watching = { ok: true } | { ok: false; reason: string };

/**
 * What `vault.status()` answers (`docs/architecture.md` § Index). `current`
 * is the index's, with the watcher's health folded in, so that beat 5's
 * Ingest reads every reason ADR 0014 decision 11 names from one place.
 */
export type VaultStatus = IndexStatus & { watching: Watching };

export type VaultServiceOptions = {
  host: Host;
  /** Where the core keeps its own state; the remembered vault path lives here. */
  appSupportDir: string;
  index?: IndexOptions | undefined;
  /** The watcher's settle window; tests shorten it (ADR 0013 decision 5). */
  settleMs?: number | undefined;
  /** `fs.watch`, or a test's wrapper that fails or refuses a watch (#190). */
  watch?: typeof fsWatch | undefined;
};

export type VaultService = {
  current: () => Promise<Vault | null>;
  open: (path: string) => Promise<Vault>;
  /** Ask the host for a folder and open it; null when the user cancelled. */
  pick: () => Promise<Vault | null>;
  /** The open vault with its index, or null: what a procedure that needs both asks for. */
  opened: () => Promise<Opened | null>;
  /** `vault.status`, for the open vault; null when none is. */
  status: () => Promise<VaultStatus | null>;
  /** Reopen a watcher that is down for good, then sweep; resolves once both have been tried. */
  rewatch: () => Promise<void>;
  /** Tear down the open vault's resources; called on exit. The next `open` does the same. */
  close: () => void;
};

/** Throws a VaultError unless the path is a folder this process can list. */
async function validateFolder(path: string): Promise<void> {
  let isDirectory = false;
  try {
    isDirectory = (await stat(path)).isDirectory();
  } catch {
    // Missing counts as not a folder.
  }
  if (!isDirectory) {
    throw new VaultError(
      "notAFolder",
      `${path} is not a folder. Choose a folder.`
    );
  }
  try {
    await readdir(path);
  } catch {
    throw new VaultError(
      "unreadable",
      `${path} can't be read. Check its permissions.`
    );
  }
}

/** The last vault opened, so the next launch skips First run. */
const LAST_VAULT_FILE = "last-vault.json";

/**
 * Everything held per open vault, torn down together by the next `open` or
 * exit. `watcher` is null while none is live: between a failure and its
 * reopen, or for good when the reopen failed (`watching.ok` false).
 */
export type Opened = {
  vault: Vault;
  index: VaultIndex;
  watcher: Watcher | null;
  watching: Watching;
  /** A failed watcher is being reopened; the index is not current meanwhile. */
  reopening: boolean;
  /** The install this belongs to; a stale one is overtaken and discards what it makes. */
  generation: number;
};

export function createVaultService({
  host,
  appSupportDir,
  index: indexOptions,
  settleMs = SETTLE_MS,
  watch,
}: VaultServiceOptions): VaultService {
  const lastVaultFile = join(appSupportDir, LAST_VAULT_FILE);
  let opened: Opened | null = null;

  async function remember(path: string): Promise<void> {
    await mkdir(appSupportDir, { recursive: true });
    await writeFile(lastVaultFile, JSON.stringify({ path }) + "\n");
  }

  async function remembered(): Promise<string | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(lastVaultFile, "utf8"));
      if (typeof parsed === "object" && parsed !== null && "path" in parsed) {
        return typeof parsed.path === "string" ? parsed.path : null;
      }
    } catch {
      // No file yet, or one that does not parse. Either way the outcome is
      // First run, which is the honest answer; nothing the user did is lost.
    }
    return null;
  }

  /** A vault whose `.vitrine/` cannot hold the index is refused: it could not hold a Question either. */
  async function openResources(absolute: string): Promise<VaultIndex> {
    try {
      return await openIndex(absolute, indexOptions);
    } catch (cause) {
      if (cause instanceof IndexOpenError) {
        throw new VaultError("writeFailed", cause.message);
      }
      throw cause;
    }
  }

  // Bumped by every install and by close, so an install still waiting on
  // its watcher — or a watcher reporting its death later — can tell it has
  // been overtaken and discard what it made.
  let generation = 0;
  const overtaken = (o: Opened) => o.generation !== generation;

  function teardown(): void {
    opened?.watcher?.close();
    opened?.index.close();
    opened = null;
  }

  /** Watcher state changed: the renderer re-reads `vault.status` (§ Watcher and Ingest). */
  const raiseStatus = async () => {
    await indexOptions?.onStatus?.();
  };

  /**
   * Bring a watcher up for `o`. A watch that cannot be brought up live does
   * not refuse the vault: it is *not watching*, the sweep still runs so
   * what is on disk is at least read once, and only `current` says the
   * rows may not be trusted.
   *
   * `retried` marks a watcher that is itself the one automatic reopen. Its
   * own death is not reopened again but reported: one reopen recovers a
   * transient FSEvents fault, and anything that kills two watches in a row
   * is something the user should see and retry deliberately, rather than a
   * loop of reopen-and-sweep the footer never shows.
   */
  async function startWatcher(o: Opened, retried: boolean): Promise<void> {
    o.watcher = null;
    try {
      const watcher = await watchVault(o.vault.path, {
        settleMs,
        watch,
        onSettled: (paths) => o.index.refresh(paths),
        onBatchFailed: (reason) =>
          console.error(`vitrine-core: the watcher failed: ${reason}`),
        onError: (reason) => {
          if (overtaken(o)) return;
          o.watcher = null;
          if (retried) {
            o.watching = { ok: false, reason };
            void raiseStatus();
            return;
          }
          o.reopening = true;
          void raiseStatus();
          void watchAndSweep(o, true);
        },
      });
      if (overtaken(o)) {
        watcher.close();
        return;
      }
      o.watcher = watcher;
      o.watching = { ok: true };
    } catch (cause) {
      o.watching = { ok: false, reason: errorMessage(cause) };
    }
  }

  /**
   * *Watch, then sweep* (ADR 0013 decision 3): a file written during the
   * sweep is either seen by the walk or delivered as an event, never missed
   * by both. Used for the reopen after a failure and for `rewatch`; the
   * open-time run is `install`, which swaps the vault in between the two.
   */
  async function watchAndSweep(o: Opened, retried: boolean): Promise<void> {
    await startWatcher(o, retried);
    if (overtaken(o)) return;
    o.reopening = false;
    // Never awaited: the app opens at once and indexes in the background
    // (ADR 0014 decision 10). The sweep reports its own failure as a
    // status reason rather than rejecting. Started before the status is
    // raised, so a reader woken by the event never sees the watcher back
    // and the index current with the catch-up still to come.
    void o.index.sweep();
    await raiseStatus();
  }

  /**
   * Install the new vault and start its build. The watcher comes up first
   * and only then does the previous vault go: one index handle and one
   * watcher per vault, and the old vault answers until the new one can.
   */
  async function install(vault: Vault, index: VaultIndex): Promise<void> {
    const o: Opened = {
      vault,
      index,
      watcher: null,
      watching: { ok: true },
      reopening: false,
      generation: ++generation,
    };
    await startWatcher(o, false);
    if (overtaken(o)) {
      // A later open or the exit got here first; nothing of ours is wanted.
      o.watcher?.close();
      index.close();
      return;
    }
    teardown();
    opened = o;
    void index.sweep();
    // Not awaited: a listener that answers by reading `vault.status` waits
    // on `restored`, which may be waiting on this very install.
    void raiseStatus();
  }

  // A remembered vault that has moved or gone is First run, not a fault, so
  // its failure is swallowed here and nowhere else. One whose `.vitrine/`
  // can no longer be written is a fault with nowhere to show yet — no vault
  // is open, so `vault.status` cannot carry it — so it reaches the core's
  // log and the user sees First run; reopening the folder says why.
  const restored = (async () => {
    const path = await remembered();
    if (path === null) return;
    try {
      await validateFolder(path);
    } catch {
      return;
    }
    try {
      await install({ name: basename(path), path }, await openResources(path));
    } catch (cause) {
      console.error(`vitrine-core: ${errorMessage(cause)}`);
    }
  })();

  async function open(path: string): Promise<Vault> {
    await restored;
    const absolute = resolve(path);
    await validateFolder(absolute);
    const index = await openResources(absolute);
    // Remembered only here, after validation and the index, so a failed
    // open can never overwrite a good path — and remembered before it
    // becomes current, so an open either happens whole or not at all.
    try {
      await remember(absolute);
    } catch (cause) {
      index.close();
      throw cause;
    }
    const vault = { name: basename(absolute), path: absolute };
    await install(vault, index);
    return vault;
  }

  return {
    current: async () => {
      await restored;
      return opened?.vault ?? null;
    },
    open,
    pick: async () => {
      const path = await host.pickFolder();
      return path === null ? null : open(path);
    },
    opened: async () => {
      await restored;
      return opened;
    },
    status: async () => {
      await restored;
      if (opened === null) return null;
      const { indexing, current } = opened.index.status();
      // Every reason ADR 0014 decision 11 names, the index's first: an
      // unfinished sweep is the larger gap, and the sweep after a reopen is
      // what closes the watcher's.
      const watcherReason = !opened.watching.ok
        ? `not watching: ${opened.watching.reason}`
        : opened.reopening
          ? "the watcher is being reopened"
          : null;
      return {
        indexing,
        watching: opened.watching,
        current:
          current.ok && watcherReason !== null
            ? { ok: false, reason: watcherReason }
            : current,
      };
    },
    rewatch: async () => {
      await restored;
      // Nothing to do while a watcher is live or the automatic reopen is
      // still under way: a second start would leave one of the two orphaned.
      if (opened === null || opened.watcher !== null || opened.reopening) {
        return;
      }
      await watchAndSweep(opened, false);
    },
    close: () => {
      generation++;
      teardown();
    },
  };
}
