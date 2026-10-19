import { describe, expect, it } from "vitest";
import { createOpenAlexClient, OpenAlexError } from "./openalex.js";
import { urlOf, virtualClock } from "./test-core.js";

// The OpenAlex client on its own (#653): the pacing, the rate-limit headers
// and the split of a query that nears 4 KB, against a clock a test moves.

const answer = (count: number, headers: Record<string, string> = {}) =>
  Response.json({ meta: { count }, results: [] }, { headers });

describe("the OpenAlex client", () => {
  it("serialises requests and leaves a gap between them", async () => {
    const clock = virtualClock();
    let inFlight = 0;
    let most = 0;
    const client = createOpenAlexClient({
      clock,
      fetch: async () => {
        most = Math.max(most, ++inFlight);
        await Promise.resolve();
        inFlight--;
        return answer(1);
      },
    });
    await Promise.all([
      client.monthlyCounts(["a"], ["2026-01", "2026-02"]),
      client.monthlyCounts(["b"], ["2026-01"]),
    ]);
    expect(most).toBe(1);
    expect(clock.slept.length).toBe(2);
  });

  it("stops sending once a response says the budget is spent, until its reset", async () => {
    const clock = virtualClock();
    let sent = 0;
    const client = createOpenAlexClient({
      clock,
      fetch: () => {
        sent++;
        return Promise.resolve(
          answer(1, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "60" })
        );
      },
    });
    await expect(
      client.monthlyCounts(["a"], ["2026-01", "2026-02"])
    ).rejects.toMatchObject({ kind: "rate_limited" });
    expect(sent).toBe(1);
    // After the reset the same client may ask again.
    await clock.sleep(61_000);
    await expect(client.monthlyCounts(["a"], ["2026-03"])).resolves.toEqual([
      1,
    ]);
  });

  it("calls a 429 rate_limited, an unreachable host network, a 500 http and a non-count answer parse", async () => {
    const kinds = async (reply: () => Promise<Response>) =>
      createOpenAlexClient({
        clock: virtualClock(),
        fetch: reply,
      })
        .monthlyCounts(["a"], ["2026-01"])
        .catch((e: unknown) => (e as OpenAlexError).kind);
    expect(
      await kinds(() => Promise.resolve(new Response("", { status: 429 })))
    ).toBe("rate_limited");
    expect(await kinds(() => Promise.reject(new Error("offline")))).toBe(
      "network"
    );
    expect(
      await kinds(() => Promise.resolve(new Response("", { status: 500 })))
    ).toBe("http");
    expect(await kinds(() => Promise.resolve(Response.json({ nope: 1 })))).toBe(
      "parse"
    );
  });

  it("splits a query that would pass the URL limit and unions the works, not the counts", async () => {
    const seen: URL[] = [];
    const works: Record<string, string[]> = {
      alpha: ["W1", "W2"],
      beta: ["W2", "W3"],
    };
    const client = createOpenAlexClient({
      clock: virtualClock(),
      // Short enough that the two Terms cannot share one URL.
      maxUrl: 170,
      fetch: (input: string | URL | Request) => {
        const url = urlOf(input);
        seen.push(url);
        const term = /"(\w+)"/.exec(url.searchParams.get("filter")!)![1]!;
        return Promise.resolve(
          Response.json({
            meta: { next_cursor: null },
            results: works[term]!.map((id) => ({ id })),
          })
        );
      },
    });
    expect(await client.monthlyCounts(["alpha", "beta"], ["2026-01"])).toEqual([
      3,
    ]);
    expect(seen).toHaveLength(2);
  });
});
