import { useMutation } from "@tanstack/react-query";
import type { Provenance, Question } from "core";
import type { PageSelection } from "./pdf-document";
import { useRef } from "react";
import { formatDateTime } from "./time";
import { useTRPC } from "./trpc";

/**
 * What the two chords share (ADR 0027 decision 1). ⌘' and ⌘K are two
 * presentations of one act, and the ADR accepts two UIs only on the
 * grounds that the procedure and the Provenance are the same for both — so
 * everything that is the same for both lives here, and only the drawing
 * differs. The Provenance itself is the window's (`App.tsx`): the chord
 * never decides it.
 */

/**
 * The chip a capture shows before a character is typed:
 * `Unattached · <when>`, `Pursuing · <the page's file name> · <when>`,
 * `Resolving · <the Hypothesis's file name> · <when>` for a follow-up,
 * `Observing · <the run's name> · <when>` — an Experiment's file is named
 * by the run — or `Reading · <the Source's file name> · p.<n> · <when>`.
 */
export function provenanceChip(provenance: Provenance, at: Date): string {
  return `${where(provenance)} · ${formatDateTime(at)}`;
}

function where(provenance: Provenance): string {
  if (provenance.context === "other") return "Unattached";
  const [word, path] =
    provenance.context === "pursuing"
      ? ["Pursuing", provenance.page]
      : provenance.context === "resolving"
        ? ["Resolving", provenance.hypothesis]
        : provenance.context === "reading"
          ? ["Reading", provenance.source]
          : ["Observing", provenance.experiment];
  const stem = path.split("/").pop() ?? "";
  const named = `${word} · ${stem.replace(/\.md$/, "")}`;
  return provenance.context === "reading"
    ? `${named} · p.${provenance.page}`
    : named;
}

export type Capture = {
  /** Writes the trimmed text, or does nothing when there is nothing to write. */
  write: (
    text: string,
    provenance: Provenance,
    onWritten: (question: Question) => void,
    /** The Reader's selection: makes the Question a `Q:` highlight too (#427). */
    selection?: PageSelection | null
  ) => void;
  /** Why the last attempt did not land, in the words the core sent, or null. */
  error: { message: string } | null;
  /** Forget a failed attempt, so the next opening starts clean. */
  reset: () => void;
};

/**
 * The capture, as either chord makes it. The two guards are here rather
 * than in each caller because they are the write's own rules and not the
 * UI's: an empty line is not a Question, and one ↵ is one Question however
 * fast the second arrives. The second is a ref and not the mutation's
 * pending flag — that flag is only true after React has re-rendered, which
 * is one repaint too late for two keystrokes in the same tick.
 */
export function useCapture(): Capture {
  const trpc = useTRPC();
  const capture = useMutation(trpc.questions.capture.mutationOptions());
  // From a selection the core writes the highlight and the Question as one
  // act (#427), so it is a different procedure, not a second call.
  const fromSelection = useMutation(trpc.sources.question.mutationOptions());
  const writing = useRef(false);
  const settled = () => {
    writing.current = false;
  };
  return {
    write: (text, provenance, onWritten, selection) => {
      const trimmed = text.trim();
      if (trimmed === "" || writing.current) return;
      writing.current = true;
      if (selection && provenance.context === "reading") {
        fromSelection.mutate(
          {
            path: provenance.source,
            page: selection.page,
            rects: selection.rects as [number, number, number, number][],
            text: trimmed,
          },
          { onSuccess: (made) => onWritten(made.question), onSettled: settled }
        );
        return;
      }
      capture.mutate(
        { text: trimmed, provenance },
        { onSuccess: onWritten, onSettled: settled }
      );
    },
    error: fromSelection.isError
      ? fromSelection.error
      : capture.isError
        ? capture.error
        : null,
    reset: () => {
      writing.current = false;
      capture.reset();
      fromSelection.reset();
    },
  };
}
