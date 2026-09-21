import { hashOf, INBOX, LOOSE_ENDS, type Route } from "./router";
import styles from "./Sidebar.module.css";

// The eight surfaces in CONTEXT.md's order, then the one dashboard that has
// an address; the Sidebar stands in for Home until beat 12. An entry with a
// destination is a link; the rest are drawn inert so the product's shape is
// visible — plain list items, not controls. The Research Question view has
// no destination of its own (a page needs a path): it lights when a page is
// open and is inert otherwise.
type Entry = { name: string; to?: Route; lit?: (at: Route) => boolean };

const SURFACES: readonly Entry[] = [
  { name: "Home" },
  { name: "Question Inbox", to: INBOX },
  { name: "Reader" },
  { name: "Research Question view", lit: (at) => at.surface === "questions" },
  { name: "Hypothesis view" },
  { name: "Experiment view" },
  { name: "Scout Queue" },
  { name: "Vault" },
];

const DASHBOARDS: readonly Entry[] = [{ name: "Loose Ends", to: LOOSE_ENDS }];

export function Sidebar({ route }: { route: Route }) {
  const item = ({ name, to, lit }: Entry) => {
    const current = to ? to.surface === route.surface : lit?.(route);
    const href = current ? hashOf(route) : to ? hashOf(to) : null;
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
    </nav>
  );
}
