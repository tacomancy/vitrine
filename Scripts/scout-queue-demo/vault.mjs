// The scratch vault the Scout Queue revamp's closing run uses (#842): beat
// 6b's vault (six Scouts and the triage history Rank, Caps and the
// counterweight slot rest on) plus what the revamp draws that it did not
// have — two Retroactive batches from first looks at a page, and a Scout file
// that does not parse.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { queueVault } from "../queue-demo/vault.mjs";

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

// Neither word is one the stand-in answers to, so a launch runs nothing new
// for them; their last run is inside the cadence anyway.
const BATCHES = [
  { id: "labpage", name: "Lab publications page", papers: 6, cost: 0.41 },
  { id: "oldwork", name: "Back catalogue", papers: 4, cost: null },
];

export async function revampVault(fixture, vault, core) {
  await queueVault(fixture, vault, core);
  const scouts = join(vault, ".vitrine/scouts");
  mkdirSync(scouts, { recursive: true });
  for (const b of BATCHES)
    writeFileSync(
      join(scouts, `${b.id}.yaml`),
      `name: ${b.name}\ncadence: weekly\nlane: review\ncreated: 2026-06-01T00:00:00Z\nfilter:\n  query: all:${b.id}\n`
    );
  // A tab where a colon belongs: the file cannot be read, and the strip must say so.
  writeFileSync(join(scouts, "broken.yaml"), "name: [unclosed\n\tfilter: x\n");

  const { openQueue } = await import(
    pathToFileURL(join(core, "dist/queue.js")).href
  );
  const db = await openQueue(vault);
  const now = Date.now();
  for (const b of BATCHES) {
    const at = now - 2 * DAY;
    const runId = Number(
      db
        .prepare(
          `INSERT INTO scout_runs (scout_id, started, finished, outcome, window_from, window_to, retroactive, fetched, new, held, query, cost_usd)
           VALUES (?, ?, ?, 'ok', ?, ?, 1, ?, ?, 0, ?, ?)`
        )
        .run(
          b.id,
          iso(at),
          iso(at + 4000),
          iso(at - 365 * DAY),
          iso(at),
          b.papers,
          b.papers,
          `all:${b.id}`,
          b.cost
        ).lastInsertRowid
    );
    for (let n = 1; n <= b.papers; n++) {
      const id = Number(
        db
          .prepare(
            `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
             VALUES (?, ?, ?, ?, NULL, ?, 'https://example.test/r', 'review', 'pending', ?)`
          )
          .run(
            `retro-${b.id}-${n}`,
            `${b.name}: earlier paper ${n}`,
            JSON.stringify(["R. Archive"]),
            `2025-0${(n % 9) + 1}-11`,
            `An abstract for the ${n}th paper of ${b.name}.`,
            iso(at)
          ).lastInsertRowid
      );
      db.prepare(
        "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, ?, ?, 'https://example.test/r')"
      ).run(id, runId, b.id, iso(at));
    }
  }
  // The beat 6b paper waiting in Skim is raised to Review at launch, so the
  // Skim tab needs lines of its own.
  const skimRun = db
    .prepare("SELECT MAX(id) AS id FROM scout_runs WHERE scout_id = 'skim'")
    .get().id;
  for (let n = 1; n <= 3; n++) {
    const id = Number(
      db
        .prepare(
          `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
           VALUES (?, ?, '["K. Glance"]', '2026-09-20', NULL, 'An abstract to skim.', 'https://example.test/s', 'skim', 'pending', ?)`
        )
        .run(`skim-${n}`, `A paper to glance at (${n})`, iso(now - n * DAY))
        .lastInsertRowid
    );
    db.prepare(
      "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, 'skim', ?, 'https://example.test/s')"
    ).run(id, skimRun, iso(now - n * DAY));
  }
  db.close();
}
