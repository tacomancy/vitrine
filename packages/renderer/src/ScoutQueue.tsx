import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Card, Fleet, Health } from "core";
import { useEffect, useRef, useState } from "react";
import { useChosenInView } from "./chosen";
import { classifyLink, refusal } from "./link-rule";
import { hashOf } from "./router";
import styles from "./ScoutQueue.module.css";
import { ScoutForm, type QuestionChoice } from "./ScoutForm";
import { VoiceLine } from "./ScoutVoice";
import { StatusGlyph } from "./StatusGlyph";
import { useTRPC } from "./trpc";

/**
 * The Scout Queue's Review lane (#450; brief § Scout Queue; spec #447): a
 * rail of Scouts that groups the stack, one card in hand with the rest
 * listed beneath it in order, and the keys. Nothing here generates or
 * guesses: a field the source did not supply is said to be missing, and the
 * card says *assigned to* because nothing has scored a match. The form
 * (#451) opens in the centre pane in place of the stack, and every short
 * place — a rail row, a Scout's header, an empty stack — speaks in one of
 * ADR 0032's three voices. Skim is a later ticket's.
 */
export function ScoutQueue() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const scouts = useQuery(trpc.scouts.list.queryOptions());
  const queue = useQuery(trpc.scouts.queue.queryOptions());
  const groups = useQuery(trpc.scouts.groups.queryOptions());
  const health = useQuery(trpc.scouts.health.queryOptions());
  const fleet = useQuery(trpc.scouts.fleet.queryOptions());
  const questionList = useQuery(
    trpc.questions.list.queryOptions({ order: "newest" })
  );
  // The form, or null for the stack. `edit` is the Scout's id when reopened.
  const [form, setForm] = useState<{ edit: string | null } | null>(null);
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
  const pause = useMutation(
    trpc.scouts.setPaused.mutationOptions({
      onSuccess: () => void reread(),
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
  const reject = useMutation({
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
  const group =
    selected === null
      ? {
          held: [
            ...new Map(
              (groups.data ?? []).flatMap((g) => g.held).map((h) => [h.path, h])
            ).values(),
          ],
          runId: null,
          runPending: 0,
        }
      : groups.data?.find((g) => g.id === selected);
  const runId = group?.runId ?? null;
  const groupName = scouts.data?.scouts.find((s) => s.id === selected)?.name;

  const railRows = [
    { id: null, name: "All Scouts" },
    ...(scouts.data?.scouts ?? []),
  ];
  const countFor = (id: string | null) =>
    id === null
      ? everything.length
      : everything.filter((c) => c.scouts.some((s) => s.id === id)).length;
  const healthOf = (id: string): Health | undefined =>
    health.data?.scouts.find((h) => h.id === id)?.health;
  const questions: QuestionChoice[] = (
    questionList.data?.questions ?? []
  ).flatMap((q) =>
    q.id === undefined
      ? []
      : [{ id: q.id, question: q.question, status: q.status }]
  );
  const selectedScout = scouts.data?.scouts.find((s) => s.id === selected);
  const editing =
    form?.edit == null
      ? undefined
      : scouts.data?.scouts.find((s) => s.id === form.edit);
  // What an empty stack says is a claim only when what it rests on has been
  // read: while the reads are in flight, or failed, it says nothing at all.
  const quiet: EmptyStackProps | null =
    !queue.isSuccess || !scouts.isSuccess || inGroup.length > 0
      ? null
      : selected !== null
        ? { kind: "scout", health: healthOf(selected) }
        : scouts.data.scouts.length === 0 && scouts.data.unreadable.length === 0
          ? { kind: "none" }
          : fleet.data === undefined
            ? null
            : {
                kind: "fleet",
                fleet: fleet.data,
                broken: [
                  ...fleet.data.broken.map((b) => ({
                    name: b.name,
                    sentence:
                      scouts.data.unreadable.find((u) => u.file === b.id)
                        ?.sentence ??
                      (() => {
                        const h = healthOf(b.id);
                        return h?.voice === "wrong" ? h.sentence : "";
                      })(),
                  })),
                ],
              };
  useChosenInView(`scout-rail-${selected ?? "all"}`);
  useChosenInView(card === undefined ? undefined : `scout-card-${card.id}`);

  function onPass(id: number) {
    setPassed((was) => [...was.filter((p) => p !== id), id]);
  }
  function onDecide(
    kind: "rejected" | "deferred",
    mutation: typeof reject,
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

  // ⌘Z lives here and not on the card: after the last card is rejected there
  // is no card, and that is exactly when undo is wanted.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]") !== null
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        onUndo();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <section className={styles.surface} aria-label="Scout Queue">
      <header className={styles.header}>
        <h1 className={styles.title}>Scout Queue</h1>
        {card !== undefined && form === null && (
          <span className={styles.count}>card 1 of {stack.length}</span>
        )}
        <button type="button" onClick={() => setForm({ edit: null })}>
          + New Scout
        </button>
      </header>
      <ul className={styles.scouts} aria-label="Scouts">
        {railRows.map((row) => (
          <li key={row.id ?? "all"} className={styles.scout}>
            <button
              type="button"
              id={`scout-rail-${row.id ?? "all"}`}
              className={styles.railRow}
              aria-current={row.id === selected ? "true" : undefined}
              onClick={() => {
                // A pass is a session fact about one stack; another group's
                // passes must not decide this one's order or its notice.
                setSelected(row.id);
                setPassed([]);
              }}
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
            {/* On the row as well as in the header, so a broken Scout cannot
                hide in a group nobody selects (spec #447 story 42). */}
            {row.id !== null && <VoiceLine health={healthOf(row.id)} />}
          </li>
        ))}
        {/* A file that does not parse is a Scout the researcher made, not one
            nobody did: named, with what is wrong. */}
        {(scouts.data?.unreadable ?? []).map((file) => (
          <li key={file.file} className={styles.scout}>
            <span>{file.file}</span>
            <VoiceLine
              health={{ voice: "wrong", kind: null, sentence: file.sentence }}
            />
          </li>
        ))}
      </ul>
      {selectedScout !== undefined && form === null && (
        <div className={styles.scoutHeader}>
          <h2 className={styles.scoutName}>{selectedScout.name}</h2>
          <VoiceLine health={healthOf(selectedScout.id)} />
          {selectedScout.assigned.length > 0 && (
            <ul className={styles.assigned} aria-label="Assigned Questions">
              {selectedScout.assigned.map((id) => {
                const q = questions.find((candidate) => candidate.id === id);
                // A closed Question gets no nag: it is drawn with its glyph
                // like any other and the Scout keeps running (story 23).
                return (
                  <li key={id}>
                    {q !== undefined && <StatusGlyph status={q.status} />}{" "}
                    {q?.question ?? id}
                  </li>
                );
              })}
            </ul>
          )}
          <p className={styles.actions}>
            <button
              type="button"
              onClick={() => setForm({ edit: selectedScout.id })}
            >
              Edit
            </button>{" "}
            <button
              type="button"
              disabled={pause.isPending}
              onClick={() =>
                pause.mutate({
                  scoutId: selectedScout.id,
                  paused: !selectedScout.paused,
                })
              }
            >
              {selectedScout.paused ? "Resume" : "Pause"}
            </button>
          </p>
        </div>
      )}
      {form !== null && (
        <ScoutForm
          key={form.edit ?? "new"}
          {...(editing === undefined ? {} : { scout: editing })}
          questions={questions}
          onDone={(saved) => {
            setForm(null);
            if (saved !== null) setSelected(saved);
          }}
        />
      )}
      {form === null && group !== undefined && (
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
          {runId !== null && group.runPending > 0 && (
            <button
              type="button"
              disabled={rejectRun.isPending}
              onClick={() => rejectRun.mutate({ runId })}
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
      {form === null && quiet !== null && <EmptyStack {...quiet} />}
      {form === null && passedThrough && (
        <p className={styles.line}>
          You have passed through every card{" "}
          {selected === null ? "here" : "in this group"}; they come round again.
        </p>
      )}
      {form === null && card !== undefined && (
        <Proposal
          key={card.id}
          card={card}
          onAccept={() => {
            if (!accept.isPending) accept.mutate({ proposalId: card.id });
          }}
          onPass={() => onPass(card.id)}
          onReject={() => onDecide("rejected", reject, card.id, card.title)}
          onDefer={() => onDecide("deferred", defer, card.id, card.title)}
        />
      )}
      {form === null && stack.length > 1 && (
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
}: {
  card: Card;
  onAccept: () => void;
  onPass: () => void;
  onReject: () => void;
  onDefer: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const [refused, setRefused] = useState<string | null>(null);
  const link = classifyLink(card.url);

  function onKeyDown(event: globalThis.KeyboardEvent) {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, [contenteditable]") !== null
    ) {
      return;
    }
    if (event.altKey) return;
    const key = event.key.toLowerCase();
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

  // Heard on the document, not only on the card: clicking the rail, *Undo* or
  // *Reject this run* moves focus off the card, and a key that then did
  // nothing would be a silent failure. A field being typed in keeps its keys.
  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });
  return (
    <article
      ref={ref}
      id={`scout-card-${card.id}`}
      className={styles.card}
      aria-label={card.title}
      tabIndex={0}
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

type EmptyStackProps =
  | { kind: "none" }
  | { kind: "scout"; health: Health | undefined }
  | {
      kind: "fleet";
      fleet: Fleet;
      broken: Array<{ name: string; sentence: string }>;
    };

/**
 * An empty Review stack in ADR 0032's three voices. Nothing here claims more
 * than the derivation did: no Scouts is *not yet*; one Scout claims only
 * after a clean run (anything else is the voice its header already speaks);
 * and *Review cleared* is the fleet's claim, warranted by who is looking and
 * when they last did, and withheld outright while any Scout is broken —
 * a clear stack must never read as a clear field when it is not.
 */
function EmptyStack(props: EmptyStackProps) {
  if (props.kind === "none") {
    return (
      <p className={styles.line} data-voice="not yet">
        no Scouts yet
      </p>
    );
  }
  if (props.kind === "scout") {
    return props.health?.voice === "claim" ? (
      <p className={styles.line}>Nothing pending.</p>
    ) : null;
  }
  const { fleet, broken } = props;
  if (broken.length > 0) {
    return (
      <ul className={styles.assigned} aria-label="Scouts that are broken">
        {broken.map((b) => (
          <li key={b.name}>
            <VoiceLine
              health={{
                voice: "wrong",
                kind: null,
                sentence: `${b.name}: ${b.sentence}`,
              }}
            />
          </li>
        ))}
      </ul>
    );
  }
  const notLooking = fleet.notLooking.length > 0 && (
    <> · not looking: {fleet.notLooking.map((n) => n.name).join(", ")}</>
  );
  if (fleet.watching === 0) {
    return (
      <p className={styles.line} data-voice="not yet">
        no Scout is looking{notLooking}
      </p>
    );
  }
  return (
    <div className={styles.line}>
      <p>Review cleared.</p>
      <p>
        {fleet.watching} {fleet.watching === 1 ? "scout" : "scouts"} watching ·
        all parsed cleanly
        {fleet.newestRun !== null && ` · newest run ${ago(fleet.newestRun)}`}
        {fleet.lastProposal !== null &&
          ` · last new proposal ${day(fleet.lastProposal)}`}
        {notLooking}
      </p>
    </div>
  );
}

function ago(at: string): string {
  const minutes = Math.floor(Math.max(Date.now() - Date.parse(at), 0) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// Fixed names, not a locale's: "Sep" is "Sept" in some, and the claim's text
// is the same on every machine.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const day = (at: string) => {
  const date = new Date(at);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};
