import { useQuery } from "@tanstack/react-query";
import { voiceOf } from "./FirstSlot";
import { hashOf, type Route } from "./router";
import styles from "./Sidebar.module.css";
import { DASHBOARDS, SURFACES, type Entry } from "./surfaces";
import { useTRPC } from "./trpc";
import { useVaultStatusLines } from "./VaultStatusLines";

// The map, drawn from `surfaces.ts` — which the Global command reads too, so
// the two cannot disagree about what is reachable. An entry with a
// destination is a link; the rest are drawn inert so the product's shape is
// visible — plain list items, not controls.

export function Sidebar({ route }: { route: Route }) {
  const trpc = useTRPC();
  const { read } = useVaultStatusLines();
  const kinds = useQuery(trpc.vault.kinds.queryOptions());
  // Saying an entry has nothing in it is a claim, so it follows the empty
  // slot's rule (ADR 0032): only a vault read in full and watched may make
  // it. Otherwise every entry is drawn as it always is and the rail claims
  // nothing — a hollow entry during a read would say "empty" of a vault
  // the app has not finished looking at.
  const held =
    voiceOf({
      incomplete: kinds.isError,
      answered: kinds.data !== undefined,
      read,
    }) === "claim"
      ? new Set(kinds.data)
      : null;

  const item = ({ name, to, lit, holds }: Entry) => {
    const current = to ? to.surface === route.surface : lit?.(route);
    const href = current ? hashOf(route) : to ? hashOf(to) : null;
    // Waiting is shown as provenance still to come, never by greying the
    // entry out, which is what makes an entry look broken (prototype 12,
    // panel 4).
    if (!current && holds && held !== null && !held.has(holds.kind))
      return (
        <li key={name} className={styles.waiting}>
          <span className={styles.hollow} />
          <span className={styles.entry}>
            {name}
            <span className={styles.from}>{holds.from}</span>
          </span>
        </li>
      );
    return href === null ? (
      <li key={name} className={styles.disabled}>
        <span className={styles.dot} />
        {name}
      </li>
    ) : (
      <li key={name}>
        <a
          href={href}
          className={current ? styles.current : styles.live}
          aria-current={current ? "page" : undefined}
        >
          <span className={styles.dot} />
          {name}
        </a>
      </li>
    );
  };
  return (
    <nav className={styles.sidebar} aria-label="Surfaces">
      <div className={styles.label}>Surfaces</div>
      <ul className={styles.list}>{SURFACES.map(item)}</ul>
      <div className={styles.label}>Dashboards</div>
      <ul className={styles.list}>{DASHBOARDS.map(item)}</ul>
      {/* The map's last word is the route that replaces it: a map that
          does not name the faster way is failing at being one (ADR 0027
          decision 10). Ancillary, not an entry — nothing to click, nothing
          the keyboard stops on. */}
      <div
        className={styles.chords}
        role="note"
        aria-label="Keyboard shortcuts"
      >
        <p className={styles.chord}>
          <span className={styles.key}>⌘K</span> go anywhere, or capture
        </p>
        <p className={styles.chord}>
          <span className={styles.key}>⌘&apos;</span> capture
        </p>
      </div>
    </nav>
  );
}
