import { useQuery } from "@tanstack/react-query";
import type { GraphNode, NotDrawn } from "core";
import { useState } from "react";
import { useChosenInView } from "./chosen";
import { FirstSlot, voiceOf } from "./FirstSlot";
import { markOf } from "./kinds";
import { listKeys } from "./listKeys";
import { hashOf, LOOSE_ENDS, pushRoute } from "./router";
import { useTRPC } from "./trpc";
import styles from "./Vault.module.css";
import { useVaultStatusLines } from "./VaultStatusLines";

// For aria-activedescendant: position is what decides whether a row is in
// view (ADR 0030), and a path is not id-safe.
const rowId = (index: number) => `vault-graph-row-${index}`;

const nameOf = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

const dotRadius = 0.07;

/**
 * The Graph tab (#741; spec #740, ADR 0047): the open file's first Ring as
 * plain SVG. The core says where every node goes (`vault.graph`), so this
 * draws coordinates and moves nothing; there is no pan, zoom, drag or
 * animation. The drawing is a mouse's way in; the same nodes are one keyboard
 * list in layout order, which is also how a screen reader reads them.
 */
export function VaultGraph({ path }: { path: string }) {
  const trpc = useTRPC();
  const graph = useQuery(trpc.vault.graph.queryOptions({ path, hops: 1 }));
  const status = useVaultStatusLines();
  const [chosen, setChosen] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const ring = (graph.data?.nodes ?? []).filter((node) => node.hop === 1);
  const at = Math.min(chosen, Math.max(ring.length - 1, 0));
  const activeId = ring.length === 0 ? undefined : rowId(at);
  useChosenInView(activeId);

  const notDrawn = graph.data?.notDrawn ?? [];

  if (ring.length === 0 && notDrawn.length > 0) {
    // Links exist, none lands on one file: saying "no links yet" here would
    // be the quiet-field lie the Not drawn list exists to prevent.
    return (
      <>
        <p className={styles.notDrawnLead}>No link here lands on one file.</p>
        <NotDrawnPanel links={notDrawn} />
      </>
    );
  }

  if (ring.length === 0) {
    return (
      <FirstSlot
        voice={voiceOf({
          incomplete: graph.isError,
          answered: graph.data !== undefined,
          read: status.read,
        })}
        claim="No links yet."
      >
        This file neither links to another file nor is linked from one.
      </FirstSlot>
    );
  }

  const centre = graph.data?.nodes.find((node) => node.hop === 0);
  const place = new Map(
    (graph.data?.nodes ?? []).map((node) => [node.path, node])
  );
  const open = (index: number) => {
    setChosen(index);
    const node = ring[index];
    if (node !== undefined) pushRoute({ surface: "vault", path: node.path });
  };
  const labelled = new Set(
    [centre?.path, ring[at]?.path, hovered ?? undefined].filter(
      (p): p is string => p !== undefined
    )
  );

  return (
    <>
      <svg
        className={styles.graph}
        viewBox="-1.6 -1.3 3.2 2.6"
        role="presentation"
      >
        {graph.data?.edges.map((edge) => {
          const a = place.get(edge.a);
          const b = place.get(edge.b);
          if (a === undefined || b === undefined) return null;
          return (
            <g key={`${edge.a}|${edge.b}`}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={styles.edge}
              />
              {edge.count > 1 && (
                <text
                  x={(a.x + b.x) / 2}
                  y={(a.y + b.y) / 2}
                  className={styles.edgeCount}
                  textAnchor="middle"
                >
                  {edge.count}
                </text>
              )}
            </g>
          );
        })}
        {graph.data?.nodes.map((node) => (
          <Dot
            key={node.path}
            node={node}
            onOpen={() => open(ring.indexOf(node))}
            onHover={(on) => setHovered(on ? node.path : null)}
          />
        ))}
        {graph.data?.nodes
          .filter((node) => labelled.has(node.path))
          .map((node) => (
            <text
              key={node.path}
              data-label=""
              x={node.x}
              y={node.y - dotRadius * 1.8}
              className={styles.nodeLabel}
              textAnchor="middle"
            >
              {nameOf(node.path)}
            </text>
          ))}
      </svg>
      <ul
        className={styles.tree}
        role="listbox"
        aria-label="Graph"
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={listKeys(at, ring.length, setChosen, open)}
      >
        {ring.map((node, index) => {
          const mark = markOf(node.kind ?? "note");
          return (
            <li
              key={node.path}
              id={rowId(index)}
              role="option"
              aria-selected={index === at}
              className={styles.row}
              onClick={() => open(index)}
            >
              <span className={styles.glyph} aria-hidden="true">
                {mark?.glyph ?? "·"}
              </span>
              <span className={styles.name}>{nameOf(node.path)}</span>
              <span className={styles.kindLine}>
                {mark?.label ?? node.kind ?? "note"}
              </span>
            </li>
          );
        })}
      </ul>
      {notDrawn.length > 0 && <NotDrawnPanel links={notDrawn} />}
    </>
  );
}

/**
 * Links in the neighbourhood that resolve to no single file (CONTEXT.md *Not
 * drawn*; ADR 0047 decision 4). Counted and listed, never drawn as ghost
 * nodes. Only an ambiguous link has a Loose Ends row (an unresolved one is
 * the editor's squiggle to show), so only then does the count link there; the
 * page has no per-row anchor, so it lands on the surface.
 */
function NotDrawnPanel({ links }: { links: NotDrawn[] }) {
  const count = `${links.length} not drawn`;
  return (
    <section className={styles.notDrawn} aria-label="Not drawn">
      <p className={styles.notDrawnCount}>
        {links.some((link) => link.state === "ambiguous") ? (
          <a href={hashOf(LOOSE_ENDS)}>{count}</a>
        ) : (
          count
        )}
      </p>
      <ul className={styles.notDrawnList}>
        {links.map((link, i) => (
          <li key={`${link.path}:${link.target}:${i}`}>
            <span className={styles.name}>{nameOf(link.path)}</span>{" "}
            <span className={styles.target}>[[{link.target}]]</span>{" "}
            <span className={styles.kindLine}>{link.state}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Dot({
  node,
  onOpen,
  onHover,
}: {
  node: GraphNode;
  onOpen: () => void;
  onHover: (on: boolean) => void;
}) {
  const mark = markOf(node.kind ?? "note");
  return (
    <g
      data-node={node.path}
      data-x={node.x}
      data-y={node.y}
      className={node.hop === 0 ? styles.centre : styles.dot}
      aria-hidden="true"
      onClick={node.hop === 0 ? undefined : onOpen}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <circle cx={node.x} cy={node.y} r={dotRadius} />
      <text
        x={node.x}
        y={node.y}
        className={styles.dotGlyph}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {mark?.glyph ?? "·"}
      </text>
    </g>
  );
}
