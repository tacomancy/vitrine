import { watch as fsWatch, type FSWatcher, type WatchListener } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Listing } from "./list.js";
import { closeCores, core, tmp, type CoreOptions } from "./test-core.js";
import type { VaultStatus } from "./vault.js";

// Watcher health at the harness seam (#190; spec #177 § Testing decisions):
// the `watch` the core is handed is the real `fs.watch` wrapped so a test can
// fail the watch it made, refuse to make the next one, or — #272 — make one
// that is never heard from again. One case needs no wrapper at all: a probe
// that cannot be written is arranged on disk instead (#281). Every wait is on
// `vaultStatus` or on the index becoming current — never a sleep.

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

type Core = Awaited<ReturnType<typeof core>>;

/** `vault.status` as a renderer reads it. */
const statusOf = async (c: Core): Promise<VaultStatus> =>
  (await c.query<VaultStatus>("vault.status")).result!.data;

/**
 * The status once the open-time sweep is no longer what `current` is
 * complaining about — waited *out*, not merely waited on. An unfinished
 * sweep is the larger gap, so `current` names it ahead of the watcher
 * (§ Watcher and Ingest), and a read taken between the first committed chunk
 * and the sweep's end would see that reason instead of the one under test.
 */
async function afterTheSweep(c: Core): Promise<VaultStatus> {
  const stream = await c.events();
  let seen = await statusOf(c);
  while (/sweep/.test(seen.current.ok ? "" : seen.current.reason)) {
    await stream.next("vaultStatus");
    seen = await statusOf(c);
  }
  stream.close();
  return seen;
}

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
  // Spelled out rather than `Parameters<typeof fsWatch>` as `injectable()`
  // does: that tuple resolves to the two-argument overload, and the call
  // under test passes three.
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
  const status = () => statusOf(c);
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
      watching: { ok: true, since: expect.any(String) as string },
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
    expect((await status()).watching).toEqual({
      ok: true,
      since: expect.any(String) as string,
    });
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
    expect((await status()).watching).toEqual({
      ok: true,
      since: expect.any(String) as string,
    });
    await c.indexed();
    stream.close();

    expect(await status()).toEqual({
      indexing: null,
      watching: { ok: true, since: expect.any(String) as string },
      current: { ok: true },
    });
    expect(await questions()).toEqual(["Meanwhile"]);
  });

  // #288. *Not watching — <reason>* is a line in the window, so the reason
  // carries the cause and never the machine's filesystem layout.
  //
  // The errno is thrown rather than provoked from a real `fs.watch`: what a
  // missing path does there is the platform's to decide — on macOS it throws
  // where Linux hangs the open waiting for the probe — and what is under
  // test here is that the watcher's reason goes through the strip at all.
  // The strip itself is pinned against real errnos in `errors.test.ts`.
  it("says why it is not watching without naming an absolute path", async () => {
    const gone = join(await tmp("Tong's"), "not here");
    const watch: typeof fsWatch = () => {
      throw Object.assign(
        new Error(`ENOENT: no such file or directory, watch '${gone}'`),
        { code: "ENOENT", syscall: "watch", path: gone }
      );
    };
    const vault = await tmp("unwatched");
    await mkdir(join(vault, "questions"));
    const c = await core({ settleMs: SETTLE_MS, watch });

    const reply = await c.mutate<Vault>("vault.open", { path: vault });
    expect(reply.error).toBeUndefined();

    const seen = (await c.query<VaultStatus>("vault.status")).result!.data;
    expect(seen.watching).toEqual({
      ok: false,
      reason: "ENOENT: no such file or directory",
    });
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

describe("the harness's indexed() on a vault that never comes current", () => {
  // The instrument, not the product: a wait for `current` that nothing
  // answers must fail naming what `current` last said, never as a bare
  // Vitest timeout — the one a lost status event once hid behind (#294).
  it("fails with the reason current gave, inside the test's own timeout", async () => {
    const fs = injectable();
    fs.refuseNext("ENOSPC: no space left on device");
    const vault = await tmp("never-current");
    await mkdir(join(vault, "questions"));
    const c = await core({ settleMs: SETTLE_MS, watch: fs.watch });
    await c.mutate<Vault>("vault.open", { path: vault });

    await expect(c.indexed()).rejects.toThrow(
      /^waited \d+ms for the vault to be current: not watching: ENOSPC: no space left on device$/
    );
  });

  // The open's own wait: `vault.open` resolves only once the probe is
  // answered or given up on, and the production bound on that is Vitest's
  // 5 s default. No `probeTimeoutMs` here, unlike the give-up test below —
  // the harness's own bound is what is under test.
  it("a probe that is never answered gives up, and says so, inside the test's own timeout", async () => {
    const fs = await deaf();
    const vault = await tmp("never-answered");
    await mkdir(join(vault, "questions"));
    const c = await core({ settleMs: SETTLE_MS, watch: fs.watch });
    await c.mutate<Vault>("vault.open", { path: vault });

    await expect(c.indexed()).rejects.toThrow(
      /: not watching: the watch gave no sign of life$/
    );
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

  // A batch ending is a change to `current` like any other, and a renderer
  // only re-reads `vault.status` when told to. Read directly, as the test
  // above does, the silent version passes; this one waits the way the footer
  // does. Found as a hang in `indexed()`: a batch delivered late by a loaded
  // FSEvents landed behind the reopen's sweep, whose last status event read
  // "a settled batch is not yet applied", and nothing ever said otherwise.
  it("says so with a vaultStatus once the batch is applied", async () => {
    const { vault, c, status } = await opened();
    const stream = await c.events();
    await writeFile(join(vault, "questions", "Q.md"), questionFile("Q"));
    await stream.next("vaultChanged");
    // After `vaultChanged` and never before it: that event is raised inside
    // the batch, so a status event behind it is the batch's own ending.
    await stream.next("vaultStatus");
    stream.close();
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
    expect((await statusOf(c)).watching).toEqual({
      ok: false,
      reason: "the watch gave no sign of life",
    });

    // The sweep still runs, and is waited out before `current` is read.
    const seen = await afterTheSweep(c);

    // What is on disk was read once...
    const listing = await c.query<Listing>("questions.list");
    expect((listing.result?.data as Listing).questions).toHaveLength(1);
    // ...and only `current` says those rows may go stale behind the app.
    expect(seen.current).toEqual({
      ok: false,
      reason: "not watching: the watch gave no sign of life",
    });

    // The probe is the app's own litter in someone's vault; giving up is
    // still the app's own business to clean up after.
    expect(await readdir(join(vault, ".vitrine"))).not.toContain(".watch");
  });
});

describe("a watch whose probe cannot be written", () => {
  it("says so, with the cause, leaving the vault open, not watching, and swept", async () => {
    const vault = await tmp("unwritable-probe");
    await mkdir(join(vault, "questions"));
    await writeFile(join(vault, "questions", "Q.md"), questionFile("Q"));
    // A directory where the probe file goes: `writeFile` to it fails EISDIR,
    // which is the one way to fail the probe write without touching
    // production — a read-only `.vitrine/` would fail the index open first
    // and the vault would be refused before the watcher ever ran. EISDIR is
    // the vehicle, not the claim: the real causes are a full volume or a
    // read-only remount, and what is under test is the write rejecting.
    await mkdir(join(vault, ".vitrine", ".watch"), { recursive: true });
    // The real `fs.watch`, unwrapped: this watch is made and would deliver
    // normally. It is the probe that fails, not the watcher. And no
    // `probeTimeoutMs`, unlike the give-up test above: the write is the first
    // statement in the probe loop, so this fails on the first tick and the
    // 5 s bound is never reached.
    const c = await core({ settleMs: SETTLE_MS });

    // The vault opens: a probe that cannot be written must not hold it shut.
    const reply = await c.mutate<Vault>("vault.open", { path: vault });
    expect(reply.error).toBeUndefined();

    // The reason is the whole product of this path. The prefix is what the
    // watcher adds, and it is the difference between a footer that says what
    // failed and one showing a bare errno with an absolute path where a
    // sentence should be; the cause after it is what the prefix must not
    // swallow. Anchored rather than compared whole, because the tail of it is
    // this vault's own temp path.
    expect((await statusOf(c)).watching).toEqual({
      ok: false,
      reason: expect.stringMatching(
        /^the watch probe could not be written: EISDIR\b/
      ) as string,
    });

    const seen = await afterTheSweep(c);
    // Swept once despite never watching: what is on disk was read...
    const listing = await c.query<Listing>("questions.list");
    expect((listing.result?.data as Listing).questions).toHaveLength(1);
    // ...and Not watching reaches `current` too, so the rows are never
    // mistaken for live ones (CONTEXT.md § Not watching: never a quiet vault).
    expect(seen.current).toEqual({
      ok: false,
      reason: expect.stringMatching(
        /^not watching: the watch probe could not be written: EISDIR\b/
      ) as string,
    });

    // The give-up test's last claim — that the app cleans its probe up —
    // cannot be made here: the `.watch` left behind is the directory this
    // test put there, and the app's `unlink` of it fails EPERM and is
    // swallowed. If the probe ever moves, or `.vitrine/` handling turns
    // stricter, this test needs a different vehicle for the same claim.
  });
});
