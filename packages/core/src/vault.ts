import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { Host } from "./host.js";

export type Vault = { name: string; path: string };

export type VaultErrorKind = "notAFolder" | "unreadable";

/** Why an open was refused, with a message fit to show as it is. */
export class VaultError extends Error {
  constructor(
    readonly kind: VaultErrorKind,
    message: string
  ) {
    super(message);
    this.name = "VaultError";
  }
}

export type VaultServiceOptions = {
  host: Host;
  /** Where the core keeps its own state; the remembered vault path lives here. */
  appSupportDir: string;
};

export type VaultService = {
  current: () => Promise<Vault | null>;
  open: (path: string) => Promise<Vault>;
  /** Ask the host for a folder and open it; null when the user cancelled. */
  pick: () => Promise<Vault | null>;
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

export function createVaultService({
  host,
  appSupportDir,
}: VaultServiceOptions): VaultService {
  const lastVaultFile = join(appSupportDir, LAST_VAULT_FILE);
  let current: Vault | null = null;

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

  // A remembered vault that has moved or gone is First run, not a fault, so
  // its failure is swallowed here and nowhere else.
  const restored = (async () => {
    const path = await remembered();
    if (path === null) return;
    try {
      await validateFolder(path);
      current = { name: basename(path), path };
    } catch {
      current = null;
    }
  })();

  async function open(path: string): Promise<Vault> {
    await restored;
    const absolute = resolve(path);
    await validateFolder(absolute);
    // Remembered only here, after validation, so a failed open can never
    // overwrite a good path — and remembered before it becomes current, so
    // an open either happens whole or not at all.
    await remember(absolute);
    current = { name: basename(absolute), path: absolute };
    return current;
  }

  return {
    current: async () => {
      await restored;
      return current;
    },
    open,
    pick: async () => {
      const path = await host.pickFolder();
      return path === null ? null : open(path);
    },
  };
}
