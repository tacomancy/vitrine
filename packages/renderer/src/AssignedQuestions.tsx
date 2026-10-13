import { StatusGlyph } from "./StatusGlyph";
import styles from "./AssignedQuestions.module.css";

/** A Question the picker or the header can name: open ones are offered, others only when already assigned. */
export type QuestionChoice = {
  id: string;
  question: string;
  status: "open" | "promoted" | "answered" | "abandoned";
};

/**
 * The Questions a Scout may be Assigned to, as the Questions list hands them
 * over. One with no id cannot be named in a Scout's file, so it is not offered.
 */
export function questionChoices(
  listed:
    | {
        questions: ReadonlyArray<{
          id?: string | undefined;
          question: string;
          status: QuestionChoice["status"];
        }>;
      }
    | undefined
): QuestionChoice[] {
  return (listed?.questions ?? []).flatMap((q) =>
    q.id === undefined
      ? []
      : [{ id: q.id, question: q.question, status: q.status }]
  );
}

/**
 * The Questions a Scout is Assigned to, as checkboxes: the Queue's form and a
 * Scout Activity row's edit are one picker and so write one thing. Open
 * Questions only are offered (spec #447 story 5); one the Scout is already
 * assigned to stays on the list even when it has closed, so the researcher can
 * take it off and the file is never rewritten behind them.
 */
export function AssignedQuestions({
  questions,
  assigned,
  onChange,
}: {
  questions: QuestionChoice[];
  assigned: string[];
  onChange: (assigned: string[]) => void;
}) {
  const choices = questions.filter(
    (q) => q.status === "open" || assigned.includes(q.id)
  );
  const unknown = assigned.filter((id) => !questions.some((q) => q.id === id));
  return (
    <fieldset className={styles.fieldset}>
      <legend>Assigned Questions</legend>
      {choices.length === 0 && unknown.length === 0 && (
        <p className={styles.none}>no open Questions</p>
      )}
      {choices.map((q) => (
        <label key={q.id} className={styles.choice}>
          <input
            type="checkbox"
            checked={assigned.includes(q.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...assigned, q.id]
                  : assigned.filter((id) => id !== q.id)
              )
            }
          />
          <StatusGlyph status={q.status} /> {q.question}
        </label>
      ))}
      {unknown.map((id) => (
        <label key={id} className={styles.choice}>
          <input
            type="checkbox"
            checked
            onChange={() => onChange(assigned.filter((a) => a !== id))}
          />
          {id}
        </label>
      ))}
    </fieldset>
  );
}
