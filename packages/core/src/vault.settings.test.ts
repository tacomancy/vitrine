import { watch as fsWatch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Host } from "./host.js";
import { closeCores, core, tmp } from "./test-core.js";
import type { VaultStatus } from "./vault.js";

// The two reads Settings' *Where the vault is* needs beyond `vault.current`
// (#376; spec #363): since when changes made outside have been seen, and a
// way to show the folder in Finder that the core cannot do itself.

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
    const reply = await c.mutate("vault.reveal");
    expect(reply.error).toBeUndefined();
    expect(host.revealed).toEqual([vault]);
  });

  it("is refused while no vault is open, and asks the host nothing", async () => {
    const host = revealingHost();
    const c = await core({ host });
    const reply = await c.mutate("vault.reveal");
    expect(reply.error?.message).toBe("No vault is open.");
    expect(host.revealed).toEqual([]);
  });
});
