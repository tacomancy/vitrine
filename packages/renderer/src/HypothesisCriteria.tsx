import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AfterEvidenceMark,
  CriterionRead,
  Outcome,
  Relationship,
  SavedAnswer,
} from "core";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { AttachRun } from "./AttachEvidence";
import styles from "./Hypothesis.module.css";
import { Lines, Outline } from "./ResearchQuestion";
import rq from "./ResearchQuestion.module.css";
import { localDate } from "./rows";
import { useTRPC } from "./trpc";

/**
 * The criteria as read, and the page's writes to them (#334; spec #327
 * stories 21, 24–31; ADR 0031 decisions 2–5). Falsifying ones get their own
 * band above the rest (story 24): they can settle the page on their own, so
 * they carry more weight. That is layout, not file order — the file keeps
 * them where they were written, and a new one is appended.
 *
 * Every write is the core's, which records the criterion's Revision and a
 * `· state` entry when the Derived state moves; the page sends the hash it
 * read and, for a rewording, the text it was editing. A refusal is a line
 * on the criterion — or the form — that asked, never a silent no-op.
 */
export function Criteria({
  path,
  hash,
  claim,
  criteria,
}: {
  path: string;
  hash: string;
  /** The claim as read: what *attach evidence*'s note is written against. */
  claim: string;
  criteria: CriterionRead[];
}) {
  const falsifying = criteria.filter((c) => c.relationship === "falsifying");
  const rest = criteria.filter((c) => c.relationship !== "falsifying");
  // *add a new criterion instead* (#335) opens the form below with what the
  // card was about to write; each offer remounts it, so it opens afresh.
  const [instead, setInstead] = useState<Draft & { n: number }>({
    n: 0,
    text: "",
    relationship: null,
  });
  const card = (c: CriterionRead) => (
    <Card
      key={c.id}
      path={path}
      hash={hash}
      claim={claim}
      criterion={c}
      onInstead={(draft) => setInstead({ ...draft, n: instead.n + 1 })}
    />
  );
  return (
    <div className={styles.criteria}>
      {criteria.length === 0 && (
        <Outline>
          No criteria yet. Write what would confirm the claim and what would
          kill it before any run — that record is the point of the page.
        </Outline>
      )}
      {falsifying.length > 0 && (
        <div
          role="group"
          aria-label="Falsifying criteria"
          className={styles.band}
        >
          <p className={styles.bandNote}>
            if met, any one of these decides the page alone
          </p>
          {falsifying.map(card)}
        </div>
      )}
      {rest.length > 0 && (
        <div role="group" aria-label="Other criteria" className={styles.rest}>
          {rest.map(card)}
        </div>
      )}
      <AddCriterion
        key={instead.n}
        path={path}
        hash={hash}
        draft={instead.n === 0 ? null : instead}
      />
    </div>
  );
}

/** What a new criterion starts from when it is offered in place of an edit. */
type Draft = { text: string; relationship: Relationship | null };

const RELATIONSHIPS: Relationship[] = [
  "confirming",
  "falsifying",
  "diagnostic",
];
const OUTCOMES: Outcome[] = ["met", "not met", "inconclusive"];

/**
 * One criterion write: the page re-read when it lands (the own write's
 * `vaultChanged` would do the same, a moment later), or the refusal kept
 * for a line in `verb`'s words — *could not record it* says what did not
 * happen where *could not save* would not.
 */
function useCriterionWrite(verb: string, onWritten?: () => void) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  return {
    refusal,
    clear: () => setRefusal(null),
    options: {
      onSuccess: (result: SavedAnswer) => {
        if (result.written) {
          setRefusal(null);
          void queryClient.invalidateQueries(trpc.hypotheses.page.pathFilter());
          onWritten?.();
        } else {
          // The detail is the sentence; the reason is the protocol's word.
          setRefusal(`could not ${verb}: ${result.detail}`);
        }
      },
      onError: (error: { message: string }) =>
        setRefusal(`could not ${verb}: ${error.message}`),
    },
  };
}

/** A refusal line, in the footer's quiet voice, where the write was asked for. */
function Refusal({ refusal }: { refusal: string | null }) {
  if (refusal === null) return null;
  return (
    <p role="status" className={rq.refusal}>
      {refusal}
    </p>
  );
}

/**
 * One criterion: its Relationship and label, its chips, its text, the
 * Evidence under it, and its controls. *Awaiting evidence* is the absence
 * of an Outcome (ADR 0031 decision 2) and is drawn as its own chip — and as
 * no Outcome checked — so *not yet tested* never looks like *tested and
 * inconclusive* (TEST-4). An Outcome with nothing under it says no run is
 * named, rather than showing an Outcome nobody can trace. *delete* is there
 * only while nothing tests the criterion: before Evidence it is a draft
 * (decision 5), and the core refuses it after. Once tested, *make
 * diagnostic* takes its place — the way out of the rule that keeps the
 * criterion on the page — and rewording or relabelling it first says that
 * the change will be marked (#335, TEST-5), offering a new criterion
 * instead. Recording an Outcome never warns: it is what Evidence is for.
 */
function Card({
  path,
  hash,
  claim,
  criterion,
  onInstead,
}: {
  path: string;
  hash: string;
  claim: string;
  criterion: CriterionRead;
  onInstead: (draft: Draft) => void;
}) {
  const trpc = useTRPC();
  const { id, relationship, label, outcome, outcomeUnreadable, evidence } =
    criterion;
  const name = label ?? `^${id}`;
  const tested = evidence.length > 0;
  // The rewording as typed, held here so the warning's *save the edit* can
  // send it — on a tested criterion a blur never saves, since reaching for
  // *add a new criterion instead* would otherwise commit the edit it avoids.
  const [editing, setEditing] = useState<string | null>(null);
  // A Relationship chosen on a tested criterion, waiting on the warning.
  const [relabel, setRelabel] = useState<Relationship | null>(null);
  // *attach evidence* open (#371), and a run it could not make.
  const [attaching, setAttaching] = useState(false);
  const [unmade, setUnmade] = useState<string | null>(null);
  const write = useCriterionWrite("record it");
  const rewording = useCriterionWrite("save the criterion", () =>
    setEditing(null)
  );
  const deleting = useCriterionWrite("delete the criterion");
  const set = useMutation(
    trpc.hypotheses.setCriterionField.mutationOptions(write.options)
  );
  const setRelationship = (value: Relationship) =>
    set.mutate({ path, id, field: "relationship", value, basedOn: hash });
  const save = (text: string) =>
    edit.mutate({ path, id, text, was: criterion.text, basedOn: hash });
  const edit = useMutation(
    trpc.hypotheses.editCriterion.mutationOptions(rewording.options)
  );
  const remove = useMutation(
    trpc.hypotheses.deleteCriterion.mutationOptions(deleting.options)
  );

  const chips: Array<{ text: string; tone: "outcome" | "quiet" }> = [];
  if (outcomeUnreadable !== null) {
    chips.push({
      text: `outcome unreadable: ${outcomeUnreadable}`,
      tone: "quiet",
    });
  } else if (outcome === null) {
    chips.push({ text: "awaiting evidence", tone: "quiet" });
  } else {
    chips.push({ text: outcome, tone: "outcome" });
    if (evidence.length === 0)
      chips.push({ text: "no run named", tone: "quiet" });
  }
  if (relationship === null) {
    chips.push({ text: "does not count yet", tone: "quiet" });
  }

  return (
    <article className={styles.card} aria-label={`Criterion ${name}`}>
      <div className={styles.cardHead}>
        <span className={styles.relationship}>
          {relationship === null
            ? "no relationship"
            : `${relationship} · ${label}`}
        </span>
        <span className={styles.chips}>
          {chips.map(({ text, tone }) => (
            <span key={text} className={styles.chip} data-tone={tone}>
              {text}
            </span>
          ))}
        </span>
      </div>
      {editing !== null ? (
        <CriterionField
          label={`Criterion ${name}`}
          text={criterion.text}
          value={editing}
          onChange={setEditing}
          saveOnBlur={!tested}
          onSave={save}
          onClose={() => {
            rewording.clear();
            setEditing(null);
          }}
        />
      ) : (
        <p className={styles.criterionText}>{criterion.text}</p>
      )}
      {tested && editing !== null && (
        <Warning
          name={name}
          lines={evidence.length}
          change="Changing the wording"
          confirm="save the edit"
          onConfirm={() => save(editing)}
          onInstead={() => {
            rewording.clear();
            setEditing(null);
            onInstead({ text: editing, relationship: null });
          }}
        />
      )}
      {relabel !== null && (
        <Warning
          name={name}
          lines={evidence.length}
          change={`Making it ${relabel}`}
          confirm={`make it ${relabel}`}
          onConfirm={() => {
            setRelabel(null);
            setRelationship(relabel);
          }}
          onInstead={() => {
            setRelabel(null);
            onInstead({ text: criterion.text, relationship: relabel });
          }}
          onLeave={() => setRelabel(null)}
        />
      )}
      {criterion.editedAfterEvidence.length > 0 && (
        <Marks marks={criterion.editedAfterEvidence} />
      )}
      {tested && <Lines lines={evidence} empty="" />}
      <div className={styles.controls}>
        <Choice
          label="Outcome"
          name={`outcome-${id}`}
          values={OUTCOMES}
          chosen={outcome}
          onChoose={(value) =>
            set.mutate({ path, id, field: "outcome", value, basedOn: hash })
          }
        />
        <Choice
          label="Relationship"
          name={`relationship-${id}`}
          values={RELATIONSHIPS}
          chosen={relationship}
          onChoose={(value) =>
            tested ? setRelabel(value) : setRelationship(value)
          }
        />
        <span className={styles.verbs}>
          {editing === null && (
            <button
              type="button"
              className={rq.edit}
              onClick={() => setEditing(criterion.text)}
            >
              edit
            </button>
          )}
          <button
            type="button"
            className={rq.edit}
            onClick={() => {
              setUnmade(null);
              setAttaching(true);
            }}
          >
            attach evidence
          </button>
          {tested && relationship !== "diagnostic" && (
            // The sanctioned way out of the rule, so it asks nothing: the
            // core marks it all the same (ADR 0031 decision 5).
            <button
              type="button"
              className={rq.edit}
              onClick={() => setRelationship("diagnostic")}
            >
              make diagnostic
            </button>
          )}
          {!tested && (
            <button
              type="button"
              className={rq.edit}
              onClick={() => remove.mutate({ path, id, basedOn: hash })}
            >
              delete
            </button>
          )}
        </span>
      </div>
      <Refusal refusal={write.refusal} />
      <Refusal refusal={rewording.refusal} />
      <Refusal refusal={deleting.refusal} />
      <Refusal refusal={unmade} />
      {attaching && (
        <AttachRun
          group={{ path, claim, hash }}
          criterion={criterion}
          onRefused={setUnmade}
          onClose={() => setAttaching(false)}
        />
      )}
    </article>
  );
}

/**
 * The warning at the moment of editing a tested criterion (prototype 04,
 * "at the moment of editing"): the change will be recorded as *edited
 * after evidence* and shown on the criterion for good. Criteria are not
 * locked — a badly worded one should be fixable — so the change is one
 * button away, and beside it the alternative that keeps the record honest:
 * a new criterion next to the old one, which costs nothing and leaves both.
 */
function Warning({
  name,
  lines,
  change,
  confirm,
  onConfirm,
  onInstead,
  onLeave,
}: {
  name: string;
  lines: number;
  change: string;
  confirm: string;
  onConfirm: () => void;
  onInstead: () => void;
  onLeave?: () => void;
}) {
  const evidence =
    lines === 1 ? "one line of evidence" : `${lines} lines of evidence`;
  return (
    <div
      role="note"
      aria-label="Edited after evidence"
      className={styles.afterEvidence}
    >
      <p className={styles.afterEvidenceLead}>
        There is already {evidence} under {name}.
      </p>
      <p className={styles.afterEvidenceText}>
        {change} now is recorded as edited after evidence and shown on the
        criterion permanently. If the criterion was simply wrong, that is a fine
        reason — the history will take a why.
      </p>
      <div className={styles.verbs}>
        <button
          type="button"
          className={rq.action}
          // Keep the field's focus: a mouse-down here must not blur it first.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onConfirm}
        >
          {confirm}
        </button>
        <button
          type="button"
          className={rq.edit}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onInstead}
        >
          add a new criterion instead
        </button>
        {onLeave !== undefined && (
          <button type="button" className={rq.edit} onClick={onLeave}>
            leave it
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The mark, forever afterwards (prototype 04): each time the criterion's
 * wording or Relationship changed with evidence under it, when, the wording
 * it replaced, and the why if one was written — so the page cannot be read
 * as though the criterion had always said this. Read from the history by
 * the core, so it lasts exactly as long as the entry does.
 */
function Marks({ marks }: { marks: AfterEvidenceMark[] }) {
  return (
    <div
      role="note"
      aria-label="Edited after evidence"
      className={styles.afterEvidence}
    >
      {marks.map(({ at, why, was }, i) => (
        // Two hand-written entries may share a timestamp.
        <div key={`${at} ${i}`} className={styles.mark}>
          <p className={styles.afterEvidenceHead}>
            edited {localDate(at)}, after evidence
          </p>
          <p className={styles.afterEvidenceText}>
            was — “{was.text}”
            {was.relationship !== null && ` · ${was.relationship}`}
          </p>
          {why !== null && <p className={styles.afterEvidenceWhy}>{why}</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * A row of radio buttons for one field of a criterion. Native radios, so
 * the arrows move within the row as the platform's do; nothing is checked
 * when the file records nothing, which is how *awaiting evidence* and a
 * criterion with no Relationship read.
 */
function Choice<T extends string>({
  label,
  name,
  values,
  chosen,
  onChoose,
}: {
  label: string;
  name: string;
  values: readonly T[];
  chosen: T | null;
  onChoose: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.choice}>
      {values.map((value) => (
        <label key={value} className={styles.option}>
          <input
            type="radio"
            name={name}
            value={value}
            checked={chosen === value}
            onChange={() => onChoose(value)}
          />
          {value}
        </label>
      ))}
    </div>
  );
}

/** A field opened by a verb takes the keyboard: the typing goes where it was asked for. */
function useFocusOnOpen(open = true): RefObject<HTMLInputElement | null> {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  return ref;
}

/**
 * The criterion's text as a one-line field: it is a heading in the file,
 * so a line break has nowhere to go. ↵ and blur save; esc puts the text
 * back and closes. A refused save leaves the field open with the typing.
 * On a tested criterion blur does not save (`saveOnBlur`): the edit is
 * made on purpose, by ↵ or the warning's button.
 */
function CriterionField({
  label,
  text,
  value,
  onChange,
  saveOnBlur,
  onSave,
  onClose,
}: {
  label: string;
  text: string;
  value: string;
  onChange: (value: string) => void;
  saveOnBlur: boolean;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const field = useFocusOnOpen();
  // An ↵ followed by the blur it causes is one save, not two.
  const settled = useRef(false);
  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    if (value.trim() === text) onClose();
    else onSave(value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      settled.current = true;
      onClose();
    }
  };
  return (
    <input
      type="text"
      aria-label={label}
      className={styles.criterionField}
      value={value}
      ref={field}
      onChange={(event) => {
        settled.current = false;
        onChange(event.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={saveOnBlur ? commit : undefined}
    />
  );
}

/**
 * *+ criterion* and the form it opens (spec #327 story 21, TEST-1): the
 * text and the Relationship, with none chosen and no default — choosing
 * what the criterion means for the claim is part of writing it, so *add*
 * waits for both. ↵ adds, esc closes and writes nothing. Offered in place
 * of editing a tested criterion, it opens holding that edit.
 */
function AddCriterion({
  path,
  hash,
  draft,
}: {
  path: string;
  hash: string;
  /** Opens the form already holding what a tested criterion's card was about to write (#335). */
  draft: Draft | null;
}) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(draft !== null);
  const [text, setText] = useState(draft?.text ?? "");
  const [relationship, setRelationship] = useState<Relationship | null>(
    draft?.relationship ?? null
  );
  const close = () => {
    setOpen(false);
    setText("");
    setRelationship(null);
  };
  const adding = useCriterionWrite("add the criterion", close);
  const add = useMutation(
    trpc.hypotheses.addCriterion.mutationOptions(adding.options)
  );
  const field = useFocusOnOpen(open);
  const ready = text.trim() !== "" && relationship !== null;
  const submit = () => {
    if (!ready || add.isPending) return;
    add.mutate({ path, text, relationship, basedOn: hash });
  };

  if (!open) {
    return (
      <button
        type="button"
        className={`${rq.edit} ${styles.addCriterion}`}
        onClick={() => setOpen(true)}
      >
        + criterion
      </button>
    );
  }
  return (
    <form
      aria-label="New criterion"
      className={styles.newCriterion}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        type="text"
        aria-label="Criterion"
        placeholder="What would show the claim true, or false"
        className={styles.criterionField}
        value={text}
        ref={field}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            adding.clear();
            close();
          } else if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className={styles.controls}>
        <Choice
          label="Relationship"
          name="relationship-new"
          values={RELATIONSHIPS}
          chosen={relationship}
          onChoose={setRelationship}
        />
        <button type="submit" className={rq.action} disabled={!ready}>
          add
        </button>
      </div>
      <Refusal refusal={adding.refusal} />
    </form>
  );
}
