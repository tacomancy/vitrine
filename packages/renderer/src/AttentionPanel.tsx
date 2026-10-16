import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AttentionTag, LexiconView } from "core";
import { FirstSlot } from "./FirstSlot";
import { RefusalLine, useRefusal } from "./refusal-line";
import styles from "./AttentionPanel.module.css";
import { useTRPC } from "./trpc";

/**
 * The Question Map's second panel (ADR 0045; brief § Panel 2), kept apart
 * from the matrix with an *as of* of its own, since it describes the papers
 * held and not the Questions' Material. Until a later ticket measures
 * anything it lists the Tags at the page's depth and opens each Tag's
 * Lexicon beside the list (ADR 0018): the Terms in use, where each came
 * from, the ones below the cut and the query they compile to, with the two
 * edits the user has — Seed a Term by typing it, Exclude a derived one — each
 * undoable and each belonging to the Tag as written (ADR 0045 decision 3).
 *
 * It sits behind the page's own gate, so it never claims anything of a vault
 * that has not been read in full.
 */
export function AttentionPanel({ depth }: { depth: number | undefined }) {
  const trpc = useTRPC();
  const attention = useQuery({
    ...trpc.questionMap.attention.queryOptions(
      depth === undefined ? undefined : { depth }
    ),
    placeholderData: (previous) => previous,
  });
  const [chosen, setChosen] = useState<string>();

  if (attention.isError) {
    return (
      <section className={styles.panel} aria-labelledby="attention-title">
        <h2 id="attention-title" className={styles.title}>
          Attention
        </h2>
        <p className={styles.stated} role="status">
          not read — {attention.error.message}
        </p>
      </section>
    );
  }
  if (attention.data === undefined) return null;
  const { tags, sources } = attention.data;

  return (
    <section className={styles.panel} aria-labelledby="attention-title">
      <div className={styles.header}>
        <h2 id="attention-title" className={styles.title}>
          Attention
        </h2>
        <span className={styles.stated}>
          as of {attention.data.asOf ?? "nothing synced"}
        </span>
      </div>
      <p className={styles.stated}>
        counts papers held, not papers attached to questions
      </p>
      {tags.length === 0 ? (
        <FirstSlot
          voice="claim"
          claim="No tags to place."
          warrant={`read ${sources} of ${sources} sources · just now`}
        />
      ) : (
        <div className={styles.body}>
          <ul className={styles.list}>
            {tags.map((tag) => (
              <li key={tag.tag}>
                <TagButton
                  tag={tag}
                  pressed={tag.tag === chosen}
                  onChoose={() => setChosen(tag.tag)}
                />
              </li>
            ))}
          </ul>
          {chosen !== undefined && <Editor tag={chosen} depth={depth} />}
        </div>
      )}
    </section>
  );
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const REASON = { "few-papers": "too few papers with text" } as const;

function TagButton({
  tag,
  pressed,
  onChoose,
}: {
  tag: AttentionTag;
  pressed: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.tag}
      aria-pressed={pressed}
      onClick={onChoose}
    >
      <span>{tag.display}</span>
      <span className={styles.facts}>
        {plural(tag.papers, "paper", "papers")} ·{" "}
        {tag.reason === null
          ? tag.state
          : `${tag.state} · ${REASON[tag.reason]}`}
      </span>
    </button>
  );
}

/** One Tag's Lexicon, read on every open: the Terms are derived, only the edits are stored. */
function Editor({ tag, depth }: { tag: string; depth: number | undefined }) {
  const trpc = useTRPC();
  const lexicon = useQuery(
    trpc.lexicon.get.queryOptions(
      depth === undefined ? { tag } : { tag, depth }
    )
  );
  if (lexicon.isError) {
    return (
      <p className={styles.stated} role="status">
        not read — {lexicon.error.message}
      </p>
    );
  }
  if (lexicon.data === undefined) return null;
  return <LexiconEditor view={lexicon.data} />;
}

function LexiconEditor({ view }: { view: LexiconView }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // An alert on the control, since a refused Seed is a refused act (ADR 0033).
  const refusal = useRefusal();
  const [typed, setTyped] = useState("");

  const settled = () => {
    void queryClient.invalidateQueries(trpc.lexicon.get.pathFilter());
    void queryClient.invalidateQueries(trpc.questionMap.attention.pathFilter());
  };
  const onError = (error: { message: string }) => refusal.say(error.message);
  const seed = useMutation(
    trpc.lexicon.seed.mutationOptions({
      onSuccess: () => {
        setTyped("");
        settled();
      },
      onError,
    })
  );
  const exclude = useMutation(
    trpc.lexicon.exclude.mutationOptions({ onSuccess: settled, onError })
  );
  const restore = useMutation(
    trpc.lexicon.restore.mutationOptions({ onSuccess: settled, onError })
  );
  const edit = (
    act: { mutate: (input: { tag: string; term: string }) => void },
    term: string
  ) => {
    refusal.forget();
    act.mutate({ tag: view.tag, term });
  };

  return (
    <section className={styles.editor} aria-label={`Lexicon: ${view.display}`}>
      <h3 className={styles.editorTitle}>{view.display}</h3>
      <p className={styles.stated}>
        {plural(view.papers, "paper", "papers")} · {view.withText} with text
      </p>
      {view.reason !== null ? (
        <p className={styles.stated}>
          unplaced — {REASON[view.reason]}; seed a term to place it
        </p>
      ) : (
        <>
          {view.terms.length > 0 && (
            <ul className={styles.terms} aria-label="Terms in use">
              {view.terms.map((t) => (
                <li key={t.term} className={styles.term}>
                  <span>{t.term}</span>
                  <span className={styles.origin}>{t.origin}</span>
                  {t.origin === "seeded" ? (
                    <button
                      type="button"
                      className={styles.edit}
                      aria-label={`Remove ${t.term}`}
                      onClick={() => edit(restore, t.term)}
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.edit}
                      aria-label={`Exclude ${t.term}`}
                      onClick={() => edit(exclude, t.term)}
                    >
                      Exclude
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {view.notUsed.length > 0 && (
            <p className={styles.stated}>
              not used: {view.notUsed.map((t) => t.term).join(", ")}
            </p>
          )}
          {view.query !== null && (
            <code className={styles.query}>{view.query}</code>
          )}
        </>
      )}
      {view.excluded.length > 0 && (
        <ul className={styles.terms} aria-label="Excluded">
          {view.excluded.map((term) => (
            <li key={term} className={styles.term}>
              <span>{term}</span>
              <span className={styles.origin}>excluded</span>
              <button
                type="button"
                className={styles.edit}
                aria-label={`Restore ${term}`}
                onClick={() => edit(restore, term)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className={styles.seed}
        onSubmit={(event) => {
          event.preventDefault();
          if (seed.isPending) return;
          edit(seed, typed);
        }}
      >
        <input
          type="text"
          className={styles.seedBox}
          aria-label="Seed a term"
          placeholder="Seed a term"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="submit" className={styles.edit}>
          Seed
        </button>
      </form>
      <RefusalLine refusal={refusal} className={styles.refusal} />
    </section>
  );
}
