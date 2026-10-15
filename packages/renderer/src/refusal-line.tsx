import { useCallback, useState } from "react";

/**
 * A refusal is what the app says when it will not do something the user just
 * did (`CONTEXT.md` **Refusal**). It is drawn through this one module so that
 * the role and the repeat rule live in the callee and not in each caller that
 * must remember them (ADR 0033 decisions 5–6; `docs/architecture.md` § Research
 * Question view and triage, *A refusal is drawn through one module*).
 * Not `link-rule`'s `refusal`, which words a refused link.
 */
export type Refusal = {
  /** What was said, or null when nothing is on screen. */
  words: string | null;
  /** How many refusals have been said; a repeat of the same words still moves it. */
  count: number;
  /** Say a refusal: from a mutation's `onError`, or at once from a key or a click. */
  say: (words: string) => void;
  /** Forget the last one: call as the next act begins. */
  forget: () => void;
};

export function useRefusal(): Refusal {
  const [said, setSaid] = useState<{ words: string | null; count: number }>({
    words: null,
    count: 0,
  });
  const say = useCallback(
    (words: string) => setSaid((last) => ({ words, count: last.count + 1 })),
    []
  );
  const forget = useCallback(
    () => setSaid((last) => ({ ...last, words: null })),
    []
  );
  return { ...said, say, forget };
}

/**
 * The refusal as the user hears it: an `alert`, announced at once and not
 * politely (ADR 0033 decision 1), and keyed on the count so a refusal identical
 * to the last is a new element and is heard again, which setting the same text
 * into the node already on screen would not be (decision 6). It holds text and
 * takes no focus (decision 7). It adds no class of its own: its look is the
 * site's, passed in.
 */
export function RefusalLine({
  refusal,
  as: Tag = "p",
  className,
}: {
  refusal: Pick<Refusal, "words" | "count">;
  as?: "p" | "span";
  className?: string | undefined;
}) {
  if (refusal.words === null) return null;
  return (
    <Tag key={refusal.count} role="alert" className={className}>
      {refusal.words}
    </Tag>
  );
}
