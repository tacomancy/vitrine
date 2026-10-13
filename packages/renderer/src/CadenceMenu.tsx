import type { KeyboardEvent } from "react";
import type { Scout } from "core";
import styles from "./ScoutActivity.module.css";

/** Shortest first, as the core lists them: the renderer takes types from `core` and nothing else. */
const CADENCES: ReadonlyArray<Scout["cadence"]> = [
  "daily",
  "weekly",
  "monthly",
];

/** Where a menu's own keys take the keyboard from `at` among `count` choices: the arrows wrap, Home and End go to the ends, any other key is not the menu's. */
function moveTo(key: string, at: number, count: number): number | null {
  switch (key) {
    case "ArrowDown":
      return (at + 1) % count;
    case "ArrowUp":
      return (at - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * A row's cadence as a menu of the three it can be (spec #511 story 54): the
 * one you want is one choice away and never at the end of a cycle. Each choice
 * a Scout would be made due by says so beside it, before anything is chosen, so
 * that changing a cadence is never a surprise run (story 55).
 */
export function CadenceMenu({
  name,
  cadence,
  dueUnder,
  onPick,
  onClose,
}: {
  name: string;
  cadence: Scout["cadence"];
  /** The choices that would make the Scout due at the next check, as the core reads them. */
  dueUnder: ReadonlyArray<Scout["cadence"]>;
  onPick: (cadence: Scout["cadence"]) => void;
  onClose: () => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    const choices = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        "[role='menuitemradio']"
      ),
    ];
    const to = moveTo(
      event.key,
      choices.findIndex((choice) => choice === event.target),
      choices.length
    );
    if (to === null) return;
    event.preventDefault();
    choices[to]?.focus();
  }

  return (
    <div
      role="menu"
      aria-label={`${name}: cadence`}
      className={styles.menu}
      onKeyDown={onKeyDown}
    >
      {CADENCES.map((choice) => (
        <button
          key={choice}
          type="button"
          role="menuitemradio"
          aria-checked={choice === cadence}
          autoFocus={choice === cadence}
          className={styles.choice}
          onClick={() => onPick(choice)}
        >
          {choice}
          {dueUnder.includes(choice) && " · due at the next check"}
        </button>
      ))}
    </div>
  );
}
