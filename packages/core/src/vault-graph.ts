import type { VaultIndex } from "./vault-index.js";

/** One file in the open file's neighbourhood, with where it is drawn (spec #740; ADR 0047). */
export type GraphNode = {
  path: string;
  /** Its `kind:` verbatim, null when it declares none. */
  kind: string | null;
  /** 0 for the open file, 1 for a file a link joins it to, 2 for one joined to those. */
  hop: number;
  /** Position in a plane whose centre is the open file, whose first Ring has radius 1 and whose second has radius 2. */
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

/**
 * A neighbour a Ring's cap left off the drawing. Listed rather than dropped
 * (ADR 0047 decision 5): the panel shows *+n more* and each row opens its file.
 */
export type GraphOverflow = {
  path: string;
  kind: string | null;
  hop: 1 | 2;
  /** The links, in either direction, that ranked it. */
  links: number;
};

export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  notDrawn: NotDrawn[];
  /** Every cut neighbour, most-linked first, then by name. */
  overflow: GraphOverflow[];
};

/** How many files a Ring holds before the rest go to the overflow list. */
const CAPS = { 1: 40, 2: 80 } as const;

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
  files: { path: string; kind: string | null }[],
  hop: 1 | 2
): GraphNode[] {
  const share = (2 * Math.PI) / SECTOR_COUNT;
  const out: GraphNode[] = [];
  for (let sector = 0; sector < SECTOR_COUNT; sector++) {
    const inside = files
      .filter((file) => sectorOf(file.kind) === sector)
      // Array.sort is stable, so links of one file keep the SQL's document order.
      .sort((a, b) => byName(a.path, b.path));
    inside.forEach((file, i) => {
      const angle =
        -Math.PI / 2 + sector * share + ((i + 0.5) / inside.length) * share;
      out.push({
        ...file,
        hop,
        x: round(hop * Math.cos(angle)),
        y: round(hop * Math.sin(angle)),
      });
    });
  }
  return out;
}

/**
 * Splits a Ring's candidates at its cap, keeping the most-linked and then the
 * first by name. The cut is a ranking, so which files are kept never depends
 * on the order the rows came back in.
 */
function capped(
  files: { path: string; kind: string | null; links: number }[],
  hop: 1 | 2
) {
  const ranked = [...files].sort(
    (a, b) => b.links - a.links || byName(a.path, b.path)
  );
  return {
    kept: ranked.slice(0, CAPS[hop]).map(({ path, kind }) => ({ path, kind })),
    overflow: ranked
      .slice(CAPS[hop])
      .map((file): GraphOverflow => ({ ...file, hop })),
  };
}

type Row = { path: string; resolved_path: string };

/**
 * Links written in the drawn files that landed on no single file. Only
 * outgoing ones can be listed: an ambiguous link has no resolved target, so
 * nothing says it points at the open file.
 */
function notDrawnIn(index: VaultIndex, files: string[]): NotDrawn[] {
  const drawn = new Set(files);
  return (
    index
      .select<NotDrawn & { resolution: NotDrawn["state"] }>(
        `SELECT path, target, resolution FROM links
        WHERE resolution IN ('ambiguous', 'unresolved')
        ORDER BY path, start`
      )
      .filter((row) => drawn.has(row.path))
      .map(({ path, target, resolution }) => ({
        path,
        target,
        state: resolution,
      }))
      // Array.sort is stable, so links of one file keep the SQL's document order.
      .sort((a, b) => byName(a.path, b.path))
  );
}

/**
 * `vault.graph`: the files a resolved link joins to the open one, in either
 * direction, and with `hops` 2 the files joined to those. An ambiguous or
 * unresolved link has no `resolved_path` and so draws nothing, as in backlinks
 * (ADR 0036); a file's link to itself is no neighbour. A hop-1 file's place
 * depends on the hop-1 files alone, so asking for 2 hops never moves it. Edges
 * join any two drawn files, not only a file and its parent Ring. Reads the
 * index only and writes nothing.
 */
export function graphOf(index: VaultIndex, path: string, hops: 1 | 2): Graph {
  const linked = (of: string): string[] =>
    index
      .select<Row>(
        `SELECT path, resolved_path FROM links
          WHERE resolved_path IS NOT NULL AND path <> resolved_path
            AND (path = ? OR resolved_path = ?)`,
        of,
        of
      )
      .map((row) => (row.path === of ? row.resolved_path : row.path));
  const kindOf = (p: string): string | null =>
    index.select<{ kind: string | null }>(
      "SELECT kind FROM files WHERE path = ?",
      p
    )[0]?.kind ?? null;

  const first = new Set(linked(path));
  const second = new Set<string>();
  if (hops === 2) {
    for (const near of first)
      for (const far of linked(near))
        if (far !== path && !first.has(far)) second.add(far);
  }
  const withKind = (paths: Set<string>) =>
    [...paths].map((p) => ({
      path: p,
      kind: kindOf(p),
      links: linked(p).length,
    }));
  const inner = capped(withKind(first), 1);
  const outer = capped(withKind(second), 2);
  const nodes = [
    { path, kind: kindOf(path), hop: 0, x: 0, y: 0 },
    ...ringOf(inner.kept, 1),
    ...ringOf(outer.kept, 2),
  ];

  const drawn = new Set(nodes.map((node) => node.path));
  const counts = new Map<string, GraphEdge>();
  for (const node of nodes) {
    const outgoing = index.select<Row>(
      `SELECT path, resolved_path FROM links
        WHERE path = ? AND resolved_path IS NOT NULL AND path <> resolved_path`,
      node.path
    );
    for (const { path: from, resolved_path: to } of outgoing) {
      if (!drawn.has(to)) continue;
      const [a, b] = from < to ? [from, to] : [to, from];
      const edge = counts.get(`${a}\0${b}`) ?? { a, b, count: 0 };
      edge.count++;
      counts.set(`${a}\0${b}`, edge);
    }
  }
  const edges = [...counts.values()].sort(
    (x, y) =>
      (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) ||
      (x.b < y.b ? -1 : x.b > y.b ? 1 : 0)
  );
  return {
    nodes,
    notDrawn: notDrawnIn(index, [...drawn]),
    edges,
    overflow: [...inner.overflow, ...outer.overflow],
  };
}
