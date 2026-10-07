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
}: {
  name: string;
  cadence: Scout["cadence"];
  /** The choices that would make the Scout due at the next check, as the core reads them. */
  dueUnder: ReadonlyArray<Scout["cadence"]>;
  onPick: (cadence: Scout["cadence"]) => void;
}) {
  return (
    <div role="menu" aria-label={`${name}: cadence`} className={styles.menu}>
      {CADENCES.map((choice) => (
        <button
          key={choice}
          type="button"
          role="menuitemradio"
          aria-checked={choice === cadence}
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
