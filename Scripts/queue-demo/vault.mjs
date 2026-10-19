// The scratch vault the Queue demo runs on (#650): the fixture vault plus
// six Scouts, and the Proposals, runs and triage rows that make each one
// what its step needs. Seeded by SQL because Cap, Rank and the counterweight
// slot all rest on triage history, and the app only ever makes history by
// someone triaging for weeks.
//
// Two Scouts are due at launch (`sleep`, `replay`) and are answered by the
// stand-in; everything else last ran inside its cadence, so a relaunch runs
// nothing. Seeded authors: the fixture vault's Sources hold Jan Born and
// Björn Rasch, so those are the "accepted work" authors.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 86_400_000;
const HOUR = 3_600_000;

const QUESTIONS = {
  consolidate: {
    id: "qconsol001",
    text: "Does sleep consolidate or only protect?",
  },
  replay: { id: "qreplay002", text: "What does replay add to recall?" },
  dreams: { id: "qdreams003", text: "Do dreams carry anything forward?" },
};

const question = ({ id, text }, day) =>
  `---\nid: ${id}\nkind: question\nquestion: ${text}\nstatus: open\ncaptured: 2026-09-${String(10 + day).padStart(2, "0")}T09:00:00+01:00\ncontext: other\n---\n`;

const scoutYaml = (s) =>
  [
    `name: ${s.name}`,
    "cadence: weekly",
    `lane: ${s.lane ?? "review"}`,
    "created: 2026-06-01T00:00:00Z",
    ...(s.cap ? [`cap: ${s.cap}`] : []),
    ...(s.assigned
      ? ["assigned:", ...s.assigned.map((id) => `  - ${id}`)]
      : []),
    "filter:",
    `  query: ${s.query}`,
    "",
  ].join("\n");

// `consolidation` and `replay` are the words the stand-in answers to.
const SCOUTS = [
  {
    id: "sleep",
    name: "Sleep and consolidation",
    query: "all:consolidation",
    assigned: [QUESTIONS.consolidate.id, QUESTIONS.replay.id],
    cap: 2,
    lastRun: 8 * 24, // hours: past a week, so due
  },
  {
    id: "replay",
    name: "Memory replay",
    query: "all:replay",
    assigned: [QUESTIONS.replay.id],
    lastRun: 8 * 24,
  },
  {
    id: "skim",
    name: "Sleep, skim only",
    query: "all:skimming",
    lane: "skim",
    lastRun: 72,
  },
  {
    id: "dreams",
    name: "Dream reports",
    query: "all:dreaming",
    assigned: [QUESTIONS.dreams.id],
    lastRun: 72,
  },
  // No Assigned Question: the Queue by Question files it under Unassigned.
  { id: "unfiled", name: "Unfiled finds", query: "all:unfiled", lastRun: 72 },
  {
    id: "tmr",
    name: "Targeted reactivation",
    query: "all:reactivation",
    lastRun: 72,
  },
];

const iso = (ms) => new Date(ms).toISOString();

/** The fixture vault with the Scouts written, and the queue made and seeded. */
export async function queueVault(fixture, vault, core) {
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
  for (const s of SCOUTS)
    writeFileSync(join(scouts, `${s.id}.yaml`), scoutYaml(s));

  const { openQueue } = await import(
    pathToFileURL(join(core, "dist/queue.js")).href
  );
  const db = await openQueue(vault);
  const now = Date.now();
  let key = 0;
  const run = (scout, agoMs) =>
    Number(
      db
        .prepare(
          `INSERT INTO scout_runs (scout_id, started, finished, outcome, window_from, window_to, fetched, new, held, query)
           VALUES (?, ?, ?, 'ok', ?, ?, 0, 0, 0, ?)`
        )
        .run(
          scout.id,
          iso(now - agoMs),
          iso(now - agoMs + 4000),
          iso(now - agoMs - DAY),
          iso(now - agoMs),
          scout.query
        ).lastInsertRowid
    );
  const proposal = (scout, runId, o) => {
    key += 1;
    const id = Number(
      db
        .prepare(
          `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
           VALUES (?, ?, ?, '2026-09-01', NULL, '', 'https://example.test/p', ?, ?, ?)`
        )
        .run(
          o.sourceKey ?? `demo${key}`,
          o.title,
          JSON.stringify(o.authors ?? ["A. Author"]),
          o.lane ?? "review",
          o.state ?? "pending",
          iso(now - o.agoDays * DAY)
        ).lastInsertRowid
    );
    db.prepare(
      "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, ?, ?, 'https://example.test/p')"
    ).run(id, runId, scout.id, iso(now - o.agoDays * DAY));
    for (const action of o.triage ?? [])
      db.prepare(
        "INSERT INTO triage (proposal_id, action, at) VALUES (?, ?, ?)"
      ).run(id, action, iso(now - o.agoDays * DAY + HOUR));
    return id;
  };
  const by = Object.fromEntries(SCOUTS.map((s) => [s.id, s]));
  const runs = Object.fromEntries(
    SCOUTS.map((s) => [s.id, run(s, s.lastRun * HOUR)])
  );

  // Sleep and consolidation: ten triaged Review items, so the Cap and the
  // counterweight slot are past their five-act floor.
  for (let n = 0; n < 10; n++)
    proposal(by.sleep, runs.sleep, {
      title: `Triaged sleep paper ${n}`,
      state: n < 7 ? "accepted" : "rejected",
      agoDays: 10 + n,
      triage: [n < 7 ? "accept" : "reject"],
    });
  proposal(by.sleep, runs.sleep, {
    title: "Spindle coupling in the papers you attached by hand",
    authors: ["Jan Born"],
    agoDays: 4,
  });
  // Found by two Scouts, by authors the vault has never accepted from: the
  // counterweight slot's one candidate.
  const outside = proposal(by.sleep, runs.sleep, {
    title: "Cortical spindles across species",
    authors: ["M. Haddad"],
    agoDays: 5,
  });
  db.prepare(
    "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, 'replay', ?, 'https://example.test/q')"
  ).run(outside, runs.replay, iso(now - 4 * DAY));
  for (let n = 1; n <= 3; n++)
    proposal(by.sleep, runs.sleep, {
      title: `Ten sleep hacks, a listicle (${n})`,
      authors: ["Chad Noisy"],
      agoDays: 1,
    });
  // Past the default 14-day window: the digest.
  for (let n = 1; n <= 2; n++)
    proposal(by.sleep, runs.sleep, {
      title: `An older sleep paper (${n})`,
      authors: ["P. Elder"],
      agoDays: 20,
    });

  // The paper Memory replay finds at launch, already waiting in Skim.
  proposal(by.skim, runs.skim, {
    title: "Cueing in the skim lane",
    authors: ["S. Quill"],
    lane: "skim",
    sourceKey: "arxiv:2610.00010",
    agoDays: 3,
  });

  // A group of four a researcher would clear in one gesture.
  for (let n = 1; n <= 4; n++)
    proposal(by.dreams, runs.dreams, {
      title: `Dream report ${n}`,
      authors: ["D. Reverie"],
      agoDays: 2,
    });

  proposal(by.unfiled, runs.unfiled, {
    title: "A find no Question was assigned",
    authors: ["U. Nassigned"],
    agoDays: 2,
  });

  // Deferred twice already: the third defer demotes it.
  proposal(by.tmr, runs.tmr, {
    title: "Targeted reactivation in naps",
    authors: ["L. Nap"],
    agoDays: 2,
    triage: ["defer", "defer"],
  });
  db.close();
}
