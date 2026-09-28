import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Destination, Provenance, Question } from "core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { provenanceChip, useCapture } from "./capture";
import { useChosenInView } from "./chosen";
import styles from "./GlobalCommand.module.css";
import { KIND, routeOf, type Mark } from "./kinds";
import { matchKey, matchRun, strength } from "./match";
import { hashOf, pushRoute, type Route } from "./router";
import { ADDRESSED, type Addressed } from "./surfaces";
import { useTRPC } from "./trpc";

/**
 * The Global command (`CONTEXT.md`; ADR 0027): ⌘K from any Surface or
 * Dashboard opens one keyboard list over what the window was doing, typing
 * narrows it, and ↵ either goes somewhere or writes the typed text down as
 * a Question. Which of the two it is follows how well what was typed
 * matches something that already exists, and ⇥ overrules it — so the verb
 * at the foot, which names the act and its target in full, is the safety
 * and not a decoration.
 *
 * The list is half the renderer's and half the core's. Screens are not
 * files, so the core does not know them (#301); objects are matched and
 * ordered there and merged in here, and the ordering across both is
 * decided below.
 *
 * `provenance` is what the window says was open when the chord was pressed,
 * exactly as the Capture line is given it: the chord never changes it.
 */
export function GlobalCommand({
  route,
  provenance,
  onCaptured,
}: {
  route: Route;
  provenance: Provenance;
  onCaptured: (question: Question) => void;
}) {
  const [open, setOpen] = useState(false);

  // A renderer key handler, not a native shortcut: the chord is the app's,
  // and works the same in the iPad client with no menu bar. Mounted only
  // where a vault is, so First run keeps its single action (ADR 0025
  // decision 5), as the Capture line's chord already is.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // Whatever case the key arrives in: caps lock and ⌘⇧K are the chord
      // too, and a dead key would just look broken.
      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Remounted on every open, so nothing a previous one was typing or had
  // arrowed to greets the next — and so the Provenance chip is re-resolved
  // for this capture rather than the last one.
  return open ? (
    <Command
      route={route}
      provenance={provenance}
      onCaptured={onCaptured}
      onClose={() => setOpen(false)}
    />
  ) : null;
}

/** A row of the list: where it goes, and what it says about itself. */
type Row = {
  /** Its Address: what it goes to, and what tells it from every other row. */
  address: string;
  glyph: string;
  /** The Kind's own word, shown beside the glyph: no mark carries a Kind alone. */
  label: string;
  name: string;
  route: Route;
  /** Where the window already is. Listed, marked, never the default choice. */
  current: boolean;
  /** The reading family, for the Kinds whose Display name is a question or a claim. */
  serif: boolean;
  /** How well it answers what was typed, the rung both halves score on. */
  strength: number;
  /** Surfaces, Dashboards, Settings, then the objects: the tie-break after strength. */
  kindRank: number;
};

/**
 * The one number line the whole list is ranked on after strength: Surfaces,
 * Dashboards, then the objects in the order the core already ranks them
 * among themselves (`destinations.ts` `ADDRESSABLE`). A Kind added to either
 * half takes its place here and nowhere else.
 */
const KIND_ORDER = [
  "surface",
  "dashboard",
  "settings",
  "research-question",
  "hypothesis",
  "experiment",
  "question",
] as const;

type Kind = (typeof KIND_ORDER)[number];

const rankOf = (kind: Kind) => KIND_ORDER.indexOf(kind);

/**
 * A screen's mark and its word. The objects take theirs from `KIND`, which
 * every surface showing a file already shares; a Surface is not a file, so
 * its own two live here.
 */
/**
 * The objects' marks and words, narrowed from the table every surface
 * showing a file shares — a closed union, so a Kind the core can answer
 * with and `KIND` has no mark for fails to compile rather than falling back.
 */
const KIND_OF: Record<Destination["kind"], Mark> = KIND;

const SCREEN_KIND: Record<Addressed["kind"], { glyph: string; label: string }> =
  {
    surface: { glyph: "▪", label: "surface" },
    dashboard: { glyph: "▦", label: "dashboard" },
    // The rail's gear, so the row and the way in it names look alike.
    settings: { glyph: "⚙", label: "settings" },
  };

/**
 * The rung at which a match is worth ↵ on its own. Below it the typed text
 * is likelier to be a question than a name, so the capture holds the key
 * (ADR 0027 decision 2). An empty query scores 0 everywhere, which is why
 * a freshly opened command is already a capture.
 */
const WORTH_GOING_TO = 2;

function Command({
  route,
  provenance,
  onCaptured,
  onClose,
}: {
  route: Route;
  provenance: Provenance;
  onCaptured: (question: Question) => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  // The row the user put the cursor on, null until they arrow or cross:
  // the default follows the list, and the list changes under it with
  // every keystroke.
  const [picked, setPicked] = useState<number | null>(null);
  // Resolved once, when the command opened: the chip says when this
  // capture is, as the Capture line's does.
  const [openedAt] = useState(() => new Date());
  const inputRef = useRef<HTMLInputElement>(null);
  const here = hashOf(route);

  // Where focus was when the command opened, put back when it closes —
  // however it closes, including a jump or a capture. What the window lands on may then
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
  const capture = useCapture();

  const wanted = matchKey(query);
  /** The half of a row that is the same whichever half of the list it came from. */
  const rowOf = (
    kind: Kind,
    name: string,
    route: Route,
    mark: { glyph: string; label: string },
    serif: boolean
  ): Row => {
    const address = hashOf(route);
    return {
      address,
      glyph: mark.glyph,
      label: mark.label,
      name,
      route,
      current: address === here,
      serif,
      strength: strength(wanted, matchKey(name)),
      kindRank: rankOf(kind),
    };
  };

  const screens: Row[] = ADDRESSED.flatMap((screen) =>
    matchKey(screen.name).includes(wanted)
      ? [
          rowOf(
            screen.kind,
            screen.name,
            screen.route,
            SCREEN_KIND[screen.kind],
            false
          ),
        ]
      : []
  );
  const objects: Row[] = (listing.data?.rows ?? []).flatMap((object) => {
    const route = routeOf(object.kind, object.path);
    // The reach rule, and the only one: a Kind with nowhere to open has no
    // row, so no row can lead to a dead end. The core answers with
    // addressable Kinds alone today, and this is what keeps that true if it
    // ever stops being.
    return route === null
      ? []
      : [rowOf(object.kind, object.display, route, KIND_OF[object.kind], true)];
  });

  // Strength, then Kind — so an exact hit leads whatever it is, and a
  // Surface outranks an object that merely contains the word (ADR 0027
  // decision 6). Recency is the third key and the core has already applied
  // it to the objects; a stable sort is what keeps that order intact here
  // without the renderer having to know a modification time.
  const rows = [...screens, ...objects].sort(
    (a, b) => b.strength - a.strength || a.kindRank - b.kindRank
  );

  // One index across both sides: the destinations, then the capture last.
  // Arrows walk the whole of it, and ⇥ jumps between its two halves.
  const captureAt = rows.length;
  // The Address the window is on is never the default choice: omitting the
  // row would make the list lie about what exists, but ↵ should never be a
  // no-op by accident. Arrowing onto it is another matter — that is a
  // choice, not an accident. The rows are sorted by strength, so the first
  // one that is not it is also the best one ↵ could act on.
  const stranger = rows.findIndex((row) => !row.current);
  // The default side. An exact or prefix hit means the user typed a name,
  // so ↵ goes; anything weaker means they typed a question, so ↵ writes it
  // down. The rung is read off that row and not off the whole list, or an
  // exact hit on the page the user is standing on — which ↵ cannot act on
  // — would send them to some weaker row they never named.
  const byDefault =
    (rows[stranger]?.strength ?? -1) >= WORTH_GOING_TO ? stranger : captureAt;
  // The choice never points past the list a new query returned.
  const chosen =
    picked === null ? byDefault : Math.max(0, Math.min(picked, captureAt));
  const onCapture = chosen === captureAt;
  const target = rows[chosen];
  /**
   * The chosen row's id: the keyboard's and the list's window alike. Never
   * absent, because the capture is always the last row — so the one choice
   * with no `target` behind it is still a row, and still one the list has
   * to scroll to when fifty destinations stand above it.
   */
  const chosenRowId = rowId(chosen);
  useChosenInView(chosenRowId);

  const typed = query.trim();

  const move = (to: number) => setPicked(Math.max(0, Math.min(to, captureAt)));

  function cross() {
    if (onCapture) {
      // The far side's own choice, by the same rule the default uses — but
      // ⇥ is a deliberate act, so the row the window is on is better than
      // no crossing at all.
      if (rows.length > 0) setPicked(Math.max(stranger, 0));
    } else setPicked(captureAt);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        onClose();
        return;
      case "Enter":
        event.preventDefault();
        if (onCapture) write();
        else if (target !== undefined) go(target);
        return;
      case "ArrowDown":
        event.preventDefault();
        move(chosen + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(chosen - 1);
        return;
      case "Tab":
        // Swapping sides, and never focus: the overlay is one tab stop, so
        // taking the key costs nothing — and ⇥ walking focus out to the
        // Sidebar behind the scrim would leave the command with no way to
        // dismiss it, because this handler is the input's and esc would
        // never reach it again (#317).
        event.preventDefault();
        cross();
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

  // The Capture line's write, unchanged: the same mutation and the same
  // Provenance, so the chord is presentation and nothing more (ADR 0027
  // decision 1). No duplicate check — an exact hit has already moved the
  // default side to the existing object, which is the only signal this
  // design gives and the only one it needs (decision 8). `useCapture` holds
  // the write's own two rules, so neither chord has to remember them.
  function write() {
    capture.write(query, provenance, (question) => {
      onClose();
      onCaptured(question);
    });
  }

  // What the list is, said beside the verb. A read that failed must not be
  // counted: the screens are still reachable and still listed, but calling
  // them the whole answer would say the vault holds three things
  // (§ Invariants, no silent failures).
  const count = listing.isError
    ? "the Surfaces, Dashboards and Settings only"
    : countLine(
        wanted,
        rows.length,
        (listing.data?.total ?? 0) + screens.length
      );
  // Where ⇥ would take ↵, or nothing when there is no other side.
  const alternative = onCapture
    ? rows.length === 0
      ? ""
      : "⇥ goes to the top match"
    : "⇥ writes it down instead";
  // The row and the verb would otherwise print the same sentence twice in
  // the state that happens most: nothing matched, and the thing typed is
  // the thing worth writing down.
  const bare = rows.length === 0;

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
            aria-label="Capture a question, or go to something"
            aria-expanded
            aria-controls="global-command-list"
            aria-activedescendant={chosenRowId}
            autoComplete="off"
            placeholder="Write a question, or go somewhere"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPicked(null);
            }}
            onKeyDown={onKeyDown}
          />
          <span className={styles.hint}>esc leaves</span>
        </div>
        {/* A read that failed must never read as an empty vault, and a
            write that failed must never look like one that landed. */}
        {listing.isError && (
          <p className={styles.message} role="alert">
            {listing.error.message}
          </p>
        )}
        {capture.error !== null && (
          <p className={styles.message} role="alert">
            {capture.error.message}
          </p>
        )}
        {/* The list's name is the count line's sentence, said to whoever
            cannot see it: before anything is typed these rows are the
            recent set and not matches for anything (#304). */}
        <ul
          id="global-command-list"
          className={styles.list}
          role="listbox"
          aria-label={
            wanted === "" ? "Recent and capture" : "Destinations and capture"
          }
        >
          {rows.map((row, index) => (
            <li
              key={row.address}
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
          {/* Always last, and always there: the thing the command exists
              for is the one row a search can never return. */}
          <li
            id={rowId(captureAt)}
            role="option"
            aria-selected={onCapture}
            className={
              bare ? `${styles.capture} ${styles.bare}` : styles.capture
            }
            onMouseDown={(event) => {
              event.preventDefault();
              write();
            }}
          >
            {/* Bare, the glyph is the only mark on the row, so the Kind it
                stands for is spelled for a reader that cannot see it. */}
            <span className={styles.glyph} role="img" aria-label="question">
              ◆
            </span>
            {!bare && (
              <span
                className={
                  typed === ""
                    ? `${styles.captureText} ${styles.invite}`
                    : styles.captureText
                }
              >
                {typed === ""
                  ? "Write a question — it costs nothing and keeps where you were"
                  : typed}
              </span>
            )}
            <span className={styles.chip}>
              {provenanceChip(provenance, openedAt)}
            </span>
          </li>
        </ul>
        <div className={styles.footer}>
          {/* The capture is the fallback as well as the other side: it is
              the one row that is always there, so the verb is never at a
              loss for something true to say. */}
          <Verb
            act={
              !onCapture && target !== undefined
                ? going(target)
                : capturing(typed)
            }
          />
          {/* The alternative key and the count, one muted run: the verb is
              the loud thing, and nothing beside it should compete. */}
          <span className={styles.aside}>
            {alternative !== "" && (
              <>
                <span>{alternative}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{count}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

const rowId = (index: number) => `global-command-row-${index}`;

/**
 * What ↵ is about to do: the mode, and the thing in full rather than a
 * category. `serif` is the reading family, for a name that is a question
 * or a claim.
 */
type Act = { mode: string; target: string; serif: boolean; pending: boolean };

/**
 * The typed text is shown as it will be written. The prototype's trailing
 * `?` is not added, because the capture does not add one either and a verb
 * that overstates is worse than no verb at all.
 */
const capturing = (typed: string): Act =>
  typed === ""
    ? {
        mode: "Capture",
        target: "type a question",
        serif: false,
        pending: true,
      }
    : { mode: "Capture", target: typed, serif: true, pending: false };

const going = (row: Row): Act => ({
  mode: "Go to",
  target: row.name,
  serif: row.serif,
  pending: false,
});

/**
 * Said loudly and at all times: the key drawn as a key, the mode in the one
 * brass on screen, and the thing ↵ will act on named in full (ADR 0027
 * decision 2). It is the safety for a key that means two things, so it is
 * never silent and never has anything to apologise for.
 */
function Verb({ act }: { act: Act }) {
  return (
    <p className={styles.verb} role="status">
      <span className={styles.key}>↵</span>
      <span className={styles.mode}>{act.mode}</span>
      <span
        className={[
          styles.target,
          act.pending ? styles.pending : "",
          act.serif ? styles.serif : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {act.target}
      </span>
    </p>
  );
}

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
