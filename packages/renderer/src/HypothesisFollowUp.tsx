import { useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import { useCapture } from "./capture";
import styles from "./Hypothesis.module.css";
import { useTRPC } from "./trpc";

/**
 * The follow-up question (#339; spec #327 stories 71, 72, 74; CAP-5): a
 * "no" should become the next thing wondered at once, so whenever the
 * result is closable the page holds a capture line under it — prototype
 * 04's *capture what it raises*. It is the one capture path the two chords
 * share (`useCapture`), with `resolving` Provenance naming this page, so
 * what it writes is the same kind of Question in the same Inbox as any
 * other capture. It is offered whether or not there is a parent to write
 * the result back to: a hand-made Hypothesis still raises questions.
 *
 * Nothing is appended to the page. The Question joins the related rail
 * because its `from:` names the page, which is why the rail is refetched.
 */
export function FollowUp({ path }: { path: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const capture = useCapture();
  const [text, setText] = useState("");

  const submit = () =>
    capture.write(text, { context: "resolving", hypothesis: path }, () => {
      setText("");
      void queryClient.invalidateQueries(trpc.hypotheses.page.pathFilter());
      void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
    });

  // The field is never disabled for the wait, as the capture line's is
  // not: a refused write leaves the text where it was, with the reason.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape" && text !== "") {
      event.preventDefault();
      setText("");
      capture.reset();
    }
  };

  return (
    <section className={styles.followUp} aria-label="The follow-up">
      <h3 className={styles.followUpLabel}>Capture what it raises</h3>
      <div className={styles.followUpRow}>
        <span className={styles.followUpGlyph} aria-hidden="true">
          ?
        </span>
        <input
          className={styles.followUpInput}
          type="text"
          aria-label="Follow-up question"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className={styles.followUpHint}>↵ capture</span>
      </div>
      <p className={styles.offerNote}>
        lands in the Inbox as a question, with this hypothesis as where it came
        from
      </p>
      {capture.error !== null && (
        <p className={styles.followUpError} role="alert">
          {capture.error.message}
        </p>
      )}
    </section>
  );
}
