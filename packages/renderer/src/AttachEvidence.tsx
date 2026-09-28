import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArtifactCheck, CriteriaToAttach, CriterionToAttach } from "core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import form from "./AttachSource.module.css";
import styles from "./AttachEvidence.module.css";
import { useChosenInView } from "./chosen";
import { useRestoreFocus } from "./focus";
import { Picker } from "./Picker";
import picker from "./Picker.module.css";
import { useTRPC } from "./trpc";

type Group = CriteriaToAttach["groups"][number];
/** What the note and its write need of a Hypothesis, from either door. */
type HypothesisRead = Pick<Group, "path" | "claim" | "hash">;
type Chosen = { group: HypothesisRead; criterion: CriterionToAttach };

/**
 * *Attach as evidence* from an Experiment page (#367; spec #362 stories 45,
 * 47–49; § Experiment view, Attaching as Evidence): every Hypothesis's
 * Criteria as one keyboard list, then the note on what this run shows *for
 * that Criterion*. The note is required — it is the difference between
 * Evidence and a link (`CONTEXT.md` § Evidence) — so a blank one never
 * reaches the core; the core refuses one too, in its own words.
 *
 * Not the Picker: its rows are vault files, and a Criterion is a block
 * inside one. Grouped by Hypothesis, falsifying first within each — the
 * core's order — because a falsifying Criterion is the one a run most
 * needs to be read against. The keyboard goes back where it was, however
 * the form closes.
 */
export function AttachEvidence({
  experiment,
  onClose,
}: {
  /** The run's vault-relative path: what the Evidence line names. */
  experiment: string;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const leave = useRestoreFocus(onClose);
  return chosen === null ? (
    <CriterionList onChoose={setChosen} onClose={leave} />
  ) : (
    <Note experiment={experiment} chosen={chosen} onDone={leave} />
  );
}

/**
 * *attach evidence* from a Criterion on the Hypothesis page (#371; spec
 * #362 stories 7–8, 46): the other door onto the same write. The Picker
 * narrowed to Experiments — here the rows *are* vault files — then the
 * same required note as the Experiment page's door.
 *
 * When no run matches, *new experiment named …* makes one from what was
 * typed, `from:` this Hypothesis, so its page says what prompted it; the
 * run is made when the row is taken and attached only once the note is
 * written. Leaving the note leaves a planned run with nothing attached,
 * which is a run like any other — an Experiment exists independently of
 * any claim (brief § Experiment). A refusal to make it (a taken name) is
 * `onRefused`'s to show, since the Picker has closed by then.
 */
export function AttachRun({
  hypothesis,
  criterion,
  onRefused,
  onClose,
}: {
  /** The Hypothesis as the page read it: its path, claim, and the hash the write is `basedOn`. */
  hypothesis: HypothesisRead;
  criterion: CriterionToAttach;
  onRefused: (reason: string) => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const [run, setRun] = useState<{ path: string; name: string } | null>(null);
  // The note step outlives the Picker, which only restores focus for its
  // own.
  const leave = useRestoreFocus(onClose);
  const make = useMutation(
    trpc.experiments.create.mutationOptions({
      onSuccess: ({ path }, { name }) => setRun({ path, name }),
      onError: (error) => {
        onRefused(`could not make the run: ${error.message}`);
        leave();
      },
    })
  );
  const name = criterionName(criterion);

  if (run !== null) {
    return (
      <Note
        experiment={run.path}
        run={run.name}
        chosen={{ group: hypothesis, criterion }}
        onDone={leave}
      />
    );
  }
  return (
    <Picker
      label={`Evidence for ${name}`}
      kinds={["experiment"]}
      newRow={(query) => {
        const typed = query.trim();
        // No name, no run: the core would only refuse it.
        if (typed === "" || make.isPending) return undefined;
        return {
          label: `new experiment named ${typed}`,
          onChoose: () => make.mutate({ name: typed, from: hypothesis.path }),
        };
      }}
      onChoose={(chosen) => setRun({ path: chosen.path, name: chosen.name })}
      onClose={leave}
    />
  );
}

/** A Criterion by its label, or its id when it has no Relationship to letter it. */
export const criterionName = (c: Pick<CriterionToAttach, "id" | "label">) =>
  c.label ?? `^${c.id}`;

/** A Criterion's Relationship and Outcome, in the Hypothesis page's words. */
export function standing({
  relationship,
  outcome,
}: Pick<CriterionToAttach, "relationship" | "outcome">): string {
  return `${relationship ?? "no relationship"} · ${outcome ?? "awaiting evidence"}`;
}

function CriterionList({
  onChoose,
  onClose,
}: {
  onChoose: (chosen: Chosen) => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const listing = useQuery(trpc.experiments.criteria.queryOptions());
  const groups = listing.data?.groups ?? [];
  const problems = listing.data?.problems ?? [];
  // The rows in the order they are drawn, so the choice is one index
  // however the groups break it up.
  const rows: Chosen[] = groups.flatMap((group) =>
    group.criteria.map((criterion) => ({ group, criterion }))
  );
  const [arrowedTo, setArrowedTo] = useState(0);
  const chosen = Math.min(arrowedTo, Math.max(rows.length - 1, 0));
  const chosenRowId = rows[chosen] === undefined ? undefined : rowId(chosen);
  useChosenInView(chosenRowId);

  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        onClose();
        return;
      case "Enter": {
        event.preventDefault();
        const row = rows[chosen];
        if (row !== undefined) onChoose(row);
        return;
      }
      case "ArrowDown":
      case "j":
        event.preventDefault();
        setArrowedTo(Math.min(chosen + 1, rows.length - 1));
        return;
      case "ArrowUp":
      case "k":
        event.preventDefault();
        setArrowedTo(Math.max(chosen - 1, 0));
        return;
      default:
        return;
    }
  }

  let index = 0;
  return (
    <div
      className={picker.picker}
      role="dialog"
      aria-label="Attach as evidence"
    >
      <div className={picker.row}>
        <span className={picker.label}>Attach as evidence</span>
        <span className={picker.hint}>j/k move · ↵ choose · esc leaves</span>
      </div>
      {/* A read that failed must never read as a vault with no claims. */}
      {listing.isError && (
        <p className={picker.message} role="alert">
          {listing.error.message}
        </p>
      )}
      <ul
        ref={listRef}
        className={picker.list}
        role="listbox"
        aria-label="Criteria"
        aria-activedescendant={chosenRowId}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {groups.map((group) => (
          <li key={group.path} role="presentation">
            <ul className={styles.group} role="group" aria-label={group.claim}>
              <li role="presentation" className={styles.claim}>
                {group.claim}
              </li>
              {group.criteria.length === 0 && (
                <li role="presentation" className={picker.message}>
                  no criteria written yet
                </li>
              )}
              {group.criteria.map((criterion) => {
                const at = index++;
                return (
                  <li
                    key={criterion.id}
                    id={rowId(at)}
                    role="option"
                    aria-selected={at === chosen}
                    className={styles.criterion}
                    data-relationship={criterion.relationship ?? undefined}
                    onClick={() => onChoose({ group, criterion })}
                  >
                    <span className={styles.label}>
                      {criterionName(criterion)}
                    </span>
                    <span className={styles.standing}>
                      {standing(criterion)}
                    </span>
                    <span className={styles.text}>{criterion.text}</span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {listing.isSuccess && groups.length === 0 && (
        <p className={picker.message}>
          No Hypothesis in the vault yet; Evidence attaches to one of its
          criteria.
        </p>
      )}
      {problems.map((problem) => (
        <p key={problem.path} className={picker.message}>
          could not read {problem.path}: {problem.reason}
        </p>
      ))}
    </div>
  );
}

// Unique in the document (`chosen.ts`): the page's other lists have their own prefixes.
const rowId = (index: number) => `evidence-criterion-${index}`;

/**
 * The note, required, then the one write: on the Hypothesis, under the
 * Criterion, `basedOn` the Hypothesis as the list read it. A refusal is a
 * line in the form with the note still in it.
 */
function Note({
  experiment,
  run,
  chosen: { group, criterion },
  onDone,
}: {
  experiment: string;
  /** The run's name, shown when the note is reached from the Criterion's side, where the run is what was just chosen. */
  run?: string;
  chosen: Chosen;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [blank, setBlank] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    noteRef.current?.focus();
  }, []);
  const name = criterionName(criterion);

  const attach = useMutation(
    trpc.experiments.attachEvidence.mutationOptions({
      onSuccess: (result) => {
        if (!result.written) {
          setRefusal(`${result.reason} — ${result.detail}`);
          return;
        }
        // The line is read back from the Hypothesis on both pages.
        void queryClient.invalidateQueries(trpc.experiments.page.pathFilter());
        // Attaching may take a run out of the Experiment Inbox (#372).
        void queryClient.invalidateQueries(trpc.experiments.inbox.pathFilter());
        void queryClient.invalidateQueries(trpc.hypotheses.page.pathFilter());
        void queryClient.invalidateQueries(
          trpc.experiments.criteria.pathFilter()
        );
        onDone();
      },
      onError: (error) => setRefusal(error.message),
    })
  );

  const ready = note.trim() !== "";
  const submit = () => {
    if (!ready) {
      setBlank(true);
      return;
    }
    if (attach.isPending) return;
    attach.mutate({
      hypothesis: group.path,
      criterion: criterion.id,
      experiment,
      note,
      basedOn: group.hash,
    });
  };

  return (
    <div
      className={form.form}
      role="dialog"
      aria-label={`Evidence for ${name}`}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onDone();
        }
      }}
    >
      <div className={form.row}>
        <span className={form.label}>Evidence for {name}</span>
        <span className={form.hint}>↵ attaches · esc leaves</span>
      </div>
      <p className={styles.chosen}>
        {run !== undefined && <span className={styles.run}>{run}</span>}
        <span className={styles.claimLine}>{group.claim}</span>
        <span className={styles.standing}>{standing(criterion)}</span>
        <span className={styles.text}>{criterion.text}</span>
      </p>
      <ArtifactChecks experiment={experiment} />
      <div className={form.field}>
        <span className={form.fieldLabel} aria-hidden>
          What this run shows for {name}
        </span>
        <input
          ref={noteRef}
          type="text"
          aria-label={`What this run shows for ${name}`}
          className={form.note}
          placeholder="the reading — the same run can mean different things to different criteria"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setBlank(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div className={form.row}>
        <button
          type="button"
          className={form.attach}
          disabled={!ready || attach.isPending}
          onClick={submit}
        >
          attach
        </button>
        <span className={form.hint}>
          {blank
            ? "the note is required — it is what makes a run Evidence"
            : "records no Outcome; judging the criterion stays its own act"}
        </span>
      </div>
      {refusal !== null && (
        <p role="status" className={form.refusal}>
          could not attach: {refusal}
        </p>
      )}
    </div>
  );
}

/** Each outcome in the words ADR 0035 decision 6 gives it; the machine is named where it is the answer. */
function verdict({ outcome, machine }: ArtifactCheck): string {
  switch (outcome) {
    case "unchanged":
      // Not *identical*: the Fingerprint reads the ends, not the middle.
      return "here and unchanged — same size, date and ends";
    case "elsewhere":
      return `on another machine — linked on ${machine}`;
    case "changed":
      return "changed or gone since it was linked";
    case "notChecked":
      return "a URL — not checked here";
  }
}

/**
 * The TEST-13 check (#370; stories 52–54; ADR 0035 decisions 6–7): each
 * linked Artifact the run rests on, read now, at the moment the run is
 * trusted — beside the note, and never between the note and the write.
 * The attach button does not wait on it and does not read it: two machines
 * are the researcher's arrangement (KEEP-11), and a file on the other one
 * is no reason to refuse.
 *
 * Nothing is drawn for a run with nothing linked. A check still out says
 * so, and one that failed says it failed, so an absent result is never
 * read as a clean one.
 */
function ArtifactChecks({ experiment }: { experiment: string }) {
  const trpc = useTRPC();
  const check = useQuery(
    trpc.experiments.checkArtifacts.queryOptions({ path: experiment })
  );
  if (check.isPending) {
    return <p className={styles.checking}>checking the linked artifacts…</p>;
  }
  if (check.isError) {
    return (
      <p className={styles.checking}>
        could not check the linked artifacts: {check.error.message}
      </p>
    );
  }
  const checks = check.data?.checks ?? [];
  if (checks.length === 0) return null;
  return (
    <ul className={styles.checks} aria-label="Linked artifacts, checked now">
      {checks.map((c, at) => (
        <li key={at} className={styles.check} data-outcome={c.outcome}>
          <span className={styles.checkFile} title={c.target}>
            {c.file}
          </span>
          <span className={styles.verdict}>{verdict(c)}</span>
        </li>
      ))}
    </ul>
  );
}
