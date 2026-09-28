import type { Related as RelatedRead, RelatedQuestion } from "core";
import styles from "./Hypothesis.module.css";
import { addressOf, markOf } from "./kinds";
import rq from "./ResearchQuestion.module.css";
import { linkLabel } from "./wikilink";

/**
 * The related rail (#339; spec #327 story 18; ADR 0031 decision 11): the
 * object the Hypothesis was promoted from, and every Question whose `from:`
 * names it — the core's query, drawn in prototype 04's side column. There is
 * no related-questions section on a Hypothesis to keep: a capture made here
 * joins the rail by naming the page, and leaves it by naming another.
 */
export function Related({ related }: { related: RelatedRead }) {
  const { promotedFrom, questions } = related;
  const nothing = promotedFrom === null && questions.length === 0;
  return (
    <aside className={styles.rail} aria-label="Related">
      <h2 className={rq.label}>Related</h2>
      {nothing ? (
        <p className={styles.railEmpty}>
          Nothing yet. Questions captured on this page land here.
        </p>
      ) : (
        <ul className={styles.railList}>
          {promotedFrom !== null && (
            <li className={styles.railItem}>
              {promotedFrom.path === null ? (
                // Named rather than dropped: a parent that no longer
                // resolves is something to fix, not an absence.
                <>
                  <span className={styles.railText}>
                    {linkLabel(promotedFrom.link)}
                  </span>
                  <span className={styles.railRel}>
                    the parent · {promotedFrom.reason}
                  </span>
                </>
              ) : (
                <>
                  <Named
                    text={promotedFrom.display ?? linkLabel(promotedFrom.link)}
                    href={addressOf(promotedFrom.kind, promotedFrom.path)}
                  />
                  <span className={styles.railRel}>
                    {kindWord(promotedFrom.kind)} · the parent
                  </span>
                </>
              )}
            </li>
          )}
          {questions.map((q) => (
            <li key={q.path} className={styles.railItem}>
              <Named text={q.question} href={addressOf("question", q.path)} />
              <span className={styles.railRel}>{relOf(q)}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Named({ text, href }: { text: string; href: string | null }) {
  return href === null ? (
    <span className={styles.railText}>{text}</span>
  ) : (
    <a className={styles.railText} href={href}>
      {text}
    </a>
  );
}

function kindWord(kind: string | null): string {
  if (kind === null) return "file";
  return markOf(kind)?.label ?? kind;
}

/**
 * How the Question came to name this page, in its Provenance's words: the
 * follow-up the result raised, a sub-question raised on the page, or — for
 * a `from:` written by hand — only that it names it. A Status other than
 * open is said, since the rail is where one would look for its answer.
 */
function relOf(q: RelatedQuestion): string {
  const how =
    q.context === "resolving"
      ? "the follow-up to this result"
      : q.context === "pursuing"
        ? "raised on this page"
        : "names this page";
  return ["question", how, ...(q.status === "open" ? [] : [q.status])].join(
    " · "
  );
}
