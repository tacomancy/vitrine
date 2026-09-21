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

/**
 * What `vault.status()` answers (`docs/architecture.md` § Index). `watching`
 * joins with the watcher (#190); `current` is here from the start so that
 * beat 5's Ingest reads it from the one place (spec #177).
 */
export type VaultStatus = IndexStatus;

export type VaultServiceOptions = {
  host: Host;
  /** Where the core keeps its own state; the remembered vault path lives here. */
  appSupportDir: string;
  index?: IndexOptions | undefined;
  /** The watcher's settle window; tests shorten it (ADR 0013 decision 5). */
  settleMs?: number | undefined;
};

export type VaultService = {
  current: () => Promise<Vault | null>;
  open: (path: string) => Promise<Vault>;
  /** Ask the host for a folder and open it; null when the user cancelled. */
  pick: () => Promise<Vault | null>;
  /** The open vault with its index, or null: what a procedure that needs both asks for. */
  opened: () => Promise<Opened | null>;
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

/** Everything held per open vault, torn down together by the next `open` or exit. */
export type Opened = { vault: Vault; index: VaultIndex; watcher: Watcher };

export function createVaultService({
  host,
  appSupportDir,
  index: indexOptions,
  settleMs = SETTLE_MS,
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

  function teardown(): void {
    opened?.watcher.close();
    opened?.index.close();
    opened = null;
  }

  /**
   * Install the new vault and start its build. The previous vault's
   * resources go first: one index handle and one watcher per process,
   * never two on different vaults. The order is *watch, then sweep* (ADR
   * 0013 decision 3): a file written during the sweep is then either seen
   * by the walk or delivered as an event, never missed by both.
   */
  async function install(vault: Vault, index: VaultIndex): Promise<void> {
    teardown();
    const watcher = await watchVault(vault.path, {
      settleMs,
      onSettled: (paths) => index.refresh(paths),
      // Reopening and reporting `watching` is #190; until then the failure
      // is at least in the core's log, never swallowed.
      onError: (reason) =>
        console.error(`vitrine-core: the watcher failed: ${reason}`),
    });
    opened = { vault, index, watcher };
    // Never awaited: the app opens at once and indexes in the background
    // (ADR 0014 decision 10). The sweep reports its own failure as a
    // status reason rather than rejecting.
    void index.sweep();
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
    close: teardown,
  };
}
