// A local stand-in for arXiv's query API, so the Scout demo never talks to the
// real one. It serves the core's recorded Atom fixtures and answers 503 while
// `mode.failing` is set — the one thing the demo needs the network to do that
// a recorded feed cannot.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/core/fixtures/arxiv"
);
const normal = readFileSync(join(fixtures, "normal.xml"), "utf8");
// A second field of work for the second Scout: the same recorded feed under
// other ids and titles, so two Scouts do not find one paper.
const replay = normal
  .replaceAll("2609.01234", "2609.07001")
  .replaceAll("2609.05678", "2609.07002")
  .replace(
    "Probing the Overnight Benefit:\n  Consolidation or Encoding?",
    "Replay Without Sleep"
  )
  .replace("Slow Oscillations Reconsidered", "Replay During Quiet Waking");

export function startStandin() {
  const mode = { failing: false, requests: [] };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    mode.requests.push(url.searchParams.get("search_query"));
    if (mode.failing) {
      response.writeHead(503).end("Service Unavailable");
      return;
    }
    const body = (url.searchParams.get("search_query") ?? "").includes("replay")
      ? replay
      : normal;
    response
      .writeHead(200, { "content-type": "application/atom+xml" })
      .end(body);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        mode,
        endpoint: `http://127.0.0.1:${server.address().port}/api/query`,
        close: () => server.close(),
      })
    )
  );
}
