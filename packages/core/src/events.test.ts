import { afterEach, describe, expect, it } from "vitest";
import {
  closeCores,
  core,
  NEXT_TIMEOUT_MS,
  openEventStream,
  tmp,
} from "./test-core.js";

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
      // The clause about the stream is the rest of the answer (#308): a bound
      // reached on a live stream is a different report from a stream that died
      // under the wait, and the message has to say which one this was.
      "waited 50ms on the event stream for vaultSwitched: nothing arrived, " +
        "and the stream was still open"
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

// The other half of the same instrument (#308). A bound makes a lost event
// legible; it does nothing for a stream that has *died* — the body erroring or
// closing early used to be swallowed whole, so every wait after it sat out its
// bound and was told the event was merely late. A dead stream and a quiet one
// have to read differently, for the same reason a broken Scout and a quiet
// field do.
describe("a stream that dies says so, instead of leaving every wait to its bound", () => {
  /**
   * A stream over a body this test drives: `push` carries an event, `finish`
   * closes the body cleanly, `fail` errors it. Ending or failing a real
   * subscription means killing the core out from under it, so both deaths are
   * driven at the one seam `openEventStream` reads, a `Response` with a body.
   */
  async function driven() {
    const encoder = new TextEncoder();
    let push!: (chunk: string) => void;
    let finish!: () => void;
    let fail!: (cause: Error) => void;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        push = (chunk) => controller.enqueue(encoder.encode(chunk));
        finish = () => controller.close();
        fail = (cause) => controller.error(cause);
      },
    });
    const opening = openEventStream(() =>
      Promise.resolve(new Response(body, { status: 200 }))
    );
    // Sent before the open is awaited: `openEventStream` does not resolve
    // until the `connected` message has come through.
    push("event: connected\ndata: \n\n");
    return { stream: await opening, push, finish, fail };
  }

  /**
   * A turn for the body's own reads to run. A death is recorded a microtask
   * after `finish()` or `fail()`, so a wait made in the same turn is still the
   * outstanding-waiter case — which the first two cases below already cover,
   * and which passes whether or not a wait arriving *after* the death is
   * answered at all.
   */
  const bodyCatchesUp = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("rejects a wait with the reason the body gave, rather than discarding it", async () => {
    const { stream, fail } = await driven();
    const waiting = stream.next("vaultSwitched");

    fail(new Error("the connection dropped"));

    await expect(waiting).rejects.toThrow(
      "the event stream failed (the connection dropped) while waiting for vaultSwitched"
    );
  });

  it("rejects a wait when the body ends early, which no event can follow", async () => {
    const { stream, finish } = await driven();
    const waiting = stream.next("vaultStatus");

    finish();

    await expect(waiting).rejects.toThrow(
      "the event stream ended while waiting for vaultStatus"
    );
  });

  it("tells a wait that comes later at once, not once its bound is up", async () => {
    const { stream, finish } = await driven();
    finish();
    await bodyCatchesUp();

    // A bound past Vitest's own default, so only an answer that declines to
    // wait for it can get this to green.
    await expect(
      stream.next("vaultStatus", { timeoutMs: 60_000 })
    ).rejects.toThrow("the event stream ended while waiting for vaultStatus");
  });

  it("still hands over an event that arrived before the stream died", async () => {
    const { stream, push, finish } = await driven();

    push(`data: ${JSON.stringify({ type: "vaultStatus" })}\n\n`);
    finish();
    await bodyCatchesUp();

    // The death is not the whole story: an event already queued is that wait's
    // answer, or the instrument invents a failure of its own.
    expect(await stream.next("vaultStatus")).toEqual({ type: "vaultStatus" });
    // And the stream was dead the whole time it did: a bound this far past
    // Vitest's own cannot be what answered this one.
    await expect(
      stream.next("vaultStatus", { timeoutMs: 60_000 })
    ).rejects.toThrow("the event stream ended while waiting for vaultStatus");
  });
});
