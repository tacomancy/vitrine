import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, tmp } from "./test-core.js";

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
