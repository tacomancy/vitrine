// A local stand-in for OpenAlex's works endpoint, so the attention demo never
// reaches the real one. It answers the one question the client asks — how many
// works the Terms match in a month — from a table of fields, and answers 500
// while `mode.failTerm` is set and the query holds it: the one thing the demo
// needs the network to do that a table cannot.
import { createServer } from "node:http";
import { FIELDS } from "./vault.mjs";

/** `YYYY-MM` of the month `back` months before the current one, in UTC, as the core's clock reads it. */
const monthsBack = (back) => {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)
  );
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export function startStandin() {
  const mode = { failTerm: null, requests: [] };
  // The last 12 complete months are 12 back to 1 back; the 12 before are 24 to 13.
  const recentFrom = monthsBack(12);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    mode.requests.push(url);
    const filter = url.searchParams.get("filter") ?? "";
    if (mode.failTerm !== null && filter.includes(mode.failTerm)) {
      response.writeHead(500).end("Internal Server Error");
      return;
    }
    const month = /from_publication_date:(\d{4}-\d{2})-01/.exec(filter)?.[1];
    const field = FIELDS.find((f) => filter.includes(`"${f.phrase}"`));
    // A field the table does not know is a small one, which is what the demo's
    // thinnest Tag must look like to be unplaced.
    const count =
      field === undefined || month === undefined
        ? 1
        : month >= recentFrom
          ? field.recent
          : field.prior;
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ meta: { count }, results: [] }));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        mode,
        get requests() {
          return mode.requests;
        },
        endpoint: `http://127.0.0.1:${server.address().port}/works`,
        close: () => server.close(),
      })
    )
  );
}
