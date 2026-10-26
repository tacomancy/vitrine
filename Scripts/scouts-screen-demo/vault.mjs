// The scratch vault the Scouts screen's closing run uses (#862): the fixture
// vault plus a snapshot of a real Scouts folder, copied and never opened in
// place, so the real vault is untouched however the run goes. The queue gets an
// ok run per Scout, finished just now, so a launch finds nothing due and asks
// no one anything; one Scout's newest run failed, so the Queue marks it.
import { cpSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const iso = (ms) => new Date(ms).toISOString();

/** `{ id, name }` per Scout file of a folder, read the way the app names them: the file's name is the id. */
export function scoutsOf(folder) {
  return readdirSync(folder)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => ({
      id: f.slice(0, -".yaml".length),
      name: /^name:\s*(.+)$/m.exec(readFileSync(join(folder, f), "utf8"))?.[1],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function scoutsScreenVault(
  fixture,
  vault,
  core,
  realScouts,
  failing
) {
  cpSync(fixture, vault, { recursive: true });
  mkdirSync(join(vault, ".vitrine"), { recursive: true });
  cpSync(realScouts, join(vault, ".vitrine/scouts"), { recursive: true });
  const { openQueue } = await import(
    pathToFileURL(join(core, "dist/queue.js")).href
  );
  const db = await openQueue(vault);
  const now = Date.now();
  for (const { id } of scoutsOf(join(vault, ".vitrine/scouts"))) {
    const bad = id === failing;
    db.prepare(
      `INSERT INTO scout_runs (scout_id, started, finished, outcome, error_kind, error_message, window_from, window_to, retroactive, fetched, new, held, query)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'demo')`
    ).run(
      id,
      iso(now - 60_000),
      iso(now - 59_000),
      bad ? "failed" : "ok",
      bad ? "http" : null,
      bad ? "the source answered 503" : null,
      iso(now - 7 * 86_400_000),
      iso(now - 60_000)
    );
  }
  // A rejected Proposal under each Scout the run drops, so that "nothing
  // changed" compares real rows: a rejected one does not block an erase, and
  // its Appearance is what a tombstone has to keep resolving.
  for (const { id } of scoutsOf(join(vault, ".vitrine/scouts")).slice(0, 2)) {
    const runId = db
      .prepare("SELECT MAX(id) AS id FROM scout_runs WHERE scout_id = ?")
      .get(id).id;
    const proposal = Number(
      db
        .prepare(
          `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
           VALUES (?, ?, '["R. Archive"]', '2026-09-01', NULL, 'An abstract.', 'https://example.test/r', 'review', 'rejected', ?)`
        )
        .run(`demo-${id}`, `An earlier paper from ${id}`, iso(now - 86_400_000))
        .lastInsertRowid
    );
    db.prepare(
      "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, ?, ?, 'https://example.test/r')"
    ).run(proposal, runId, id, iso(now - 86_400_000));
    db.prepare(
      "INSERT INTO triage (proposal_id, action, at) VALUES (?, 'reject', ?)"
    ).run(proposal, iso(now - 80_000_000));
  }
  db.close();
}
