// The scratch vaults the Home demo runs on (#737): the fixture vault plus a
// small fleet of Scouts whose runs and Proposals are seeded by SQL, because
// Home reads history the app can only make by running a Scout against the
// network. Two shapes of one vault: `quiet` (every Scout looking, nothing
// pending, nothing changed) and `full` (a Scout failing, a Review with depth,
// a fortnight's changes under two Tags, and Questions old enough to come
// back). Every date is relative to the run, since Home measures against now.
//
// Nothing here can reach arXiv: the launch points the endpoint at a dead
// port, so a Scout the launch finds due fails instead of fetching.
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

export const BROKEN = "Odour cueing";
export const RESURFACE_TITLES = [
  "Is a nap enough to consolidate?",
  "Can an odour cue replay in sleep?",
  "Do dreams carry anything forward?",
  "Are spindles a cause or a marker?",
];

const question = (id, text, capturedMs, tags = []) =>
  `---\nid: ${id}\nkind: question\nquestion: ${text}\nstatus: open\ncaptured: ${iso(capturedMs)}\ncontext: other\n${
    tags.length ? `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}\n` : ""
  }---\n`;

const scoutYaml = (name, query) =>
  [
    `name: ${name}`,
    "cadence: daily",
    "lane: review",
    "created: 2026-06-01T00:00:00Z",
    "filter:",
    `  query: ${query}`,
    "",
  ].join("\n");

const FLEET = [
  {
    id: "sleep-consolidation",
    name: "Sleep and consolidation",
    query: "all:sleep AND all:consolidation",
    pending: 5,
    deferred: 2,
  },
  {
    id: "memory-replay",
    name: "Memory replay",
    query: "all:replay",
    pending: 4,
  },
  {
    id: "spindles",
    name: "Sleep spindles",
    query: "all:spindle",
    pending: 3,
    skim: 4,
  },
  { id: "odour-cueing", name: BROKEN, query: "all:odour", broken: true },
];

function everyFile(dir, visit) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) everyFile(path, visit);
    else visit(path);
  }
}

/** `shape` is "quiet" or "full". */
export async function homeVault(fixture, vault, core, shape) {
  const full = shape === "full";
  const now = Date.now();
  cpSync(fixture, vault, { recursive: true });
  mkdirSync(join(vault, "map"), { recursive: true });
  mkdirSync(join(vault, "notes"), { recursive: true });

  if (full) {
    // Old enough to come back (60 days), alongside the fixture's own.
    RESURFACE_TITLES.forEach((text, i) =>
      writeFileSync(
        join(vault, `map/old-${i}.md`),
        question(`qold000${i}`, text, now - (75 + i * 40) * DAY)
      )
    );
    // Captured inside the window, two under one Tag and one under none.
    writeFileSync(
      join(vault, "map/new-0.md"),
      question(
        "qnew00001",
        "Does encoding strength gate replay?",
        now - 2 * DAY,
        ["memory/encoding"]
      )
    );
    writeFileSync(
      join(vault, "map/new-1.md"),
      question(
        "qnew00002",
        "Is the retention test sensitive enough?",
        now - 3 * DAY,
        ["memory/encoding"]
      )
    );
    writeFileSync(
      join(vault, "map/new-2.md"),
      question(
        "qnew00003",
        "What would a null result look like?",
        now - 5 * DAY
      )
    );
    writeFileSync(
      join(vault, "notes/Reading log.md"),
      "---\ntags:\n  - memory/encoding\n---\n\n# Reading log\n\nSecond pass through the encoding papers.\n"
    );
  }

  // Nothing but what this shape plants may look like a change: the fixture's
  // files are all dated to a month ago, as a vault that has sat is.
  everyFile(vault, (path) => {
    const old = new Date(now - 30 * DAY);
    utimesSync(path, old, old);
  });
  if (full) {
    const recent = new Date(now - 4 * DAY);
    utimesSync(join(vault, "notes/Reading log.md"), recent, recent);
    // A Revision of the Research Question's working answer, two days ago.
    const rq = join(
      vault,
      "questions/Is the overnight benefit consolidation or encoding (RQ).md"
    );
    appendFileSync(
      rq,
      `\n- ${iso(now - 2 * DAY)} · working answer\n  from:\n    Probably both.\n`
    );
  }

  const scouts = join(vault, ".vitrine/scouts");
  mkdirSync(scouts, { recursive: true });
  const fleet = FLEET.filter((s) => full || !s.broken);
  for (const s of fleet)
    writeFileSync(join(scouts, `${s.id}.yaml`), scoutYaml(s.name, s.query));

  const { openQueue } = await import(
    pathToFileURL(join(core, "dist/queue.js")).href
  );
  const db = await openQueue(vault);
  if (full) {
    const day = (n) => {
      const d = new Date(now - n * DAY);
      const pad = (x) => String(x).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    // The last two days the vault was open: nine days ago and a few before.
    for (const n of [9, 12])
      db.prepare("INSERT OR IGNORE INTO open_days (day) VALUES (?)").run(
        day(n)
      );
  }
  const run = (scout, agoMs, failed = false, news = 0) =>
    Number(
      db
        .prepare(
          `INSERT INTO scout_runs (scout_id, started, finished, outcome, error_kind, error_message, window_from, window_to, fetched, new, held, query)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
        )
        .run(
          scout.id,
          iso(now - agoMs),
          iso(now - agoMs + 4000),
          failed ? "failed" : "ok",
          failed ? "http" : null,
          failed ? "arXiv answered 503" : null,
          iso(now - agoMs - DAY),
          iso(now - agoMs),
          news,
          news,
          scout.query
        ).lastInsertRowid
    );
  let key = 0;
  const proposal = (scout, runId, state, lane, agoDays) => {
    key += 1;
    const id = Number(
      db
        .prepare(
          `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
           VALUES (?, ?, ?, '2026-08-01', 'A Journal', '', 'https://example.test/p', ?, ?, ?)`
        )
        .run(
          `home${key}`,
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
  };
  for (const s of fleet) {
    // Daily Scouts, last run well inside the day: none is due at launch,
    // except the broken one, which stays due until it succeeds.
    const last = run(
      s,
      (s.broken ? 30 : 5) * HOUR,
      s.broken,
      full ? (s.pending ?? 0) : 0
    );
    if (!full) continue;
    for (let n = 0; n < (s.pending ?? 0); n++)
      proposal(s, last, "pending", "review", 1 + (n % 4));
    for (let n = 0; n < (s.deferred ?? 0); n++)
      proposal(s, last, "deferred", "review", 2);
    for (let n = 0; n < (s.skim ?? 0); n++)
      proposal(s, last, "pending", "skim", 1);
  }
  db.close();
}
