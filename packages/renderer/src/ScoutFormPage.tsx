import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { questionChoices } from "./AssignedQuestions";
import { dropDraft, readDraft, writeDraft } from "./scout-draft";
import { hashOf, replaceRoute, SCOUT_MANAGEMENT } from "./router";
import { ScoutForm, type FormValues, type Tried } from "./ScoutForm";
import styles from "./ScoutQueue.module.css";
import { useTRPC } from "./trpc";

/**
 * A Scout's form at its own Address (ADR 0053 decision 5; spec #854): new, or
 * one Scout's by id. The window holds nothing of it: the draft is kept under
 * the Address (`scout-draft.ts`), so the form comes back as left from a
 * reload, from Settings and from the back button.
 */
export function ScoutFormPage({
  vaultPath,
  scout,
  assigning,
}: {
  vaultPath: string;
  /** The Scout being edited, by id; absent for a new one. */
  scout?: string | undefined;
  /** A Question a new Scout starts Assigned to (*brief a scout* on a coverage gap). */
  assigning?: string | undefined;
}) {
  const trpc = useTRPC();
  const scouts = useQuery(trpc.scouts.list.queryOptions());
  const questionList = useQuery(
    trpc.questions.list.queryOptions({ order: "newest" })
  );
  // Read once, on arrival: what is typed afterwards is the form's to hold.
  const [draft] = useState(() => readDraft(vaultPath, scout));
  // What a fresh form held when it opened. A form nobody has touched is not a
  // draft: keeping it would hand its *Assigned* default to the next new Scout.
  // A restored draft is one already, so it is always kept.
  const opened = useRef<string | null>(null);

  const editing =
    scout === undefined
      ? undefined
      : scouts.data?.scouts.find((s) => s.id === scout);
  const missing =
    scout !== undefined && scouts.data !== undefined && editing === undefined;
  // A Scout that is not there says so where the window is, naming the Address
  // (ADR 0027 decision 7); replaced, so back does not return to it.
  useEffect(() => {
    if (!missing) return;
    replaceRoute({
      surface: "inbox",
      unresolved: {
        address: hashOf({ surface: "scout-form", scout }),
        reason: "no Scout with that id in this vault",
      },
    });
  }, [missing, scout]);

  if (scout !== undefined && editing === undefined) return null;

  const keep = (values: FormValues, tried: Tried | null) => {
    const snapshot = JSON.stringify(values);
    if (draft.values === null) opened.current ??= snapshot;
    if (snapshot === opened.current && tried === null) {
      dropDraft(vaultPath, scout);
    } else {
      writeDraft(vaultPath, scout, { values, tried });
    }
  };

  return (
    <div className={styles.formPage}>
      <ScoutForm
        {...(editing === undefined ? {} : { scout: editing })}
        values={draft.values}
        tried={draft.tried}
        onChange={keep}
        questions={questionChoices(questionList.data)}
        assigning={assigning}
        onDone={() => {
          // Saved or left, the draft is spent. Replaced, so back from the
          // Scouts screen goes to where the researcher came from and not to
          // a form they have finished with.
          dropDraft(vaultPath, scout);
          replaceRoute(SCOUT_MANAGEMENT);
        }}
      />
    </div>
  );
}
