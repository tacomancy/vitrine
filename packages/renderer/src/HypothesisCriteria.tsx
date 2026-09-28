import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CriterionRead, Outcome, Relationship, SavedAnswer } from "core";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import styles from "./Hypothesis.module.css";
import { Lines, Outline } from "./ResearchQuestion";
import rq from "./ResearchQuestion.module.css";
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
  criteria,
}: {
  path: string;
  hash: string;
  criteria: CriterionRead[];
}) {
  const falsifying = criteria.filter((c) => c.relationship === "falsifying");
  const rest = criteria.filter((c) => c.relationship !== "falsifying");
  const card = (c: CriterionRead) => (
    <Card key={c.id} path={path} hash={hash} criterion={c} />
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
      <AddCriterion path={path} hash={hash} />
    </div>
  );
}

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
          setRefusal(`could not ${verb}: ${result.reason} — ${result.detail}`);
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
 * (decision 5), and the core refuses it after.
 */
function Card({
  path,
  hash,
  criterion,
}: {
  path: string;
  hash: string;
  criterion: CriterionRead;
}) {
  const trpc = useTRPC();
  const { id, relationship, label, outcome, outcomeUnreadable, evidence } =
    criterion;
  const name = label ?? `^${id}`;
  const [editing, setEditing] = useState(false);
  const write = useCriterionWrite("record it");
  const rewording = useCriterionWrite("save the criterion", () =>
    setEditing(false)
  );
  const deleting = useCriterionWrite("delete the criterion");
  const set = useMutation(
    trpc.hypotheses.setCriterionField.mutationOptions(write.options)
  );
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
      {editing ? (
        <CriterionField
          label={`Criterion ${name}`}
          text={criterion.text}
          onSave={(text) =>
            edit.mutate({ path, id, text, was: criterion.text, basedOn: hash })
          }
          onClose={() => {
            rewording.clear();
            setEditing(false);
          }}
        />
      ) : (
        <p className={styles.criterionText}>{criterion.text}</p>
      )}
      {evidence.length > 0 && <Lines lines={evidence} empty="" />}
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
            set.mutate({
              path,
              id,
              field: "relationship",
              value,
              basedOn: hash,
            })
          }
        />
        <span className={styles.verbs}>
          {!editing && (
            <button
              type="button"
              className={rq.edit}
              onClick={() => setEditing(true)}
            >
              edit
            </button>
          )}
          {evidence.length === 0 && (
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
    </article>
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
 */
function CriterionField({
  label,
  text,
  onSave,
  onClose,
}: {
  label: string;
  text: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(text);
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
        setValue(event.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  );
}

/**
 * *+ criterion* and the form it opens (spec #327 story 21, TEST-1): the
 * text and the Relationship, with none chosen and no default — choosing
 * what the criterion means for the claim is part of writing it, so *add*
 * waits for both. ↵ adds, esc closes and writes nothing.
 */
function AddCriterion({ path, hash }: { path: string; hash: string }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [relationship, setRelationship] = useState<Relationship | null>(null);
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
