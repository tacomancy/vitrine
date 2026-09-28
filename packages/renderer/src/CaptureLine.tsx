import type { Provenance, Question } from "core";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { provenanceChip, useCapture } from "./capture";
import styles from "./CaptureLine.module.css";

/** What a surface may ask of the Capture line: open it on a Provenance of its choosing. */
export type CaptureLineHandle = { open: (provenance: Provenance) => void };

/**
 * The two-keystroke capture: ⌘' opens one line at the bottom of the window
 * with the Provenance already resolved, ↵ writes the Question, esc discards.
 * Closing puts focus back where it was; the surface the Question lands in
 * may then take it (ADR 0010). Mounted once, window-wide. What happens to a
 * Question once written is the window's business, not the line's: it
 * reports the landing and closes. `provenance` is what the window says was
 * open when the chord was pressed: the chip shows it, and the Question
 * carries it. A surface can open the line on something it has chosen
 * instead — the Experiment Inbox's `Q` on its chosen run (#373) — through
 * `ref`'s `open`, so there is still one Capture line and one landing.
 */
export function CaptureLine({
  provenance,
  onCaptured,
  ref,
}: {
  provenance: Provenance;
  onCaptured: (question: Question) => void;
  ref?: Ref<CaptureLineHandle>;
}) {
  // The Provenance is fixed when the line opens, as its time is: it is
  // what was open at the chord, whatever the window shows after.
  const [opened, setOpened] = useState<{
    at: Date;
    provenance: Provenance;
  } | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Where focus was when the line opened, so closing puts it back.
  const restoreTo = useRef<HTMLElement | null>(null);

  const capture = useCapture();

  const close = () => {
    setOpened(null);
    setText("");
    // The component stays mounted, so a failed attempt's message would
    // otherwise greet the next open.
    capture.reset();
    restoreTo.current?.focus();
    restoreTo.current = null;
  };

  const open = useCallback(
    (from: Provenance) => {
      if (opened === null) {
        restoreTo.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      }
      // Re-resolved on every open: the chip says when this capture is, not
      // when the first one was.
      setOpened({ at: new Date(), provenance: from });
    },
    [opened]
  );

  useImperativeHandle(ref, () => ({ open }), [open]);

  // A renderer key handler, not a native shortcut: the chord is the app's,
  // and works the same in the iPad client with no menu bar.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey && event.key === "'") {
        event.preventDefault();
        open(provenance);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, provenance]);

  useEffect(() => {
    if (opened !== null) inputRef.current?.focus();
  }, [opened]);

  if (opened === null) return null;

  // `useCapture` holds the write's own two rules. The input is never
  // disabled for the wait, because disabling it drops focus and a failed
  // write should leave the user exactly where they were, text and all.
  const submit = () =>
    capture.write(text, opened.provenance, (question) => {
      close();
      onCaptured(question);
    });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  return (
    <form
      className={styles.line}
      aria-label="Capture"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={styles.row}>
        <span className={styles.label}>Capture</span>
        <span className={styles.chip}>
          {provenanceChip(opened.provenance, opened.at)}
        </span>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          aria-label="Question"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className={styles.hint}>↵ capture · esc discards</span>
      </div>
      {capture.error !== null && (
        <p className={styles.message} role="alert">
          {capture.error.message}
        </p>
      )}
    </form>
  );
}
