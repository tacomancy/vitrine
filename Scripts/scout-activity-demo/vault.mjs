// The scratch vault the Scout Activity demo runs on (#523): the fixture vault
// plus a dozen Scouts of mixed quality, and the run, Proposal and triage rows
// that make each one what it is. Seeded by SQL rather than driven through the
// app because the fleet needs twelve weeks of history, and the app is only
// ever allowed to make history by running a Scout against the network.
//
// Nothing here can reach arXiv: a Scout the launch finds due is run against
// the stand-in (`standin.mjs`), and the one Watched Scout is refused for want
// of a key before it fetches anything.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 86_400_000;
const HOUR = 3_600_000;

const QUESTIONS = {
  sleep: { id: "qsleep0001", text: "Does sleep consolidate or only protect?" },
  replay: { id: "qreplay002", text: "What does replay add to recall?" },
  dreams: { id: "qdreams003", text: "Do dreams carry anything forward?" },
  spindles: { id: "qspind0004", text: "Are spindles a cause or a marker?" },
  // Nothing is looking for these two, and `paused-lab` looks only for the
  // third, so a coverage gap names a Scout that is not looking.
  naps: { id: "qnaps00005", text: "Is a nap enough to consolidate?" },
  odour: { id: "qodour0006", text: "Can an odour cue replay in sleep?" },
  quietly: { id: "qquiet0007", text: "Is the quiet field really quiet?" },
};

const question = ({ id, text }, day) =>
  `---\nid: ${id}\nkind: question\nquestion: ${text}\nstatus: open\ncaptured: 2026-09-${String(10 + day).padStart(2, "0")}T09:00:00+01:00\ncontext: other\n---\n`;

const yaml = (name, extra) =>
  [
    `name: ${name}`,
    `cadence: ${extra.cadence ?? "daily"}`,
    `lane: ${extra.lane ?? "review"}`,
    "created: 2026-06-01T00:00:00Z",
    ...(extra.paused ? ["paused: true"] : []),
    ...(extra.assigned
      ? ["assigned:", ...extra.assigned.map((id) => `  - ${id}`)]
      : []),
    ...(extra.path
      ? ["source:", "  kind: watched", `  url: ${extra.origin}${extra.path}`]
      : ["filter:", `  query: ${extra.query}`]),
    "",
  ].join("\n");

/**
 * The twelve. `rate` is how many of each ten triaged Review items were
 * accepted over the twelve weeks (null: none triaged); `lastRun` is hours
 * since the last clean run, chosen so only the Scouts meant to run at launch
 * are due.
 */
const FLEET = [
  {
    id: "sleep-consolidation",
    name: "Sleep and consolidation",
    query: "all:sleep AND all:consolidation",
    assigned: [QUESTIONS.sleep.id],
    cadence: "weekly",
    rate: 7,
    lastRun: 3 * 24,
    pending: 2,
  },
  {
    id: "memory-replay",
    name: "Memory replay",
    query: "all:replay",
    assigned: [QUESTIONS.replay.id],
    rate: 6,
    lastRun: 5,
    pending: 3,
    // Two of its finds were first made by Sleep and consolidation.
    echoes: "sleep-consolidation",
  },
  {
    id: "spindles",
    name: "Sleep spindles",
    query: "all:spindle",
    assigned: [QUESTIONS.spindles.id],
    rate: 8,
    lastRun: 7,
    pending: 1,
  },
  {
    id: "hippocampal-ripples",
    name: "Hippocampal ripples",
    query: "all:ripple",
    assigned: [QUESTIONS.replay.id],
    cadence: "weekly",
    rate: 5,
    lastRun: 40,
    pending: 4,
    // Mostly finds what the vault already holds.
    held: 6,
  },
  {
    // The poor Query: broad enough to match everything, so most of it is
    // rejected. The demo fixes it from its row.
    id: "dream-reports",
    name: "Dream reports",
    query: "all:dream",
    assigned: [QUESTIONS.dreams.id],
    rate: 1,
    lastRun: 9,
    pending: 6,
    // What its last run fetched, which the row's *try* is compared with.
    fetched: 40,
  },
  {
    id: "fragile-feed",
    name: "Odour cueing",
    query: "all:broken",
    assigned: [QUESTIONS.odour.id],
    rate: 4,
    lastRun: 30,
    pending: 0,
    // Due, and the stand-in answers its Query with a 503.
    failed: true,
  },
  {
    id: "quiet-field",
    name: "Targeted memory reactivation",
    query: "all:quiet",
    assigned: [QUESTIONS.quietly.id],
    rate: null,
    lastRun: 6,
    pending: 0,
    // Clean runs that found nothing, before the last: the Warrant's evidence.
    quietRuns: 4,
  },
  {
    id: "paused-lab",
    name: "Nap studies (paused)",
    query: "all:nap",
    assigned: [QUESTIONS.naps.id],
    paused: true,
    rate: 5,
    lastRun: 80,
    pending: 1,
  },
  {
    id: "lab-page",
    name: "Sleep lab publications page",
    path: "/publications",
    cadence: "weekly",
    rate: null,
    lastRun: null,
    pending: 0,
  },
  {
    id: "new-scout",
    name: "Glymphatic clearance",
    query: "all:glymphatic",
    rate: null,
    lastRun: null,
    pending: 0,
  },
  {
    id: "skim-everything",
    name: "Sleep, skim only",
    query: "all:sleep",
    lane: "skim",
    rate: null,
    lastRun: 12,
    pending: 0,
    skim: 4,
  },
  {
    // The Scout the demo drops. It has Proposals waiting that must survive.
    id: "stale-topic",
    name: "Stale topic",
    query: "all:stale",
    rate: 3,
    lastRun: 15,
    pending: 3,
    deferred: 1,
  },
];

const iso = (ms) => new Date(ms).toISOString();

// The drives read these figures back off the screen (10%, 30%, "fetched 40",
// twelve rows): change a Scout's `rate`, `fetched` or the count here and the
// drives that name them must change with it.

/** The fixture vault with the fleet's files written, and the queue made and seeded. */
export async function fleetVault(fixture, vault, core, origin) {
  cpSync(fixture, vault, { recursive: true });
  mkdirSync(join(vault, "map"), { recursive: true });
  Object.values(QUESTIONS).forEach((q, i) =>
    writeFileSync(
      join(vault, `map/${q.text.replace("?", "")}.md`),
      question(q, i + 1)
    )
  );
  const scouts = join(vault, ".vitrine/scouts");
  mkdirSync(scouts, { recursive: true });
  for (const s of FLEET)
    writeFileSync(join(scouts, `${s.id}.yaml`), yaml(s.name, { ...s, origin }));

  const { openQueue } = await import(
    pathToFileURL(join(core, "dist/queue.js")).href
  );
  const db = await openQueue(vault);
  const now = Date.now();
  let key = 0;
  const run = (scout, startedAgo, o = {}) =>
    Number(
      db
        .prepare(
          `INSERT INTO scout_runs (scout_id, started, finished, outcome, error_kind, error_message, window_from, window_to, fetched, new, held, query)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          scout.id,
          iso(now - startedAgo),
          iso(now - startedAgo + 4000),
          o.failed ? "failed" : "ok",
          o.failed ? "http" : null,
          o.failed ? "arXiv answered 503" : null,
          iso(now - startedAgo - DAY),
          iso(now - startedAgo),
          o.fetched ?? 0,
          o.new ?? 0,
          o.held ?? 0,
          scout.query ?? null
        ).lastInsertRowid
    );
  const proposal = (
    scout,
    runId,
    { state, lane = "review", agoDays, action }
  ) => {
    key += 1;
    const id = Number(
      db
        .prepare(
          `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
           VALUES (?, ?, ?, '2026-08-01', 'A Journal', '', 'https://example.test/p', ?, ?, ?)`
        )
        .run(
          `demo${key}`,
          `${scout.name}: paper ${key}`,
          JSON.stringify(["A. Author"]),
          lane,
          state,
          iso(now - agoDays * DAY)
        ).lastInsertRowid
    );
    db.prepare(
      "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, ?, ?, 'https://example.test/p')"
    ).run(id, runId, scout.id, iso(now - agoDays * DAY));
    if (action)
      db.prepare(
        "INSERT INTO triage (proposal_id, action, at, batch) VALUES (?, ?, ?, NULL)"
      ).run(id, action, iso(now - agoDays * DAY + HOUR));
    return id;
  };

  for (const s of FLEET) {
    if (s.lastRun === null) continue;
    // Twelve weeks of triage, ten Review items a week, so every point of the
    // line rests on more than the five a week needs to be drawn.
    const history = run(s, 40 * DAY, { fetched: 40, new: 10 });
    if (s.rate !== null)
      for (let week = 0; week < 12; week++)
        for (let n = 0; n < 10; n++)
          proposal(s, history, {
            state: n < s.rate ? "accepted" : "rejected",
            agoDays: 3 + week * 7 + (n % 5),
            action: n < s.rate ? "accept" : "reject",
          });
    for (let n = 0; n < (s.quietRuns ?? 0); n++)
      run(s, (s.lastRun + 24 * (s.quietRuns - n)) * HOUR);
    const last = run(s, s.lastRun * HOUR, {
      failed: s.failed,
      fetched: s.fetched ?? s.pending + (s.held ?? 0),
      new: s.pending,
      held: s.held ?? 0,
    });
    for (let n = 0; n < s.pending; n++)
      proposal(s, last, { state: "pending", agoDays: 1 + (n % 3) });
    for (let n = 0; n < (s.deferred ?? 0); n++)
      proposal(s, last, { state: "deferred", agoDays: 2 });
    for (let n = 0; n < (s.held ?? 0); n++)
      proposal(s, last, { state: "held", agoDays: 1 });
    for (let n = 0; n < (s.skim ?? 0); n++)
      proposal(s, last, { state: "pending", lane: "skim", agoDays: 1 });
    if (s.echoes) {
      // A find the other Scout made first: its Appearance lands under the
      // echoing Scout's own run, after the original.
      const first = FLEET.find((f) => f.id === s.echoes);
      const echoRun = run(first, 2 * DAY);
      for (let n = 0; n < 2; n++) {
        const id = proposal(first, echoRun, { state: "pending", agoDays: 2 });
        db.prepare(
          "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, ?, ?, 'https://example.test/q')"
        ).run(id, last, s.id, iso(now - DAY));
      }
    }
  }
  db.close();
}
