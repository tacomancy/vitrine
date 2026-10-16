import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AttentionTag, LexiconView, SyncResult } from "core";
import { FirstSlot } from "./FirstSlot";
import styles from "./AttentionPanel.module.css";
import { useTRPC } from "./trpc";

/**
 * The Question Map's second panel (ADR 0045; brief § Panel 2), kept apart
 * from the matrix with an *as of* of its own, since it describes the papers
 * held and not the Questions' Material. Until a later ticket measures
 * anything it lists the Tags at the page's depth and opens each Tag's
 * Lexicon beside the list (ADR 0018): the Terms in use, where each came
 * from, the ones below the cut and the query they compile to. *Sync now*
 * measures them against OpenAlex; its first press asks in a line here, since
 * the Terms say what the user is researching (ADR 0045 decisions 4 and 10).
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
  const [asking, setAsking] = useState(false);
  const queryClient = useQueryClient();
  const sync = useMutation({
    ...trpc.lexicon.sync.mutationOptions(),
    onSettled: () => {
      void queryClient.invalidateQueries(
        trpc.questionMap.attention.pathFilter()
      );
      void queryClient.invalidateQueries(trpc.lexicon.get.pathFilter());
    },
  });

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
          {asOfLine(attention.data.asOf, attention.data.synced)}
        </span>
        <button
          type="button"
          className={styles.sync}
          disabled={sync.isPending}
          onClick={() => {
            if (attention.data.synced) sync.mutate({});
            else setAsking(true);
          }}
        >
          Sync now
        </button>
      </div>
      {asking && !attention.data.synced && (
        <div role="group" aria-label="Confirm sync" className={styles.confirm}>
          <span>
            Sync sends each placed Tag&rsquo;s Terms, and nothing else from your
            vault, to OpenAlex (api.openalex.org). No account or key.
          </span>
          <button
            type="button"
            className={styles.sync}
            onClick={() => {
              setAsking(false);
              sync.mutate({ confirm: true });
            }}
          >
            Sync
          </button>
          <button
            type="button"
            className={styles.sync}
            onClick={() => setAsking(false)}
          >
            Not now
          </button>
        </div>
      )}
      <SyncLine sync={sync} />
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

const REASON = {
  "few-papers": "too few papers with text",
  "few-in-field": "too few in the field's index",
} as const;

/** The oldest measurement's date, or what is true of a vault with none. */
function asOfLine(asOf: string | null, synced: boolean) {
  if (asOf !== null) return `as of ${asOf.slice(0, 10)}`;
  return synced ? "nothing measured yet" : "nothing synced";
}

const growthOf = (growth: number) => {
  const percent = Math.round(growth * 100);
  return `${percent < 0 ? "\u2212" : "+"}${Math.abs(percent)}%`;
};

const FAILURE = {
  network: "OpenAlex could not be reached",
  http: "OpenAlex answered with an error",
  rate_limited: "rate limited",
  parse: "OpenAlex's answer was not understood",
} as const;

/**
 * What the last sync did, in a polite state-of-the-app line: it refuses
 * nothing the user did, so it is a status and not an alert (ADR 0033), and
 * a failure is always said.
 */
function SyncLine({
  sync,
}: {
  sync: { data: SyncResult | undefined; error: { message: string } | null };
}) {
  if (sync.error !== null) {
    return (
      <p className={styles.stated} role="status">
        not synced — {sync.error.message}
      </p>
    );
  }
  const result = sync.data;
  if (result === undefined) return null;
  const limited = result.failed.some((f) => f.kind === "rate_limited");
  const others = result.failed.filter((f) => f.kind !== "rate_limited");
  return (
    <p className={styles.stated} role="status">
      {plural(result.measured, "tag", "tags")} measured
      {others.length > 0 &&
        ` · ${others.map((f) => `${f.tag}: ${FAILURE[f.kind]}`).join("; ")}`}
      {limited &&
        ` · rate limited — ${plural(result.waiting, "tag", "tags")} waiting, try again later`}
    </p>
  );
}

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
        {tag.state === "measured" && tag.growth !== null
          ? `growth ${growthOf(tag.growth)}`
          : tag.reason === null
            ? tag.state
            : `${tag.state} · ${REASON[tag.reason]}`}
      </span>
    </button>
  );
}

/** One Tag's Lexicon, read from the Index on every open: nothing here is stored. */
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
  return (
    <section className={styles.editor} aria-label={`Lexicon: ${view.display}`}>
      <h3 className={styles.editorTitle}>{view.display}</h3>
      <p className={styles.stated}>
        {plural(view.papers, "paper", "papers")} · {view.withText} with text
      </p>
      {view.counts !== null && (
        <p className={styles.stated}>
          field: {plural(view.counts.last12, "work", "works")} in the last 12
          months, {view.counts.prior12} in the 12 before
        </p>
      )}
      {view.reason === "few-papers" ? (
        <p className={styles.stated}>
          unplaced — {REASON[view.reason]}; nothing to measure yet
        </p>
      ) : (
        <>
          {view.reason === "few-in-field" && (
            <p className={styles.stated}>unplaced — {REASON[view.reason]}</p>
          )}
          {view.terms.length > 0 && (
            <ul className={styles.terms} aria-label="Terms in use">
              {view.terms.map((t) => (
                <li key={t.term} className={styles.term}>
                  <span>{t.term}</span>
                  <span className={styles.origin}>{t.origin}</span>
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
    </section>
  );
}
