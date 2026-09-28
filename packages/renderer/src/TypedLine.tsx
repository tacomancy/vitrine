import { useEffect, useRef } from "react";
import styles from "./TypedLine.module.css";

/** What the line is for: an answer in place, or the claim of a Hypothesis. */
export type TypedLinePurpose = "answer" | "hypothesis";

const LINES: Record<
  TypedLinePurpose,
  { form: string; input: string; hint: string }
> = {
  answer: {
    form: "Answer in place",
    input: "Answer",
    hint: "↵ answer · esc discards",
  },
  hypothesis: {
    form: "Promote to Hypothesis",
    input: "Claim",
    hint: "↵ promote to hypothesis · esc discards",
  },
};

/**
 * One typed line, held until ↵ writes it or esc discards it: *answer in
 * place* on an Inbox row, and the claim a promotion to Hypothesis asks for
 * — the one thing a question cannot supply by itself (ADR 0031 decision 9)
 * — on a row or on a Research Question page (#332). One component, so the
 * two doors to a Hypothesis ask in the same words and keys. It takes the
 * keyboard when it opens; a stray ↵ on an empty line writes nothing and
 * leaves the line open. Where it sits is the caller's (`className`).
 */
export function TypedLine({
  purpose,
  value,
  onChange,
  onSubmit,
  onDiscard,
  className,
}: {
  purpose: TypedLinePurpose;
  value: string;
  onChange: (text: string) => void;
  /** The line, trimmed and never empty. */
  onSubmit: (text: string) => void;
  onDiscard: () => void;
  className?: string | undefined;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const line = LINES[purpose];
  const submit = () => {
    const text = value.trim();
    if (text !== "") onSubmit(text);
  };
  return (
    <form
      className={
        className === undefined ? styles.line : `${styles.line} ${className}`
      }
      aria-label={line.form}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        aria-label={line.input}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            // esc discards the typing and writes nothing; the caller gives
            // the keyboard back to whatever opened the line.
            event.preventDefault();
            onDiscard();
          }
        }}
      />
      <span className={styles.hint}>{line.hint}</span>
    </form>
  );
}
