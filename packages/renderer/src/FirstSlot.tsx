import type { ReactNode } from "react";
import styles from "./FirstSlot.module.css";
import type { VaultRead } from "./VaultStatusLines";

/** One slot, three Voices (ADR 0032, prototype 12). */
export type Voice = "claim" | "not yet" | "wrong";

/**
 * Which Voice an empty surface speaks in (ADR 0033 decision 3). Only a read
 * in full, while watched, may claim that nothing is there: a surface swept
 * once and then left unwatched is accurate as of the sweep and nothing more.
 * `incomplete` is the surface's own reason it cannot vouch for what it read
 * — a failed read, a file it could not read — and outranks everything, since
 * a failure must never pass for an empty vault.
 */
export function voiceOf({
  incomplete,
  answered,
  read,
}: {
  incomplete: boolean;
  answered: boolean;
  read: VaultRead;
}): Voice {
  if (incomplete || read === "unwatched" || read === "unknown") return "wrong";
  if (!answered || read === "reading") return "not yet";
  return "claim";
}

/**
 * Where a surface's contents would begin, when it has none. Only the claim
 * asserts anything, so only the claim carries a Warrant, and only the claim
 * is followed by the surface's paragraph. The other two are fragments that
 * assert nothing; what is happening, and why, is the footer channel's to say.
 */
export function FirstSlot({
  voice,
  claim,
  warrant = "read in full · watching",
  children,
}: {
  voice: Voice;
  /** The sentence, full stop and all. */
  claim: string;
  /** What the claim rests on, when it is not the usual full, watched read. */
  warrant?: string;
  /** The paragraph under the claim, said once at the page's own size. */
  children?: ReactNode;
}) {
  if (voice === "claim")
    return (
      <>
        <p className={styles.slot}>
          <span className={styles.claim}>{claim}</span>
          <span className={styles.warrant}>{warrant}</span>
        </p>
        {children !== undefined && (
          <p className={styles.paragraph}>{children}</p>
        )}
      </>
    );
  return (
    <p className={styles.slot}>
      <span className={styles.fragment}>
        {voice === "wrong" ? (
          <span className={styles.warning} aria-hidden="true">
            ‖
          </span>
        ) : (
          <span aria-hidden="true">◐</span>
        )}
        <span>{voice === "wrong" ? "not known" : "not read yet"}</span>
      </span>
    </p>
  );
}
