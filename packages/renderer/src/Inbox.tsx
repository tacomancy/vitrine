import styles from "./Inbox.module.css";

/**
 * The Question Inbox. This slice draws its header only; the list, the sort,
 * and the detail pane arrive with the slices that put Questions on disk.
 */
export function Inbox() {
  return (
    <section id="inbox" className={styles.inbox} aria-labelledby="inbox-title">
      <div className={styles.header}>
        <h1 id="inbox-title" className={styles.title}>
          Question Inbox
        </h1>
        {/* Nothing is read from the vault yet, so the count is what it says. */}
        <span className={styles.count}>0 questions</span>
      </div>
      <ul className={styles.list} aria-label="Questions" />
    </section>
  );
}
