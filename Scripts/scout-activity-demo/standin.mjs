// A local stand-in for arXiv's query API, so the Scout Activity demo never
// talks to the real one. It serves the core's recorded Atom fixtures, chosen
// by what the Query says, so each Scout in the fleet can be given the answer
// its row is meant to show without a switch the drive has to flip.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/core/fixtures/arxiv"
);
const feed = (name) => readFileSync(join(fixtures, `${name}.xml`), "utf8");
const normal = feed("normal"); // two results
const revised = feed("revised"); // one result
const empty = feed("empty"); // none

/** What a Query is answered with, by a word in it. */
export function answer(query) {
  if (query.includes("broken")) return { status: 503, body: "Unavailable" };
  if (query.includes("quiet")) return { status: 200, body: empty };
  // A Query narrowed by category matches less than the same words bare:
  // the edit the demo makes to the poor Scout.
  if (query.includes("cat:")) return { status: 200, body: revised };
  return { status: 200, body: normal };
}

export function startStandin() {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    // The Watched Scout's page: no feed, so reading it would take a model,
    // and with no key stored the Scout waits instead (ADR 0040).
    if (url.pathname === "/publications") {
      response
        .writeHead(200, { "content-type": "text/html" })
        .end(
          "<html><body><h1>Publications</h1><p>Nothing listed yet.</p></body></html>"
        );
      return;
    }
    const query = url.searchParams.get("search_query") ?? "";
    requests.push(query);
    const { status, body } = answer(query);
    response
      .writeHead(status, { "content-type": "application/atom+xml" })
      .end(body);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        requests,
        origin: `http://127.0.0.1:${server.address().port}`,
        endpoint: `http://127.0.0.1:${server.address().port}/api/query`,
        close: () => server.close(),
      })
    )
  );
}
