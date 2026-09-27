import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, NEXT_TIMEOUT_MS, tmp } from "./test-core.js";

// The event stream at the harness seam (spec #177, ADR 0013 decision 11): one
// SSE subscription per renderer, guarded by the bearer header, carrying a
// discriminated union on `type`.

afterEach(closeCores);

describe("events.subscribe", () => {
  it("is 401 without the bearer header, before any router code", async () => {
    const c = await core();
    const res = await c.raw("/trpc/events.subscribe", {
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(401);
  });

  it("carries the one vaultChanged a capture raises, naming the file", async () => {
    const vault = await tmp("stream-capture");
    const c = await core();
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const stream = await c.events();

    const reply = await c.mutate<{ path: string }>("questions.capture", {
      text: "Does the stream carry this?",
      provenance: { context: "other" },
    });
    expect(reply.error).toBeUndefined();
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["questions/Does the stream carry this.md"],
      removed: [],
      renamed: [],
    });
    stream.close();
  });
});

// The harness's own wait, not the core's behaviour (#294). A test that awaits
// an event which never comes used to die at Vitest's 5 s default — which says
// the test was slow, not that an event was lost. Diagnosing #292 took an
// instrumented CI run to establish the difference; the stream says it outright
// now, at the seam the no-silent-failures invariant covers for the app itself.
describe("the harness's wait on the event stream is bounded", () => {
  /** A vault opened and indexed, with the stream connected and nothing pending. */
  async function quiet(name: string) {
    const c = await core();
    await c.mutate("vault.open", { path: await tmp(name) });
    await c.indexed();
    return { c, stream: await c.events() };
  }

  it("names the event awaited when nothing at all arrives", async () => {
    const { stream } = await quiet("bounded");

    await expect(
      stream.next("vaultSwitched", { timeoutMs: 50 })
    ).rejects.toThrow(
      "waited 50ms on the event stream for vaultSwitched: nothing arrived"
    );
    stream.close();
  });

  it("names what arrived instead, so the wrong event is not read as silence", async () => {
    const { c, stream } = await quiet("bounded-wrong");
    const reply = await c.mutate<{ path: string }>("questions.capture", {
      text: "Raises a vaultChanged",
      provenance: { context: "other" },
    });
    expect(reply.error).toBeUndefined();

    // Long enough to outlast that event's trip through the SSE stream on any
    // runner — the case is about what the message says once it has arrived —
    // and short enough that the whole of it costs a blink.
    await expect(
      stream.next("vaultSwitched", { timeoutMs: 300 })
    ).rejects.toThrow(
      /^waited 300ms on the event stream for vaultSwitched: saw .*vaultChanged/
    );
    stream.close();
  });

  /**
   * Vitest's default `testTimeout`, which neither config raises: a suite that
   * ever does has to come back to `NEXT_TIMEOUT_MS` first.
   */
  const VITEST_DEFAULT_TIMEOUT_MS = 5_000;

  it("keeps its default under Vitest's, or the diagnostic never gets to fire", () => {
    // The whole point of the bound is winning that race. Asserted on the
    // number rather than by waiting it out: a test that sleeps the default to
    // prove it spends it on every run, and has the rest of the budget to open
    // a vault in.
    expect(NEXT_TIMEOUT_MS).toBeLessThan(VITEST_DEFAULT_TIMEOUT_MS);
  });

  it("says so when the stream closes under a wait, rather than sitting out the bound", async () => {
    const { stream } = await quiet("bounded-closed");

    // Not awaited yet: `close()` has to reach the wait already outstanding.
    const waiting = stream.next("vaultSwitched");
    stream.close();

    await expect(waiting).rejects.toThrow(
      "the event stream closed while waiting for vaultSwitched"
    );
  });
});
