import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Card } from "core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useChosenInView } from "./chosen";
import { classifyLink, refusal } from "./link-rule";
import { hashOf } from "./router";
import styles from "./ScoutQueue.module.css";
import { useTRPC } from "./trpc";

/**
 * The Scout Queue's Review lane (#450; brief § Scout Queue; spec #447): a
 * rail of Scouts that groups the stack, one card in hand with the rest
 * listed beneath it in order, and the keys. Nothing here generates or
 * guesses: a field the source did not supply is said to be missing, and the
 * card says *assigned to* because nothing has scored a match. The form, Skim
 * and the rail's voices are later tickets'.
 */
export function ScoutQueue() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const scouts = useQuery(trpc.scouts.list.queryOptions());
  const queue = useQuery(trpc.scouts.queue.queryOptions());
  const groups = useQuery(trpc.scouts.groups.queryOptions());
  const [said, setSaid] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Cards passed this session, oldest pass first. A pass records nothing
  // (ADR 0039 decision 6), so this lives here and the next open is
  // newest-first again.
  const [passed, setPassed] = useState<number[]>([]);
  // Rejects and defers made this session that can still be taken back
  // (ADR 0016's update of 2026-09-26); accept is never on it.
  const [undoable, setUndoable] = useState<
    Array<{ id: number; title: string; action: "rejected" | "deferred" }>
  >([]);
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
  const decide = useMutation({
    ...trpc.scouts.reject.mutationOptions(),
    onError: (error) => setSaid(error.message),
  });
  const defer = useMutation({
    ...trpc.scouts.defer.mutationOptions(),
    onError: (error) => setSaid(error.message),
  });
  const undo = useMutation(
    trpc.scouts.undo.mutationOptions({
      onError: (error) => setSaid(error.message),
    })
  );
  const rejectRun = useMutation(
    trpc.scouts.rejectRun.mutationOptions({
      onSuccess: ({ rejected }) => {
        setSaid(`Rejected ${rejected} from this run.`);
        void reread();
      },
      onError: (error) => setSaid(error.message),
    })
  );

  const everything = queue.data ?? [];
  const inGroup = everything.filter(
    (card) =>
      selected === null || card.scouts.some((scout) => scout.id === selected)
  );
  // The session's order: what has not been passed, then what has, in the
  // order it was passed — so passing the last card wraps to the first.
  const stack = [
    ...inGroup.filter((card) => !passed.includes(card.id)),
    ...passed.flatMap((id) => inGroup.filter((card) => card.id === id)),
  ];
  const card = stack[0];
  const passedThrough =
    inGroup.length > 0 && inGroup.every((c) => passed.includes(c.id));
  const group = groups.data?.find((g) => g.id === selected);
  const groupName = scouts.data?.scouts.find((s) => s.id === selected)?.name;

  const railRows = [
    { id: null, name: "All Scouts" },
    ...(scouts.data?.scouts ?? []),
  ];
  const countFor = (id: string | null) =>
    id === null
      ? everything.length
      : everything.filter((c) => c.scouts.some((s) => s.id === id)).length;
  useChosenInView(`scout-rail-${selected ?? "all"}`);
  useChosenInView(card === undefined ? undefined : `scout-card-${card.id}`);

  function onPass(id: number) {
    setPassed((was) => [...was.filter((p) => p !== id), id]);
  }
  function onDecide(
    kind: "rejected" | "deferred",
    mutation: typeof decide,
    id: number,
    title: string
  ) {
    mutation.mutate(
      { proposalId: id },
      {
        onSuccess: () => {
          setUndoable((was) => [...was, { id, title, action: kind }]);
          setSaid(
            kind === "rejected"
              ? `Rejected “${title}”.`
              : `Deferred “${title}” until the next run.`
          );
          void reread();
        },
      }
    );
  }
  const last = undoable.at(-1);
  function onUndo() {
    if (last === undefined || undo.isPending) return;
    undo.mutate(
      { proposalId: last.id },
      {
        onSuccess: () => {
          setUndoable((was) => was.slice(0, -1));
          setSaid(`Put “${last.title}” back.`);
          void reread();
        },
      }
    );
  }

  return (
    <section className={styles.surface} aria-label="Scout Queue">
      <header className={styles.header}>
        <h1 className={styles.title}>Scout Queue</h1>
        {card !== undefined && (
          <span className={styles.count}>card 1 of {stack.length}</span>
        )}
      </header>
      <ul className={styles.scouts} aria-label="Scouts">
        {railRows.map((row) => (
          <li key={row.id ?? "all"} className={styles.scout}>
            <button
              type="button"
              id={`scout-rail-${row.id ?? "all"}`}
              className={styles.railRow}
              aria-current={row.id === selected ? "true" : undefined}
              onClick={() => setSelected(row.id)}
            >
              <span>{row.name}</span>
              <span className={styles.count}>{countFor(row.id)}</span>
            </button>
            {row.id !== null && (
              <button
                type="button"
                disabled={run.isPending}
                onClick={() => run.mutate({ scoutId: row.id })}
              >
                Run now
              </button>
            )}
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
      {group !== undefined && (
        <div className={styles.group}>
          {group.held.length > 0 && (
            <div>
              <p className={styles.line}>
                {group.held.length} already in your vault
              </p>
              <ul
                className={styles.heldList}
                aria-label="Already in your vault"
              >
                {group.held.map((held) => (
                  <li key={held.path}>
                    <a href={hashOf({ surface: "source", path: held.path })}>
                      {held.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {group.runId !== null && group.runPending > 0 && (
            <button
              type="button"
              disabled={rejectRun.isPending}
              onClick={() => rejectRun.mutate({ runId: group.runId! })}
            >
              Reject this run{groupName !== undefined && ` of ${groupName}`} (
              {group.runPending})
            </button>
          )}
        </div>
      )}
      {said !== null && (
        <p className={styles.line} role="status">
          {said}
        </p>
      )}
      {last !== undefined && (
        <p className={styles.line}>
          <button type="button" onClick={onUndo}>
            Undo {last.action === "rejected" ? "reject" : "defer"}
          </button>{" "}
          <kbd>⌘Z</kbd>
        </p>
      )}
      {passedThrough && (
        <p className={styles.line}>
          You have passed through every card{" "}
          {selected === null ? "here" : "in this group"}; they come round again.
        </p>
      )}
      {card !== undefined && (
        <Proposal
          key={card.id}
          card={card}
          onAccept={() => {
            if (!accept.isPending) accept.mutate({ proposalId: card.id });
          }}
          onPass={() => onPass(card.id)}
          onReject={() => onDecide("rejected", decide, card.id, card.title)}
          onDefer={() => onDecide("deferred", defer, card.id, card.title)}
          onUndo={onUndo}
        />
      )}
      {stack.length > 1 && (
        <ol className={styles.rest} aria-label="Next in the stack">
          {stack.slice(1).map((next) => (
            <li key={next.id} id={`scout-card-${next.id}`}>
              {next.title}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The card in hand. It takes the keyboard when it arrives, so a key acts on what is on screen. */
function Proposal({
  card,
  onAccept,
  onPass,
  onReject,
  onDefer,
  onUndo,
}: {
  card: Card;
  onAccept: () => void;
  onPass: () => void;
  onReject: () => void;
  onDefer: () => void;
  onUndo: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const [refused, setRefused] = useState<string | null>(null);
  const link = classifyLink(card.url);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "z") {
      event.preventDefault();
      onUndo();
      return;
    }
    if (event.metaKey || event.ctrlKey) return;
    const act = { a: onAccept, p: onPass, r: onReject, d: onDefer }[key];
    if (act !== undefined) {
      event.preventDefault();
      act();
    } else if (key === "o") {
      event.preventDefault();
      // Looking records nothing; a link the rule refuses says which scheme it
      // had instead of doing nothing (§ Invariants, no silent failures).
      if (link.kind === "refused") setRefused(refusal(link.scheme));
      else window.open(link.href, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <article
      ref={ref}
      id={`scout-card-${card.id}`}
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
        <kbd>A</kbd> accept · <kbd>O</kbd> open · <kbd>P</kbd> pass ·{" "}
        <kbd>R</kbd> reject · <kbd>D</kbd> defer
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
