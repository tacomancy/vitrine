import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Candidate } from "core";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Picker } from "./Picker";
import { usePageProcedures, type HistoriedKind } from "./page-procedures";
import { useTRPC } from "./trpc";
import styles from "./WhyLine.module.css";

/**
 * The one line for *why* (#216; brief § Position history, "detailed when it
 * matters"; prompt 3; spec #206 stories 33–36). The Revision it explains is
 * already on disk — `⌥↵` saves first, and *+ why* in the history comes
 * months later — so this line only ever adds to one. That is what makes
 * `esc` a decline rather than a cancel, and it is why nothing here can
 * cost a change of mind.
 *
 * `[[` opens the one picker, narrowed to nothing: what changed a mind may
 * be a paper, an experiment, or another question. The link is completed
 * inline, because the line is text the user is writing and not a field of
 * links — and its text is the core's (`wikilinkTo`), not the bare name,
 * so a name two files answer to can never send the why to the wrong one.
 */
export function WhyLine({
  kind,
  path,
  at,
  field,
  basedOn,
  onClose,
}: {
  /** Which Kind's page the Revision is on: the procedure that writes the why is that Kind's. */
  kind: HistoriedKind;
  /** The page's vault-relative path. */
  path: string;
  /**
   * The Revision's timestamp and field: an entry has no id, and its
   * timestamp names it only within its field (ADR 0020 decision 2) — two
   * of a Hypothesis's fields can be stamped the same second (#333).
   */
  at: string;
  field: string;
  /** The file's hash as the caller last saw it — a ⌥↵ line's is its own save's. */
  basedOn: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const procedures = usePageProcedures();
  const [text, setText] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  // Where inside the line the picker was opened: the offset just past the
  // `[[` the user typed, so the link the core composes replaces those two
  // characters along with the space it needs.
  const [bracket, setBracket] = useState<number | null>(null);
  // Where the caret belongs once a completion has rendered. A ref, not
  // state: it is a note to the effect below and nothing renders from it.
  const caret = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Where the keyboard was when the line opened — the working answer, or
  // the *+ why* that offered this — put back however the line closes.
  const [restoreTo] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  useEffect(() => {
    inputRef.current?.focus();
    return () => restoreTo?.focus();
  }, [restoreTo]);

  // After a completion has rendered: the Picker's own unmount has put
  // focus back in this input, and this puts the caret past the link it
  // just wrote, so typing carries on where the sentence left off.
  useEffect(() => {
    const to = caret.current;
    if (to === null) return;
    caret.current = null;
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(to, to);
  }, [text]);

  const explain = useMutation({
    mutationFn: (input: {
      path: string;
      at: string;
      field: string;
      why: string;
      basedOn: string;
    }) => procedures.explain(kind, input),
    onSuccess: async (result) => {
      if (!result.written) {
        // The typing stays: a why that could not be written is worth
        // more in the field than in the reason it failed for.
        setRefusal(`not explained — ${result.detail}`);
        return;
      }
      await procedures.reread(kind, path);
      onClose();
    },
    onError: (error) => setRefusal(`not explained — ${error.message}`),
  });

  const write = () => {
    const why = text.trim();
    // Nothing typed is the same decline `esc` makes: the Revision stands,
    // it is simply not explained.
    if (why === "") return onClose();
    if (explain.isPending) return;
    explain.mutate({ path, at, field, why, basedOn });
  };

  const type = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setText(value);
    const to = event.target.selectionStart ?? value.length;
    if (value.slice(to - 2, to) === "[[") setBracket(to);
  };

  /**
   * The picked file, written the way the app writes every link it composes
   * (`link-text.ts`): the bare name when the Index says it reaches this
   * file and nothing else, the vault-relative path when it does not. The
   * renderer cannot know which, so it asks — a link that quietly resolved
   * to a second file by the same name is the silent failure the brief
   * forbids, and a why is where the evidence for a change of mind lives.
   */
  const complete = async (candidate: Candidate) => {
    const opened = bracket;
    if (opened === null) return;
    let link: string;
    try {
      const reply = await queryClient.fetchQuery(
        trpc.picker.linkText.queryOptions({ from: path, to: candidate.path })
      );
      link = reply.text;
    } catch (error) {
      // Nothing is inserted and the `[[` stays where it was typed: the
      // sentence is the user's, and a guess in the middle of it is worse
      // than a line saying the link could not be written.
      setBracket(null);
      setRefusal(`no link written — ${(error as Error).message}`);
      return;
    }
    setText(text.slice(0, opened - 2) + link + text.slice(opened));
    caret.current = opened - 2 + link.length;
    setBracket(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      write();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className={styles.why}>
      <div className={styles.row}>
        <span className={styles.label}>why</span>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          aria-label="Why"
          autoComplete="off"
          value={text}
          onChange={type}
          onKeyDown={onKeyDown}
        />
        <span className={styles.hint}>↵ writes it · esc leaves it quiet</span>
      </div>
      {bracket !== null && (
        <Picker
          label="Why — link to a file"
          onChoose={(candidate) => void complete(candidate)}
          onClose={() => setBracket(null)}
        />
      )}
      {refusal !== null && (
        <p role="status" className={styles.refusal}>
          {refusal}
        </p>
      )}
    </div>
  );
}
