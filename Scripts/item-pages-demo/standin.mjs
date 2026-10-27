// A local stand-in for anthropic.com's alignment listing and its Item pages,
// and for the model's API, so the Item pages demo never talks to the real
// site or spends a real key. The pages are the core's recorded fixtures
// (packages/core/fixtures/watched/item-pages) with `https://www.anthropic.com`
// rewritten to this server, so the listing and its items share a host the way
// they do on the real site; the off-host item keeps its real address and is
// never fetched (the host rule). Twenty generated notes, declared in JSON-LD,
// push the listing past the 25 Item pages a run reads, so its last three items
// arrive Listing-only.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/core/fixtures/watched/item-pages"
);
const fixture = (name) => readFileSync(join(fixtures, name), "utf8");

export const LISTING = "/research/team/alignment";
const BLURB =
  "Anthropic is an AI safety and research company that's working to build reliable, interpretable, and steerable AI systems.";

// The fixtures, in the order the listing shows them. Reward hacking is last
// on the site, so it is past the ceiling on the first look and fills in on
// the next run.
const RECORDED = [
  [
    "/research/tracing-thoughts-language-model",
    "tracing-thoughts.html",
    "Tracing the thoughts of a large language model",
  ],
  [
    "/research/agentic-misalignment",
    "agentic-misalignment.html",
    "Agentic Misalignment: How LLMs could be insider threats",
  ],
  ["/research/byline", "byline.html", "A Byline With No Markup"],
  ["/constitution", "constitution.html", "Claude's new constitution"],
  [
    "/research/sparse-probes",
    "sparse-probes.html",
    "Sparse Probes Find Planning Features",
  ],
  ["/research/plain-post", "plain-post.html", "A Plain Post With No Markup"],
  [
    "/research/already-dated",
    "already-dated.html",
    "A Card the Listing Already Dated",
  ],
];
const LAST = [
  "/research/reward-hacking",
  "reward-hacking.html",
  "Natural Emergent Misalignment from Reward Hacking",
];
const PEOPLE = [
  "Ada Rowe",
  "Ben Ito",
  "Chiara Moss",
  "Dev Patel",
  "Eun-ji Park",
];
const NOTES = Array.from({ length: 20 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return {
    path: `/research/note-${n}`,
    title: `Alignment research note ${n}`,
    author: PEOPLE[i % PEOPLE.length],
    date: `2025-${String((i % 9) + 1).padStart(2, "0")}-1${i % 10}`,
  };
});
const notePage = (
  note
) => `<!doctype html><html lang="en"><head><title>${note.title} \\ Anthropic</title>
<meta property="og:description" content="${BLURB}" />
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: note.title,
  datePublished: `${note.date}T00:00:00.000Z`,
  description: `What ${note.title.toLowerCase()} found, in a sentence.`,
  author: [{ "@type": "Person", name: note.author }],
})}</script></head><body><main><article><h1>${note.title}</h1><p>A generated note.</p></article></main></body></html>`;

const OFF_HOST = {
  url: "https://alignment.anthropic.com/2025/off-host/",
  title: "A Post on the Alignment Science Blog",
};

/**
 * What the model copies from each Item page that needs a call, keyed by a
 * phrase only that page carries. Every value is on its page as written, so
 * the core's Verify keeps it; the Paper link is the page's own *Read the
 * paper*, not one of the arXiv works it cites.
 */
const ITEM_ANSWERS = [
  [
    "Today we are sharing two new papers",
    {
      authors: ["Lindsey, Jack", "Gurnee, Wes"],
      abstract:
        "Today we are sharing two new papers on the biology of a large language model.",
      paperUrl:
        "https://transformer-circuits.pub/2025/attribution-graphs/biology.html",
    },
  ],
  [
    "We stress-tested 16 leading models",
    { authors: ["Lynch, Aengus", "Wright, Benjamin"] },
  ],
  [
    "light probing",
    {
      authors: ["Aengus Lynch", "Benjamin Wright"],
      date: "Jun 20, 2025",
      venue: "Transactions on Machine Learning Research",
      abstract:
        "We find that models trained to hide a goal still reveal it under light probing.",
    },
  ],
  [
    "We are publishing a new constitution for Claude.",
    { abstract: "We are publishing a new constitution for Claude." },
  ],
  [
    "Nothing on this page is declared for machines",
    {
      abstract:
        "Nothing on this page is declared for machines but its time element.",
    },
  ],
];

export function startStandin() {
  const mode = { listingCalls: 0, itemPageCalls: [] };
  const requests = [];
  let origin = "";
  const site = (html) => html.replaceAll("https://www.anthropic.com", origin);
  const listingItems = () => [
    ...RECORDED.map(([path, , title]) => ({ path, title })),
    ...NOTES,
    { path: LAST[0], title: LAST[2] },
  ];
  const listing = () =>
    site(fixture("listing.html")).replace(
      /<section>[\s\S]*<\/section>/,
      `<section>${[
        ...listingItems().map(
          (item) =>
            `<article><a href="${origin}${item.path}">${item.title}</a></article>`
        ),
        `<article><a href="${OFF_HOST.url}">${OFF_HOST.title}</a></article>`,
      ].join("\n")}</section>`
    );
  const pages = new Map([
    ...[...RECORDED, LAST].map(([path, file]) => [
      path,
      () => site(fixture(file)),
    ]),
    ...NOTES.map((note) => [note.path, () => notePage(note)]),
  ]);

  const answer = (body) => {
    const text = JSON.parse(body).messages?.[0]?.content ?? "";
    if (!String(text).startsWith("Fields asked for:")) {
      mode.listingCalls += 1;
      const items = [
        ...listingItems().map((item) => ({
          title: item.title,
          url: `${origin}${item.path}`,
        })),
        OFF_HOST,
      ].map((item) => ({
        authors: null,
        date: null,
        venue: null,
        keywords: null,
        abstract: null,
        ...item,
      }));
      return { output: JSON.stringify({ items }), input: 2400, out: 900 };
    }
    // The page arrives as reduced, with the fixture's line breaks in it.
    const flat = String(text).replace(/\s+/g, " ");
    const found = ITEM_ANSWERS.find(([phrase]) => flat.includes(phrase));
    mode.itemPageCalls.push(found ? found[0] : "(unrecognised page)");
    return {
      output: JSON.stringify({
        authors: null,
        date: null,
        venue: null,
        abstract: null,
        paperUrl: null,
        ...(found?.[1] ?? {}),
      }),
      input: 3100,
      out: 140,
    };
  };

  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    requests.push(pathname);
    const send = (status, type, body) =>
      response.writeHead(status, { "content-type": type }).end(body);
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
    if (pathname === LISTING) return send(200, "text/html", listing());
    const page = pages.get(pathname);
    if (page) return send(200, "text/html", page());
    send(404, "text/plain", "not found");
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      done({
        mode,
        requests,
        origin,
        itemPaths: [...pages.keys()],
        close: () => server.close(),
      });
    })
  );
}
