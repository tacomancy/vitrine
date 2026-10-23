// A local stand-in for arXiv's query API and OpenAlex's works, sources and
// publishers endpoints, so the OpenAlex demo (#810) never reaches either real
// one. OpenAlex's answers are chosen by what the request asks, from the small
// catalogue below; the budget is a switch (`/__budget?mode=…`) the drives flip
// from their own process, because the stand-in lives in the demo's.
import { createServer } from "node:http";

const ARXIV_SOURCE = "https://openalex.org/S4306400194";
const oa = (id) => `https://openalex.org/${id}`;

/** Venues and the publishers behind them; an imprint (P2) sits under its parent (P3). */
const VENUES = {
  S1: {
    name: "Journal of Interpretability",
    type: "journal",
    issn: "2001-0001",
    pub: ["P1", "Press Seven"],
  },
  S2: {
    name: "Transactions on Probing",
    type: "journal",
    issn: "2002-0002",
    pub: ["P2", "Acme Imprint"],
    parent: ["P3", "Acme Publishing"],
  },
  S3: {
    name: "Journal of Interpretability Letters",
    type: "journal",
    issn: "2001-0099",
    pub: ["P1", "Press Seven"],
  },
  S4: {
    name: "Proceedings of Sleep Science",
    type: "conference",
    issn: null,
    pub: ["P4", "Society Press"],
  },
};

const lineage = (v) => (v.parent ? [v.pub[0], v.parent[0]] : [v.pub[0]]);
const lineageNames = (v) => (v.parent ? [v.pub[1], v.parent[1]] : [v.pub[1]]);

const work = (n, title, venue, over = {}) => ({
  id: oa(`W${n}`),
  doi: `https://doi.org/10.1000/demo${n}`,
  title,
  publication_date: "2026-10-12",
  authorships: [{ author: { display_name: "Ada Meer" } }],
  abstract_inverted_index: { A: [0], published: [1], abstract: [2] },
  primary_location: {
    landing_page_url: `https://journal.example/w${n}`,
    source: {
      id: oa(venue),
      display_name: VENUES[venue].name,
      type: VENUES[venue].type,
      host_organization: oa(VENUES[venue].pub[0]),
      host_organization_name: VENUES[venue].pub[1],
      host_organization_lineage: lineage(VENUES[venue]).map(oa),
      host_organization_lineage_names: lineageNames(VENUES[venue]),
    },
  },
  locations: [],
  ...over,
});

/** Works by the word that finds them in the request's search. */
const CATALOGUE = {
  probe: [
    work(1, "Linear probes recover steering directions", "S1"),
    work(2, "What a probe cannot see", "S2"),
    work(3, "Probing across layers, revisited", "S3"),
    work(4, "A probe for slow structure", "S2"),
  ],
  // The same paper arXiv's stand-in lists, with an arXiv copy among its locations.
  oscillations: [
    work(5, "Slow Oscillations Reconsidered", "S4", {
      locations: [
        {
          landing_page_url: "https://journal.example/w5",
          source: { id: oa("S4") },
        },
        {
          landing_page_url: "https://arxiv.org/abs/2610.00001",
          source: { id: ARXIV_SOURCE },
        },
      ],
    }),
  ],
};

const names = {
  sources: Object.entries(VENUES).map(([id, v]) => ({
    id: oa(id),
    display_name: v.name,
    host_organization_name: v.pub[1],
    issn_l: v.issn,
    issn: v.issn ? [v.issn] : [],
    works_count: { S1: 1840, S2: 920, S3: 75, S4: 310 }[id],
  })),
  publishers: [
    { id: oa("P1"), display_name: "Press Seven", works_count: 24500 },
    { id: oa("P2"), display_name: "Acme Imprint", works_count: 3100 },
    { id: oa("P3"), display_name: "Acme Publishing", works_count: 91000 },
  ],
};

const arxivFeed = (total, entries) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>${total}</opensearch:totalResults>${entries}</feed>`;
const OSCILLATIONS_ENTRY = `<entry><id>http://arxiv.org/abs/2610.00001v1</id><published>2026-10-10T00:00:00Z</published><title>Slow Oscillations Reconsidered</title><summary>Preprint abstract.</summary><author><name>Ada Meer</name></author><link href="http://arxiv.org/abs/2610.00001v1" rel="alternate"/></entry>`;

export function startStandin() {
  // `open`: plenty left. `low`: under the sync's reserve, so the scatter yields
  // while a Scout may still spend it. `spent`: every OpenAlex request is a 429.
  const state = { budget: "open", requests: [] };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/__budget") {
      state.budget = url.searchParams.get("mode");
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/api/query") {
      const query = url.searchParams.get("search_query") ?? "";
      state.requests.push({ source: "arxiv", query });
      response
        .writeHead(200, { "content-type": "application/atom+xml" })
        .end(
          query.includes("oscillations")
            ? arxivFeed(1, OSCILLATIONS_ENTRY)
            : arxivFeed(0, "")
        );
      return;
    }
    const headers = { "content-type": "application/json" };
    if (state.budget === "spent") {
      response
        .writeHead(429, {
          ...headers,
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "5400",
        })
        .end(JSON.stringify({ error: "daily budget spent" }));
      return;
    }
    headers["x-ratelimit-remaining"] = state.budget === "low" ? "250" : "912";
    headers["x-ratelimit-reset"] = "5400";
    const filter = url.searchParams.get("filter") ?? "";
    const search = url.searchParams.get("search") ?? "";
    if (/\/sources$|\/publishers$/.test(url.pathname)) {
      const kind = url.pathname.endsWith("sources") ? "sources" : "publishers";
      state.requests.push({ source: "openalex", kind, search });
      const found = names[kind].filter((r) =>
        r.display_name.toLowerCase().includes(search.toLowerCase())
      );
      response.writeHead(200, headers).end(JSON.stringify({ results: found }));
      return;
    }
    const month = /from_publication_date:(\d{4}-\d{2})-01/.exec(filter);
    if (month !== null) {
      // The scatter's monthly count: a field that is steady, whatever the Terms.
      response
        .writeHead(200, headers)
        .end(JSON.stringify({ meta: { count: 40 }, results: [] }));
      return;
    }
    const worksTerm =
      /title_and_abstract\.search:([^,]*)/.exec(filter)?.[1] ?? "";
    const venues =
      /primary_location\.source\.id:([^,]*)/.exec(filter)?.[1]?.split("|") ??
      null;
    state.requests.push({
      source: "openalex",
      kind: "works",
      filter,
      page: url.searchParams.get("page"),
      per: url.searchParams.get("per-page"),
    });
    let results;
    let total;
    if (worksTerm.toLowerCase().includes("ceiling")) {
      // 650 match; a page is 200 and a run keeps 400.
      const page = Number(url.searchParams.get("page") ?? 1);
      const per = Number(url.searchParams.get("per-page") ?? 200);
      total = 650;
      results = Array.from(
        { length: Math.max(0, Math.min(per, total - (page - 1) * per)) },
        (_, i) => {
          const n = 100 + (page - 1) * per + i;
          return work(n, `Broad finding number ${n}`, "S1");
        }
      );
    } else {
      const hits = Object.entries(CATALOGUE).flatMap(([word, ws]) =>
        worksTerm.toLowerCase().includes(word) ? ws : []
      );
      results = hits.filter(
        (w) =>
          venues === null ||
          venues.some(
            (id) =>
              oa(id) === w.primary_location.source.id ||
              id ===
                w.primary_location.source.id.replace(
                  "https://openalex.org/",
                  ""
                )
          )
      );
      total = results.length;
    }
    response
      .writeHead(200, headers)
      .end(JSON.stringify({ meta: { count: total }, results }));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({
        state,
        origin,
        arxivEndpoint: `${origin}/api/query`,
        openalexEndpoint: `${origin}/works`,
        close: () => server.close(),
      });
    })
  );
}
