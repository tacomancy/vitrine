// A local stand-in for one lab's site, which the beat 16 demo's Scout reads
// as three pages, and for the model's API, so the demo never talks to a real
// site or spends a real key. All three pages are on the one host:
//
// - /blog/ advertises a feed, so it is read without the model;
// - /papers/ needs an Extraction, and its Item pages are read by the model;
// - /talks/ needs an Extraction too, and lists the same three talks at every
//   check, so it parses cleanly and goes quiet while its siblings keep finding.
//
// `mode.round` adds papers and a post at the second check, and a paper and a
// post at the third; `mode.broken` makes /papers/ answer 503. A drive mends it
// over GET /__mend, which is the stand-in's own and is left out of `requests`.
import { createServer } from "node:http";

export const PAGES = { feed: "/blog/", papers: "/papers/", talks: "/talks/" };

// Every paper and talk carries its venue on the listing, so the Accept rate
// has something to measure (a Watched Scout whose papers lack one has none:
// ADR 0042 d.3). The feed's posts carry none, as a lab blog's do.
const PAPERS = [
  ["Overnight Replay Consolidates Declarative Memory", "Ada Rowe", 1],
  ["Sleep Spindles Predict Next-Day Learning", "Ben Ito", 1],
  ["A Nap Is Not a Night", "Cara Voss", 1],
  ["Slow Oscillations Gate Hippocampal Ripples", "Ada Rowe", 2],
  ["Targeted Reactivation During Slow-Wave Sleep", "Dev Patel", 2],
  ["Sleep Deprivation Blunts Replay", "Ben Ito", 2],
  ["Spindle Density Tracks Retention", "Cara Voss", 3],
].map(([title, author, round], i) => ({
  title,
  authors: [author],
  date: `2026-10-${String(1 + i * 3).padStart(2, "0")}`,
  venue: "Journal of Sleep Research",
  path: `/papers/${slug(title)}/`,
  round,
}));
const TALKS = [
  ["What Replay Is For", "Ada Rowe"],
  ["Memory Across a Night", "Ben Ito"],
  ["Measuring Spindles at Home", "Cara Voss"],
].map(([title, author], i) => ({
  title,
  authors: [author],
  date: `2026-09-${String(8 + i * 5).padStart(2, "0")}`,
  venue: "Sleep and Memory Symposium",
  path: `/talks/${slug(title)}/`,
  round: 1,
}));
const POSTS = [
  ["Our New Sleep Recording Rig", "Dev Patel", 1],
  ["Recruiting for the Nap Study", "Cara Voss", 1],
  ["What We Learned From a Hundred Nights", "Ada Rowe", 2],
  ["The Nap Study Begins", "Ben Ito", 3],
].map(([title, author, round], i) => ({
  title,
  author,
  date: new Date(Date.UTC(2026, 9, 5 + i * 7, 8)).toUTCString(),
  path: `/blog/${slug(title)}/`,
  round,
}));

function slug(title) {
  return title.toLowerCase().replace(/[^a-z]+/g, "-");
}
const abstractOf = (item) =>
  `${item.title}: what the lab found, in one sentence.`;

const listing = (origin, heading, items) =>
  `<!doctype html><html><head><title>Sleep Lab — ${heading}</title></head><body><main><h2>${heading}</h2><ul>${items
    .map(
      (p) =>
        `<li><a href="${origin}${p.path}">${p.title}</a> <span class="authors">${p.authors[0]}</span> <span class="date">${p.date}</span> <span class="venue">${p.venue}</span></li>`
    )
    .join("")}</ul></main></body></html>`;
const itemPage = (item) =>
  `<!doctype html><html><head><title>${item.title} — Sleep Lab</title></head><body><main><article><h1>${item.title}</h1><p>${item.authors?.[0] ?? item.author}</p><p>${abstractOf(item)}</p></article></main></body></html>`;
const blog = `<!doctype html><html><head><title>Sleep Lab — Blog</title><link rel="alternate" type="application/rss+xml" title="Posts" href="/blog/feed.xml" /></head><body><main><h2>Blog</h2><p>News from the lab.</p></main></body></html>`;
const feed = (origin, posts) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Sleep Lab — Blog</title><link>${origin}/blog/</link>${posts
    .map(
      (p) =>
        `<item><title>${p.title}</title><link>${origin}${p.path}</link><dc:creator>${p.author}</dc:creator><pubDate>${p.date}</pubDate><description>${abstractOf(p)}</description></item>`
    )
    .join("")}</channel></rss>`;

/** What each round's check finds new on the pages that keep finding. */
export const NEW_AT = (round) => ({
  papers: PAPERS.filter((p) => p.round === round).map((p) => p.title),
  feed: POSTS.filter((p) => p.round === round).map((p) => p.title),
});

export function startStandin() {
  const mode = { round: 1, broken: false, listingCalls: 0, itemPageCalls: 0 };
  const requests = [];
  let origin = "";
  const upTo = (items) => items.filter((i) => i.round <= mode.round);
  const items = () => [...PAPERS, ...TALKS, ...POSTS];

  const answer = (body) => {
    const content = JSON.parse(body).messages?.[0]?.content ?? "";
    const text = String(
      Array.isArray(content) ? content.map((c) => c.text).join("") : content
    );
    // The core opens an Item page's Extraction with this line
    // (`model-provider.ts`); anything else is a listing's.
    if (!text.startsWith("Fields asked for:")) {
      mode.listingCalls += 1;
      const found = [...PAPERS, ...TALKS]
        .filter((p) => text.includes(p.title))
        .map(({ title, authors, date, venue, path }) => ({
          title,
          authors,
          date,
          venue,
          keywords: null,
          abstract: null,
          url: `${origin}${path}`,
        }));
      return {
        output: JSON.stringify({ items: found }),
        input: 1800,
        out: 260,
      };
    }
    // An Item page arrives reduced; the one it is names its own title.
    mode.itemPageCalls += 1;
    const item = items().find((i) => text.includes(i.title));
    return {
      output: JSON.stringify({
        authors: null,
        date: null,
        venue: null,
        abstract: item ? abstractOf(item) : null,
        paperUrl: null,
      }),
      input: 900,
      out: 120,
    };
  };

  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    const send = (status, type, body) =>
      response.writeHead(status, { "content-type": type }).end(body);
    if (pathname === "/__mend") {
      mode.broken = false;
      return send(200, "text/plain", "mended");
    }
    requests.push(pathname);
    if (pathname.startsWith("/v1/messages")) {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        if (pathname.endsWith("/count_tokens"))
          return send(200, "application/json", '{"input_tokens":1200}');
        const { output, input, out } = answer(body);
        send(
          200,
          "application/json",
          JSON.stringify({
            id: "msg_demo",
            type: "message",
            role: "assistant",
            model: JSON.parse(body).model,
            stop_reason: "end_turn",
            stop_sequence: null,
            content: [{ type: "text", text: output }],
            usage: { input_tokens: input, output_tokens: out },
          })
        );
      });
      return;
    }
    if (pathname === "/robots.txt")
      return send(200, "text/plain", "User-agent: *\nAllow: /\n");
    if (pathname === PAGES.feed) return send(200, "text/html", blog);
    if (pathname === "/blog/feed.xml")
      return send(200, "application/rss+xml", feed(origin, upTo(POSTS)));
    if (pathname === PAGES.papers)
      return mode.broken
        ? send(503, "text/plain", "down for maintenance")
        : send(200, "text/html", listing(origin, "Papers", upTo(PAPERS)));
    if (pathname === PAGES.talks)
      return send(200, "text/html", listing(origin, "Talks", TALKS));
    const item = items().find((i) => i.path === pathname);
    if (item) return send(200, "text/html", itemPage(item));
    send(404, "text/plain", "not found");
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      done({
        mode,
        requests,
        origin,
        paths: [
          "/robots.txt",
          ...Object.values(PAGES),
          "/blog/feed.xml",
          ...items().map((i) => i.path),
          "/v1/messages",
          "/v1/messages/count_tokens",
        ],
        close: () => server.close(),
      });
    })
  );
}
