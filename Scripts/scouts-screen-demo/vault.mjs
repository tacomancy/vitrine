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
  db.close();
}
