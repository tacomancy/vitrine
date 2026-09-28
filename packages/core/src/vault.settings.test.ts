import { watch as fsWatch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Host } from "./host.js";
import {
  closeCores,
  core,
  fingerprint,
  fixtureCopy,
  tmp,
} from "./test-core.js";
import type { VaultStatus } from "./vault.js";

// What Settings' *Where the vault is* needs beyond `vault.current` (spec
// #363): since when changes made outside have been seen, a way to show the
// folder in Finder that the core cannot do itself (#376), and *Open a
// different folder…* (#377).

afterEach(closeCores);

type Vault = { name: string; path: string };

/** A host that remembers what it was asked to reveal. */
function revealingHost(): Host & { revealed: string[] } {
  const revealed: string[] = [];
  return {
    revealed,
    pickFolder: () => Promise.resolve(null),
    reveal: (path) => {
      revealed.push(path);
    },
  };
}

async function openedAt(
  clock: { now: Date },
  host?: Host,
  watch?: typeof fsWatch
) {
  const vault = await tmp("settings");
  await mkdir(join(vault, "questions"));
  const c = await core({
    settleMs: 40,
    now: () => clock.now,
    ...(host ? { host } : {}),
    ...(watch ? { watch } : {}),
  });
  const reply = await c.mutate<Vault>("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

describe("Outside changes: since when the watcher has been seeing them", () => {
  it("says the watch began when the vault was opened", async () => {
    const clock = { now: new Date("2026-09-28T08:40:00Z") };
    const { c } = await openedAt(clock);
    clock.now = new Date("2026-09-28T11:02:00Z");
    const status = (await c.query<VaultStatus>("vault.status")).result!.data;
    expect(status.watching).toEqual({
      ok: true,
      since: "2026-09-28T08:40:00.000Z",
    });
  });

  // What fell between the failure and the reopen was caught by a sweep, not
  // seen live, so the watch that is running now began at the reopen. A
  // `since` carried over from the open would claim an unbroken watch.
  it("starts again from the reopen after the watch failed", async () => {
    const made: FSWatcher[] = [];
    const watch = ((...args: Parameters<typeof fsWatch>) => {
      const watcher = fsWatch(...args);
      made.push(watcher);
      return watcher;
    }) as typeof fsWatch;
    const clock = { now: new Date("2026-09-28T08:40:00Z") };
    const { c } = await openedAt(clock, undefined, watch);
    const stream = await c.events();

    clock.now = new Date("2026-09-28T10:15:00Z");
    made.at(-1)!.emit("error", new Error("FSEvents stream stopped"));
    await stream.next("vaultStatus");
    await c.indexed();
    stream.close();

    const status = (await c.query<VaultStatus>("vault.status")).result!.data;
    expect(status.watching).toEqual({
      ok: true,
      since: "2026-09-28T10:15:00.000Z",
    });
  });
});

describe("Reveal in Finder", () => {
  it("asks the host to reveal the open vault's folder", async () => {
    const host = revealingHost();
    const { vault, c } = await openedAt({ now: new Date() }, host);
    const reply = await c.mutate("vault.reveal", { folder: "vault" });
    expect(reply.error).toBeUndefined();
    expect(host.revealed).toEqual([vault]);
  });

  it("is refused while no vault is open, and asks the host nothing", async () => {
    const host = revealingHost();
    const c = await core({ host });
    const reply = await c.mutate("vault.reveal", { folder: "vault" });
    expect(reply.error?.message).toBe("No vault is open.");
    expect(host.revealed).toEqual([]);
  });
});

// *Open a different folder…* and File ▸ Open Vault… (#377; spec #363 stories
// 12–17): the same `vault.pick` First run uses. The window learns of the
// switch from the event stream, not from whichever caller asked, so the two
// ways in cannot reset it differently.
describe("Open a different folder…", () => {
  /** A host whose chooser answers each ask with the next folder given. */
  function choosing(...folders: (string | null)[]): Host {
    return {
      pickFolder: () => Promise.resolve(folders.shift() ?? null),
      reveal: () => {},
    };
  }

  /** The researcher's files: everything but the App state folder. */
  const files = async (vault: string) =>
    (await fingerprint(vault)).filter((entry) => !entry.startsWith(".vitrine"));

  it("changes nothing on disk in either vault", async () => {
    const first = await fixtureCopy("obsidian-vault");
    const second = join(await tmp("second"), "second");
    await mkdir(join(second, "questions"), { recursive: true });
    const c = await core({ settleMs: 40, host: choosing(first, second) });
    expect((await c.mutate<Vault>("vault.pick")).error).toBeUndefined();
    await c.indexed();
    const firstBefore = await files(first);
    const secondBefore = await files(second);

    const switched = await c.mutate<Vault>("vault.pick");
    expect(switched.result?.data.path).toBe(second);
    await c.indexed();

    expect(await files(first)).toEqual(firstBefore);
    expect(await files(second)).toEqual(secondBefore);
  });

  it("tells the window which vault it now shows", async () => {
    const first = await tmp("first");
    const second = await tmp("second");
    const c = await core({ settleMs: 40, host: choosing(first, second) });
    await c.mutate("vault.pick");
    await c.indexed();
    const stream = await c.events();

    await c.mutate("vault.pick");
    const event = await stream.next("vaultSwitched");
    stream.close();
    expect(event.vault).toEqual({ name: basename(second), path: second });
  });

  // Choosing the folder already open is looking, not switching (story 17):
  // the window keeps its place.
  it("says nothing when the folder chosen is the vault already open", async () => {
    const first = await tmp("first");
    const c = await core({ settleMs: 40, host: choosing(first, first) });
    await c.mutate("vault.pick");
    await c.indexed();
    const stream = await c.events();

    const again = await c.mutate<Vault>("vault.pick");
    expect(again.result?.data.path).toBe(first);
    await expect(
      stream.next("vaultSwitched", { timeoutMs: 150 })
    ).rejects.toThrow(/^waited 150ms on the event stream for vaultSwitched/);
    stream.close();
  });

  it("a cancelled chooser switches nothing and says nothing", async () => {
    const first = await tmp("first");
    const c = await core({ settleMs: 40, host: choosing(first, null) });
    await c.mutate("vault.pick");
    await c.indexed();
    const stream = await c.events();

    const cancelled = await c.mutate<Vault | null>("vault.pick");
    expect(cancelled.result?.data).toBeNull();
    await expect(
      stream.next("vaultSwitched", { timeoutMs: 150 })
    ).rejects.toThrow(/^waited 150ms on the event stream for vaultSwitched/);
    stream.close();
    const current = await c.query<Vault>("vault.current");
    expect(current.result?.data.path).toBe(first);
  });
});
