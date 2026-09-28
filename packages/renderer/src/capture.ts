import { useMutation } from "@tanstack/react-query";
import type { Provenance, Question } from "core";
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
 * `Resolving · <the Hypothesis's file name> · <when>` for a follow-up, or
 * `Observing · <the run's name> · <when>` — an Experiment's file is named
 * by the run.
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
        : ["Observing", provenance.experiment];
  const stem = path.split("/").pop() ?? "";
  return `${word} · ${stem.replace(/\.md$/, "")}`;
}

export type Capture = {
  /** Writes the trimmed text, or does nothing when there is nothing to write. */
  write: (
    text: string,
    provenance: Provenance,
    onWritten: (question: Question) => void
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
  const writing = useRef(false);
  return {
    write: (text, provenance, onWritten) => {
      const trimmed = text.trim();
      if (trimmed === "" || writing.current) return;
      writing.current = true;
      capture.mutate(
        { text: trimmed, provenance },
        {
          onSuccess: onWritten,
          onSettled: () => {
            writing.current = false;
          },
        }
      );
    },
    error: capture.isError ? capture.error : null,
    reset: () => {
      writing.current = false;
      capture.reset();
    },
  };
}
