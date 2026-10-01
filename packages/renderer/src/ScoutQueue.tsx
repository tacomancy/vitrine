import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Card } from "core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { classifyLink, refusal } from "./link-rule";
import styles from "./ScoutQueue.module.css";
import { useTRPC } from "./trpc";

/**
 * The Scout Queue's tracer bullet (#448; brief § Scout Queue; spec #447):
 * the Scouts found as files, *Run now* beside each, and the Queue's one card
 * in hand with the one key that does anything to it, `A`. Nothing here
 * generates or guesses: a field the source did not supply is said to be
 * missing, and the card says *assigned to* because nothing has scored a
 * match. The rail, the form, the other keys and the Lanes are later tickets'.
 */
export function ScoutQueue() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const scouts = useQuery(trpc.scouts.list.queryOptions());
  const queue = useQuery(trpc.scouts.queue.queryOptions());
  const [said, setSaid] = useState<string | null>(null);
  const reread = () => queryClient.invalidateQueries(trpc.scouts.pathFilter());

  const run = useMutation(
    trpc.scouts.runNow.mutationOptions({
      onSuccess: (summary) => {
        setSaid(
          summary.outcome === "failed"
            ? `This run failed: ${summary.errorKind}.`
            : [
                `${summary.new} new`,
                ...(summary.held > 0
                  ? [`${summary.held} already in your vault`]
                  : []),
                ...(summary.truncated > 0
                  ? [`stopped at 500 — ${summary.truncated} more matched`]
                  : []),
              ].join(" · ")
        );
        void reread();
      },
      onError: (error) => setSaid(error.message),
    })
  );
  const accept = useMutation(
    trpc.scouts.accept.mutationOptions({
      onSuccess: (accepted) => {
        setSaid(
          accepted.held
            ? `Already in your vault: ${accepted.path}`
            : `Accepted into ${accepted.path}`
        );
        void reread();
      },
      onError: (error) => setSaid(error.message),
    })
  );

  const cards = queue.data ?? [];
  const card = cards[0];

  return (
    <section className={styles.surface} aria-label="Scout Queue">
      <header className={styles.header}>
        <h1 className={styles.title}>Scout Queue</h1>
        {card !== undefined && (
          <span className={styles.count}>card 1 of {cards.length}</span>
        )}
      </header>
      <ul className={styles.scouts} aria-label="Scouts">
        {(scouts.data?.scouts ?? []).map((scout) => (
          <li key={scout.id} className={styles.scout}>
            <span>{scout.name}</span>
            <button
              type="button"
              disabled={run.isPending}
              onClick={() => run.mutate({ scoutId: scout.id })}
            >
              Run now
            </button>
          </li>
        ))}
        {/* A file that does not parse is a Scout the researcher made, not one
            nobody did: named, with what is wrong. */}
        {(scouts.data?.unreadable ?? []).map((file) => (
          <li key={file.file} className={styles.scout}>
            <span>{file.file}</span>
            <span>{file.sentence}</span>
          </li>
        ))}
      </ul>
      {said !== null && (
        <p className={styles.line} role="status">
          {said}
        </p>
      )}
      {card !== undefined && (
        <Proposal
          key={card.id}
          card={card}
          onAccept={() => {
            if (!accept.isPending) accept.mutate({ proposalId: card.id });
          }}
        />
      )}
    </section>
  );
}

/** The card in hand. It takes the keyboard when it arrives, so `A` acts on what is on screen. */
function Proposal({ card, onAccept }: { card: Card; onAccept: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const [refused, setRefused] = useState<string | null>(null);
  const link = classifyLink(card.url);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      onAccept();
    }
  }

  return (
    <article
      ref={ref}
      className={styles.card}
      aria-label={card.title}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <p className={styles.why}>
        {card.scouts.map((scout) => scout.name).join(" · ")}
        {card.scouts.some((s) => s.assigned.length > 0) &&
          ` · assigned to ${card.scouts
            .flatMap((s) => s.assigned)
            .map((q) => q.name ?? q.id)
            .join(", ")}`}
        {card.retroactive && " · retroactive"}
      </p>
      <h2 className={styles.cardTitle}>{card.title}</h2>
      <dl className={styles.fields}>
        <Field label="authors" value={card.authors.join(", ") || null} />
        <Field label="published" value={card.published.slice(0, 10)} />
        <Field label="venue" value={card.venue} />
        <Field label="doi" value={card.doi} />
        <dt>link</dt>
        <dd>
          {link.kind === "refused" ? (
            <button
              type="button"
              className={styles.notLink}
              aria-label={`not a link: ${card.url}`}
              onClick={() => setRefused(refusal(link.scheme))}
            >
              {card.url}
            </button>
          ) : (
            <a href={link.href} target="_blank" rel="noreferrer">
              {card.url}
            </a>
          )}
        </dd>
      </dl>
      {refused !== null && <p role="status">{refused}</p>}
      <p className={styles.abstract}>{card.abstract}</p>
      <p className={styles.actions}>
        <kbd>A</kbd> accept
      </p>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value === null ? styles.missing : undefined}>
        {value ?? "missing"}
      </dd>
    </>
  );
}
