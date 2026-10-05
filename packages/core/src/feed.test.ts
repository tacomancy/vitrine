import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFeed } from "./feed.js";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "../fixtures/watched", name), "utf8");

describe("readFeed authors", () => {
  it("takes the name from an RSS <author> written `address (Name)`", () => {
    const entries = readFeed(fixture("lab-feed.rss.xml"));
    expect(
      entries.find((e) => e.title.startsWith("Sleep Spindles"))?.authors
    ).toEqual(["Cara Voss"]);
  });

  it("keeps a bare RSS <author> whole rather than its first character", () => {
    const rss = `<rss><channel><item><title>T</title><link>https://x.test/a</link><author>Cara Voss</author></item></channel></rss>`;
    expect(readFeed(rss)[0]?.authors).toEqual(["Cara Voss"]);
  });
});
