import { useMutation } from "@tanstack/react-query";
import type { SavedAnswer } from "core";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  usePageProcedures,
  type Base,
  type EditedPosition,
} from "./page-procedures";
import styles from "./ResearchQuestion.module.css";
import { useTRPCClient } from "./trpc";
import { WhyLine } from "./WhyLine";

/** One save of a Position: the write, and the Revision it recorded. */
function useSave(position: EditedPosition) {
  const client = useTRPCClient();
  return (input: {
    path: string;
    text: string;
    basedOn: string;
    was: string;
  }): Promise<SavedAnswer> =>
    position.kind === "hypothesis"
      ? client.hypotheses.savePosition.mutate({
          ...input,
          field: position.field,
        })
      : client.researchQuestions.saveWorkingAnswer.mutate(input);
}

/**
 * A Position as a plain text field (§ Research Question view and triage,
 * Editing on the page; spec #327 stories 16–17): autosave on blur, ⌘↵
 * saves now, ⌥↵ saves and opens one line for *why* (#216), esc reverts
 * unsaved typing. A save carries the hash the page was given and the text
 * it read; the core diffs and records the Revision, so nothing here knows
 * the grammar. A save landing on a section changed underneath is the
 * *changed on disk* line with autosave suspended until it is answered; any
 * other refusal is a line under the field with its reason, and the typing
 * stays — never silent, never lost (CLAUDE.md § Invariants).
 */
export function PositionField({
  position,
  path,
  hash,
  text,
  labelledBy,
  empty,
  className,
}: {
  position: EditedPosition;
  path: string;
  hash: string;
  text: string;
  /** The id of the section label naming the field. */
  labelledBy: string;
  /** What sits above the field while it is empty: the section's one sentence on what belongs there. */
  empty: ReactNode;
  /** The field's own face, where it differs from a Working answer's — the claim's display size. */
  className?: string | undefined;
}) {
  const procedures = usePageProcedures(position.kind);
  const saveFn = useSave(position);
  // Null while the field shows the file's text; the typing otherwise.
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Up while the *changed on disk* line is: autosave is suspended until
  // one of its two actions is chosen (#215).
  const [conflict, setConflict] = useState(false);
  // What the typing is a change *to*, captured when the field went dirty
  // and not re-taken from a re-read underneath it — an Obsidian edit to
  // another section must not make this save look based on the new file.
  const [base, setBase] = useState<Base | null>(null);
  // Set while a save is in flight, so a blur right after ⌘↵ is one save.
  const inFlight = useRef(false);
  // The Revision to explain and the file as the save that recorded it left
  // it; null when no why line is open (#216).
  const [why, setWhy] = useState<{ at: string; basedOn: string } | null>(null);
  // The keys, while the field has the keyboard: ⌥↵ is otherwise a gesture
  // nothing on the page mentions.
  const [focused, setFocused] = useState(false);
  const save = useMutation({
    mutationFn: saveFn,
    onSuccess: async (result, { text: saved, basedOn }) => {
      if (!result.written) {
        if (result.reason === "changedAndUnreapplyable") setConflict(true);
        else setRefusal(`not saved — ${result.detail}`);
        return;
      }
      setRefusal(null);
      setConflict(false);
      await procedures.reread(path);
      // Typing that went on past the save is kept; the field shows the
      // re-read page only when it holds what was typed. Typing that
      // stayed is now a change to what this save put on disk.
      setDraft((current) => (current === saved ? null : current));
      setBase((current) =>
        current === null || current.hash === basedOn
          ? { hash: result.hash, text: saved.trim() }
          : current
      );
    },
    onError: (error) => setRefusal(`not saved — ${error.message}`),
  });

  /**
   * `explain` is ⌥↵'s one addition: the same save, with the why line
   * opened on the Revision it turns out to have recorded. It rides on this
   * call rather than on a flag the next reply would have to read, so a
   * blur's save can never be mistaken for the one ⌥↵ asked for.
   */
  const send = (typed: string, on: Base, explain = false) => {
    inFlight.current = true;
    save.mutate(
      { path, text: typed, basedOn: on.hash, was: on.text },
      {
        onSuccess: (result) => {
          // Based on the file as this save left it: the page's hash, which
          // the field carried in, is one write out of date by now.
          if (explain && result.written && result.revision !== null) {
            setWhy({ at: result.revision, basedOn: result.hash });
          }
        },
        onSettled: () => {
          inFlight.current = false;
        },
      }
    );
  };
  const commit = (explain = false) => {
    if (draft === null || inFlight.current || conflict) return;
    if (draft.trim() === text) {
      setDraft(null);
      setBase(null);
      return;
    }
    send(draft, base ?? { hash, text }, explain);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && event.metaKey) {
      event.preventDefault();
      commit();
    } else if (event.key === "Enter" && event.altKey) {
      event.preventDefault();
      // Nothing to save is nothing to explain: the line waits for a
      // Revision rather than opening over the last one, which already
      // said what it had to say.
      commit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
      setBase(null);
    }
  };
  const type = (typed: string) => {
    setBase((current) => current ?? { hash, text });
    setDraft(typed);
  };
  // *Keep mine*: the disk copy read afresh, then the typing saved over it.
  const keepMine = async () => {
    const disk = await procedures.diskCopy(path, position);
    setConflict(false);
    if (!disk.read) return setRefusal(`not saved — ${disk.reason}`);
    if (draft === null) return;
    setBase(disk.base);
    send(draft, disk.base);
  };
  // *Take the disk copy*: the typing let go, the field showing the file.
  // The read is also what puts that file in the page's cache — `text`
  // arrives as a prop, and a field showing the file is one with no draft.
  const takeTheDiskCopy = async () => {
    const disk = await procedures.diskCopy(path, position);
    setConflict(false);
    // Nothing to take: the typing stays rather than being dropped for a
    // copy that could not be read.
    if (!disk.read) return setRefusal(`not saved — ${disk.reason}`);
    setDraft(null);
    setBase(null);
  };
  const shown = draft ?? text;
  return (
    <>
      {shown === "" && empty}
      <textarea
        className={
          className === undefined
            ? styles.field
            : `${styles.field} ${className}`
        }
        aria-labelledby={labelledBy}
        value={shown}
        rows={shown === "" ? 2 : undefined}
        onChange={(event) => type(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={onKeyDown}
      />
      {focused && (
        <p className={styles.keys}>
          <span>⌘↵ save</span>
          <span>⌥↵ save with a note on what changed</span>
          <span>esc reverts</span>
        </p>
      )}
      {why !== null && (
        <WhyLine
          kind={position.kind}
          path={path}
          at={why.at}
          basedOn={why.basedOn}
          onClose={() => setWhy(null)}
        />
      )}
      {conflict && (
        <ChangedOnDisk
          keepMine={() => void keepMine()}
          takeTheDiskCopy={() => void takeTheDiskCopy()}
        />
      )}
      {refusal !== null && (
        <p role="status" className={styles.refusal}>
          {refusal}
        </p>
      )}
    </>
  );
}

/**
 * The Vault editor's *changed on disk* line (ADR 0015 decision 5), inside
 * the section that refused: the section was edited elsewhere between the
 * page's read and this save, so re-applying would have replaced those words
 * with these. Not a modal and not a silent overwrite — the typing stays in
 * the field, autosave is suspended until one of the two is chosen, and
 * *keep mine* is the one place a byte the user did not type is overwritten
 * on their explicit say-so.
 */
export function ChangedOnDisk({
  keepMine,
  takeTheDiskCopy,
}: {
  keepMine: () => void;
  takeTheDiskCopy: () => void;
}) {
  return (
    <p role="status" className={styles.conflict}>
      <span>changed on disk</span>
      <button type="button" className={styles.edit} onClick={keepMine}>
        keep mine
      </button>
      <button type="button" className={styles.edit} onClick={takeTheDiskCopy}>
        take the disk copy
      </button>
    </p>
  );
}
