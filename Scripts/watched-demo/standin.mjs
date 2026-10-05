// A local stand-in for a lab's website and for the model's API, so the
// Watched sources demo never talks to a real site or spends a real key. The
// site serves the core's recorded pages; the model endpoint is the one the
// Anthropic SDK is pointed at with ANTHROPIC_BASE_URL. The model answers the
// way a model does on the demo's page — the three papers it lists plus one it
// made up, which verification must drop — and reads nothing from a page it
// cannot find them on.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/core/fixtures/watched"
);
const read = (name) => readFileSync(join(fixtures, name), "utf8");
const pages = {
  plain: read("lab-page.html"),
  withFeed: read("lab-page-with-feed.html"),
  redesigned: read("lab-page-redesigned.html"),
  feed: read("lab-feed.rss.xml"),
};

export const WELL_KEY = "sk-demo-good";
export const REFUSED_KEY = "sk-demo-refused";

const LISTED = [
  {
    title: "Overnight Replay Consolidates Declarative Memory",
    authors: ["Ada Rowe", "Ben Ito"],
    date: "2026-09-12",
    venue: null,
    keywords: null,
    abstract: "We record hippocampal replay across a night of sleep.",
    url: "https://arxiv.org/abs/2609.01234v2?utm_source=lab",
  },
  {
    title: "Sleep Spindles Predict Next-Day Learning",
    authors: ["Cara Voss"],
    date: "2026-08-30",
    venue: "Journal of Sleep Research",
    keywords: null,
    abstract: null,
    url: "https://lab.example/papers/spindles/",
  },
  {
    title: "A Nap Is Not a Night",
    authors: ["Dev Patel"],
    date: "2026-07-01",
    venue: null,
    keywords: null,
    abstract: null,
    url: "https://doi.org/10.1234/Nap.5",
  },
];
// Posted after the first look, so the page differs and is read again — a
// page that has not changed is never sent to the model.
const NEWER = {
  ...LISTED[2],
  title: "Sleep Deprivation Blunts Replay",
  authors: ["Eli Moss"],
  date: "2026-09-28",
  url: "https://lab.example/papers/deprivation/",
};
// Not on the page: the card a model invents. Proposing it would be a paper
// nobody published.
const INVENTED = {
  ...LISTED[0],
  title: "Sleep Cures Everything",
  url: "https://lab.example/papers/cures",
};

export function startStandin() {
  const mode = {
    /** The lab has posted a new paper. */
    posted: false,
    /** The lab's page has been redesigned: its listing is gone. */
    redesigned: false,
    /** The provider answers 401 whatever key it is sent. */
    refuseKeys: false,
    modelCalls: 0,
    paths: [],
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    mode.paths.push(url.pathname);
    const send = (status, type, body) =>
      response.writeHead(status, { "content-type": type }).end(body);
    if (url.pathname === "/lab/")
      return send(
        200,
        "text/html",
        mode.redesigned
          ? pages.redesigned
          : mode.posted
            ? pages.plain.replace(
                "</ul>",
                `<li><a href="${NEWER.url}">${NEWER.title}</a> <span class="authors">${NEWER.authors[0]}</span> <span class="date">${NEWER.date}</span></li></ul>`
              )
            : pages.plain
      );
    if (url.pathname === "/feed-lab/")
      return send(200, "text/html", pages.withFeed);
    if (url.pathname === "/feed.xml")
      return send(200, "application/rss+xml", pages.feed);
    if (url.pathname.startsWith("/v1/messages")) {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const key = request.headers["x-api-key"];
        if (mode.refuseKeys || key === REFUSED_KEY)
          return send(
            401,
            "application/json",
            JSON.stringify({
              type: "error",
              error: {
                type: "authentication_error",
                message: "invalid x-api-key",
              },
            })
          );
        if (url.pathname.endsWith("/count_tokens"))
          return send(200, "application/json", '{"input_tokens":1}');
        mode.modelCalls += 1;
        const items = body.includes("Overnight Replay Consolidates")
          ? [
              ...LISTED,
              ...(body.includes(NEWER.title) ? [NEWER] : []),
              INVENTED,
            ]
          : [];
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
    send(404, "text/plain", "not found");
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ mode, origin, close: () => server.close() });
    })
  );
}
