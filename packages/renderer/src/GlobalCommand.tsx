import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Destination } from "core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./GlobalCommand.module.css";
import { KIND, routeOf } from "./kinds";
import { matchKey, matchRun, strength } from "./match";
import { hashOf, pushRoute, type Route } from "./router";
import { SCREENS } from "./surfaces";
import { useTRPC } from "./trpc";

/**
 * The Global command (`CONTEXT.md`; ADR 0027): ⌘K from any Surface or
 * Dashboard opens one keyboard list over what the window was doing, typing
 * narrows it, and ↵ goes there. Capture joins this list in #303 — until it
 * does, the verb below has one thing to say.
 *
 * The list is half the renderer's and half the core's. Screens are not
 * files, so the core does not know them (#301); objects are matched and
 * ordered there and merged in here, and the ordering across both is
 * decided below.
 */
export function GlobalCommand({ route }: { route: Route }) {
  const [open, setOpen] = useState(false);

  // A renderer key handler, not a native shortcut: the chord is the app's,
  // and works the same in the iPad client with no menu bar. Mounted only
  // where a vault is, so First run keeps its single action (ADR 0025
  // decision 5), as the Capture line's chord already is.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey && event.key === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Remounted on every open, so nothing a previous one was typing or had
  // arrowed to greets the next.
  return open ? <Command route={route} onClose={() => setOpen(false)} /> : null;
}

/** A row of the list: where it goes, and what it says about itself. */
type Row = {
  key: string;
  glyph: string;
  /** The Kind's own word, shown beside the glyph: no mark carries a Kind alone. */
  label: string;
  name: string;
  route: Route;
  /** Where the window already is. Listed, marked, never the default choice. */
  current: boolean;
  /** The reading family, for the Kinds whose Display name is a question. */
  serif: boolean;
  /** How well it answers what was typed, the rung both halves score on. */
  strength: number;
  /** Surfaces, then Dashboards, then the objects: the tie-break after strength. */
  kindRank: number;
};

const SCREEN_KIND = {
  surface: { glyph: "▪", label: "surface", rank: 0 },
  dashboard: { glyph: "▦", label: "dashboard", rank: 1 },
};

const OBJECT_RANK: Record<Destination["kind"], number> = {
  "research-question": 2,
  question: 3,
};

function Command({ route, onClose }: { route: Route; onClose: () => void }) {
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  // Null until the user moves it: the default follows the list, and the
  // list changes under it with every keystroke.
  const [arrowedTo, setArrowedTo] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const here = hashOf(route);

  // Where focus was when the command opened, put back when it closes —
  // however it closes, including a jump. What the window lands on may then
  // take the keyboard, which is the landing's call and not this one
  // (ADR 0010).
  useEffect(() => {
    const restoreTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
    return () => restoreTo?.focus();
  }, []);

  // The old rows stay while the new ones are asked for, rather than the
  // list flashing empty between keystrokes.
  const listing = useQuery({
    ...trpc.globalCommand.destinations.queryOptions({ query }),
    placeholderData: keepPreviousData,
  });

  const wanted = matchKey(query);
  const screens: Row[] = SCREENS.flatMap((screen) => {
    const key = matchKey(screen.name);
    if (!key.includes(wanted)) return [];
    const { glyph, label, rank } = SCREEN_KIND[screen.kind];
    const address = hashOf(screen.route);
    return [
      {
        key: address,
        glyph,
        label,
        name: screen.name,
        route: screen.route,
        current: address === here,
        serif: false,
        strength: strength(wanted, key),
        kindRank: rank,
      },
    ];
  });
  const objects: Row[] = (listing.data?.rows ?? []).flatMap((object) => {
    const route = routeOf(object.kind, object.path);
    // Unreachable by construction — the core answers with addressable
    // Kinds alone — and the rule is still written once: a Kind with
    // nowhere to open has no row, so no row can lead to a dead end.
    if (route === null) return [];
    const address = hashOf(route);
    return [
      {
        key: address,
        glyph: KIND[object.kind]?.glyph ?? "◇",
        label: KIND[object.kind]?.label ?? object.kind,
        name: object.display,
        route,
        current: address === here,
        serif: true,
        strength: strength(wanted, matchKey(object.display)),
        kindRank: OBJECT_RANK[object.kind],
      },
    ];
  });

  // Strength, then Kind — so an exact hit leads whatever it is, and a
  // Surface outranks an object that merely contains the word (ADR 0027
  // decision 6). Recency is the third key and the core has already applied
  // it to the objects; a stable sort is what keeps that order intact here
  // without the renderer having to know a modification time.
  const rows = [...screens, ...objects].sort(
    (a, b) => b.strength - a.strength || a.kindRank - b.kindRank
  );

  // The Address the window is on is never the default choice: omitting the
  // row would make the list lie about what exists, but ↵ should never be a
  // no-op by accident. Arrowing onto it is another matter — that is a
  // choice, not an accident.
  const byDefault = rows.findIndex((row) => !row.current);
  // The choice never points past the list a new query returned.
  const chosen =
    arrowedTo === null ? byDefault : Math.min(arrowedTo, rows.length - 1);
  const target = rows[chosen];

  const move = (to: number) => {
    if (rows.length === 0) return;
    setArrowedTo(Math.max(0, Math.min(to, rows.length - 1)));
  };

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        onClose();
        return;
      case "Enter":
        event.preventDefault();
        if (target !== undefined) go(target);
        return;
      case "ArrowDown":
        event.preventDefault();
        move(chosen + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(chosen - 1);
        return;
      default:
        return;
    }
  }

  // One push of the route, so back returns where the user was (ADR 0027
  // decision 7).
  function go(row: Row) {
    pushRoute(row.route);
    onClose();
  }

  const total = (listing.data?.total ?? 0) + screens.length;

  return (
    <div className={styles.scrim} onMouseDown={() => inputRef.current?.focus()}>
      <div
        className={styles.command}
        role="dialog"
        aria-label="Global command"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.row}>
          <span className={styles.label}>⌘K</span>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            role="combobox"
            aria-label="Go to something"
            aria-expanded
            aria-controls="global-command-list"
            aria-activedescendant={
              target === undefined ? undefined : rowId(chosen)
            }
            autoComplete="off"
            placeholder="Go somewhere"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setArrowedTo(null);
            }}
            onKeyDown={onKeyDown}
          />
          <span className={styles.hint}>esc leaves</span>
        </div>
        {/* A read that failed must never read as an empty vault. */}
        {listing.isError && (
          <p className={styles.message} role="alert">
            {listing.error.message}
          </p>
        )}
        {/* The list's name is the count line's sentence, said to whoever
            cannot see it: before anything is typed these rows are the
            recent set and not matches for anything (#304). */}
        <ul
          id="global-command-list"
          className={styles.list}
          role="listbox"
          aria-label={wanted === "" ? "Recent" : "Destinations"}
        >
          {rows.map((row, index) => (
            <li
              key={row.key}
              id={rowId(index)}
              role="option"
              aria-selected={index === chosen}
              aria-current={row.current ? "page" : undefined}
              className={styles.destination}
              onMouseDown={(event) => {
                event.preventDefault();
                go(row);
              }}
            >
              {/* The Kind's word is beside it, so the mark never carries
                  the Kind on its own (BRAND.md law 6). */}
              <span className={styles.glyph} aria-hidden="true">
                {row.glyph}
              </span>
              <Name name={row.name} query={query} serif={row.serif} />
              <span className={styles.kind}>{row.label}</span>
              {row.current && <span className={styles.current}>current</span>}
            </li>
          ))}
        </ul>
        <div className={styles.footer}>
          {/* What ↵ will do, said loudly and at all times: the key drawn as
              a key, the mode in the one brass on screen, and the thing it
              will act on named in full rather than implied (ADR 0027
              decision 2). It says one thing until #303 gives it a second. */}
          <p className={styles.verb} role="status">
            <span className={styles.key}>↵</span>
            <span className={styles.mode}>Go to</span>
            <span
              className={[
                styles.target,
                target === undefined ? styles.pending : "",
                target?.serif === true ? styles.serif : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {target?.name ??
                (rows.length === 0
                  ? "nothing here goes by that name"
                  : "you are already here")}
            </span>
          </p>
          <span className={styles.count}>
            {countLine(wanted, rows.length, total)}
          </span>
        </div>
      </div>
    </div>
  );
}

const rowId = (index: number) => `global-command-row-${index}`;

/**
 * What the list is, in the terms of what was typed. Never a silent cut: a
 * list longer than one ask says how long it is, whichever list it is (ADR
 * 0027 decision 6).
 *
 * Before anything is typed there is nothing to have matched — every object
 * is in the list and the order is recency — so the line names the set
 * instead of counting it, and a cut one says the length it was cut from
 * *inside* that naming rather than in place of it. The prototype's line
 * dropped the length here; the ADR says a cut list carries it, and the ADR
 * is what a prototype does not overrule.
 */
function countLine(wanted: string, shown: number, total: number): string {
  const cut = total > shown;
  if (wanted === "")
    return cut
      ? `recent · ${shown} of ${total} · type to narrow`
      : "recent · type to narrow";
  if (total === 0) return "no destination matches";
  return cut ? `${shown} of ${total} — keep typing` : `${total} matching`;
}

/**
 * A row's Display name with the run that matched picked out, so it is
 * obvious why the row is here. The run is found in the name as written,
 * not in the key it was matched through, so a query typed across a hyphen
 * marks the hyphen too.
 */
function Name({
  name,
  query,
  serif,
}: {
  name: string;
  query: string;
  serif: boolean;
}) {
  const className = serif ? `${styles.name} ${styles.serif}` : styles.name;
  const run = matchRun(name, query);
  if (run === null) return <span className={className}>{name}</span>;
  const [from, to] = run;
  return (
    <span className={className}>
      {name.slice(0, from)}
      <mark className={styles.mark}>{name.slice(from, to)}</mark>
      {name.slice(to)}
    </span>
  );
}
