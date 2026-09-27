import {
  existsSync,
  watch as fsWatch,
  type FSWatcher,
  type WatchListener,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Listing } from "./list.js";
import { closeCores, core, tmp, type CoreOptions } from "./test-core.js";
import type { VaultStatus } from "./vault.js";

// Watcher health at the harness seam (#190; spec #177 § Testing decisions):
// the `watch` the core is handed is the real `fs.watch` wrapped so a test can
// fail the watch it made, refuse to make the next one, or — #272 — make one
// that is never heard from again. Every wait is on `vaultStatus` or on the
// index becoming current — never a sleep.

type Vault = { name: string; path: string };

afterEach(closeCores);

const SETTLE_MS = 40;

/**
 * How long the probe may go unanswered here. Short enough that the give-up
 * path runs in a blink, long enough that the probe is touched a few times
 * (`PROBE_TICK_MS`, 50 ms) before it does. The production bound is
 * `PROBE_TIMEOUT_MS` — 5 s, `vault-watcher.ts` — which no suite should wait
 * out; it is the number this test stands in for, not one it changes.
 */
const PROBE_TIMEOUT_MS = 300;

function questionFile(text: string, captured = "2026-09-20T09:00:00Z") {
  return `---\nkind: question\nquestion: ${text}\nstatus: open\ncaptured: ${captured}\ncontext: other\n---\n`;
}

/**
 * The real `fs.watch`, remembering every watcher it made so the test can
 * fail one, and refusing whole calls once `refuse` is set.
 */
function injectable() {
  const made: FSWatcher[] = [];
  let refuse: string | null = null;
  const watch: typeof fsWatch = ((...args: Parameters<typeof fsWatch>) => {
    if (refuse !== null) throw new Error(refuse);
    const watcher = fsWatch(...args);
    made.push(watcher);
    return watcher;
  }) as typeof fsWatch;
  return {
    watch,
    made,
    /** The watch on the vault root fails, as FSEvents would report it. */
    fail: (reason: string) => made.at(-1)!.emit("error", new Error(reason)),
    refuseNext: (reason: string | null) => {
      refuse = reason;
    },
  };
}

/**
 * A watch made without complaint that then delivers nothing — a volume
 * FSEvents cannot follow. Real `fs.watch`, so closing and `error` behave as
 * they do in production, but pointed at an empty folder nothing ever writes
 * to instead of the vault: the probe is written and rewritten under the
 * vault's `.vitrine/`, and no event for it can come back.
 */
async function deaf() {
  const elsewhere = await tmp("unheard");
  const made: FSWatcher[] = [];
  const watch: typeof fsWatch = ((
    _folder: string,
    options: { recursive: boolean },
    listener: WatchListener<string>
  ) => {
    const watcher = fsWatch(elsewhere, options, listener);
    made.push(watcher);
    return watcher;
  }) as typeof fsWatch;
  return { watch, made };
}

async function opened(opts: CoreOptions = {}) {
  const vault = await tmp("health");
  await mkdir(join(vault, "questions"));
  const c = await core({ settleMs: SETTLE_MS, ...opts });
  const reply = await c.mutate<Vault>("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  const status = async () =>
    (await c.query<VaultStatus>("vault.status")).result!.data;
  const questions = async () => {
    const listing = await c.query<Listing>("questions.list");
    return (listing.result?.data as Listing).questions.map((q) => q.question);
  };
  return { vault, c, status, questions };
}

describe("a watcher that fails is reopened and the vault swept", () => {
  it("an injected error leaves watching ok, catches a file added during the outage, and raises vaultStatus", async () => {
    const fs = injectable();
    const { vault, c, status, questions } = await opened({ watch: fs.watch });
    expect(await status()).toEqual({
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    });
    const stream = await c.events();
    const before = fs.made.length;

    fs.fail("FSEvents stream stopped");
    // Written before the reopen can possibly be live: only the sweep that
    // follows it can find this file.
    await writeFile(
      join(vault, "questions", "During.md"),
      questionFile("During the outage")
    );
    await stream.next("vaultStatus");
    await c.indexed();
    stream.close();

    expect(fs.made.length).toBeGreaterThan(before);
    expect((await status()).watching).toEqual({ ok: true });
    expect(await questions()).toEqual(["During the outage"]);
  });

  it("a recovered fault on a quiet vault shows no indexing progress: no trace", async () => {
    const fs = injectable();
    const progress: Array<VaultStatus["indexing"]> = [];
    const c0 = { c: null as Awaited<ReturnType<typeof core>> | null };
    const { c } = await opened({
      watch: fs.watch,
      onVaultStatus: async () => {
        if (c0.c === null) return;
        progress.push(
          (await c0.c.query<VaultStatus>("vault.status")).result!.data.indexing
        );
      },
    });
    c0.c = c;
    const stream = await c.events();
    fs.fail("FSEvents stream stopped");
    await stream.next("vaultStatus");
    await c.indexed();
    stream.close();
    expect(progress.every((p) => p === null)).toBe(true);
  });

  it("a reopen that fails is not watching, with the reason, and the index is not current", async () => {
    const fs = injectable();
    const { c, status } = await opened({ watch: fs.watch });
    const stream = await c.events();

    fs.refuseNext("EMFILE: too many open files");
    fs.fail("FSEvents stream stopped");
    // The sweep that follows the failed reopen still runs and is the reason
    // while it does; once it is done, the watcher is.
    let seen = await status();
    while (
      seen.watching.ok ||
      /sweep/.test(seen.current.ok ? "" : seen.current.reason)
    ) {
      await stream.next("vaultStatus");
      seen = await status();
    }
    stream.close();

    expect(seen.watching).toEqual({
      ok: false,
      reason: "EMFILE: too many open files",
    });
    expect(seen.current).toEqual({
      ok: false,
      reason: "not watching: EMFILE: too many open files",
    });
  });

  it("vault.rewatch after a failed reopen recovers, and a file added meanwhile appears", async () => {
    const fs = injectable();
    const { vault, c, status, questions } = await opened({ watch: fs.watch });
    const stream = await c.events();
    fs.refuseNext("EMFILE: too many open files");
    fs.fail("FSEvents stream stopped");
    while ((await status()).watching.ok) await stream.next("vaultStatus");

    await writeFile(
      join(vault, "questions", "Meanwhile.md"),
      questionFile("Meanwhile")
    );
    fs.refuseNext(null);
    const reply = await c.mutate<void>("vault.rewatch");
    expect(reply.error).toBeUndefined();
    expect((await status()).watching).toEqual({ ok: true });
    await c.indexed();
    stream.close();

    expect(await status()).toEqual({
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    });
    expect(await questions()).toEqual(["Meanwhile"]);
  });

  it("a watch that cannot be opened at all leaves the vault open, not watching, and swept", async () => {
    const fs = injectable();
    fs.refuseNext("ENOSPC: no space left on device");
    const vault = await tmp("unwatchable");
    await mkdir(join(vault, "questions"));
    await writeFile(join(vault, "questions", "Q.md"), questionFile("Q"));
    const c = await core({ settleMs: SETTLE_MS, watch: fs.watch });
    const reply = await c.mutate<Vault>("vault.open", { path: vault });
    expect(reply.error).toBeUndefined();

    const seen = (await c.query<VaultStatus>("vault.status")).result!.data;
    expect(seen.watching).toEqual({
      ok: false,
      reason: "ENOSPC: no space left on device",
    });
    // The sweep still runs — a vault that cannot be watched can still be
    // read — so the rows arrive; only `current` says it may not be trusted.
    const stream = await c.events();
    for (;;) {
      const listing = await c.query<Listing>("questions.list");
      if ((listing.result?.data as Listing).questions.length === 1) break;
      await stream.next("vaultStatus");
    }
    stream.close();
    expect(
      (await c.query<VaultStatus>("vault.status")).result!.data.current
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("not watching") as string,
    });
  });
});

describe("current names a settled batch not yet applied", () => {
  it("is false while a batch is being applied, and true once it is", async () => {
    // The index's after-commit listener runs inside the batch: what
    // `vault.status` says there is what an Ingest asking mid-batch would see.
    const c0 = { c: null as Awaited<ReturnType<typeof core>> | null };
    const inside: VaultStatus["current"][] = [];
    let recorded: () => void = () => undefined;
    const seen = new Promise<void>((resolve) => (recorded = resolve));
    const { vault, c, status } = await opened({
      onVaultChanged: async () => {
        if (c0.c === null) return;
        const reply = await c0.c.query<VaultStatus>("vault.status");
        inside.push(reply.result!.data.current);
        recorded();
      },
    });
    c0.c = c;
    const stream = await c.events();
    await writeFile(join(vault, "questions", "Q.md"), questionFile("Q"));
    await stream.next("vaultChanged");
    await seen;
    stream.close();
    expect(inside).toEqual([
      { ok: false, reason: expect.stringMatching(/batch/) as string },
    ]);
    expect((await status()).current).toEqual({ ok: true });
  });
});

describe("a watch that comes up and is then never heard from", () => {
  it("gives up at the probe timeout, leaving the vault open, not watching, and swept", async () => {
    const fs = await deaf();
    const vault = await tmp("unheard-vault");
    await mkdir(join(vault, "questions"));
    await writeFile(join(vault, "questions", "Q.md"), questionFile("Q"));
    const c = await core({
      settleMs: SETTLE_MS,
      probeTimeoutMs: PROBE_TIMEOUT_MS,
      watch: fs.watch,
    });

    // That the open resolves at all is half the claim: a watch that never
    // answers must give up rather than hold the vault shut.
    const reply = await c.mutate<Vault>("vault.open", { path: vault });
    expect(reply.error).toBeUndefined();
    // Made, not refused — the path under test is silence, not ENOSPC.
    expect(fs.made).toHaveLength(1);

    // The silence is said out loud: a watch that does not deliver must never
    // look like a vault where nothing is happening (`CLAUDE.md`).
    const seen = (await c.query<VaultStatus>("vault.status")).result!.data;
    expect(seen.watching).toEqual({
      ok: false,
      reason: "the watch gave no sign of life",
    });

    // The sweep still runs, so what is on disk is read once...
    const stream = await c.events();
    for (;;) {
      const listing = await c.query<Listing>("questions.list");
      if ((listing.result?.data as Listing).questions.length === 1) break;
      await stream.next("vaultStatus");
    }
    stream.close();
    // ...and only `current` says those rows may go stale behind the app.
    expect(
      (await c.query<VaultStatus>("vault.status")).result!.data.current
    ).toEqual({
      ok: false,
      reason: "not watching: the watch gave no sign of life",
    });

    // Giving up still tidies up: the probe is not left in the vault.
    expect(existsSync(join(vault, ".vitrine", ".watch"))).toBe(false);
  });
});
