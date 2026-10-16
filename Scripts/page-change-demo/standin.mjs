// A local stand-in for a lab that moves its publications page, and for the
// model's API, so the page change demo never talks to a real site or spends a
// real key. `mode.moved` turns the old page into a 404, the way a moved page
// is.
import { createServer } from "node:http";

// Every paper carries a venue on the page, so the Accept rate has something
// to measure (a Watched Scout whose papers lack one has none: ADR 0042 d.3).
const VENUE = "Journal of Sleep Research";
const TITLES = [
  "Overnight Replay Consolidates Declarative Memory",
  "Sleep Spindles Predict Next-Day Learning",
  "A Nap Is Not a Night",
  "Slow Oscillations Gate Hippocampal Ripples",
  "Targeted Reactivation During Slow-Wave Sleep",
  "Encoding Strength Moderates Overnight Gain",
  "Sleep Deprivation Blunts Replay",
  "Spindle Density Tracks Retention",
];
const paper = (title, i) => ({
  title,
  authors: ["Ada Rowe"],
  date: `2026-09-${String(10 + i).padStart(2, "0")}`,
  venue: VENUE,
  keywords: null,
  abstract: null,
  url: `https://lab.example/papers/${i}/`,
});
const CATALOG = TITLES.map(paper);
const pageOf = (indexes) =>
  `<!doctype html><html><head><title>Sleep Lab — Publications</title></head><body><main><h2>Publications</h2><ul>${indexes
    .map((i) => {
      const p = CATALOG[i];
      return `<li><a href="${p.url}">${p.title}</a> <span class="authors">${p.authors[0]}</span> <span class="date">${p.date}</span> <span class="venue">${VENUE}</span></li>`;
    })
    .join(
      ""
    )}</ul></main><footer>Page generated 2026-09-30</footer></body></html>`;
// The old page lists six papers; the new one overlaps it by one and lists two
// more, so the first look has something it already holds and something new.
const OLD = pageOf([0, 1, 2, 3, 4, 5]);
const NEW = pageOf([0, 6, 7]);

export function startStandin() {
  const mode = { moved: false, modelCalls: 0 };
  const requests = [];
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
          return send(200, "application/json", '{"input_tokens":1}');
        mode.modelCalls += 1;
        const items = CATALOG.filter((c) => body.includes(c.title));
        send(
          200,
          "application/json",
          JSON.stringify({
            id: "msg_demo",
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            stop_reason: "end_turn",
            stop_sequence: null,
            content: [{ type: "text", text: JSON.stringify({ items }) }],
            usage: { input_tokens: 1800, output_tokens: 260 },
          })
        );
      });
      return;
    }
    if (pathname === "/old/")
      return mode.moved
        ? send(404, "text/plain", "moved")
        : send(200, "text/html", OLD);
    if (pathname === "/new/") return send(200, "text/html", NEW);
    send(404, "text/plain", "not found");
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        mode,
        requests,
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => server.close(),
      })
    )
  );
}
