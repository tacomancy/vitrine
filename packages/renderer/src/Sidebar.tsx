import { useQuery } from "@tanstack/react-query";
import type { Vault } from "core";
import { voiceOf } from "./FirstSlot";
import { hashOf, SETTINGS, type Route } from "./router";
import styles from "./Sidebar.module.css";
import { DASHBOARDS, SURFACES, type Entry } from "./surfaces";
import { useTRPC } from "./trpc";
import { useVaultStatusLines } from "./VaultStatusLines";

// The map, drawn from `surfaces.ts` — which the Global command reads too, so
// the two cannot disagree about what is reachable. An entry with a
// destination is a link; the rest are drawn inert so the product's shape is
// visible — plain list items, not controls.

export function Sidebar({ route, vault }: { route: Route; vault: Vault }) {
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
    const current =
      (to !== undefined && to.surface === route.surface) ||
      (lit?.(route) ?? false);
    const href = current ? hashOf(route) : to ? hashOf(to) : null;
    // Waiting is shown as provenance still to come, never by greying the
    // entry out, which is what makes an entry look broken (prototype 12,
    // panel 4). An entry with a surface of its own still goes there: the
    // Experiment view is where the first run is made (KEEP-10).
    if (!current && holds && held !== null && !held.has(holds.kind)) {
      const waiting = (
        <>
          <span className={`${styles.dot} ${styles.hollow}`} />
          <span className={styles.entry}>
            {name}
            <span className={styles.hint}>{holds.hint}</span>
          </span>
        </>
      );
      return (
        <li key={name}>
          {href === null ? (
            <span className={styles.waiting}>{waiting}</span>
          ) : (
            <a href={href} className={`${styles.waiting} ${styles.live}`}>
              {waiting}
            </a>
          )}
        </li>
      );
    }
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
  const inSettings = route.surface === "settings";
  return (
    <nav className={styles.sidebar} aria-label="Surfaces">
      {/* The vault the window is on, as two facts, and the gear on it:
          Settings describes this vault, so it opens from the vault's name
          (prototype 13). Not an entry on the map — Settings is not one of
          the Surfaces (ADR 0025 decision 1). */}
      <div className={styles.vault}>
        <div className={styles.vaultFacts}>
          <span className={styles.vaultName}>{vault.name}</span>
          <span className={styles.vaultPath}>{vault.path}</span>
        </div>
        <a
          href={hashOf(SETTINGS)}
          className={inSettings ? styles.gearCurrent : styles.gear}
          aria-label="Settings"
          aria-current={inSettings ? "page" : undefined}
        >
          <span aria-hidden="true">⚙</span>
        </a>
      </div>
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
