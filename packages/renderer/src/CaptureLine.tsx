import { useMutation } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import styles from "./CaptureLine.module.css";
import { formatDateTime } from "./time";
import { useTRPC } from "./trpc";

/**
 * The two-keystroke capture: ⌘' opens one line at the bottom of the window
 * with the Provenance already resolved, ↵ writes the Question and returns
 * focus to where it was, esc discards. Mounted once, window-wide.
 */
export function CaptureLine() {
  const trpc = useTRPC();
  const [openedAt, setOpenedAt] = useState<Date | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Where focus was when the line opened, so closing puts it back.
  const restoreTo = useRef<HTMLElement | null>(null);

  const capture = useMutation(trpc.questions.capture.mutationOptions());

  const close = () => {
    setOpenedAt(null);
    setText("");
    // The component stays mounted, so a failed attempt's message would
    // otherwise greet the next open.
    capture.reset();
    restoreTo.current?.focus();
    restoreTo.current = null;
  };

  const open = useCallback(() => {
    if (openedAt === null) {
      restoreTo.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    // Re-resolved on every open: the chip says when this capture is, not
    // when the first one was.
    setOpenedAt(new Date());
  }, [openedAt]);

  // A renderer key handler, not a native shortcut: the chord is the app's,
  // and works the same in the iPad client with no menu bar.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey && event.key === "'") {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (openedAt !== null) inputRef.current?.focus();
  }, [openedAt]);

  if (openedAt === null) return null;

  const submit = () => {
    const trimmed = text.trim();
    // A stray ↵ never makes a blank Question; a second ↵ mid-write never
    // makes a duplicate. The input is never disabled for the wait, because
    // disabling it drops focus and a failed write should leave the user
    // exactly where they were, text and all.
    if (trimmed === "" || capture.isPending) return;
    capture.mutate(
      { text: trimmed, provenance: { context: "other" } },
      { onSuccess: close }
    );
  };

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
          Unattached · {formatDateTime(openedAt)}
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
      {capture.isError && (
        <p className={styles.message} role="alert">
          {capture.error.message}
        </p>
      )}
    </form>
  );
}
