import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CriterionRead, SavedAnswer } from "core";
import { useEffect, useRef, useState } from "react";
import styles from "./Hypothesis.module.css";
import rq from "./ResearchQuestion.module.css";
import { useTRPC } from "./trpc";

/**
 * Overriding inconclusive — a written act (prompt 4; prototype 04; spec
 * #327 stories 56–59, 63; TEST-6). Opened from the line under the rule,
 * never a control beside the state: it lists what the call overrules and
 * cannot be completed without a why, because the why is the whole of the
 * Override — an entry in the history, permanently, next to the derived
 * state it contradicts. Only ever to *supported*: there is no way here to
 * override to *falsified*, which goes through a falsifying criterion's
 * Outcome like any other result.
 *
 * `unlanded` is the core's list of what keeps the state from supported;
 * the form draws those criteria and decides nothing about the rule.
 */
export function OverrideForm({
  path,
  hash,
  criteria,
  unlanded,
  onClose,
}: {
  path: string;
  hash: string;
  criteria: CriterionRead[];
  unlanded: string[];
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [why, setWhy] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  const refused = (detail: string) =>
    setRefusal(`could not record the override: ${detail}`);
  const record = useMutation(
    trpc.hypotheses.override.mutationOptions({
      onSuccess: (result: SavedAnswer) => {
        if (!result.written) return refused(result.detail);
        void queryClient.invalidateQueries(trpc.hypotheses.page.pathFilter());
        onClose();
      },
      onError: (error) => refused(error.message),
    })
  );
  const ready = why.trim() !== "";
  const submit = () => {
    if (!ready || record.isPending) return;
    record.mutate({ path, why, basedOn: hash });
  };
  // The core's `nameOf`, repeated (the renderer imports only types): it is
  // how `unlanded` names a criterion, so the two must spell it alike.
  const nameOf = (c: CriterionRead) => c.label ?? `^${c.id}`;
  const overruled = criteria.filter((c) => unlanded.includes(nameOf(c)));

  return (
    <form
      aria-label="Override the derived state"
      className={styles.override}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className={styles.overrideMove}>
        <span className={styles.overrideFrom}>inconclusive</span> derived →{" "}
        <span className={styles.overrideTo}>supported</span> asserted by you
      </p>
      <h3 id="hy-overruling" className={styles.overrideHead}>
        What you are overruling
      </h3>
      <ul aria-labelledby="hy-overruling" className={styles.overruled}>
        {overruled.map((c) => (
          <li key={c.id}>
            <span className={styles.overruledLabel}>{nameOf(c)}</span>{" "}
            <span className={styles.overruledOutcome}>{standing(c)}</span> —{" "}
            {c.text}
          </li>
        ))}
      </ul>
      <label htmlFor="hy-override-why" className={styles.overrideHead}>
        Why you are overriding
      </label>
      <p id="hy-override-why-hint" className={styles.overrideHint}>
        required · goes into the history and stays there
      </p>
      <textarea
        id="hy-override-why"
        ref={field}
        aria-describedby="hy-override-why-hint"
        className={styles.overrideWhy}
        rows={4}
        value={why}
        onChange={(event) => setWhy(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className={styles.controls}>
        <button type="submit" className={rq.action} disabled={!ready}>
          override and record
        </button>
        <button type="button" className={rq.edit} onClick={onClose}>
          cancel
        </button>
        <span className={styles.overrideHint}>
          the page will read supported · overrides inconclusive
        </span>
      </div>
      {refusal !== null && (
        <p role="status" className={rq.refusal}>
          {refusal}
        </p>
      )}
    </form>
  );
}

/** Where a criterion the Override overrules stands: its Outcome, or why it has none that counts. */
function standing(c: CriterionRead): string {
  if (c.relationship === null) return "does not count yet";
  if (c.outcomeUnreadable !== null) return "outcome unreadable";
  return c.outcome ?? "awaiting evidence";
}
