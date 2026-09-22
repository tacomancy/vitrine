import { describe, expect, it } from "vitest";
import { serialised } from "./serialise.js";

/** A promise whose settling this test controls, so overlap is observable. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("serialised", () => {
  it("does not start the second piece of work until the first has settled", async () => {
    const first = deferred<string>();
    const started: string[] = [];
    const queue = serialised();

    const a = queue(() => {
      started.push("a");
      return first.promise;
    });
    const b = queue(() => {
      started.push("b");
      return Promise.resolve("b");
    });

    // The whole point: `b` has been handed over but has not run, because
    // the read half of `a` is still in flight.
    await Promise.resolve();
    expect(started).toEqual(["a"]);

    first.resolve("a");
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(started).toEqual(["a", "b"]);
  });

  it("leaves the queue usable after work throws, and the throw reaches only its own caller", async () => {
    const queue = serialised();

    const failed = queue(() => Promise.reject(new Error("boom")));
    const after = queue(() => Promise.resolve("still running"));

    await expect(failed).rejects.toThrow("boom");
    expect(await after).toBe("still running");
  });

  it("gives each caller its own result", async () => {
    const queue = serialised();

    const results = await Promise.all([
      queue(() => Promise.resolve(1)),
      queue(() => Promise.resolve(2)),
      queue(() => Promise.resolve(3)),
    ]);

    expect(results).toEqual([1, 2, 3]);
  });

  it("holds one queue per call, so unrelated writes do not wait on each other", async () => {
    // link's queue and the page's are separate hazards: a page write that
    // is parked must not hold a link that reads a different file.
    const blocked = deferred<void>();
    const one = serialised();
    const other = serialised();

    const parked = one(() => blocked.promise);
    const free = other(() => Promise.resolve("went through"));

    expect(await free).toBe("went through");
    blocked.resolve();
    await parked;
  });
});
