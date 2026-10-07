import type { KeyboardEvent } from "react";
import type { Scout } from "core";
import styles from "./ScoutActivity.module.css";

/** Shortest first, as the core lists them: the renderer takes types from `core` and nothing else. */
const CADENCES: ReadonlyArray<Scout["cadence"]> = [
  "daily",
  "weekly",
  "monthly",
];

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
  // A menu's own keys: the arrows move through it, wrapping, and Escape closes
  // it. Choosing is the button's, which Enter and Space already are.
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
    const at = choices.findIndex((choice) => choice === event.target);
    const to =
      event.key === "ArrowDown"
        ? (at + 1) % choices.length
        : event.key === "ArrowUp"
          ? (at - 1 + choices.length) % choices.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? choices.length - 1
              : null;
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
          // The keyboard arrives on the cadence the Scout has, as a menu's does.
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
