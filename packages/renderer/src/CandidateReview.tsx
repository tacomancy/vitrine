import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CandidateLink, CandidateQuestion } from "core";
import { useEffect, useRef, useState } from "react";
import { useChosenInView } from "./chosen";
import styles from "./CandidateReview.module.css";
import { FirstSlot } from "./FirstSlot";
import { hashOf, pushRoute } from "./router";
import { useTRPC } from "./trpc";

/**
 * The inferred-link review (ADR 0041 decisions 9–10): one unanchored
 * Question at a time, the Scout Queue's grammar over (Question, paper)
 * pairs. Accept writes a Related edge through `questions.link` and nothing
 * else; open looks and decides nothing; pass records nothing — it only moves
 * the candidate to the bottom of this visit's stack, so leaving the page
 * forgets it. Reject is a later ticket's.
 *
 * The list is read once and held for the visit. An accept anchors its
 * Question, so a re-read would drop it from the list mid-review and jump the
 * panel to the next; the page's own cell fills on the next read instead.
 */
export function CandidateReview({
  request = null,
}: {
  /**
   * A row asking to be reviewed. It moves the review to that Question and
   * nothing else: no count starts, and *next question* still follows the
   * review's own order from there (ADR 0041 decision 10).
   */
  request?: { path: string } | null;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // Never served from a cache: a list left by an earlier visit would still
  // hold Questions anchored since, and the visit's snapshot is taken once.
  const read = useQuery({
    ...trpc.questionMap.candidates.queryOptions(),
    gcTime: 0,
  });
  const [session, setSession] = useState<CandidateQuestion[] | null>(null);
  if (session === null && read.data !== undefined) setSession(read.data);

  // Per Question, nothing more than what this visit did: a Question left for
  // the next is not returned to, so there is nothing to carry across.
  const [at, setAt] = useState(0);
  const [question, setQuestion] = useState(0);
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [passed, setPassed] = useState<readonly string[]>([]);
  const [refused, setRefused] = useState<string | null>(null);

  const link = useMutation(
    trpc.questions.link.mutationOptions({
      onSuccess: (_reply, input) => {
        setDecided((was) => new Set(was).add(input.target));
        void queryClient.invalidateQueries(
          trpc.questionMap.coverage.pathFilter()
        );
      },
      onError: (error) => setRefused(error.message),
    })
  );

  // Adjusted during render, not in an effect: a request is handled once,
  // the render it arrives in, and its object identity is what says "again".
  const [handled, setHandled] = useState<{ path: string } | null>(null);
  const asked = session?.findIndex((q) => q.path === request?.path) ?? -1;
  if (request !== handled && session !== null) {
    setHandled(request);
    if (asked !== -1) {
      setQuestion(asked);
      setAt(0);
      setDecided(new Set());
      setPassed([]);
      setRefused(null);
    }
  }
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (request !== null && asked !== -1)
      section.current?.scrollIntoView?.({ block: "nearest" });
    // Keyed on the request alone: `asked` moves as the session loads, and a
    // scroll then would be one nobody asked for.
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = session?.[question];
  // Fresh candidates in their ranked order, then the passed ones in the order
  // they were passed: a pass is a *not now*, so it goes to the back.
  const stack: CandidateLink[] =
    current === undefined
      ? []
      : [
          ...current.candidates.filter(
            (c) => !decided.has(c.path) && !passed.includes(c.path)
          ),
          ...passed.flatMap((path) =>
            current.candidates.filter(
              (c) => c.path === path && !decided.has(c.path)
            )
          ),
        ];
  const focus = Math.min(at, Math.max(stack.length - 1, 0));
  const focused = stack[focus];
  const rowId = (i: number) => `candidate-${question}-${i}`;
  useChosenInView(focused === undefined ? undefined : rowId(focus));

  const settled = stack.every((c) => passed.includes(c.path));
  const hasNext = session !== null && question < session.length - 1;

  function accept() {
    if (current === undefined || focused === undefined || link.isPending)
      return;
    setRefused(null);
    link.mutate({ path: current.path, target: focused.path });
  }
  function pass() {
    if (focused === undefined) return;
    setPassed((was) => [
      ...was.filter((p) => p !== focused.path),
      focused.path,
    ]);
  }
  function open() {
    if (focused === undefined) return;
    pushRoute({ surface: "source", path: focused.path });
  }
  function next() {
    setQuestion((q) => q + 1);
    setAt(0);
    setDecided(new Set());
    setPassed([]);
    setRefused(null);
  }

  // Heard on the document so a click elsewhere on the page never leaves a key
  // doing nothing; a field being typed in keeps its keys.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]") !== null
      ) {
        return;
      }
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        setAt(
          Math.min(
            Math.max(focus + (key === "j" ? 1 : -1), 0),
            stack.length - 1
          )
        );
      } else if (key === "a") {
        event.preventDefault();
        accept();
      } else if (key === "p") {
        event.preventDefault();
        pass();
      } else if (key === "o") {
        event.preventDefault();
        open();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  if (session === null) return null;
  if (session.length === 0) {
    return (
      <section aria-label="Candidate links">
        <FirstSlot voice="claim" claim="No candidate links to offer.">
          A paper is offered to an unanchored question only when the two share a
          Tag.
        </FirstSlot>
      </section>
    );
  }
  if (current === undefined) return null;

  return (
    <section
      ref={section}
      className={styles.review}
      aria-label="Candidate links"
    >
      <h2 className={styles.question}>
        <a href={hashOf({ surface: "inbox", question: current.path })}>
          {current.question}
        </a>
      </h2>
      <ul
        role="listbox"
        aria-label="Papers sharing a Tag with this question"
        aria-activedescendant={focused === undefined ? undefined : rowId(focus)}
        className={styles.list}
      >
        {stack.map((c, i) => (
          <li
            key={c.path}
            id={rowId(i)}
            role="option"
            aria-selected={i === focus}
            className={styles.row}
            data-chosen={i === focus}
            onClick={() => setAt(i)}
          >
            <span className={styles.paper}>{c.display}</span>
            <span className={styles.why}>shares {c.shared.join(" · ")}</span>
          </li>
        ))}
      </ul>
      <p className={styles.keys} aria-hidden="true">
        <kbd>A</kbd> link as related · <kbd>O</kbd> open · <kbd>P</kbd> pass
      </p>
      {refused !== null && (
        <p role="alert" className={styles.refused}>
          {refused}
        </p>
      )}
      {settled && hasNext && (
        <button type="button" className={styles.next} onClick={next}>
          next question
        </button>
      )}
    </section>
  );
}
