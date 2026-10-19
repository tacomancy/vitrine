import { useMutation, useQuery } from "@tanstack/react-query";
import type { Card, MuteRule, MutedItem } from "core";
import { useEffect, useState } from "react";
import styles from "./ScoutQueue.module.css";
import { useTRPC } from "./trpc";

/** A rule in words, the same way wherever it is named. */
export const ruleWords = (rule: MuteRule) => `${rule.kind} “${rule.value}”`;

const pendingItems = (count: number) =>
  count === 0
    ? "no pending items"
    : `${count} pending ${count === 1 ? "item" : "items"}`;

/**
 * `M` on a card (ADR 0044 decision 4): the rules the card offers — each of its
 * authors, its venue if it has one, a keyword typed in — and, once one is
 * chosen, how many pending items saving it would hold. Nothing is written
 * until *Save rule*; the core owns what a rule catches, so the count is asked
 * and never worked out here.
 */
export function MuteOffer({
  card,
  onSaved,
  onCancel,
  onRefused,
}: {
  card: Card;
  onSaved: (rule: MuteRule) => void;
  onCancel: () => void;
  onRefused: (error: { message: string }) => void;
}) {
  const trpc = useTRPC();
  const [choice, setChoice] = useState<MuteRule | null>(null);
  const [keyword, setKeyword] = useState("");
  const reach = useQuery({
    ...trpc.scouts.muteReach.queryOptions(
      choice ?? { kind: "keyword", value: "" }
    ),
    enabled: choice !== null,
  });
  const save = useMutation(
    trpc.scouts.mute.mutationOptions({
      onSuccess: (_done, rule) => onSaved(rule),
      onError: onRefused,
    })
  );

  // Heard on the document so that Escape leaves the offer however focus moved.
  // Re-bound each render because `onCancel` is a fresh closure each time.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div
      role="group"
      aria-label="Mute"
      className={styles.card}
      aria-describedby="mute-title"
    >
      <p id="mute-title" className={styles.why}>
        Mute rule for “{card.title}”
      </p>
      {choice === null ? (
        <>
          <p className={styles.actions}>
            {card.authors.map((name) => (
              <button
                key={name}
                type="button"
                aria-label={`Mute author ${name}`}
                onClick={() => setChoice({ kind: "author", value: name })}
              >
                Mute author {name}
              </button>
            ))}
            {card.venue !== null && (
              <button
                type="button"
                aria-label={`Mute venue ${card.venue}`}
                onClick={() => setChoice({ kind: "venue", value: card.venue! })}
              >
                Mute venue {card.venue}
              </button>
            )}
          </p>
          <p className={styles.actions}>
            <input
              type="text"
              aria-label="Keyword"
              placeholder="a word in the title or abstract"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />{" "}
            <button
              type="button"
              disabled={keyword.trim() === ""}
              onClick={() =>
                setChoice({ kind: "keyword", value: keyword.trim() })
              }
            >
              Mute keyword
            </button>
          </p>
        </>
      ) : (
        <>
          <p className={styles.line}>
            Mute {ruleWords(choice)}.{" "}
            {reach.isSuccess
              ? `Saving it would mute ${pendingItems(reach.data.count)}.`
              : reach.isError
                ? `Could not count what it would catch: ${reach.error.message}`
                : "Counting what it would catch…"}
          </p>
          <p className={styles.actions}>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate(choice)}
            >
              Save rule
            </button>{" "}
            <button type="button" onClick={() => setChoice(null)}>
              Back
            </button>
          </p>
        </>
      )}
      <p className={styles.actions}>
        <kbd>Esc</kbd> cancel
      </p>
    </div>
  );
}

/**
 * Everything a rule holds, each item with the rule that holds it, and a way to
 * delete a rule, which hands everything it held back (ADR 0044 decision 4).
 * A muted item is not rejected: nothing here is a verdict.
 */
export function MutedView({
  rules,
  items,
  onDelete,
  deleting,
}: {
  rules: MuteRule[];
  items: MutedItem[];
  onDelete: (rule: MuteRule) => void;
  deleting: boolean;
}) {
  return (
    <div className={styles.group}>
      {items.length === 0 ? (
        <p className={styles.line}>Nothing is muted.</p>
      ) : (
        <ul aria-label="Muted">
          {items.map((item) => (
            <li key={item.id}>
              {item.title} — {item.lane === "skim" ? "Skim · " : ""}
              {item.state === "deferred" ? "deferred · " : ""}held by{" "}
              {ruleWords(item.rule)}
            </li>
          ))}
        </ul>
      )}
      {rules.length > 0 && (
        <ul aria-label="Mute rules">
          {rules.map((rule) => (
            <li key={`${rule.kind}:${rule.value}`}>
              {ruleWords(rule)}{" "}
              <button
                type="button"
                disabled={deleting}
                aria-label={`Delete rule ${ruleWords(rule)}`}
                onClick={() => onDelete(rule)}
              >
                Delete rule
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
