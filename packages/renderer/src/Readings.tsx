import { useState, type ReactNode } from "react";
import type { Readings } from "core";
import { hashOf, type Route } from "./router";
import { markOf, routeOf } from "./kinds";
import styles from "./Readings.module.css";

/**
 * The Question Map's four readings (ADR 0041 decision 4). Each is a count
 * that names a decision, never summed with another; one with no members is
 * absent, and one with members stays a count until the researcher opens it —
 * never automatically, and never because of how many it holds (#252, #245).
 */
export function ReadingsStrip({ readings }: { readings: Readings }) {
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  return (
    <div className={styles.strip}>
      <Reading
        count={readings.wellSupported.count}
        label={plural(
          readings.wellSupported.count,
          "well-supported question",
          "well-supported questions"
        )}
      >
        <Rows rows={readings.wellSupported.items} showMaterial />
      </Reading>
      <Reading
        count={readings.unanchored.count}
        label={plural(
          readings.unanchored.count,
          "unanchored question",
          "unanchored questions"
        )}
      >
        <Rows rows={readings.unanchored.items} />
      </Reading>
      <Reading
        count={readings.unquestionedKnowledge.count}
        label={plural(
          readings.unquestionedKnowledge.count,
          "tag of unquestioned knowledge",
          "tags of unquestioned knowledge"
        )}
      >
        <TagList
          groups={readings.unquestionedKnowledge.items.map((g) => ({
            tag: g.display,
            members: g.material,
            kind: "source" as const,
          }))}
        />
      </Reading>
      <Reading
        count={readings.clockedButUnquestioned.count}
        label={`${plural(readings.clockedButUnquestioned.count, "stub", "stubs")} clocked but unquestioned`}
        note="kept from a Scout, assigned to no question"
      >
        <TagList
          groups={readings.clockedButUnquestioned.items.map((g) => ({
            tag: g.display,
            members: g.stubs,
            kind: "source-stub" as const,
          }))}
        />
      </Reading>
    </div>
  );
}

function Reading({
  count,
  label,
  note,
  children,
}: {
  count: number;
  label: string;
  note?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <section className={styles.reading}>
      <button
        type="button"
        className={styles.count}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {note !== undefined && <span className={styles.note}>{note}</span>}
      {open && children}
    </section>
  );
}

function Rows({
  rows,
  showMaterial = false,
}: {
  rows: Readings["unanchored"]["items"];
  showMaterial?: boolean;
}) {
  return (
    <ol className={styles.list}>
      {rows.map((row) => (
        <li key={row.path}>
          <Named kind={row.kind} path={row.path} name={row.question} />
          {showMaterial && (
            <span className={styles.meta}>{row.material} material</span>
          )}
          {row.unresolved > 0 && (
            <span className={styles.meta}>
              a link in this question&rsquo;s Related lands on nothing
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function TagList({
  groups,
}: {
  groups: Array<{
    tag: string;
    members: Array<{ path: string; display: string }>;
    kind: "source" | "source-stub";
  }>;
}) {
  return (
    <ol className={styles.list}>
      {groups.map((group) => (
        <li key={group.tag}>
          <span className={styles.tag}>{group.tag}</span>
          <span className={styles.meta}>{group.members.length}</span>
          <ul className={styles.members}>
            {group.members.map((m) => (
              <li key={m.path}>
                <Named kind={group.kind} path={m.path} name={m.display} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** A name that opens what has an Address (spec #416: a stub has none) and is otherwise left alone. */
function Named({
  kind,
  path,
  name,
}: {
  kind: string;
  path: string;
  name: string;
}) {
  const route: Route | null = routeOf(kind, path);
  const mark = markOf(kind);
  return (
    <>
      {mark !== undefined && (
        <span className={styles.glyph} role="img" aria-label={mark.label}>
          {mark.glyph}
        </span>
      )}
      {route === null ? (
        <span>{name}</span>
      ) : (
        <a href={hashOf(route)}>{name}</a>
      )}
    </>
  );
}
