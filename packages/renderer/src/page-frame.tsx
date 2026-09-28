import { useCallback, useEffect, useRef, useState } from "react";
import { useVaultChanged } from "./events";
import styles from "./ResearchQuestion.module.css";
import { hashOf, replaceRoute } from "./router";

/**
 * What a page's read answers, for the frame: whether it resolved, and why
 * not. Every Kind's page read has this shape (`core`'s `page-file.ts`).
 */
type Read =
  { readable: true } | { readable: false; path: string; reason: string };

/**
 * The frame every Kind's page shares — the Research Question view and the
 * Hypothesis view (#330) — so the two cannot drift in how they behave under
 * external change. Kept in one place because a fix to how a page follows
 * its file must reach every page, not the one somebody remembered.
 *
 * - The surface the object landed in takes the keyboard (ADR 0010): a
 *   promotion arrives here, and the page is what answers the next key. The
 *   window mounts the page afresh per Address (`key={path}` in `App`), so
 *   every arrival takes it.
 * - The page follows its file as the Inbox's selection does: a rename moves
 *   the Address so the re-read lands on `to`; a removal is an absence line,
 *   not a stale page and not an alarm.
 * - An Address the router accepted but the vault cannot answer for lands on
 *   the Inbox naming itself (ADR 0027 decision 7; #299), replaced rather
 *   than pushed so back does not return to it. Arrival only: a page that
 *   stops being readable *under* the reader says so where they stand.
 */
export function usePageFrame(
  surface: "research-question" | "hypothesis" | "experiment",
  path: string,
  data: Read | undefined
) {
  const sectionRef = useRef<HTMLElement>(null);
  // A field inside the page that took the keyboard as it mounted — a new
  // Experiment's Purpose — keeps it; the page takes it otherwise.
  useEffect(() => {
    if (!sectionRef.current?.contains(document.activeElement)) {
      sectionRef.current?.focus();
    }
  }, []);

  const [removed, setRemoved] = useState<string | null>(null);
  useVaultChanged(
    useCallback(
      ({ changed, renamed, removed: gone }) => {
        if (gone.includes(path)) setRemoved(path);
        // The file came back (an undo, a sync flap): the re-read shows it.
        else if (changed.includes(path)) setRemoved(null);
        const move = renamed.find(({ from }) => from === path);
        if (move) replaceRoute({ surface, path: move.to });
      },
      [surface, path]
    )
  );

  // Whether this Address resolved: what the *first* answer said, recorded
  // during render so no paint happens between the answer and what it
  // decides. The page is mounted afresh per Address, so this is the one
  // arrival it belongs to.
  const [resolved, setResolved] = useState<boolean | null>(null);
  if (resolved === null && data !== undefined) setResolved(data.readable);

  useEffect(() => {
    if (resolved !== false || data?.readable !== false) return;
    replaceRoute({
      surface: "inbox",
      unresolved: {
        address: hashOf({ surface, path }),
        reason: data.reason,
      },
    });
  }, [resolved, data, surface, path]);

  return { sectionRef, removed, resolved };
}

/**
 * The lines a page says in place of itself: a refused read, a removal, and
 * a page that resolved and then stopped being readable.
 */
export function FrameLines({
  error,
  removed,
  resolved,
  data,
}: {
  error: { message: string } | null;
  removed: string | null;
  resolved: boolean | null;
  data: Read | undefined;
}) {
  return (
    <>
      {/* A refused read is a failure, not an absence: it must not read as a quiet page. */}
      {error !== null && (
        <p className={styles.refused} role="alert">
          {error.message}
        </p>
      )}
      {removed !== null && (
        <p className={styles.absent}>{removed} — removed from the vault</p>
      )}
      {/* Resolved, and then did not — a `kind:` edited elsewhere, a
          permission changed. The reader is standing here, so the reason
          belongs here rather than on the Inbox they did not ask for. */}
      {removed === null && resolved === true && data?.readable === false && (
        <p className={styles.absent}>
          {data.path} — {data.reason}
        </p>
      )}
    </>
  );
}
