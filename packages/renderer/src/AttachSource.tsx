import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Candidate, Side } from "core";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import styles from "./AttachSource.module.css";
import { ATTACHABLE } from "./kinds";
import { Picker } from "./Picker";
import { useTRPC } from "./trpc";

/**
 * The attach form (#218; § Research Question view and triage, One picker;
 * ADR 0020 decision 5): the one picker narrowed to Sources and stubs, then
 * the side — *supporting* or *opposing*, required, with no default and no
 * third answer — then the optional note on why the paper is here. When
 * nothing matched, *new stub* makes the paper first (#220) and the form
 * carries it straight on to the side.
 *
 * The side has no default because attaching *is* the judgement: a form that
 * pre-selected one would let a paper land on a side nobody chose, which is
 * the unsorted pile the ADR rejected wearing a different name.
 */
export function AttachSource({
  path,
  hash,
  onClose,
}: {
  /** The page's vault-relative path, and the hash its writes are `basedOn`. */
  path: string;
  hash: string;
  onClose: () => void;
}) {
  // The form's three faces, in the order they are reached. A stub made by
  // hand joins at the side, which is the one step no path skips: making the
  // paper is not the judgement that it is evidence.
  const [step, setStep] = useState<
    { at: "picker" } | { at: "stub" } | { at: "side"; chosen: Candidate }
  >({ at: "picker" });
  // Where the keyboard was when the form opened. Read during the first
  // render rather than in an effect: the Picker's own mount effect runs
  // first and would otherwise be what this remembers. The Picker restores
  // focus for its own step; this carries it across the step that replaces
  // it, so no caller has to remember where the page's keyboard was.
  const [restoreTo] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  const leave = () => {
    restoreTo?.focus();
    onClose();
  };

  if (step.at === "picker") {
    return (
      <Picker
        label="Attach a source"
        kinds={ATTACHABLE}
        // A page is not evidence for itself, and is not a Source anyway.
        exclude={[path]}
        newRow={{ label: "new stub", onChoose: () => setStep({ at: "stub" }) }}
        onChoose={(chosen) => setStep({ at: "side", chosen })}
        onClose={onClose}
      />
    );
  }
  if (step.at === "stub") {
    return (
      <NewStub
        onCreated={(chosen) => setStep({ at: "side", chosen })}
        onClose={leave}
      />
    );
  }
  return (
    <SideAndNote
      path={path}
      hash={hash}
      chosen={step.chosen}
      onDone={leave}
      onClose={leave}
    />
  );
}

/**
 * *New stub* (#220; ADR 0020 decision 7): the four fields § Vault layout
 * gives the hand path, and the citekey the core mints from them. The only
 * way to make a paper until Scouts land, which is why it sits here rather
 * than on a surface of its own — the moment you need one is the moment you
 * have something to attach it to.
 */
function NewStub({
  onCreated,
  onClose,
}: {
  onCreated: (chosen: Candidate) => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const [fields, setFields] = useState({
    title: "",
    authors: "",
    year: "",
    url: "",
  });
  const [refusal, setRefusal] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const create = useMutation(
    trpc.sources.createStub.mutationOptions({
      // Straight on to the side with the paper that was just made: the row
      // the picker would have shown for it, without asking for it back.
      onSuccess: (stub) =>
        onCreated({
          path: stub.path,
          name: stub.citekey,
          kind: "source-stub",
          title: fields.title,
          pdf: false,
        }),
      // A refused write is a line in the form, with the typing still in it.
      onError: (error) => setRefusal(error.message),
    })
  );

  const ready = fields.title.trim() !== "";
  const submit = () => {
    if (!ready || create.isPending) return;
    create.mutate(fields);
  };
  const field = (key: keyof typeof fields) => ({
    value: fields[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setFields((was) => ({ ...was, [key]: event.target.value })),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        submit();
      }
    },
  });

  return (
    <div
      className={styles.form}
      role="dialog"
      aria-label="New stub"
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className={styles.row}>
        <span className={styles.label}>New stub</span>
        <span className={styles.hint}>↵ makes it · esc leaves</span>
      </div>

      <Field label="Title">
        <input
          ref={titleRef}
          type="text"
          className={styles.text}
          aria-label="Title"
          placeholder="the paper, as it is titled"
          {...field("title")}
        />
      </Field>

      <div className={styles.rest}>
        <Field label="Authors">
          <input
            type="text"
            className={styles.text}
            aria-label="Authors"
            // Semicolons, because a comma already means surname-first
            // inside one name (`sources.ts`).
            placeholder="Klinzing, Jens G.; Niethard, Niels"
            {...field("authors")}
          />
        </Field>
        <Field label="Year">
          <input
            type="text"
            className={styles.text}
            aria-label="Year"
            placeholder="2019"
            {...field("year")}
          />
        </Field>
      </div>

      <Field label="URL">
        <input
          type="text"
          className={styles.text}
          aria-label="URL"
          placeholder="where it can be read"
          {...field("url")}
        />
      </Field>

      <div className={styles.row}>
        <button
          type="button"
          className={styles.attach}
          disabled={!ready || create.isPending}
          onClick={submit}
        >
          make it
        </button>
        <span className={styles.hint}>
          {ready
            ? "then the side it goes on"
            : "a title is what names the paper"}
        </span>
      </div>
      {refusal !== null && (
        <p role="status" className={styles.refusal}>
          could not make the stub: {refusal}
        </p>
      )}
    </div>
  );
}

/** The two sides, in the order the page draws its columns. */
const SIDES: Side[] = ["supporting", "opposing"];

function SideAndNote({
  path,
  hash,
  chosen,
  onDone,
  onClose,
}: {
  path: string;
  hash: string;
  chosen: Candidate;
  onDone: () => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [side, setSide] = useState<Side | null>(null);
  const [note, setNote] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const attach = useMutation(
    trpc.researchQuestions.attachSource.mutationOptions({
      onSuccess: (result) => {
        // A refused write is a line in the form, with the typing still in
        // it — never a dialog that closes as if it had landed.
        if (!result.written) {
          setRefusal(`${result.reason} — ${result.detail}`);
          return;
        }
        void queryClient.invalidateQueries(
          trpc.researchQuestions.page.pathFilter()
        );
        onDone();
      },
      onError: (error) => setRefusal(error.message),
    })
  );

  const submit = () => {
    if (side === null || attach.isPending) return;
    attach.mutate({ path, target: chosen.path, side, note, basedOn: hash });
  };

  return (
    <div
      className={styles.form}
      role="dialog"
      aria-label={`Attach ${chosen.name}`}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className={styles.row}>
        <span className={styles.label}>Attach {chosen.name}</span>
        <span className={styles.hint}>esc leaves</span>
      </div>

      <Field label="Which side">
        <div className={styles.sides} role="radiogroup" aria-label="Which side">
          {SIDES.map((value, index) => (
            <label key={value} className={styles.side}>
              <input
                ref={index === 0 ? firstRef : undefined}
                type="radio"
                name="side"
                value={value}
                checked={side === value}
                onChange={() => setSide(value)}
              />
              <span>{value}</span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Why it is here">
        <input
          type="text"
          className={styles.note}
          aria-label="Why it is here"
          placeholder="optional — the finding that puts it on this side"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
      </Field>

      <div className={styles.row}>
        <button
          type="button"
          className={styles.attach}
          disabled={side === null || attach.isPending}
          onClick={submit}
        >
          attach
        </button>
        <span className={styles.hint}>
          {side === null
            ? "choose a side — attaching is the judgement"
            : `lands in ${side} sources`}
        </span>
      </div>
      {refusal !== null && (
        <p role="status" className={styles.refusal}>
          could not attach: {refusal}
        </p>
      )}
    </div>
  );
}

/** One labelled step of the form, in the picker's voice. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}
