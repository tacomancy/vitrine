import { useMutation, useQuery } from "@tanstack/react-query";
import type { Card, MuteRule, MutedItem } from "core";
import { useEffect, useState, type FormEvent } from "react";
import {
  ActionRow,
  Button,
  FieldRow,
  FormSection,
  Input,
  SegmentedRow,
  Unlocks,
} from "./Form";
import styles from "./ScoutQueue.module.css";
import { useTRPC } from "./trpc";

/** A rule in words, the same way wherever it is named; one that matches by an OpenAlex ID says so. */
export const ruleWords = (rule: MuteRule) =>
  `${rule.kind} “${rule.value}”${rule.id === undefined ? "" : ` (by ID ${rule.id})`}`;

/** OpenAlex does not always name a publisher; its ID is then the name. */
const publisherName = (publisher: NonNullable<Card["publisher"]>) =>
  publisher.name ?? publisher.id;

const pendingItems = (count: number) =>
  count === 0
    ? "no pending items"
    : `${count} pending ${count === 1 ? "item" : "items"}`;

/**
 * A chosen rule, how many pending items saving it would hold, and the save.
 * Nothing is written until *Save rule*; the core owns what a rule catches, so
 * the count is asked and never worked out here.
 */
function RuleConfirm({
  rule,
  onSaved,
  onBack,
  onRefused,
}: {
  rule: MuteRule;
  onSaved: (rule: MuteRule) => void;
  onBack: () => void;
  onRefused: (error: { message: string }) => void;
}) {
  const trpc = useTRPC();
  const reach = useQuery(trpc.scouts.muteReach.queryOptions(rule));
  const save = useMutation(
    trpc.scouts.mute.mutationOptions({
      onSuccess: (_done, saved) => onSaved(saved),
      onError: onRefused,
    })
  );
  return (
    <>
      <p className={styles.line}>
        Mute {ruleWords(rule)}.{" "}
        {reach.isSuccess
          ? `Saving it would mute ${pendingItems(reach.data.count)}.`
          : reach.isError
            ? `Could not count what it would catch: ${reach.error.message}`
            : "Counting what it would catch…"}
      </p>
      <p className={styles.actions}>
        <Button
          tier="primary"
          disabled={save.isPending}
          onClick={() => save.mutate(rule)}
        >
          Save rule
        </Button>{" "}
        <Button onClick={onBack}>Back</Button>
      </p>
    </>
  );
}

/**
 * `M` on a card (ADR 0044 decision 4): the rules the card offers — each of its
 * authors, its venue if it has one, its publisher if it has one, a keyword
 * typed in — and, once one is
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
  const [choice, setChoice] = useState<MuteRule | null>(null);
  const [keyword, setKeyword] = useState("");

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
              <Button
                key={name}
                aria-label={`Mute author ${name}`}
                onClick={() => setChoice({ kind: "author", value: name })}
              >
                Mute author {name}
              </Button>
            ))}
            {card.venue !== null && (
              <Button
                aria-label={`Mute venue ${card.venue}`}
                onClick={() =>
                  setChoice({
                    kind: "venue",
                    value: card.venue!,
                    // The name stays beside the ID so the rule reads back in words;
                    // with an ID the rule survives the venue being spelled another way.
                    ...(card.venueId === null ? {} : { id: card.venueId }),
                  })
                }
              >
                Mute venue {card.venue}
              </Button>
            )}
            {card.publisher !== null && (
              <button
                type="button"
                aria-label={`Mute publisher ${publisherName(card.publisher)}`}
                onClick={() =>
                  setChoice({
                    kind: "publisher",
                    value: publisherName(card.publisher!),
                    id: card.publisher!.id,
                  })
                }
              >
                Mute publisher {publisherName(card.publisher)}
              </button>
            )}
          </p>
          <p className={styles.actions}>
            <Input
              type="text"
              aria-label="Keyword"
              placeholder="a word in the title or abstract"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />{" "}
            <Button
              disabled={keyword.trim() === ""}
              onClick={() =>
                setChoice({ kind: "keyword", value: keyword.trim() })
              }
            >
              Mute keyword
            </Button>
          </p>
        </>
      ) : (
        <RuleConfirm
          rule={choice}
          onSaved={onSaved}
          onBack={() => setChoice(null)}
          onRefused={onRefused}
        />
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
            <li key={`${rule.kind}:${rule.id ?? rule.value}`}>
              {ruleWords(rule)}{" "}
              <Button
                disabled={deleting}
                aria-label={`Delete rule ${ruleWords(rule)}`}
                onClick={() => onDelete(rule)}
              >
                Delete rule
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A venue or publisher added by searching OpenAlex for its name (ADR 0051
 * decision 9). The search runs on an explicit press or enter and never as the
 * name is typed, since each costs 10 of a daily budget shared with others. A
 * result carries its publisher, ISSN and works count so near-identical names
 * can be told apart, and the rule keeps its ID beside its name. A failed or
 * spent search is said in the fault's own sentence: it must not read as a
 * search that found nothing.
 */
export function MuteByName({
  onSaved,
  onRefused,
}: {
  onSaved: (rule: MuteRule) => void;
  onRefused: (error: { message: string }) => void;
}) {
  const trpc = useTRPC();
  const [kind, setKind] = useState<"venue" | "publisher">("venue");
  const [name, setName] = useState("");
  const [choice, setChoice] = useState<MuteRule | null>(null);
  const search = useMutation(trpc.scouts.searchNames.mutationOptions());
  const ready = name.trim() !== "";
  // The kind the results answer, which may differ from the one now selected.
  const answered = search.variables?.kind;
  const found = search.data?.outcome === "found" ? search.data : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || search.isPending) return;
    setChoice(null);
    search.mutate({ kind, name });
  }

  return (
    <form onSubmit={submit}>
      <FormSection title="Mute by name">
        <SegmentedRow
          label="Mute a"
          value={kind}
          onChange={setKind}
          options={[
            { value: "venue", label: "Venue" },
            { value: "publisher", label: "Publisher" },
          ]}
        />
        <FieldRow
          label="Name"
          note="Searches OpenAlex when you press Search, not as you type. Each search spends 10 of the day's shared credits."
        >
          {(field) => (
            <Input
              {...field}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </FieldRow>
        <ActionRow>
          <Button tier="primary" disabled={!ready || search.isPending}>
            Search
          </Button>
          {!ready && <Unlocks>Search needs a name.</Unlocks>}
        </ActionRow>
        {search.isError && (
          <p className={styles.line} role="alert">
            {search.error.message}
          </p>
        )}
        {search.data?.outcome === "failed" && (
          <p className={styles.line} role="alert">
            {search.data.sentence}
          </p>
        )}
        {found !== null && (
          <>
            {found.results.length === 0 ? (
              <p className={styles.line}>
                No {answered === "publisher" ? "publishers" : "venues"} found.
              </p>
            ) : (
              <ul aria-label="Results">
                {found.results.map((result) => (
                  <li key={result.id}>
                    {result.name} —{" "}
                    {[
                      result.publisher,
                      result.issn === null ? null : `ISSN ${result.issn}`,
                      `${result.worksCount.toLocaleString("en-US")} works`,
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}{" "}
                    <Button
                      aria-label={`Mute ${result.name}${result.publisher === null ? "" : ` (${result.publisher})`}`}
                      onClick={() =>
                        setChoice({
                          kind: answered ?? kind,
                          value: result.name,
                          id: result.id,
                        })
                      }
                    >
                      Mute
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {found.creditsLeft !== null && (
              <p className={styles.line}>
                {found.creditsLeft.toLocaleString("en-US")} credits left today.
              </p>
            )}
          </>
        )}
        {choice !== null && (
          <RuleConfirm
            rule={choice}
            onSaved={(rule) => {
              setChoice(null);
              onSaved(rule);
            }}
            onBack={() => setChoice(null)}
            onRefused={onRefused}
          />
        )}
      </FormSection>
    </form>
  );
}
