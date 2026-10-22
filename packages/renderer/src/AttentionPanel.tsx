import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AttentionTag, LexiconView, SyncResult } from "core";
import { Scatter, growthOf } from "./charts/scatter";
import { Button, Input } from "./Form";
import { FirstSlot } from "./FirstSlot";
import { RefusalLine, useRefusal } from "./refusal-line";
import styles from "./AttentionPanel.module.css";
import { useTRPC } from "./trpc";

/**
 * The Question Map's second panel (ADR 0045; brief § Panel 2), kept apart
 * from the matrix with an *as of* of its own, since it describes the papers
 * held and not the Questions' Material. It lists the Tags at the page's
 * depth and opens each Tag's Lexicon beside the list (ADR 0018): the Terms
 * in use, where each came from, the ones below the cut and the query they
 * compile to, with the two edits the user has — Seed a Term by typing it,
 * Exclude a derived one — each undoable and each belonging to the Tag as
 * written (ADR 0045 decision 3). *Sync now* measures them against OpenAlex;
 * its first press asks in a line here, since the Terms say what the user is
 * researching (ADR 0045 decisions 4 and 10).
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
  const { tags, sources, crossing } = attention.data;
  const measured = tags.filter((t) => t.state === "measured");
  // Unplaced is a Tag the chart cannot honestly plot, never a Tag plotted low
  // (ADR 0045 decision 5), so it is listed beside the chart as a chip with
  // its reason and is not a point.
  const unplaced = tags.filter((t) => t.state === "unplaced");
  const listed = tags.filter((t) => t.state !== "unplaced");

  return (
    <section className={styles.panel} aria-labelledby="attention-title">
      <div className={styles.header}>
        <h2 id="attention-title" className={styles.title}>
          Attention
        </h2>
        <span className={styles.stated}>
          {asOfLine(attention.data.asOf, attention.data.synced)}
        </span>
        <span className={styles.syncNow}>
          <Button
            disabled={sync.isPending}
            onClick={() => {
              if (attention.data.synced) sync.mutate({});
              else setAsking(true);
            }}
          >
            Sync now
          </Button>
        </span>
      </div>
      {asking && !attention.data.synced && (
        <div role="group" aria-label="Confirm sync" className={styles.confirm}>
          <span>
            Sync sends each placed Tag&rsquo;s Terms, and nothing else from your
            vault, to OpenAlex (api.openalex.org). No account or key.
          </span>
          <Button
            tier="primary"
            onClick={() => {
              setAsking(false);
              sync.mutate({ confirm: true });
            }}
          >
            Sync
          </Button>
          <Button onClick={() => setAsking(false)}>Not now</Button>
        </div>
      )}
      <SyncLine sync={sync} />
      {/* Read from what is stored, so a failure outlives the sync that saw it
          (the one on open has no caller to tell) and never looks like a quiet
          field. A Tag that failed keeps its last Measurement and its date. */}
      {attention.data.measuring !== null ? (
        <p className={styles.stated} role="status">
          measuring {attention.data.measuring.done} of{" "}
          {attention.data.measuring.of}
        </p>
      ) : (
        <>
          <Failures tags={tags} due={attention.data.due} />
          {attention.data.synced && attention.data.due > 0 && (
            <p className={styles.stated} role="status">
              {plural(attention.data.due, "tag", "tags")} waiting to be measured
            </p>
          )}
        </>
      )}
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
          <div className={styles.beside}>
            <Scatter
              tags={measured}
              crossing={crossing}
              chosen={chosen}
              onChoose={setChosen}
            />
            {listed.length > 0 && (
              <ul className={styles.list} aria-label="Tags">
                {listed.map((tag) => (
                  <li key={tag.tag}>
                    <TagButton
                      tag={tag}
                      pressed={tag.tag === chosen}
                      onChoose={() => setChosen(tag.tag)}
                    />
                  </li>
                ))}
              </ul>
            )}
            {unplaced.length > 0 && (
              <ul className={styles.chips} aria-label="Unplaced">
                {unplaced.map((tag) => (
                  <li key={tag.tag}>
                    <TagButton
                      tag={tag}
                      pressed={tag.tag === chosen}
                      onChoose={() => setChosen(tag.tag)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
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

const FAILURE = {
  network: "OpenAlex could not be reached",
  http: "OpenAlex answered with an error",
  rate_limited: "rate limited",
  parse: "OpenAlex's answer was not understood",
} as const;

/**
 * What the last *Sync now* did, in a polite state-of-the-app line: it refuses
 * nothing the user did, so it is a status and not an alert (ADR 0033).
 * Which Tags failed is `Failures`' to say, from what is stored.
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
  if (sync.data === undefined) return null;
  return (
    <p className={styles.stated} role="status">
      {plural(sync.data.measured, "tag", "tags")} measured
    </p>
  );
}

/** Each Tag whose newest attempt failed, and why; a rate limit also says the rest are waiting. */
function Failures({ tags, due }: { tags: AttentionTag[]; due: number }) {
  const failed = tags.filter((t) => t.failure !== null);
  const limited = failed.some((t) => t.failure === "rate_limited");
  const others = failed.filter((t) => t.failure !== "rate_limited");
  if (failed.length === 0) return null;
  return (
    <p className={styles.stated} role="status">
      {others
        .map(
          (t) =>
            `${t.tag}: ${FAILURE[t.failure!]}${
              t.measuredAt === null
                ? ""
                : `, kept its measurement as of ${t.measuredAt.slice(0, 10)}`
            }`
        )
        .join("; ")}
      {others.length > 0 && limited && " · "}
      {limited &&
        `rate limited at ${failed
          .filter((t) => t.failure === "rate_limited")
          .map((t) => t.tag)
          .join(
            ", "
          )} — ${plural(due, "tag", "tags")} waiting, try again later`}
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
        {tag.pending && " · re-measure pending"}
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
      {view.counts !== null && (
        <p className={styles.stated}>
          field: {plural(view.counts.last12, "work", "works")} in the last 12
          months, {view.counts.prior12} in the 12 before
        </p>
      )}
      {view.pending && (
        <p className={styles.stated}>
          re-measure pending — the point shown was measured with an earlier
          query; the next sync re-measures it
        </p>
      )}
      {view.reason === "few-papers" ? (
        <p className={styles.stated}>
          unplaced — {REASON[view.reason]}; seed a term to place it
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
                  {t.origin === "seeded" ? (
                    <Button
                      aria-label={`Remove ${t.term}`}
                      onClick={() => edit(restore, t.term)}
                    >
                      Remove
                    </Button>
                  ) : (
                    <Button
                      aria-label={`Exclude ${t.term}`}
                      onClick={() => edit(exclude, t.term)}
                    >
                      Exclude
                    </Button>
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
              <Button
                aria-label={`Restore ${term}`}
                onClick={() => edit(restore, term)}
              >
                Restore
              </Button>
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
        <Input
          type="text"
          aria-label="Seed a term"
          placeholder="Seed a term"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <Button tier="primary">Seed</Button>
      </form>
      <RefusalLine refusal={refusal} className={styles.refusal} />
    </section>
  );
}
