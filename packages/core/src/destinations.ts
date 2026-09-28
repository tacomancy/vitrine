import { matchKey } from "./display-name.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * What the Global command can go to (ADR 0027): the objects in the vault
 * that have an Address, ordered so that the answer is useful. Surfaces,
 * Dashboards and the hash itself are the renderer's — it merges its own
 * fixed set into these rows and does the final ordering across both — so
 * nothing here knows what a screen is.
 *
 * Shaped like the Picker's answer, and deliberately not built from it: the
 * Picker is Kind-narrowed, goes nowhere, and matches the stored file name
 * (ADR 0027 decision 3). This matches the Display name, which is the whole
 * reason it exists. No file is read, as with every other list a surface
 * shows (ADR 0014 decision 3).
 */

/**
 * The Kinds with a page to arrive on, best first: reach is the Address
 * rule and nothing more, so a Kind joins this list the beat it gains a
 * page and never before (ADR 0027 decision 4). The order is the order a
 * tie between two Kinds is broken in.
 */
const ADDRESSABLE = [
  "research-question",
  "hypothesis",
  "experiment",
  "question",
] as const;

export type DestinationKind = (typeof ADDRESSABLE)[number];

export type Destination = {
  kind: DestinationKind;
  /** Vault-relative, as the index keys it: what the Address is built from. */
  path: string;
  /** The Display name (`CONTEXT.md`): what the row says and what matched. */
  display: string;
};

/** `rows` is capped; `total` is how many matched, so a cut list can say so. */
export type Destinations = { rows: Destination[]; total: number };

/** How many rows one ask returns; beyond it the list says how long it is. */
export const DESTINATION_LIMIT = 50;

/**
 * How well an object answers the query, the prototype's four rungs
 * (branch `prototype/global-command`, variant B):
 *
 *   3 exact · 2 prefix · 1 word start · 0 contains
 *
 * Both arguments are already `matchKey`ed, so a word start is a space
 * followed by the query — the name's own first word is the prefix rung
 * above. An empty query is every object equally, which is what leaves the
 * list before a character is typed to Kind and recency alone.
 */
function strength(query: string, display: string): number {
  if (query === "") return 0;
  if (display === query) return 3;
  if (display.startsWith(query)) return 2;
  return display.includes(` ${query}`) ? 1 : 0;
}

export function destinations(
  index: VaultIndex,
  { query }: { query: string }
): Destinations {
  const wanted = matchKey(query);
  // `ldisplay` is `matchKey`ed too, so it holds letters, digits and single
  // spaces alone: there is no `%`, `_` or `\` left on either side for LIKE
  // to read as a wildcard. The contains-LIKE is the lowest rung of
  // `strength`, so every row it returns scores; nothing is filtered after.
  const matched = index.select<{
    path: string;
    kind: DestinationKind;
    display: string;
    ldisplay: string;
    mtime: number | null;
  }>(
    `SELECT path, kind, display, ldisplay, mtime
     FROM files
     WHERE markdown = 1 AND ldisplay LIKE ?
       AND kind IN (${ADDRESSABLE.map(() => "?").join(", ")})`,
    `%${wanted}%`,
    ...ADDRESSABLE
  );

  const scored = matched.map((row) => ({
    row,
    strength: strength(wanted, row.ldisplay),
    kindRank: ADDRESSABLE.indexOf(row.kind),
  }));
  // Strength, then Kind, then recency — so an exact hit leads whatever it
  // is, and the newest of an equal pair is the likelier target. Recency is
  // the index's modification time for every Kind alike, never a Question's
  // `captured`, which answers *when I wondered it* and is the Inbox's sort
  // (ADR 0027 decision 6).
  scored.sort(
    (a, b) =>
      b.strength - a.strength ||
      a.kindRank - b.kindRank ||
      (b.row.mtime ?? 0) - (a.row.mtime ?? 0)
  );
  return {
    rows: scored.slice(0, DESTINATION_LIMIT).map(({ row }) => ({
      kind: row.kind,
      path: row.path,
      display: row.display,
    })),
    total: scored.length,
  };
}
