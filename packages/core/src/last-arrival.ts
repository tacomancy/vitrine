import type { DatabaseSync } from "node:sqlite";

/**
 * The PDF folder's last arrival (#379; `docs/architecture.md` § Settings):
 * the newest PDF seen under `sources/pdf`, remembered so that a folder which
 * stops resolving can still say when papers last came — which is how the
 * researcher tells when the arrangement broke.
 *
 * While the folder resolves it is the truth, and its newest PDF replaces
 * this; a folder that holds none leaves it alone, so a link pointed for a
 * moment at an empty folder cannot erase when papers last came. Only once
 * the folder does not resolve is this what answers. A fact about the past that no sweep of a broken link
 * could recover, which is why it lives in `queue.sqlite` and not the index.
 */
export type Arrival = { at: string; name: string };

export type LastArrival = {
  get: () => Arrival | null;
  /** The newest PDF the folder holds now, replacing whatever was kept. */
  set: (arrival: Arrival) => void;
};

export function lastArrival(db: DatabaseSync): LastArrival {
  const select = db.prepare("SELECT at, name FROM last_arrival WHERE id = 1");
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO last_arrival (id, at, name) VALUES (1, ?, ?)"
  );
  return {
    get: () => {
      const row = select.get() as Arrival | undefined;
      return row ?? null;
    },
    set: (arrival) => void upsert.run(arrival.at, arrival.name),
  };
}
