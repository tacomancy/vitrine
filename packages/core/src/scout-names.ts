import type { DatabaseSync } from "node:sqlite";
import { readScouts, type Scout, type Tombstone } from "./scout-file.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * A Scout as a record that names it by id shows it. `erased` is true when the
 * only thing left of the Scout is its tombstone (ADR 0053 decision 6): the name
 * is still its own, and the reader says it is gone rather than guess. A Scout
 * the vault knows nothing of — a file removed by hand — is its id and not
 * erased, since nothing says it was.
 */
export type NamedScout = { id: string; name: string; erased: boolean };

/**
 * The one place a Scout's id becomes a name. Every reader of a record that
 * names a Scout (a card's Scouts, who raised it, a stub's origin, a run's line)
 * goes through it, so a tombstone is resolved the same way everywhere and a
 * reader added later has no way to forget it.
 */
export function scoutNamesOf(read: {
  scouts: Scout[];
  dropped: Scout[];
  erased: Tombstone[];
}): (id: string) => NamedScout {
  const { scouts, dropped, erased } = read;
  const names = new Map<string, NamedScout>([
    ...erased.map((t): [string, NamedScout] => [
      t.id,
      { id: t.id, name: t.name, erased: true },
    ]),
    ...[...scouts, ...dropped].map((s): [string, NamedScout] => [
      s.id,
      { id: s.id, name: s.name, erased: false },
    ]),
  ]);
  return (id) => names.get(id) ?? { id, name: id, erased: false };
}

export async function readScoutNames(
  vaultPath: string
): Promise<(id: string) => NamedScout> {
  return scoutNamesOf(await readScouts(vaultPath));
}

/** The Scout a stub says found it (`origin_scout`), or null for a paper the researcher attached by hand. */
export async function readStubOrigin(
  deps: { vaultPath: string; index: VaultIndex },
  path: string
): Promise<NamedScout | null> {
  const [row] = deps.index.select<{ value: string }>(
    "SELECT value FROM frontmatter WHERE path = ?",
    path
  );
  const origin = (
    JSON.parse(row?.value ?? "null") as Record<string, unknown> | null
  )?.["origin_scout"];
  if (typeof origin !== "string") return null;
  return (await readScoutNames(deps.vaultPath))(origin);
}

/** One past run, named by the Scout that made it. */
export type RunLine = {
  runId: number;
  scout: NamedScout;
  finished: string | null;
  outcome: string | null;
};

/** The newest runs across every Scout, each named; a Scout since erased still has its runs. */
export async function readRunLines(
  deps: { vaultPath: string; queue: DatabaseSync },
  limit = 50
): Promise<RunLine[]> {
  const named = await readScoutNames(deps.vaultPath);
  return (
    deps.queue
      .prepare(
        "SELECT id, scout_id, finished, outcome FROM scout_runs ORDER BY id DESC LIMIT ?"
      )
      .all(limit) as Array<{
      id: number;
      scout_id: string;
      finished: string | null;
      outcome: string | null;
    }>
  ).map((run) => ({
    runId: run.id,
    scout: named(run.scout_id),
    finished: run.finished,
    outcome: run.outcome,
  }));
}
