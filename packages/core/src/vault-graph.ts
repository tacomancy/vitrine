import type { VaultIndex } from "./vault-index.js";

/** One file in the open file's neighbourhood, with where it is drawn (spec #740; ADR 0047). */
export type GraphNode = {
  path: string;
  /** Its `kind:` verbatim, null when it declares none. */
  kind: string | null;
  /** 0 for the open file, 1 for a file a link joins it to. */
  hop: number;
  /** Position in a plane whose centre is the open file and whose first Ring has radius 1. */
  x: number;
  y: number;
};

/** An undirected line: one per file pair, `count` links collapsed into it (block links included). `a` sorts before `b`. */
export type GraphEdge = { a: string; b: string; count: number };

/**
 * A link in the neighbourhood that resolves to no single file, so no line is
 * drawn for it (CONTEXT.md *Not drawn*; ADR 0047 decision 4). Listed rather
 * than dropped: a missing line must never read as no link.
 */
export type NotDrawn = {
  /** The file the link is written in. */
  path: string;
  /** As written, before the index lowercased or split it. */
  target: string;
  state: "ambiguous" | "unresolved";
};

export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  notDrawn: NotDrawn[];
};

/**
 * The Kinds in the order their sectors go round the Ring, clockwise from the
 * top. Fixed, and not the Kinds present: a Kind keeps its sector whatever else
 * the neighbourhood holds, so a Question is always where the researcher last
 * found one (ADR 0047 decision 2). A file with no `kind:` is a note; a Kind
 * the app does not know shares the last sector.
 */
const SECTORS = [
  "note",
  "question",
  "research-question",
  "hypothesis",
  "experiment",
  "source",
  "source-stub",
];
const SECTOR_COUNT = SECTORS.length + 1;

const sectorOf = (kind: string | null): number => {
  const at = SECTORS.indexOf(kind ?? "note");
  return at === -1 ? SECTORS.length : at;
};

const nameOf = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

const byName = (a: string, b: string) =>
  nameOf(a).localeCompare(nameOf(b), "en") || (a < b ? -1 : a > b ? 1 : 0);

// Rounded so a position is a stable value and not a float's last digit.
const round = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Where each file of a Ring sits: a pure function of the paths and Kinds, with
 * no iteration and no randomness, so the same neighbourhood is the same
 * picture. A sector is an equal share of the circle; inside it files sort by
 * name and the angle comes from sort position alone.
 */
export function ringOf(
  files: { path: string; kind: string | null }[]
): GraphNode[] {
  const share = (2 * Math.PI) / SECTOR_COUNT;
  const out: GraphNode[] = [];
  for (let sector = 0; sector < SECTOR_COUNT; sector++) {
    const inside = files
      .filter((file) => sectorOf(file.kind) === sector)
      .sort((a, b) => byName(a.path, b.path));
    inside.forEach((file, i) => {
      const angle =
        -Math.PI / 2 + sector * share + ((i + 0.5) / inside.length) * share;
      out.push({
        ...file,
        hop: 1,
        x: round(Math.cos(angle)),
        y: round(Math.sin(angle)),
      });
    });
  }
  return out;
}

type Row = { path: string; resolved_path: string };

/**
 * Links written in the drawn files that landed on no single file. Only
 * outgoing ones can be listed: an ambiguous link has no resolved target, so
 * nothing says it points at the open file.
 */
function notDrawnIn(index: VaultIndex, files: string[]): NotDrawn[] {
  const inGraph = new Set(files);
  return index
    .select<NotDrawn & { resolution: NotDrawn["state"] }>(
      `SELECT path, target, resolution FROM links
        WHERE resolution IN ('ambiguous', 'unresolved')
        ORDER BY path, start`
    )
    .filter((row) => inGraph.has(row.path))
    .map(({ path, target, resolution }) => ({
      path,
      target,
      state: resolution,
    }))
    .sort((a, b) => byName(a.path, b.path));
}

/**
 * `vault.graph`: the files a resolved link joins to the open one, in either
 * direction. An ambiguous or unresolved link has no `resolved_path` and so
 * draws nothing, as in backlinks (ADR 0036); a file's link to itself is no
 * neighbour. Reads the index only and writes nothing.
 */
export function graphOf(index: VaultIndex, path: string): Graph {
  const rows = index.select<Row>(
    `SELECT path, resolved_path FROM links
      WHERE resolved_path IS NOT NULL AND path <> resolved_path
        AND (path = ? OR resolved_path = ?)`,
    path,
    path
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const other = row.path === path ? row.resolved_path : row.path;
    counts.set(other, (counts.get(other) ?? 0) + 1);
  }
  const kindOf = (p: string): string | null =>
    index.select<{ kind: string | null }>(
      "SELECT kind FROM files WHERE path = ?",
      p
    )[0]?.kind ?? null;
  const ring = ringOf(
    [...counts.keys()].map((p) => ({ path: p, kind: kindOf(p) }))
  );
  return {
    nodes: [{ path, kind: kindOf(path), hop: 0, x: 0, y: 0 }, ...ring],
    notDrawn: notDrawnIn(index, [path, ...ring.map((node) => node.path)]),
    edges: ring.map((node) => {
      const [a, b] = path < node.path ? [path, node.path] : [node.path, path];
      return { a, b, count: counts.get(node.path) ?? 0 };
    }),
  };
}
