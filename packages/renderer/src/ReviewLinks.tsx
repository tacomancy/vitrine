import styles from "./ReviewLinks.module.css";

/** The row action that opens the review at a Question (#493). */
export function ReviewLinks({
  question,
  onClick,
}: {
  question: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.review}
      aria-label={`review links for ${question}`}
      onClick={onClick}
    >
      review links
    </button>
  );
}
