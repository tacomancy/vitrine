import styles from "./Sidebar.module.css";

// The eight surfaces, in CONTEXT.md's order. Only the Inbox exists yet; the
// rest are drawn disabled so the product's shape is visible while nothing
// inert can be reached — they are plain list items, not controls.
const SURFACES = [
  "Home",
  "Question Inbox",
  "Reader",
  "Research Question view",
  "Hypothesis view",
  "Experiment view",
  "Scout Queue",
  "Vault",
] as const;

const LIVE = "Question Inbox";

export function Sidebar() {
  return (
    <nav className={styles.sidebar} aria-label="Surfaces">
      <div className={styles.label}>Surfaces</div>
      <ul className={styles.list}>
        {SURFACES.map((surface) =>
          surface === LIVE ? (
            <li key={surface}>
              <a href="#inbox" className={styles.live} aria-current="page">
                <span className={styles.dot} />
                {surface}
              </a>
            </li>
          ) : (
            <li key={surface} className={styles.disabled}>
              <span className={styles.dot} />
              {surface}
            </li>
          )
        )}
      </ul>
    </nav>
  );
}
