// A local stand-in for arXiv's query API, so the Queue demo never talks to the
// real one. The two Scouts the launch runs are answered with papers written
// here (the core's recorded feeds have too few for a Cap to cut anything);
// every other Query is answered with an empty feed.
import { createServer } from "node:http";

/** `[arxiv id, title, authors]`, by the word in the Query that asks for them. */
const FEEDS = {
  // Sleep and consolidation: four arrivals against a Cap of two. The first is
  // by an author the vault holds (born2010), so the Cap keeps it.
  consolidation: [
    [
      "2610.10001",
      "Spindle-locked replay predicts overnight gain",
      ["Jan Born"],
    ],
    [
      "2610.10002",
      "Slow-wave amplitude and word-pair recall",
      ["Ana van der Meer"],
    ],
    ["2610.10003", "Napping and the fate of weak memories", ["R. Okafor"]],
    ["2610.10004", "Odour cueing during slow-wave sleep", ["T. Lindqvist"]],
  ],
  // Memory replay: the paper the skim Scout already holds (it is raised) and
  // one of its own.
  replay: [
    ["2610.00010", "Cueing in the skim lane", ["S. Quill"]],
    ["2610.00020", "Replay without sleep", ["V. Castellan"]],
  ],
};

const entry = ([id, title, authors]) => `  <entry>
    <id>http://arxiv.org/abs/${id}v1</id>
    <updated>2026-10-17T10:00:00Z</updated>
    <published>2026-10-17T10:00:00Z</published>
    <title>${title}</title>
    <summary>An abstract for ${title}.</summary>
${authors.map((name) => `    <author><name>${name}</name></author>`).join("\n")}
    <link href="http://arxiv.org/abs/${id}v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/${id}v1" rel="related" type="application/pdf"/>
    <category term="q-bio.NC" scheme="http://arxiv.org/schemas/atom"/>
  </entry>`;

const feed = (papers) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <id>http://arxiv.org/api/queue-demo</id>
  <updated>2026-10-17T10:00:00Z</updated>
  <opensearch:totalResults>${papers.length}</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>100</opensearch:itemsPerPage>
${papers.map(entry).join("\n")}
</feed>`;

export function startStandin() {
  const requests = [];
  const server = createServer((request, response) => {
    const query =
      new URL(request.url ?? "/", "http://localhost").searchParams.get(
        "search_query"
      ) ?? "";
    requests.push(query);
    const word = Object.keys(FEEDS).find((w) => query.includes(w));
    response
      .writeHead(200, { "content-type": "application/atom+xml" })
      .end(feed(word === undefined ? [] : FEEDS[word]));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        requests,
        endpoint: `http://127.0.0.1:${server.address().port}/api/query`,
        close: () => server.close(),
      })
    )
  );
}
