import styles from "./LooseEnds.module.css";

/**
 * The Loose Ends dashboard's shell (`docs/architecture.md` § Loose Ends).
 * No row query exists yet, so no group is drawn — an empty group is never
 * shown, and a group that cannot be computed is not an empty one. The line
 * says that plainly rather than congratulating an empty list.
 */
export function LooseEnds() {
  return (
    <section className={styles.dashboard} aria-labelledby="loose-ends-title">
      <div className={styles.header}>
        <h1 id="loose-ends-title" className={styles.title}>
          Loose Ends
        </h1>
      </div>
      <p className={styles.quiet}>Nothing to tidy that the app can see yet.</p>
    </section>
  );
}
