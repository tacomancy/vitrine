import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ListedQuestion, Order, Question } from "core";
import { formatAge } from "./age";
import { Detail } from "./Detail";
import { useVaultChanged } from "./events";
import styles from "./Inbox.module.css";
import { hashOf, pushRoute } from "./router";
import { monthYear, provenanceOf, rowsOf, STATUS } from "./rows";
import { PartialGlyph, StatusGlyph } from "./StatusGlyph";
import { useTRPC } from "./trpc";
import { useVaultStatusLines } from "./VaultStatusLines";

const ORDERS: readonly Order[] = ["newest", "oldest"];

/**
 * The Question Inbox: every Question in the vault, newest first, each with
 * its Provenance and age. One number in the chrome — how many exist — and
 * nothing that counts what is owed. `landed` is the Question the capture
 * line just wrote: it becomes the selection and the list takes the keyboard.
 */
export function Inbox({
  landed,
  vaultPath,
}: {
  landed: Question | null;
  vaultPath: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<Order>("newest");
  const [selected, setSelected] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // A triage write the core refused, shown on its row until the selection
  // moves or the next attempt: never silent, never a dialog.
  const [refusal, setRefusal] = useState<{
    path: string;
    message: string;
  } | null>(null);

  // Promote to Research Question (#210): the core writes the page and marks
  // the Question; the window moves to the page, which takes the keyboard
  // (ADR 0010's rule for the surface the object landed in). The list is
  // re-read so the row reads promoted when the user comes back.
  const promote = useMutation(
    trpc.questions.promote.mutationOptions({
      onSuccess: ({ path }) => {
        void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
        pushRoute({ surface: "questions", path });
      },
      onError: (error, { path }) =>
        setRefusal({ path, message: error.message }),
    })
  );

  // The selection is a path (ADR 0010), so a rename outside the app must
  // move it before the re-query lands, or the renamed row would arrive
  // unselected. A removed selection is cleared rather than left to dangle:
  // the row's absence is the whole message, and a file that comes back
  // later (a sync flap, an undo) should not arrive already selected.
  useVaultChanged(
    useCallback(
      ({ renamed, removed }) => {
        const absolute = (path: string) => `${vaultPath}/${path}`;
        setSelected((path) => {
          if (path === null) return null;
          if (removed.some((gone) => absolute(gone) === path)) return null;
          const move = renamed.find(({ from }) => absolute(from) === path);
          return move === undefined ? path : absolute(move.to);
        });
      },
      [vaultPath]
    )
  );

  // A new landing moves the selection to it. Adjusted during render rather
  // than in an effect, so the row is selected in the same paint it appears
  // in; the row itself arrives with the re-read list, keyed by path.
  const [seen, setSeen] = useState(landed);
  if (landed !== seen) {
    setSeen(landed);
    setSelected(landed?.path ?? null);
  }
  // j/k should act on the new row at once, wherever focus was before the
  // capture line opened.
  useEffect(() => {
    if (landed !== null) listRef.current?.focus();
  }, [landed]);
  // Switching the sort re-queries; the old list stays until the new one lands
  // rather than flashing empty.
  const listing = useQuery({
    ...trpc.questions.list.queryOptions({ order }),
    placeholderData: keepPreviousData,
  });

  const rows = listing.data ? rowsOf(listing.data, order) : [];
  const failed = listing.isError;
  // The one number in the chrome counts Questions; a Partial file is listed
  // but is not yet one. Oldest by capture regardless of the sort in force.
  const questions = listing.data?.questions ?? [];
  const count = questions.length;
  const since = questions.reduce<string | null>(
    (oldest, q) =>
      oldest === null || Date.parse(q.captured) < Date.parse(oldest)
        ? q.captured
        : oldest,
    null
  );
  const selectedRow = rows.find((row) => row.path === selected) ?? null;
  const unreadable = listing.data?.unreadable ?? [];
  const now = new Date();

  // The vault's state shares the unreadable count's quiet channel.
  const status = useVaultStatusLines();

  // j/k and the arrows move the selection; ↵ selects the first row when
  // nothing is selected yet; p promotes the selected open Question. The
  // list is one tab stop. No key is reserved for promote to Hypothesis: it
  // is absent, not disabled, until its destination exists (beat 3).
  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (rows.length === 0) return;
    const index = rows.findIndex((row) => row.path === selected);
    let next: number | null = null;
    switch (event.key) {
      case "p": {
        event.preventDefault();
        if (
          selectedRow?.kind !== "question" ||
          selectedRow.question.status !== "open" ||
          promote.isPending
        ) {
          return;
        }
        setRefusal(null);
        promote.mutate({ path: selectedRow.path });
        return;
      }
      case "j":
      case "ArrowDown":
        next = Math.min(index + 1, rows.length - 1);
        break;
      case "k":
      case "ArrowUp":
        next = Math.max(index - 1, 0);
        break;
      case "Enter":
        next = index === -1 ? 0 : index;
        break;
      default:
        return;
    }
    event.preventDefault();
    setSelected(rows[next]?.path ?? null);
  }

  return (
    <>
      <section
        id="inbox"
        className={styles.inbox}
        aria-labelledby="inbox-title"
      >
        <div className={styles.header}>
          <h1 id="inbox-title" className={styles.title}>
            Question Inbox
          </h1>
          {/* A failed read must never read as an empty vault (no silent failures). */}
          {!failed && (
            <span className={styles.count}>
              {count} {count === 1 ? "question" : "questions"}
              {since !== null && ` · since ${monthYear(since)}`}
            </span>
          )}
          <div className={styles.sort} role="group" aria-label="Sort">
            <span className={styles.sortLabel}>Sort</span>
            {ORDERS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={styles.sortOption}
                aria-pressed={candidate === order}
                onClick={() => setOrder(candidate)}
              >
                {candidate}
              </button>
            ))}
          </div>
        </div>
        {failed && (
          <p className={styles.failed} role="alert">
            {listing.error.message}
          </p>
        )}
        <ul
          ref={listRef}
          className={styles.list}
          role="listbox"
          aria-label="Questions"
          aria-activedescendant={
            selectedRow ? rowId(rows.indexOf(selectedRow)) : undefined
          }
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {rows.map((row, index) => (
            <li
              key={row.path}
              id={rowId(index)}
              role="option"
              aria-selected={row.path === selected}
              className={styles.row}
              onClick={() => setSelected(row.path)}
            >
              {row.kind === "question" ? (
                <>
                  <StatusGlyph status={row.question.status} />
                  <span className={styles.question}>
                    {row.question.question}
                  </span>
                  <span className={styles.provenance}>
                    {provenanceOf(row.question)}
                    <StatusWord question={row.question} />
                  </span>
                </>
              ) : (
                <>
                  <PartialGlyph />
                  <span className={styles.question}>{row.partial.name}</span>
                  <span className={styles.provenance}>partial</span>
                </>
              )}
              <span className={styles.age}>{formatAge(row.when, now)}</span>
              {refusal?.path === row.path && row.path === selected && (
                <p className={styles.refusal} role="alert">
                  {refusal.message}
                </p>
              )}
            </li>
          ))}
        </ul>
        {/* The footer channel: the triage keys once, quietly, then whatever
            the vault has to say. The keys are a legend, not a state, so the
            footer is always there; the status lines come and go. */}
        <footer className={styles.footer}>
          <span className={styles.key}>j/k move</span>
          <span className={styles.key}>p promote</span>
          {unreadable.length > 0 && (
            <details className={styles.unreadableDetails}>
              <summary className={styles.footerLine}>
                {unreadable.length} {unreadable.length === 1 ? "file" : "files"}{" "}
                could not be read
              </summary>
              <ul className={styles.unreadable}>
                {unreadable.map((file) => (
                  <li key={file.path}>
                    <span>{file.path}</span>
                    <span className={styles.reason}>{file.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {status.lines}
        </footer>
      </section>
      <Detail row={selectedRow} />
    </>
  );
}

// For aria-activedescendant; a path is unique but not id-safe, its index is.
const rowId = (index: number) => `question-row-${index}`;

/**
 * The status word beside the Provenance on a row that has been triaged —
 * open is the default and its accent glyph says so. On a promoted row the
 * word is the link to its page; a page the index cannot find leaves the
 * word plain rather than a link into the void.
 */
function StatusWord({ question }: { question: ListedQuestion }) {
  if (question.status === "open") return null;
  const { label } = STATUS[question.status];
  const page = question.promotedTo?.path ?? null;
  return (
    <>
      {" · "}
      {page === null ? (
        label
      ) : (
        <a
          className={styles.page}
          href={hashOf({ surface: "questions", path: page })}
        >
          {label}
        </a>
      )}
    </>
  );
}
