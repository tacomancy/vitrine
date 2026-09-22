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
import type { ListedQuestion, Order, Question, QuestionStatus } from "core";
import { formatAge } from "./age";
import { Detail } from "./Detail";
import { useVaultChanged } from "./events";
import styles from "./Inbox.module.css";
import { LINKABLE } from "./kinds";
import { Picker } from "./Picker";
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
  // moves or the next attempt: never silent, never a dialog. Dropped during
  // render the moment the selection leaves the row, so coming back to it
  // never resurrects a reason that is no longer current.
  const [refusal, setRefusal] = useState<{
    path: string;
    message: string;
  } | null>(null);
  if (refusal !== null && refusal.path !== selected) setRefusal(null);
  // Open while the Link picker is up. The picker puts the keyboard back on
  // the list itself, so closing it is all this has to do.
  const [linking, setLinking] = useState(false);
  if (linking && selected === null) setLinking(false);
  // *Answer in place*: one line open on a row, holding the text until ↵
  // writes it or esc discards it. A row at a time, and only the selected
  // one, so the selection moving closes it.
  const [answering, setAnswering] = useState<{
    path: string;
    text: string;
  } | null>(null);
  if (answering !== null && answering.path !== selected) setAnswering(null);

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

  // The last three triage keys (#212): each is one write, and each leaves
  // the row where it is — only promotion moves the window. The list is
  // re-read so the row carries its new glyph and label.
  const onWritten = () =>
    void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
  const onRefused = (error: { message: string }, { path }: { path: string }) =>
    setRefusal({ path, message: error.message });

  const answer = useMutation(
    trpc.questions.answer.mutationOptions({
      onSuccess: onWritten,
      onError: onRefused,
    })
  );
  const drop = useMutation(
    trpc.questions.drop.mutationOptions({
      onSuccess: onWritten,
      onError: onRefused,
    })
  );
  const reopen = useMutation(
    trpc.questions.reopen.mutationOptions({
      onSuccess: onWritten,
      onError: onRefused,
    })
  );
  // Link (#211): the picker's choice appended to the selected Question's
  // `related`. Only the linking side is written; the backlink is the
  // index's (CONTEXT.md *Related*). Re-read on settle rather than on
  // success alone, because the refusal a link can draw — the file changed
  // underneath — is itself a row that has moved on.
  const link = useMutation(
    trpc.questions.link.mutationOptions({
      onSettled: onWritten,
      onError: onRefused,
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
  const answerRef = useRef<HTMLInputElement>(null);
  const answeringPath = answering?.path ?? null;
  useEffect(() => {
    if (answeringPath !== null) answerRef.current?.focus();
  }, [answeringPath]);

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

  /**
   * The selected row when it is a Question its Status allows the action
   * on; null otherwise, and the key then does nothing at all — a key that
   * does not apply is absent, never an error to dismiss. The core refuses
   * the same combinations (`questions.ts`, OPEN and TRIAGED); § Research
   * Question view and triage is where both read the rule from, so a change
   * to it is an edit in two places.
   */
  function actionable(...allowed: QuestionStatus[]) {
    if (selectedRow?.kind !== "question") return null;
    return allowed.includes(selectedRow.question.status) ? selectedRow : null;
  }

  // j/k and the arrows move the selection; ↵ selects the first row when
  // nothing is selected yet; p promotes, a answers in place, d drops, r
  // reopens. The list is one tab stop. No key is reserved for promote to
  // Hypothesis: it is absent, not disabled, until its destination exists
  // (beat 3).
  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    // The answer line is open and has the keyboard; its own keys reach it
    // and bubble to here, where every one of them is text.
    if (answering !== null) return;
    if (rows.length === 0) return;
    const index = rows.findIndex((row) => row.path === selected);
    let next: number | null = null;
    switch (event.key) {
      case "p": {
        const row = actionable("open");
        if (row === null || promote.isPending) return;
        event.preventDefault();
        setRefusal(null);
        promote.mutate({ path: row.path });
        return;
      }
      case "a": {
        const row = actionable("open");
        if (row === null || answer.isPending) return;
        event.preventDefault();
        setRefusal(null);
        setAnswering({ path: row.path, text: "" });
        return;
      }
      case "d": {
        const row = actionable("open");
        if (row === null || drop.isPending) return;
        event.preventDefault();
        setRefusal(null);
        drop.mutate({ path: row.path });
        return;
      }
      case "r": {
        const row = actionable("answered", "abandoned");
        if (row === null || reopen.isPending) return;
        event.preventDefault();
        setRefusal(null);
        reopen.mutate({ path: row.path });
        return;
      }
      case "l": {
        // Every Status: linking is not a state change, so unlike the other
        // four keys there is no Status it does not apply to.
        const row = actionable("open", "promoted", "answered", "abandoned");
        if (row === null || link.isPending) return;
        event.preventDefault();
        setRefusal(null);
        setLinking(true);
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

  /** ↵: the typed line, trimmed. A stray ↵ never answers with nothing. */
  function submitAnswer() {
    const line = answering?.text.trim() ?? "";
    if (answering === null || line === "" || answer.isPending) return;
    setRefusal(null);
    answer.mutate(
      { path: answering.path, line },
      {
        // The line closes only on a write that landed, and the list takes
        // the keyboard back; a refusal keeps the typing where it is, as
        // the capture line does.
        onSuccess: () => {
          setAnswering(null);
          listRef.current?.focus();
        },
      }
    );
  }

  function onAnswerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      submitAnswer();
    } else if (event.key === "Escape") {
      // esc discards the typing and writes nothing; the list takes the
      // keyboard back with the row still selected.
      event.preventDefault();
      setAnswering(null);
      listRef.current?.focus();
    }
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
              {answering?.path === row.path && (
                <form
                  className={styles.answer}
                  aria-label="Answer in place"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitAnswer();
                  }}
                >
                  <input
                    ref={answerRef}
                    className={styles.answerInput}
                    type="text"
                    aria-label="Answer"
                    autoComplete="off"
                    value={answering.text}
                    onChange={(event) =>
                      setAnswering({
                        path: row.path,
                        text: event.target.value,
                      })
                    }
                    onKeyDown={onAnswerKeyDown}
                  />
                  <span className={styles.answerHint}>
                    ↵ answer · esc discards
                  </span>
                </form>
              )}
              {refusal?.path === row.path && (
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
          <span className={styles.key}>l link</span>
          <span className={styles.key}>a answer</span>
          <span className={styles.key}>d drop</span>
          <span className={styles.key}>r reopen</span>
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
        {linking && selectedRow?.kind === "question" && (
          <Picker
            label="Link to"
            kinds={LINKABLE}
            // A Question cannot be related to itself, so it is not offered.
            exclude={[selectedRow.path.slice(vaultPath.length + 1)]}
            onChoose={(candidate) => {
              setLinking(false);
              link.mutate({
                path: selectedRow.path,
                target: candidate.path,
              });
            }}
            onClose={() => setLinking(false)}
          />
        )}
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
