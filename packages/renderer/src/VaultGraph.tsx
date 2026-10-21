import { useQuery } from "@tanstack/react-query";
import type { GraphNode } from "core";
import { type CSSProperties, useState } from "react";
import { useChosenInView } from "./chosen";
import { FirstSlot, voiceOf } from "./FirstSlot";
import { markOf } from "./kinds";
import { listKeys } from "./listKeys";
import { pushRoute } from "./router";
import { useTRPC } from "./trpc";
import styles from "./Vault.module.css";
import { useVaultStatusLines } from "./VaultStatusLines";

// For aria-activedescendant: position is what decides whether a row is in
// view (ADR 0030), and a path is not id-safe.
const rowId = (index: number) => `vault-graph-row-${index}`;

const nameOf = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

const dotRadius = 0.07;

const HOPS = [1, 2] as const;

/**
 * The Graph tab (#741; spec #740, ADR 0047): the open file's Rings (1 or 2
 * hops, 2 to begin with) as plain SVG. The core says where every node goes (`vault.graph`), so this
 * draws coordinates and moves nothing; there is no pan, zoom, drag or
 * animation. The drawing is a mouse's way in; the same nodes are one keyboard
 * list in layout order, which is also how a screen reader reads them.
 */
export function VaultGraph({ path }: { path: string }) {
  const trpc = useTRPC();
  const [hops, setHops] = useState<1 | 2>(2);
  const graph = useQuery(trpc.vault.graph.queryOptions({ path, hops }));
  const status = useVaultStatusLines();
  const [chosen, setChosen] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const ring = (graph.data?.nodes ?? []).filter((node) => node.hop > 0);
  const at = Math.min(chosen, Math.max(ring.length - 1, 0));
  const activeId = ring.length === 0 ? undefined : rowId(at);
  useChosenInView(activeId);

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

  // The Ring grows with the hops but a hop-1 node keeps its place; the view
  // widens and `--u` keeps dots and text the size they were.
  const u = hops;
  return (
    <>
      <fieldset className={styles.hops}>
        <legend>Hops</legend>
        {HOPS.map((h) => (
          <label key={h}>
            <input
              type="radio"
              name="graph-hops"
              checked={hops === h}
              onChange={() => {
                setHops(h);
                setChosen(0);
              }}
            />
            {h}
          </label>
        ))}
      </fieldset>
      <svg
        className={styles.graph}
        viewBox={`${-1.6 * u} ${-1.3 * u} ${3.2 * u} ${2.6 * u}`}
        style={{ "--u": u } as CSSProperties}
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
            radius={dotRadius * u}
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
              y={node.y - dotRadius * u * 1.8}
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
              <span className={styles.kindLine}>
                {node.hop === 1 ? "1 hop" : "2 hops"}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Dot({
  node,
  radius,
  onOpen,
  onHover,
}: {
  node: GraphNode;
  radius: number;
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
      <circle cx={node.x} cy={node.y} r={radius} />
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
