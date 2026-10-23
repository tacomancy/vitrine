import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AcceptRate,
  Card,
  Health,
  LaneMove,
  MuteRule,
  QueueSort,
  RankSignal,
} from "core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { questionChoices } from "./AssignedQuestions";
import { useChosenInView } from "./chosen";
import { FirstSlot } from "./FirstSlot";
import { MuteByName, MutedView, MuteOffer, ruleWords } from "./MuteRules";
import { classifyLink, refusal as linkRefusal } from "./link-rule";
import { RefusalLine, useRefusal } from "./refusal-line";
import { hashOf } from "./router";
import { runWords } from "./run-words";
import styles from "./ScoutQueue.module.css";
import { Button, SegmentedControl } from "./Form";
import { ScoutForm, type ScoutDraft } from "./ScoutForm";
import { CostLine, DROPPED, NOTHING_PENDING, VoiceLine } from "./ScoutVoice";
import { percent } from "./charts/line";
import { StatusGlyph } from "./StatusGlyph";
import { useTRPC } from "./trpc";
import { WarningLine } from "./VaultStatusLines";

// Not a slug, so it cannot be a real Question's id.
const UNASSIGNED = "(unassigned)";

// Review's sort lasts the session and no longer: held outside the component
// because leaving the surface unmounts it (ADR 0044 decision 2).
const sessionSort = (() => {
  let sort: QueueSort = "rank";
  return { get: () => sort, set: (next: QueueSort) => void (sort = next) };
})();

const clamp = (at: number, length: number) =>
  Math.min(Math.max(at, 0), length - 1);

/** A fired Rank signal in words; a card with none says nothing (ADR 0044). */
function signalWords(signal: RankSignal): string {
  switch (signal.kind) {
    case "authors":
      return `by ${signal.names.join(", ")}, whose work you have accepted`;
    case "corroboration":
      return `found by ${signal.scouts} Scouts`;
    case "questions":
      return `assigned to ${signal.count} ${signal.count === 1 ? "Question" : "Questions"}`;
  }
}

/** Why the counterweight slot's card sits second: the label is the reason (ADR 0044 decision 7). */
const OUTSIDE_THE_USUAL = "outside the usual";

/** Why a card is not in the Lane its Scout put it in (ADR 0044 decision 8). */
function movedWords(moved: LaneMove): string {
  return moved.kind === "demoted"
    ? "moved to Skim after three defers"
    : `raised — also found by ${moved.by.name}`;
}

/**
 * The Scout Queue's Review lane (#450; brief § Scout Queue; spec #447): a
 * rail of Scouts that groups the stack, one card in hand with the rest
 * listed beneath it in order, and the keys. Nothing here generates or
 * guesses: a field the source did not supply is said to be missing, and the
 * card says *assigned to* because nothing has scored a match. Skim (#452) is
 * the second lane: single lines with nothing to clear, offering `A`, `O` and
 * `T` (to Review) and no reject, defer or pass. The form (#451) opens in the
 * centre pane in place of the stack, and every short place — a rail row, a
 * Scout's header, an empty stack — speaks in one of ADR 0032's three voices.
 */
export function ScoutQueue({
  form,
  setForm,
  scout,
  mutedOpen: arrivedOnMuted = false,
  skimOpen: arrivedOnSkim = false,
}: {
  form: ScoutDraft | null;
  setForm: (form: ScoutDraft | null) => void;
  /** Arrived from Scout Activity's *N muted*: the muted view starts open, and the button closes it as it would any other time. */
  mutedOpen?: boolean | undefined;
  /** Arrived from Home's Skim line: the Skim lane starts chosen, and the lane buttons move off it as they would any other time. */
  skimOpen?: boolean | undefined;
  /** The Scout whose stack the window arrived on (Scout Activity's row link); the rail's own choice takes over from there. */
  scout?: string | undefined;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const scouts = useQuery(trpc.scouts.list.queryOptions());
  const [sort, setSortState] = useState<QueueSort>(sessionSort.get);
  const setSort = (next: QueueSort) => {
    sessionSort.set(next);
    setSortState(next);
  };
  const queue = useQuery(trpc.scouts.queue.queryOptions({ sort }));
  const groups = useQuery(trpc.scouts.groups.queryOptions());
  // *Group by Question* (ADR 0044 decision 10): Scout is the default, and the
  // Question view is Review's alone. The core says which cards each group holds.
  const [groupBy, setGroupBy] = useState<"scout" | "question">("scout");
  const questionGroups = useQuery({
    ...trpc.scouts.questionGroups.queryOptions(),
    enabled: groupBy === "question",
  });
  const [lane, setLane] = useState<"review" | "skim">(
    arrivedOnSkim ? "skim" : "review"
  );
  const byQuestion = groupBy === "question" && lane === "review";
  // Read in both lanes: the Skim tab counts what it holds.
  const skim = useQuery(trpc.scouts.skim.queryOptions());
  const fleet = useQuery(trpc.scouts.fleet.queryOptions());
  const health = useQuery(trpc.scouts.health.queryOptions());
  const muted = useQuery(trpc.scouts.muted.queryOptions());
  const questionList = useQuery(
    trpc.questions.list.queryOptions({ order: "newest" })
  );
  // The form, or null for the stack. Held by the window and not here: *Add a
  // key* leaves for Settings, and this surface unmounts on the way.
  const [lineChosen, setLineChosen] = useState<number | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  // The card a mute rule is being offered for, and whether the muted view has
  // taken the place of the stack (ADR 0044 decision 4).
  const [muting, setMuting] = useState<Card | null>(null);
  const [mutedOpen, setMutedOpen] = useState(arrivedOnMuted);
  const [byNameOpen, setByNameOpen] = useState(false);
  // The one line holds the latest thing that happened, of two kinds that are
  // heard differently: what was done is `said`, a polite status; what the core
  // turned down is `refusal`, an alert (ADR 0033 decision 1 and its 2026-10-15
  // Update). Saying one forgets the other, so the line never holds both.
  const [said, setSaid] = useState<string | null>(null);
  const refusal = useRefusal();
  const acknowledge = (words: string) => {
    refusal.forget();
    setSaid(words);
  };
  const refuse = (error: { message: string }) => {
    setSaid(null);
    refusal.say(error.message);
  };
  // An act's options: a refusal is forgotten as the next act begins, so one
  // left on screen is never read as the answer to the retry (decision 6).
  const acts = {
    // Returns undefined: the mutation options type will not take a void context.
    onMutate: () => {
      refusal.forget();
      return undefined;
    },
    onError: refuse,
  };
  const [selected, setSelected] = useState<string | null>(scout ?? null);
  // The Question group on screen: a Question id, `UNASSIGNED`, or null for all.
  const [pickedQuestion, setSelectedQuestion] = useState<string | null>(null);
  // Cards passed this session, oldest pass first. A pass records nothing
  // (ADR 0039 decision 6), so this lives here and the next open is
  // newest-first again.
  const [passed, setPassed] = useState<number[]>([]);
  // The Proposal in the detail, by id: it follows a click and J/K, and falls
  // back to the head of the order when its card has left (acted on).
  const [chosen, setChosen] = useState<number | null>(null);
  // Rejects and defers made this session that can still be taken back
  // (ADR 0016's update of 2026-09-26); accept is never on it.
  // A group act is one entry, undone as one (ADR 0044 decision 9).
  const [undoable, setUndoable] = useState<
    Array<
      | { id: number; title: string; action: "rejected" | "deferred" }
      | { bulk: number; count: number; action: "rejected" | "deferred" }
    >
  >([]);
  const reread = () => queryClient.invalidateQueries(trpc.scouts.pathFilter());

  const run = useMutation(
    trpc.scouts.runNow.mutationOptions({
      onSuccess: (summary) => {
        acknowledge(runWords(summary));
        void reread();
      },
      ...acts,
    })
  );
  const accept = useMutation(
    trpc.scouts.accept.mutationOptions({
      onSuccess: (accepted) => {
        acknowledge(
          accepted.held
            ? `Already in your vault: ${accepted.path}`
            : `Accepted into ${accepted.path}`
        );
        void reread();
      },
      ...acts,
    })
  );
  const pause = useMutation(
    trpc.scouts.setPaused.mutationOptions({
      onSuccess: () => void reread(),
      ...acts,
    })
  );
  const promote = useMutation(
    trpc.scouts.promote.mutationOptions({
      onSuccess: (_done, { proposalId }) => {
        const title = skim.data?.recent
          .concat(skim.data.older)
          .find((l) => l.id === proposalId)?.title;
        acknowledge(`Sent “${title ?? "that line"}” to Review.`);
        void reread();
      },
      ...acts,
    })
  );
  const reject = useMutation({
    ...trpc.scouts.reject.mutationOptions(),
    ...acts,
  });
  const defer = useMutation({
    ...trpc.scouts.defer.mutationOptions(),
    ...acts,
  });
  const undo = useMutation(trpc.scouts.undo.mutationOptions(acts));
  const unmute = useMutation(
    trpc.scouts.unmute.mutationOptions({
      onSuccess: (_done, rule) => {
        acknowledge(
          `Deleted the rule ${ruleWords(rule)}; everything it held is back.`
        );
        void reread();
      },
      ...acts,
    })
  );
  const undoBulk = useMutation(trpc.scouts.undoBulk.mutationOptions(acts));
  const rejectGroup = useMutation({
    ...trpc.scouts.rejectGroup.mutationOptions(),
    ...acts,
  });
  const deferGroup = useMutation({
    ...trpc.scouts.deferGroup.mutationOptions(),
    ...acts,
  });
  // Nothing is logged: the Proposals were only set aside, so giving them back
  // is not an act on any of them (ADR 0044 decision 5).
  const showCapped = useMutation(
    trpc.scouts.showCapped.mutationOptions({
      onSuccess: () => void reread(),
      ...acts,
    })
  );
  const rejectRun = useMutation(
    trpc.scouts.rejectRun.mutationOptions({
      onSuccess: ({ rejected }) => {
        acknowledge(`Rejected ${rejected} from this run.`);
        void reread();
      },
      ...acts,
    })
  );

  // A read the core could not answer (#526) is not an empty list: the first
  // slot is *wrong* where the rows would begin and the reason is said once,
  // on the footer channel (ADR 0033 decisions 2 and 3). Reads sharing a
  // cause share a line. Skim's read only counts in Skim: it does not run in
  // Review, and a failure it left behind there would be a reason for a stack
  // it has nothing to do with.
  const reasons = [
    ...new Set(
      [
        scouts,
        queue,
        groups,
        fleet,
        health,
        muted,
        ...(lane === "skim" ? [skim] : []),
        ...(byQuestion ? [questionGroups] : []),
      ]
        .filter((read) => read.isError)
        .map((read) => read.error.message)
    ),
  ];
  const unread = reasons.length > 0;
  // The stack, or what has taken its place: the form, or the muted view.
  const stackShown = form === null && !mutedOpen;
  const everything = queue.data ?? [];
  const questionRows = questionGroups.data ?? [];
  // A group that empties (its last card acted on) leaves the rail, so the
  // choice falls back to all rather than pointing at a row that is gone.
  const selectedQuestion = questionRows.some(
    (g) => (g.question?.id ?? UNASSIGNED) === pickedQuestion
  )
    ? pickedQuestion
    : null;
  const noneChosen = (byQuestion ? selectedQuestion : selected) === null;
  const questionKey = (g: { question: { id: string } | null }) =>
    g.question?.id ?? UNASSIGNED;
  // The cards of the Question group on screen; a paper in several Questions is
  // in each, and one acted on is gone from `everything` and so from all.
  const inQuestion = new Set(
    selectedQuestion === null
      ? null
      : questionRows.find((g) => questionKey(g) === selectedQuestion)
          ?.proposalIds
  );
  const inScoutGroup = everything.filter((card) =>
    byQuestion
      ? selectedQuestion === null || inQuestion.has(card.id)
      : selected === null || card.scouts.some((scout) => scout.id === selected)
  );
  // Past-window cards leave the dealt stack for the digest line at its foot;
  // opening the digest deals them after the live ones, so a digested card is
  // triaged like any other (ADR 0044 decision 3).
  const digest = inScoutGroup.filter((card) => card.pastWindow);
  const liveInGroup = inScoutGroup.filter((card) => !card.pastWindow);
  const inGroup = digestOpen ? [...liveInGroup, ...digest] : liveInGroup;
  // The session's order: what has not been passed, then what has, in the
  // order it was passed — so passing the last card wraps to the first.
  const stack = [
    ...inGroup.filter((card) => !passed.includes(card.id)),
    ...passed.flatMap((id) => inGroup.filter((card) => card.id === id)),
  ];
  const card = stack.find((c) => c.id === chosen) ?? stack[0];
  const cardAt = card === undefined ? -1 : stack.indexOf(card);
  // Where the selection goes once the card in the detail has been acted on.
  const nextAfter = stack[cardAt + 1] ?? stack[cardAt - 1];
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
          deferred: 0,
          capped: 0,
          cap: null,
        }
      : groups.data?.find((g) => g.id === selected);
  const runId = group?.runId ?? null;
  const groupName = [
    ...(scouts.data?.scouts ?? []),
    ...(scouts.data?.dropped ?? []),
  ].find((s) => s.id === selected)?.name;

  // Skim: newest first as the core hands it, narrowed by the rail's choice
  // like Review is, with the 30-day tail only once asked for.
  const inScout = (c: Card) =>
    selected === null || c.scouts.some((scout) => scout.id === selected);
  const older = (skim.data?.older ?? []).filter(inScout);
  const lines = [
    ...(skim.data?.recent ?? []).filter(inScout),
    ...(showOlder ? older : []),
  ];
  // The first line is chosen until another is, so a key always has a line to
  // act on and a line that leaves (accepted, promoted) hands the choice on.
  const line = lines.find((l) => l.id === lineChosen) ?? lines[0];

  // A count is only drawn once its read has answered: a 0 beside a read that
  // failed would read as all clear.
  const tabs = [
    {
      id: "review",
      label: `Review${queue.isSuccess ? ` ${everything.length}` : ""}`,
      selected: !mutedOpen && lane === "review",
      open: () => {
        setMutedOpen(false);
        setLane("review");
      },
    },
    {
      id: "skim",
      label: `Skim${skim.isSuccess ? ` ${skim.data.recent.length + skim.data.older.length}` : ""}`,
      selected: !mutedOpen && lane === "skim",
      open: () => {
        setMutedOpen(false);
        setLane("skim");
      },
    },
    {
      id: "muted",
      label: `Muted${muted.isSuccess ? ` ${muted.data.items.length}` : ""}`,
      selected: mutedOpen,
      open: () => setMutedOpen(true),
    },
  ];

  const countFor = (id: string | null) =>
    id === null
      ? everything.length
      : everything.filter((c) => c.scouts.some((s) => s.id === id)).length;
  const costOf = (id: string): number | null =>
    health.data?.scouts.find((h) => h.id === id)?.lastCostUsd ?? null;
  // Accept rate rides on Scout Activity's read; a tile cannot say a rate that
  // read has not given, and says that instead of drawing a bare gap.
  const activity = useQuery(trpc.scouts.activity.queryOptions());
  const rateOf = (id: string): AcceptRate | "unread" => {
    const row = activity.data?.rows.find(
      (r) => r.kind === "scout" && r.id === id
    );
    return row?.kind === "scout" ? row.acceptRate : "unread";
  };
  const healthOf = (id: string): Health | undefined =>
    health.data?.scouts.find((h) => h.id === id)?.health;
  const questions = questionChoices(questionList.data);
  // A dropped Scout is not looking, so it has no Voice of its own. What it
  // found stays in Review under its name (ADR 0042 decision 1), so while
  // anything waits under it, or while it is the filter, it keeps a tile, marked.
  const droppedScouts = scouts.data?.dropped ?? [];
  const droppedStacks = droppedScouts.filter(
    (d) => countFor(d.id) > 0 || d.id === selected
  );
  const selectedDropped = droppedScouts.find((d) => d.id === selected);
  const selectedScout = scouts.data?.scouts.find((s) => s.id === selected);
  const editing =
    form?.edit == null
      ? undefined
      : scouts.data?.scouts.find((s) => s.id === form.edit);
  useChosenInView(
    byQuestion
      ? `question-rail-${selectedQuestion ?? "all"}`
      : selected === null
        ? undefined
        : `scout-tile-${selected}`
  );
  useChosenInView(
    lane === "review" && card !== undefined ? `scout-row-${card.id}` : undefined
  );
  useChosenInView(
    lane === "skim" && line !== undefined ? `skim-line-${line.id}` : undefined
  );

  // A pass is a session fact about one stack; another group's passes must not
  // decide this one's order or its notice.
  function choose(id: string | null) {
    setSelected(id);
    setPassed([]);
  }
  function chooseQuestion(key: string | null) {
    setSelectedQuestion(key);
    setPassed([]);
  }
  function chooseGroupBy(next: "scout" | "question") {
    setGroupBy(next);
    setSelectedQuestion(null);
    setPassed([]);
  }
  function onPass(id: number) {
    setPassed((was) => [...was.filter((p) => p !== id), id]);
    // The last card passes to where it already is, so the next is the head.
    setChosen((stack[cardAt + 1] ?? stack[0])?.id ?? null);
  }
  function onAccept(id: number) {
    if (accept.isPending) return;
    accept.mutate(
      { proposalId: id },
      { onSuccess: () => setChosen(nextAfter?.id ?? null) }
    );
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
          setChosen(nextAfter?.id ?? null);
          setUndoable((was) => [...was, { id, title, action: kind }]);
          acknowledge(
            kind === "rejected"
              ? `Rejected “${title}”.`
              : `Deferred “${title}” until the next run.`
          );
          void reread();
        },
      }
    );
  }
  // What `MuteOffer` needs: saving says what the rule is and rereads, so the
  // card it held is gone from the stack on the next read.
  const muteOffer = (offered: Card) => ({
    card: offered,
    onSaved: (rule: MuteRule) => {
      setMuting(null);
      acknowledge(`Muted ${ruleWords(rule)}.`);
      void reread();
    },
    onCancel: () => setMuting(null),
    onRefused: refuse,
  });
  // `⇧R` and `⇧D`: exactly the cards dealt on screen, so a card folded into
  // the closed digest, or in another Scout's group, is never reached. No
  // modal: the line says what was done and that `⌘Z` takes it back.
  function onDecideGroup(kind: "rejected" | "deferred") {
    const mutation = kind === "rejected" ? rejectGroup : deferGroup;
    if (inGroup.length === 0 || rejectGroup.isPending || deferGroup.isPending)
      return;
    mutation.mutate(
      { proposalIds: inGroup.map((c) => c.id) },
      {
        onSuccess: ({ bulk, count }) => {
          setUndoable((was) => [...was, { bulk, count, action: kind }]);
          const skipped =
            count < inGroup.length
              ? ` (${inGroup.length - count} had already moved.)`
              : "";
          acknowledge(
            (kind === "rejected"
              ? `Rejected ${count} in this group. ⌘Z puts them all back.`
              : `Deferred ${count} in this group until the next run. ⌘Z puts them all back.`) +
              skipped
          );
          void reread();
        },
      }
    );
  }
  const last = undoable.at(-1);
  function onUndo() {
    if (last === undefined || undo.isPending || undoBulk.isPending) return;
    if ("bulk" in last) {
      undoBulk.mutate(
        { bulk: last.bulk },
        {
          onSuccess: ({ count }) => {
            setUndoable((was) => was.slice(0, -1));
            acknowledge(`Put ${count} back.`);
            void reread();
          },
          // Nothing of the gesture stands any more (a run brought the cards
          // back): the refusal is shown, and the entry goes so it does not
          // shadow the earlier acts beneath it.
          onError: () => setUndoable((was) => was.slice(0, -1)),
        }
      );
      return;
    }
    undo.mutate(
      { proposalId: last.id },
      {
        onSuccess: () => {
          setUndoable((was) => was.slice(0, -1));
          acknowledge(`Put “${last.title}” back.`);
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
      const bare = !event.metaKey && !event.ctrlKey && !event.altKey;
      const key = event.key.toLowerCase();
      if (bare && !event.shiftKey && key === "u") {
        event.preventDefault();
        onUndo();
      }
      if (bare && form === null && !mutedOpen && (key === "j" || key === "k")) {
        const step = key === "j" ? 1 : -1;
        if (lane === "review" && card !== undefined) {
          event.preventDefault();
          // The rows on screen: a closed digest's cards are not among them.
          const visible = digestOpen ? stack : live(stack);
          const at = visible.indexOf(card);
          setChosen(visible[clamp(at + step, visible.length)]!.id);
        } else if (lane === "skim" && line !== undefined) {
          event.preventDefault();
          setLineChosen(
            lines[clamp(lines.indexOf(line) + step, lines.length)]!.id
          );
        }
      }
      if (
        form === null &&
        lane === "review" &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        if (key === "r" || key === "d") {
          event.preventDefault();
          onDecideGroup(key === "r" ? "rejected" : "deferred");
        }
      }
      if (
        lane === "skim" &&
        line !== undefined &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault();
        const at = lines.indexOf(line) + (event.key === "ArrowDown" ? 1 : -1);
        setLineChosen(lines[clamp(at, lines.length)]!.id);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <section className={styles.surface} aria-label="Scout Queue">
      <header className={styles.header}>
        <h1 className={styles.title}>Scout Queue</h1>
        <div role="tablist" aria-label="Lane" className={styles.tabs}>
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              tier="tab"
              role="tab"
              aria-selected={tab.selected}
              onClick={tab.open}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        {lane === "review" && (
          <SegmentedControl
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "rank", label: "Rank" },
              { value: "newest", label: "Newest" },
            ]}
          />
        )}
        {lane === "review" && (
          <SegmentedControl
            label="Group by"
            value={groupBy}
            onChange={chooseGroupBy}
            options={[
              { value: "scout", label: "Scout" },
              { value: "question", label: "Question" },
            ]}
          />
        )}
        <Button
          aria-expanded={byNameOpen}
          onClick={() => setByNameOpen((was) => !was)}
        >
          Mute by name
        </Button>
        <Button onClick={() => setForm({ edit: null, values: null })}>
          + New Scout
        </Button>
      </header>
      {byQuestion && (
        <>
          <ul className={styles.scouts} aria-label="Questions">
            {[
              { key: null, name: "All Questions", count: everything.length },
              ...questionRows.map((g) => ({
                key: questionKey(g),
                name: g.question?.name ?? "Unassigned",
                count: g.proposalIds.length,
              })),
            ].map((row) => (
              <li key={row.key ?? "all"} className={styles.scout}>
                <button
                  type="button"
                  id={`question-rail-${row.key ?? "all"}`}
                  className={styles.railRow}
                  aria-current={
                    row.key === selectedQuestion ? "true" : undefined
                  }
                  onClick={() => chooseQuestion(row.key)}
                >
                  <span>{row.name}</span>
                  <span className={styles.count}>{row.count}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.line}>
            A paper can be in several groups, so these counts may add up to more
            than the total.
          </p>
        </>
      )}
      {/* The health strip (ADR 0052 decision 1): a tile per Scout, drawn from the
          same Health Loose Ends reads, that only filters. A broken Scout keeps
          its tile so it cannot hide in a strip nobody filters. */}
      {!byQuestion && (
        <ul className={styles.strip} aria-label="Scouts">
          {scouts.isError && (
            <li>
              <FirstSlot voice="wrong" claim="" />
            </li>
          )}
          {(scouts.data?.scouts ?? []).map((listed) => (
            <ScoutTile
              key={listed.id}
              name={listed.name}
              id={listed.id}
              pending={queue.isError ? null : countFor(listed.id)}
              chosen={listed.id === selected}
              onChoose={() => choose(listed.id === selected ? null : listed.id)}
              rate={rateOf(listed.id)}
            >
              <VoiceLine health={healthOf(listed.id)} />
            </ScoutTile>
          ))}
          {droppedStacks.map((dropped) => (
            <ScoutTile
              key={dropped.id}
              name={dropped.name}
              id={dropped.id}
              pending={queue.isError ? null : countFor(dropped.id)}
              chosen={dropped.id === selected}
              onChoose={() =>
                choose(dropped.id === selected ? null : dropped.id)
              }
              rate={rateOf(dropped.id)}
            >
              <span className={styles.voice}>dropped</span>
            </ScoutTile>
          ))}
          {/* A file that does not parse is a Scout the researcher made, not one
            nobody did: named, with what is wrong. */}
          {(scouts.data?.unreadable ?? []).map((file) => (
            <li key={file.file} className={styles.tile}>
              <span className={styles.tileName}>{file.file}</span>
              <VoiceLine
                health={{ voice: "wrong", kind: null, sentence: file.sentence }}
              />
              <span
                data-accept="none"
                title="This Scout file cannot be read, so it has no rate."
                className={styles.rate}
              >
                —
              </span>
            </li>
          ))}
        </ul>
      )}
      {!byQuestion && selected !== null && form === null && (
        <div className={styles.scoutHeader}>
          <p className={styles.filterLine}>
            only {groupName ?? selected} ·{" "}
            <Button tier="inline" onClick={() => choose(null)}>
              show all
            </Button>
          </p>
          {selectedDropped !== undefined && (
            <>
              <h2 className={styles.scoutName}>{selectedDropped.name}</h2>
              <VoiceLine health={{ voice: "not yet", sentence: DROPPED }} />
            </>
          )}
          {selectedScout !== undefined && (
            <>
              <h2 className={styles.scoutName}>{selectedScout.name}</h2>
              <VoiceLine health={healthOf(selectedScout.id)} />
              <CostLine usd={costOf(selectedScout.id)} />
              {selectedScout.assigned.length > 0 && (
                <ul className={styles.assigned} aria-label="Assigned Questions">
                  {selectedScout.assigned.map((id) => {
                    const q = questions.find(
                      (candidate) => candidate.id === id
                    );
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
                <Button
                  disabled={run.isPending}
                  onClick={() => run.mutate({ scoutId: selectedScout.id })}
                >
                  Run now
                </Button>{" "}
                <Button
                  onClick={() =>
                    setForm({ edit: selectedScout.id, values: null })
                  }
                >
                  Edit
                </Button>{" "}
                <Button
                  disabled={pause.isPending}
                  onClick={() =>
                    pause.mutate({
                      scoutId: selectedScout.id,
                      paused: !selectedScout.paused,
                    })
                  }
                >
                  {selectedScout.paused ? "Resume" : "Pause"}
                </Button>
              </p>
            </>
          )}
        </div>
      )}
      {form !== null && (form.edit === null || editing !== undefined) && (
        <ScoutForm
          key={form.edit ?? "new"}
          {...(editing === undefined ? {} : { scout: editing })}
          values={form.values}
          onChange={(values) => setForm({ edit: form.edit, values })}
          questions={questions}
          assigning={form.assigning}
          onDone={(saved) => {
            setForm(null);
            if (saved !== null) setSelected(saved);
          }}
        />
      )}
      {stackShown &&
        lane === "review" &&
        !byQuestion &&
        group !== undefined && (
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
            {/* A deferred card comes back with its Scout's next clean run, which a
              dropped Scout does not make, and nothing else lists the card:
              said here so it is not left invisible (ADR 0042 decision 1). A
              Scout that is looking brings its own back. */}
            {selectedDropped !== undefined && (group.deferred ?? 0) > 0 && (
              <p className={styles.line}>
                {group.deferred} deferred — they come back with its next run, if
                it is restored
              </p>
            )}
            {selected !== null && (group.capped ?? 0) > 0 && (
              <p className={styles.line}>
                {group.capped} below your cap of {group.cap}{" "}
                <Button
                  disabled={showCapped.isPending}
                  onClick={() => showCapped.mutate({ scoutId: selected })}
                >
                  Show them
                </Button>
              </p>
            )}
            {runId !== null && group.runPending > 0 && (
              <Button
                disabled={rejectRun.isPending}
                onClick={() => rejectRun.mutate({ runId })}
              >
                Reject this run{groupName !== undefined && ` of ${groupName}`} (
                {group.runPending})
              </Button>
            )}
          </div>
        )}
      {form === null && byNameOpen && (
        <MuteByName
          onSaved={(rule) => {
            setByNameOpen(false);
            acknowledge(`Muted ${ruleWords(rule)}.`);
            void reread();
          }}
          onRefused={refuse}
        />
      )}
      {form === null && mutedOpen && muted.data !== undefined && (
        <MutedView
          rules={muted.data.rules}
          items={muted.data.items}
          deleting={unmute.isPending}
          onDelete={(rule) => unmute.mutate(rule)}
        />
      )}
      {stackShown && lane === "review" && passedThrough && (
        <p className={styles.line}>
          You have passed through every card{" "}
          {noneChosen ? "here" : "in this group"}; they come round again.
        </p>
      )}
      {stackShown && lane === "skim" && (
        <>
          {lines.length > 0 && (
            <ul className={styles.skim} aria-label="Skim">
              {lines.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    id={`skim-line-${l.id}`}
                    className={styles.skimLine}
                    aria-current={l === line ? "true" : undefined}
                    onClick={() => setLineChosen(l.id)}
                  >
                    <span>{l.title}</span>
                    <span className={styles.count}>{whose(l.scouts)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!showOlder && older.length > 0 && (
            <p className={styles.line}>
              <Button onClick={() => setShowOlder(true)}>
                show older ({older.length})
              </Button>
            </p>
          )}
          {lines.length === 0 &&
            older.length === 0 &&
            (unread ? (
              <FirstSlot voice="wrong" claim="" />
            ) : (
              <SkimQuiet claim={fleet.data} dropped={droppedScouts.length} />
            ))}
          {line !== undefined && muting?.id === line.id && (
            <MuteOffer {...muteOffer(line)} />
          )}
          {line !== undefined && muting?.id !== line.id && (
            <Proposal
              key={line.id}
              card={line}
              lane="skim"
              onMute={() => setMuting(line)}
              onAccept={() => onAccept(line.id)}
              onPromote={() => {
                if (!promote.isPending) promote.mutate({ proposalId: line.id });
              }}
            />
          )}
        </>
      )}
      {stackShown && lane === "review" && inGroup.length === 0 && unread && (
        <FirstSlot voice="wrong" claim="" />
      )}
      {form === null &&
        lane === "review" &&
        queue.isSuccess &&
        inGroup.length === 0 &&
        digest.length === 0 &&
        !unread && (
          <ReviewQuiet
            scout={
              byQuestion || selected === null ? undefined : healthOf(selected)
            }
            claim={noneChosen ? fleet.data : undefined}
            dropped={droppedScouts.length}
          />
        )}
      {stackShown &&
        lane === "review" &&
        (card !== undefined || digest.length > 0) && (
          <div className={styles.panes}>
            <div className={styles.listPane}>
              {live(stack).length > 0 && (
                <ol className={styles.rows} aria-label="New finds">
                  {live(stack).map((next) => (
                    <ReviewRow
                      key={next.id}
                      card={next}
                      current={next === card}
                      onChoose={() => setChosen(next.id)}
                    />
                  ))}
                </ol>
              )}
              {digest.length > 0 && (
                <div className={styles.line}>
                  <Button
                    aria-expanded={digestOpen}
                    onClick={() => setDigestOpen((was) => !was)}
                  >
                    {digest.length} older than the window
                  </Button>
                  {digestOpen && (
                    <ol
                      className={styles.rows}
                      aria-label="Older than the window"
                    >
                      {digest.map((aged) => (
                        <ReviewRow
                          key={aged.id}
                          card={aged}
                          current={aged === card}
                          onChoose={() => setChosen(aged.id)}
                        />
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
            <div className={styles.detailPane}>
              {card !== undefined && muting?.id === card.id && (
                <MuteOffer {...muteOffer(card)} />
              )}
              {card !== undefined && muting?.id !== card.id && (
                <Proposal
                  key={card.id}
                  card={card}
                  lane="review"
                  onMute={() => setMuting(card)}
                  onAccept={() => onAccept(card.id)}
                  onPass={() => onPass(card.id)}
                  onReject={() =>
                    onDecide("rejected", reject, card.id, card.title)
                  }
                  onDefer={() =>
                    onDecide("deferred", defer, card.id, card.title)
                  }
                />
              )}
            </div>
          </div>
        )}
      {/* The one footer channel (ADR 0052 decision 8; ADR 0033): the last act
          and its undo on the left, the keys on the right. A refusal takes the
          act's place as an alert and is never beside an undo link, so it cannot
          be read as something that can be taken back. A failed read is said by
          name, polite: a state the app is in, not a refusal of an act. */}
      <footer className={styles.footer}>
        <div className={styles.last}>
          {refusal.words !== null ? (
            <RefusalLine refusal={refusal} as="span" />
          ) : (
            <>
              {said !== null && <span role="status">{said}</span>}
              {last !== undefined && (
                <Button
                  tier="inline"
                  aria-label={`Undo ${last.action === "rejected" ? "reject" : "defer"}${
                    "bulk" in last ? ` of ${last.count}` : ""
                  }`}
                  onClick={onUndo}
                >
                  undo · U
                </Button>
              )}
            </>
          )}
          {reasons.map((reason) => (
            <WarningLine key={reason} label="not read">
              {reason}
            </WarningLine>
          ))}
          {/* A rules file that does not parse holds nothing back, and says
              so by name: it must never look like no rules (ADR 0044 d.4). */}
          {muted.data?.problem != null && (
            <WarningLine label="mute rules not read">
              {muted.data.problem}
            </WarningLine>
          )}
        </div>
        <span className={styles.keys}>
          {lane === "review"
            ? "J/K move · A accept · D defer · R reject · P pass"
            : "J/K move · A accept · T to Review · O open"}
        </span>
      </footer>
    </section>
  );
}

/**
 * Whose a card or a line is. A dropped Scout's Proposals stay in Review and in
 * Skim under its name, marked, so the stack says whose it was (ADR 0042
 * decision 1).
 */
const whose = (scouts: Card["scouts"]) =>
  scouts
    .map((scout) => (scout.dropped ? `${scout.name} (dropped)` : scout.name))
    .join(" · ");

/**
 * One Scout's tile: a filter and nothing else (ADR 0052 decision 1). The
 * Accept rate is a thin bar, or `—` with the reason in its title when nothing
 * has been triaged or the rate cannot be said, never a 0% (ADR 0042 decisions
 * 2 and 3).
 */
function ScoutTile({
  id,
  name,
  pending,
  chosen,
  onChoose,
  rate,
  children,
}: {
  id: string;
  name: string;
  /** Null while the stack could not be read: a count beside a failed read would read as all clear. */
  pending: number | null;
  chosen: boolean;
  onChoose: () => void;
  rate: AcceptRate | "unread";
  children: ReactNode;
}) {
  const rateTitle =
    rate === "unread"
      ? "Accept rate could not be read."
      : rate.kind === "rate"
        ? `${rate.accepted} of ${rate.triaged} triaged were accepted.`
        : rate.kind === "unavailable"
          ? rate.reason
          : "Nothing triaged yet.";
  return (
    <li className={styles.tile}>
      <Button
        tier="listRow"
        id={`scout-tile-${id}`}
        aria-pressed={chosen}
        onClick={onChoose}
      >
        <span className={styles.tileHead}>
          <span className={styles.tileName}>{name}</span>
          {/* A quiet Scout is said by its Voice; a bare 0 would read as the claim without its Warrant. */}
          {pending !== null && pending > 0 && (
            <span className={styles.count}>{pending}</span>
          )}
        </span>
        {children}
        {rate !== "unread" && rate.kind === "rate" ? (
          <span data-accept="rate" title={rateTitle} className={styles.rate}>
            <span className={styles.bar} aria-hidden="true">
              <span style={{ width: percent(rate.rate) }} />
            </span>
            <span>{percent(rate.rate)}</span>
          </span>
        ) : (
          <span data-accept="none" title={rateTitle} className={styles.rate}>
            —
          </span>
        )}
      </Button>
    </li>
  );
}

/** What the list shows: the live finds, never the digest's. */
const live = (stack: Card[]) => stack.filter((c) => !c.pastWindow);

/** One find in the list: a click selects it, and the second line says why it sits here. */
function ReviewRow({
  card,
  current,
  onChoose,
}: {
  card: Card;
  current: boolean;
  onChoose: () => void;
}) {
  return (
    <li>
      <Button
        tier="listRow"
        id={`scout-row-${card.id}`}
        aria-label={card.title}
        aria-current={current ? "true" : undefined}
        onClick={onChoose}
      >
        <span className={styles.rowTitle}>{card.title}</span>
        <span className={styles.rowMeta}>
          {whose(card.scouts)}
          {/* The counterweight's label stands in for the rank summary. */}
          {card.counterweight
            ? ` · ${OUTSIDE_THE_USUAL}`
            : card.signals
                .filter((signal) => signal.kind !== "questions")
                .map((signal) => ` · ${signalWords(signal)}`)
                .join("")}
          {card.retroactive && " · retroactive"}
        </span>
      </Button>
    </li>
  );
}

/** The card in hand. It takes the keyboard when it arrives, so a key acts on what is on screen. */
function Proposal({
  card,
  lane,
  onAccept,
  onPass,
  onReject,
  onDefer,
  onPromote,
  onMute,
}: {
  card: Card;
  lane: "review" | "skim";
  onAccept: () => void;
  onPass?: () => void;
  onReject?: () => void;
  onDefer?: () => void;
  onPromote?: () => void;
  onMute: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), []);
  // An address the link rule refuses is the user's own `O` or click turned
  // down, so it is an alert, heard again on each press and forgotten as the
  // next act key is pressed on this card (ADR 0033 decisions 5–6).
  const refusal = useRefusal();
  const link = classifyLink(card.url);
  const chips = [
    ...card.signals
      .filter((signal) => signal.kind !== "questions")
      .map(signalWords),
    ...(card.moved === null ? [] : [movedWords(card.moved)]),
    ...(card.counterweight ? [OUTSIDE_THE_USUAL] : []),
  ];
  // A button does what its key does, so the two cannot come apart.
  const press = (act: (() => void) | undefined) => () => {
    refusal.forget();
    act?.();
  };

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
    // ⇧R and ⇧D are the group's (the Queue hears them), never this card's own.
    if (event.shiftKey && (key === "r" || key === "d")) return;
    // Skim owes nothing, so its card has no keys for refusing, putting off or
    // passing: the keys are absent, not disabled.
    const act = (
      lane === "skim"
        ? { a: onAccept, t: onPromote, m: onMute }
        : { a: onAccept, p: onPass, r: onReject, d: onDefer, m: onMute }
    )[key as "a"];
    if (act !== undefined) {
      event.preventDefault();
      refusal.forget();
      act();
    } else if (key === "o") {
      event.preventDefault();
      // Looking records nothing; a link the rule refuses says which scheme it
      // had instead of doing nothing (§ Invariants, no silent failures), as an
      // alert because it answers the user's own `O` (ADR 0033 decision 5).
      if (link.kind === "refused") refusal.say(linkRefusal(link.scheme));
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
        {whose(card.scouts)}
        {card.scouts.some((s) => s.assigned.length > 0) &&
          ` · assigned to ${card.scouts
            .flatMap((s) => s.assigned)
            .map((q) => q.name ?? q.id)
            .join(", ")}`}
        {card.retroactive && " · retroactive"}
      </p>
      <h2 className={styles.cardTitle}>{card.title}</h2>
      {/* Only what fired: a chip is never decoration (ADR 0044 decision 2).
          The Questions signal is the *assigned to* clause above. */}
      {chips.length > 0 && (
        <ul className={styles.chips} aria-label="Why">
          {chips.map((chip) => (
            <li key={chip} className={styles.chip}>
              {chip}
            </li>
          ))}
        </ul>
      )}
      <dl className={styles.fields}>
        <Field label="authors" value={card.authors.join(", ") || null} />
        <Field label="published" value={card.published.slice(0, 10)} />
        <Field
          label="venue"
          value={
            card.venue !== null && card.venueType !== null
              ? `${card.venue} (${card.venueType})`
              : card.venue
          }
        />
        <Field label="doi" value={card.doi} />
        <dt>link</dt>
        <dd>
          {link.kind === "refused" ? (
            <button
              type="button"
              className={styles.notLink}
              aria-label={`not a link: ${card.url}`}
              onClick={() => refusal.say(linkRefusal(link.scheme))}
            >
              {card.url}
            </button>
          ) : (
            <a href={link.href} target="_blank" rel="noreferrer">
              {card.url}
            </a>
          )}
        </dd>
        {card.alsoOnArxiv !== null && (
          <>
            <dt>also on arXiv</dt>
            <dd>
              <a href={card.alsoOnArxiv} target="_blank" rel="noreferrer">
                {card.alsoOnArxiv}
              </a>
            </dd>
          </>
        )}
      </dl>
      <RefusalLine refusal={refusal} />
      <p className={styles.abstract}>{card.abstract}</p>
      {lane === "skim" ? (
        <p className={styles.actions}>
          <kbd>A</kbd> accept · <kbd>O</kbd> open · <kbd>T</kbd> to Review ·{" "}
          <kbd>M</kbd> mute…
        </p>
      ) : (
        <>
          <div className={styles.decide}>
            <Button tier="primary" onClick={press(onAccept)}>
              Accept <kbd>A</kbd>
            </Button>
            <Button onClick={press(onDefer)}>
              Defer <kbd>D</kbd>
            </Button>
            <Button onClick={press(onReject)}>
              Reject <kbd>R</kbd>
            </Button>
            <Button tier="inline" onClick={press(onPass)}>
              Pass <kbd>P</kbd>
            </Button>
          </div>
          <p className={styles.actions}>
            <kbd>O</kbd> open · <kbd>M</kbd> mute…
          </p>
        </>
      )}
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

/**
 * What a lane says when no Scout is looking and none is named as needing a look.
 * A fleet whose Scouts are all dropped has had Scouts, and *yet* would say it
 * had not (ADR 0042 decision 1).
 */
const nobodyWatching = (dropped: number) =>
  dropped > 0
    ? "Every Scout is dropped, so nothing is being watched."
    : "No Scouts yet, so nothing is being watched.";

/**
 * Skim's quiet, warranted the way Review's is: from the whole fleet, and not
 * at all while a Scout is broken — then the broken one is named instead, so
 * an empty feed never reads as a quiet field when it is not (ADR 0032).
 */
function SkimQuiet({
  claim,
  dropped,
}: {
  claim: { claim: string | null; naming: string[] } | undefined;
  dropped: number;
}) {
  if (claim === undefined) return null;
  return (
    <p className={styles.line}>
      {claim.claim !== null
        ? `Skim is quiet — ${claim.claim}.`
        : claim.naming.length > 0
          ? `Nothing here, and no claim that the field is quiet: ${claim.naming.join(", ")} ${claim.naming.length === 1 ? "needs" : "need"} a look.`
          : nobodyWatching(dropped)}
    </p>
  );
}

/**
 * An empty Review stack in ADR 0032's voices, worded as Skim's quiet is so the
 * two lanes never speak differently: one Scout claims *nothing pending* only
 * after a clean run (otherwise its own voice, in its header, speaks); the
 * whole stack is *Review cleared* with the fleet's warrant, and makes no
 * claim while a Scout is broken. Nothing is said while the evidence has not
 * been read.
 */
function ReviewQuiet({
  scout,
  claim,
  dropped,
}: {
  scout: Health | undefined;
  claim: { claim: string | null; naming: string[] } | undefined;
  dropped: number;
}) {
  if (scout !== undefined) {
    return scout.voice === "claim" ? (
      <p className={styles.line}>{NOTHING_PENDING}</p>
    ) : null;
  }
  if (claim === undefined) return null;
  return (
    <p className={styles.line}>
      {claim.claim !== null
        ? `Review cleared — ${claim.claim}.`
        : claim.naming.length > 0
          ? `Nothing here, and no claim that the field is quiet: ${claim.naming.join(", ")} ${claim.naming.length === 1 ? "needs" : "need"} a look.`
          : nobodyWatching(dropped)}
    </p>
  );
}
