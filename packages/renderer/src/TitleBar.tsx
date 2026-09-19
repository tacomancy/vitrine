import styles from "./TitleBar.module.css";

/**
 * The drawn title bar. The native one is hidden with the traffic lights inset,
 * so this strip is what the user drags the window by.
 */
export function TitleBar({ title }: { title: string }) {
  return (
    <header className={styles.bar}>
      <span className={styles.title}>{title}</span>
    </header>
  );
}
