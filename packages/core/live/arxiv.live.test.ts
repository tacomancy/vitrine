import { expect, it } from "vitest";
import { createArxivClient } from "../src/arxiv.js";

// The one test that asks arXiv itself, to notice if the Atom it returns
// stops looking like the recorded fixtures. Outside the default suite on
// purpose: it needs the network, and the ToU asks for restraint. Run with
// `pnpm --filter core test:live`.
it("answers a real Query in the shape the client reads", async () => {
  const client = createArxivClient({
    fetch,
    clock: {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
  });

  const found = await client.search("cat:cs.LG AND all:probing", null, {
    limit: 3,
  });

  expect(found.total).toBeGreaterThan(0);
  expect(found.items).toHaveLength(3);
  for (const item of found.items) {
    expect(item.arxivId).toMatch(/^[\w.-]+(?:\/\d+)?$/);
    expect(item.title).not.toBe("");
    expect(item.authors.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(item.published))).toBe(false);
  }
}, 30_000);
