import { randomUUID } from "node:crypto";
import type { watch as fsWatch } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { lastArrival, type LastArrival } from "./last-arrival.js";
import {
  PDF_FOLDER,
  readPdfFault,
  readPdfFolder,
  type PdfFault,
  type PdfFolder,
} from "./pdf-folder.js";
import { renameDismissals } from "./dismissals.js";
import { createIngest, type Ingest, type IngestRun } from "./ingest.js";
import { followPdfRenames, isPdfInFolder, type PdfReads } from "./sources.js";
import { errorMessage, errorMessageWithoutPath, VaultError } from "./errors.js";
import type { Host } from "./host.js";
import { localDay, openDays, type OpenDays } from "./open-days.js";
import {
  openPendingRevisions,
  type PendingRevisions,
} from "./pending-revisions.js";
import { openQueue, QueueOpenError } from "./queue.js";
import { splicePendingRevisions } from "./page-write.js";
import {
  pdfFolderOutside,
  SETTLE_MS,
  watchVault,
  type Watcher,
} from "./vault-watcher.js";
import {
  IndexOpenError,
  openIndex,
  type IndexOptions,
  type IndexStatus,
  type VaultIndex,
} from "./vault-index.js";

export type Vault = { name: string; path: string };

/** What *Reveal in Finder* may show: named, never a path (#376, #378). */
export type RevealedFolder = "vault" | "pdfs";

/**
 * Whether changes made outside the app are reaching the index; false is
 * *Not watching* (`CONTEXT.md`). `since` is when the live watch came up —
 * at open, or at the reopen after a failure — which is what Settings'
 * *Outside changes* row states (#376): a watch that has been seeing changes
 * since this morning is a fact the researcher can check against their day.
 */
export type Watching =
  { ok: true; since: string } | { ok: false; reason: string };

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
  /** How long the probe may go unanswered before the watch is given up on; tests shorten it (#272). */
  probeTimeoutMs?: number | undefined;
  /** The clock a pending Revision is stamped by (#217); tests pin it. */
  now?: (() => Date) | undefined;
  /** How long a file must be quiet before its pending Revisions are spliced (#217). */
  coalesceMs: number;
  /** An open made `vault` the current one: `vaultSwitched` (#377). */
  onSwitched?: ((vault: Vault) => void) | undefined;
  /** The PDF folder was checked, and this is its fault or null: `pdfFolder` (#379). */
  onPdfFolder?: ((fault: PdfFault | null) => void) | undefined;
  /** The engine Ingest reads PDFs with, and the record of what it could not read (#419). */
  pdfs?: PdfReads | undefined;
  /** Mints a sidecar id for an annotation the file did not name. */
  newId?: (() => string) | undefined;
  /** An Ingest run landed something: `ingestLanded` (#419). */
  onIngest?: ((run: IngestRun) => void) | undefined;
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
  /**
   * `vault.pdfFolder`: the PDF folder as it is now, its last arrival
   * answered from `queue.sqlite` when it does not resolve (#379); null when
   * no vault is open.
   */
  pdfFolder: () => Promise<PdfFolder | null>;
  /**
   * `vault.pdfFault`: only whether the PDF folder is at fault, without
   * counting what it holds — what the footer channel asks on every surface
   * (#379). Null when it resolves, is not there, or no vault is open.
   */
  pdfFault: () => Promise<PdfFault | null>;
  /**
   * *check again* (#379): sweep the vault and check the PDF folder, raising
   * what it found. Resolves once both are done.
   */
  checkAgain: () => Promise<void>;
  /** Show the open vault's folder, or its PDF folder, in Finder through the host; nothing when none is open. */
  reveal: (folder: RevealedFolder) => Promise<void>;
  /**
   * The window came to the front: today is a day at this vault (#243).
   * Nothing when no vault is open — a day is a day at a *vault*.
   */
  focused: () => Promise<void>;
  /**
   * Tear down the open vault's resources; the orderly path out. The next
   * `open` does the same. Resolves once every Revision an Obsidian edit
   * left pending has been spliced (#217) — a vault must not close owing
   * one when it had the chance to write it.
   */
  close: () => Promise<void>;
  /**
   * Drop the open vault's handles now, splicing nothing: the last resort
   * for a `process.on("exit")` handler, which cannot await. What was
   * parked stays parked, and the next open splices it on its first write.
   */
  release: () => void;
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
  /** Reads a returning PDF into its Source; null when the core has no engine (#419). */
  ingest: Ingest | null;
  /** The Revisions Obsidian edits to this vault still owe their files (#217). */
  pending: PendingRevisions;
  /** The local dates this vault was open in the app (#243). */
  days: OpenDays;
  /** The PDF folder's newest arrival, for when it stops resolving (#379). */
  arrival: LastArrival;
  /** The `queue.sqlite` handle those read; closed with the vault. */
  queue: DatabaseSync;
  watcher: Watcher | null;
  /**
   * The watcher is itself the one automatic reopen (`startWatcher`), so a
   * re-point for the PDF folder (#379) hands the same budget on rather than
   * a fresh one.
   */
  retried: boolean;
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
  probeTimeoutMs,
  now = () => new Date(),
  coalesceMs,
  onSwitched,
  onPdfFolder,
  pdfs,
  newId = () => randomUUID(),
  onIngest,
}: VaultServiceOptions): VaultService {
  const lastVaultFile = join(appSupportDir, LAST_VAULT_FILE);
  let opened: Opened | null = null;

  async function remember(path: string): Promise<void> {
    try {
      await mkdir(appSupportDir, { recursive: true });
      await writeFile(lastVaultFile, JSON.stringify({ path }) + "\n");
    } catch (cause) {
      // The app-support folder is not named: it is the app's own state
      // directory, which the reader can neither use nor act on (#288).
      throw new VaultError(
        "writeFailed",
        `Couldn't remember the vault: ${errorMessageWithoutPath(cause)}`
      );
    }
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

  type Resources = {
    index: VaultIndex;
    ingest: Ingest | null;
    pending: PendingRevisions;
    days: OpenDays;
    arrival: LastArrival;
    queue: DatabaseSync;
  };

  /**
   * A vault whose `.vitrine/` cannot hold the index is refused: it could
   * not hold a Question either. So is one whose `queue.sqlite` is from a
   * build this one does not know — running on would mean losing every
   * Obsidian edit to a Position while pretending the history is complete.
   */
  const refusingToOpen = (cause: unknown): never => {
    if (cause instanceof IndexOpenError || cause instanceof QueueOpenError) {
      throw new VaultError("writeFailed", cause.message);
    }
    throw cause;
  };

  async function openResources(absolute: string): Promise<Resources> {
    // One handle, two tables (`queue.ts`): the version and its migrations
    // belong to the database, not to whichever table opened it first.
    const queue = await openQueue(absolute).catch(refusingToOpen);
    const days = openDays(queue);
    const arrival = lastArrival(queue);
    const pending = openPendingRevisions(queue, {
      windowMs: coalesceMs,
      now,
      // The index is awaited rather than read: `openPendingRevisions` arms a
      // timer for every row it finds already parked (#276), and with a short
      // window injected one of those can fire before `opening` below has
      // resolved. A splice writes through the index, so it waits for the
      // index rather than for the order these two statements were written in.
      //
      // One of the two has to name the other before it exists — the index
      // reports Position changes to `pending`, and `pending` splices through
      // the index — and this is the direction whose safety the language
      // guarantees: a `setTimeout` cannot fire during the call below it.
      // The other way round would rest on when the index first diffs, which
      // is a fact about behaviour rather than about evaluation.
      splice: async (path) => {
        await splicePendingRevisions(
          { vaultPath: absolute, index: await opening, pending },
          path
        );
      },
    });
    // A Source's `pdf:` follows its file when the user renames it (spec
    // #416 story 12). The rewrite reads the index for who names the old
    // file, so it waits for the index to be current: a rename paired in the
    // sweep's first chunk arrives before the Source that names it is read,
    // and acting then would follow nothing and forget it had to.
    const heldRenames: Array<{ from: string; to: string }> = [];
    const followHeld = async () => {
      if (ready === null || !ready.status().current.ok) return;
      const pairs = heldRenames.splice(0);
      try {
        await followPdfRenames(absolute, ready, pairs);
      } catch (cause) {
        // No surface for it; the Source keeps naming a file that is gone,
        // which the PDF row and a picker with no PDF already show.
        console.error(`vitrine-core: ${errorMessage(cause)}`);
      }
    };
    let ready: VaultIndex | null = null;
    let ingest: Ingest | null = null;
    const opening = openIndex(absolute, {
      ...indexOptions,
      onStatus: async () => {
        await indexOptions?.onStatus?.();
        await followHeld();
      },
      onPositionChanged: pending.record,
      // A rename re-keys the file's dismissals before the event leaves
      // (§ Watcher and Ingest, Renames). Here rather than in `app.ts` or
      // a surface, because every listener downstream re-reads Loose Ends
      // on this event and one that read first would see the row back.
      onChanged: async (event) => {
        try {
          await renameDismissals(absolute, event.renamed);
        } catch (cause) {
          // The vault is gone, or `.vitrine/` cannot be written. Nothing
          // is lost — the dismissal is still keyed by the old path — and
          // there is no surface for it, so it reaches the core's log.
          console.error(
            `vitrine-core: a dismissal could not follow a rename: ${errorMessage(cause)}`
          );
        }
        heldRenames.push(...event.renamed);
        // A PDF whose bytes changed is read when it settles (#419). Not
        // awaited: Ingest writes Source notes through this same index, which
        // would wait on the chunk that is waiting on this listener.
        const changedPdfs = event.changed.filter(isPdfInFolder);
        if (changedPdfs.length > 0) void runIngest(ingest, changedPdfs);
        await indexOptions?.onChanged?.(event);
      },
    });
    let index: VaultIndex;
    try {
      index = await opening;
      ready = index;
      ingest =
        pdfs === undefined
          ? null
          : createIngest({
              vaultPath: absolute,
              index,
              engine: pdfs.engine,
              unreadable: pdfs.unreadable,
              newId,
              now,
            });
    } catch (cause) {
      pending.close();
      queue.close();
      return refusingToOpen(cause);
    }
    return { index, ingest, pending, days, arrival, queue };
  }

  /**
   * Ingest the named PDFs, or every Source's when none are named, and say
   * what landed. Never rejects: a failed run is the core's log, and the
   * files it did not take are found again by the next change or open.
   */
  async function runIngest(
    ingest: Ingest | null,
    paths: readonly string[] | null
  ): Promise<void> {
    try {
      const landed = await ingest?.run(paths);
      if (landed) onIngest?.(landed);
    } catch (cause) {
      console.error(`vitrine-core: ingest failed: ${errorMessage(cause)}`);
    }
  }

  // Bumped by every install and by close, so an install still waiting on
  // its watcher — or a watcher reporting its death later — can tell it has
  // been overtaken and discard what it made.
  let generation = 0;
  const overtaken = (o: Opened) => o.generation !== generation;

  /**
   * The open vault's resources, pending Revisions first: the splice is an
   * own write, so it needs the index and the file both still there.
   */
  async function teardown(): Promise<void> {
    const going = opened;
    opened = null;
    if (going === null) return;
    going.watcher?.close();
    // Never rejects: a file that could not take its entries leaves them
    // parked, says so in the core's log, and the rest are still tried
    // (`pending-revisions.ts`).
    await going.pending.flush();
    going.pending.close();
    going.index.close();
    going.queue.close();
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
    o.retried = retried;
    try {
      const watcher = await watchVault(o.vault.path, {
        settleMs,
        watch,
        probeTimeoutMs,
        onSettled: async (paths) => {
          await o.index.refresh(paths);
          // Something moved in the PDF folder, or the link itself changed:
          // a paper arrived, which is the last arrival to remember, or the
          // target went, which is the break to raise (#379).
          if (
            paths.some(
              (path) => path === PDF_FOLDER || path.startsWith(`${PDF_FOLDER}/`)
            )
          ) {
            void checkPdfFolder(o);
          }
        },
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
      o.watching = { ok: true, since: now().toISOString() };
    } catch (cause) {
      o.watching = { ok: false, reason: errorMessageWithoutPath(cause) };
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
    void o.index.sweep().then(() => runIngest(o.ingest, null));
    void checkPdfFolder(o);
    await raiseStatus();
  }

  /**
   * The PDF folder as it is now, with the last arrival kept in step (#379).
   * While it resolves the folder is the truth, and its newest PDF replaces
   * the record; once it does not, the record is what answers, marked as the
   * last before it stopped resolving. A folder that resolves and holds no
   * PDF leaves the record alone: a link briefly pointed at an empty folder
   * must not erase when papers last came.
   */
  async function readPdfFolderRemembering(o: Opened): Promise<PdfFolder> {
    const folder = await readPdfFolder(o.vault.path);
    if (!folder.exists || overtaken(o)) return folder;
    if (folder.fault === null) {
      if (folder.lastArrived !== null) {
        const { at, name } = folder.lastArrived;
        o.arrival.set({ at, name });
      }
      return folder;
    }
    const last = o.arrival.get();
    return {
      ...folder,
      lastArrived: last === null ? null : { ...last, beforeFault: true },
    };
  }

  /**
   * Check the PDF folder and raise what was found, fault or none (#379).
   * Run by what already looks — the open, the sweep after a watcher
   * failure, the window's focus, a settled batch under `sources/pdf`, and
   * *check again* — and never by a timer of its own.
   *
   * A link that has come to lead to a folder the watch does not follow —
   * broken at open and fixed since, or re-pointed in Finder — reopens the
   * watch first, and only then is the finding raised, so a cleared fault is
   * never a folder still unheard. Only toward a folder: a link that has just
   * broken leaves the watch where it is, since FSEvents follows a path and a
   * target put back where it was is heard by the watch already on it. A
   * watch left on a target the link no longer leads to is harmless: every
   * hint is stat-ed through the vault's own `sources/pdf/…`, so nothing of
   * the old target's can reach the index.
   */
  async function checkPdfFolder(o: Opened): Promise<void> {
    let folder: PdfFolder;
    let follows: string | null;
    try {
      folder = await readPdfFolderRemembering(o);
      follows = await pdfFolderOutside(o.vault.path);
    } catch (cause) {
      // The vault itself is gone or unreadable; the watcher and the sweep
      // are the ones that say so.
      console.error(
        `vitrine-core: the PDF folder could not be checked: ${errorMessage(cause)}`
      );
      return;
    }
    if (overtaken(o)) return;
    const fault = folder.exists ? folder.fault : null;
    if (
      follows !== null &&
      o.watcher !== null &&
      !o.reopening &&
      o.watcher.pdfFolder !== follows
    ) {
      o.watcher.close();
      o.watcher = null;
      o.reopening = true;
      void raiseStatus();
      await watchAndSweep(o, o.retried);
      if (overtaken(o)) return;
    }
    onPdfFolder?.(fault);
  }

  /**
   * Install the new vault and start its build. The watcher comes up first
   * and only then does the previous vault go: one index handle and one
   * watcher per vault, and the old vault answers until the new one can.
   */
  async function install(vault: Vault, resources: Resources): Promise<void> {
    const { index, ingest, pending, days, arrival, queue } = resources;
    const o: Opened = {
      vault,
      index,
      ingest,
      pending,
      days,
      arrival,
      queue,
      watcher: null,
      retried: false,
      // Never read: `startWatcher` below settles it before `o` is current.
      watching: { ok: true, since: now().toISOString() },
      reopening: false,
      generation: ++generation,
    };
    await startWatcher(o, false);
    if (overtaken(o)) {
      // A later open or the exit got here first; nothing of ours is wanted.
      o.watcher?.close();
      pending.close();
      index.close();
      queue.close();
      return;
    }
    await teardown();
    opened = o;
    // Opening the vault is a day at it (#243). Recorded here, once the
    // vault is current, rather than on any request: the renderer re-queries
    // on every `vaultChanged`, and an app left open unattended while a sync
    // client delivers files would otherwise count every day it ran.
    days.record(localDay(now()));
    // The sweep's own first status event is the open's: nothing is raised
    // here, so the first `vaultStatus` after an open still means "the walk
    // is done", which is what the watch-then-sweep test writes on.
    // Then every Source's PDF is compared to its sidecar: one attached, or
    // one that changed while the app was closed, is not an event to wait for.
    void index.sweep().then(() => runIngest(ingest, null));
    void checkPdfFolder(o);
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
    const resources = await openResources(absolute);
    // Remembered only here, after validation and the index, so a failed
    // open can never overwrite a good path — and remembered before it
    // becomes current, so an open either happens whole or not at all.
    try {
      await remember(absolute);
    } catch (cause) {
      resources.pending.close();
      resources.index.close();
      resources.queue.close();
      throw cause;
    }
    const vault = { name: basename(absolute), path: absolute };
    const was = opened?.vault.path ?? null;
    await install(vault, resources);
    // Raised here, where every open passes — First run's, Settings' and the
    // File menu's alike — so the window resets one way whichever asked
    // (#377). Not by the restore at launch, which no window is watching;
    // not for an open a later one overtook, whose vault is not on screen;
    // and not for the folder already open, which is reopened but not a
    // different vault, so the window keeps its place.
    if (opened?.vault === vault && was !== absolute) onSwitched?.(vault);
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
    pdfFolder: async () => {
      await restored;
      return opened === null ? null : readPdfFolderRemembering(opened);
    },
    pdfFault: async () => {
      await restored;
      return opened === null ? null : readPdfFault(opened.vault.path);
    },
    checkAgain: async () => {
      await restored;
      if (opened === null) return;
      // Both awaited, so *check again* stays pending — and its control
      // disabled — until the sweep it ran is done, rather than stacking a
      // sweep behind every click.
      await Promise.all([opened.index.sweep(), checkPdfFolder(opened)]);
    },
    reveal: async (folder) => {
      await restored;
      if (opened === null) return;
      // The PDF folder as it sits in the vault — the link itself when it is
      // one, which is the arrangement the researcher would change in Finder.
      host.reveal(
        folder === "pdfs"
          ? join(opened.vault.path, PDF_FOLDER)
          : opened.vault.path
      );
    },
    focused: async () => {
      await restored;
      if (opened === null) return;
      opened.days.record(localDay(now()));
      // The sweep over the PDF folder on focus (`CONTEXT.md`, Sweep): the
      // researcher comes back from fixing the link in Finder (#379).
      void checkPdfFolder(opened);
    },
    close: async () => {
      // The restore first, as every other orderly method does: a quit that
      // landed while it was still installing would otherwise overtake it,
      // and the vault it was bringing up would be dropped without the
      // flush a close exists for (#276). `release`, the last resort, is
      // the one path that deliberately does not wait.
      await restored;
      generation++;
      await teardown();
    },
    release: () => {
      generation++;
      const going = opened;
      opened = null;
      going?.watcher?.close();
      going?.pending.close();
      going?.index.close();
      going?.queue.close();
    },
  };
}
