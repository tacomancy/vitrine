import { useQuery } from "@tanstack/react-query";
import type {
  LinkLine,
  OpenThread,
  ResearchQuestionFrontmatter,
  ShapeProblem,
} from "core";
import { useCallback, useState, type ReactNode } from "react";
import { formatAge } from "./age";
import { useVaultChanged } from "./events";
import styles from "./ResearchQuestion.module.css";
import { replaceRoute } from "./router";
import { localDateTime } from "./rows";
import { StatusGlyph } from "./StatusGlyph";
import { useTRPC } from "./trpc";
import { useVaultStatusLines } from "./VaultStatusLines";

/**
 * The Research Question view (brief § Surfaces; prompt 3; ADR 0020): one
 * page per promoted question, at `#/questions/<path>`. This slice is the
 * page read (#209) — the question, its provenance and status, and the six
 * sections as the file holds them. The most common state is a freshly
 * promoted page with almost nothing in it, so an empty section is drawn as
 * a quiet outline with one sentence on what belongs there, never as a gap.
 * Every section becomes editable in the tickets that own it.
 */
export function ResearchQuestion({ path }: { path: string }) {
  const trpc = useTRPC();
  const page = useQuery(trpc.researchQuestions.page.queryOptions({ path }));
  const status = useVaultStatusLines();

  // The page follows its file as the Inbox's selection does (§ Index, Inbox
  // under external change): a rename moves the address so the re-read lands
  // on `to`; a removal is an absence line, not a stale page and not an alarm.
  // The window mounts the page with `key={path}`, so a new address starts
  // with no absence remembered.
  const [removed, setRemoved] = useState<string | null>(null);
  useVaultChanged(
    useCallback(
      ({ changed, renamed, removed: gone }) => {
        if (gone.includes(path)) setRemoved(path);
        // The file came back (an undo, a sync flap): the re-read shows it.
        else if (changed.includes(path)) setRemoved(null);
        const move = renamed.find(({ from }) => from === path);
        if (move) replaceRoute({ surface: "questions", path: move.to });
      },
      [path]
    )
  );

  const data = page.data;
  const readable = removed === null && data?.readable === true ? data : null;
  const problems = readable?.problems ?? [];
  const hasFooter = problems.length > 0 || status.hasLines;

  return (
    <section className={styles.page} aria-label="Research Question view">
      {/* A refused read is a failure, not an absence: it must not read as a quiet page. */}
      {page.isError && (
        <p className={styles.refused} role="alert">
          {page.error.message}
        </p>
      )}
      {removed !== null && (
        <p className={styles.absent}>{removed} — removed from the vault</p>
      )}
      {removed === null && data?.readable === false && (
        <p className={styles.absent}>
          {data.path} — {data.reason}
        </p>
      )}
      {readable !== null && (
        <div className={styles.scroll}>
          <Header frontmatter={readable.frontmatter} />
          <Section
            name="Working answer"
            present={readable.sections.workingAnswer.present}
          >
            {readable.sections.workingAnswer.text === "" ? (
              <Outline>
                Nothing written yet. What you currently believe goes here —
                provisional, and every change to it is kept.
              </Outline>
            ) : (
              <div className={styles.answer}>
                {paragraphs(readable.sections.workingAnswer.text).map(
                  (p, i) => (
                    <p key={i}>{p}</p>
                  )
                )}
              </div>
            )}
          </Section>
          <div className={styles.sides}>
            <Section
              name="Supporting sources"
              present={readable.sections.supporting.present}
            >
              <Lines
                lines={readable.sections.supporting.lines}
                empty="Nothing attached yet. Papers that argue for the working answer collect here, each with a note on which finding does."
              />
            </Section>
            <Section
              name="Opposing sources"
              present={readable.sections.opposing.present}
            >
              <Lines
                lines={readable.sections.opposing.lines}
                empty="Nothing yet. When you find a paper that undercuts the answer, it goes here — and a page where nothing does is worth noticing."
              />
            </Section>
          </div>
          <Section
            name="Related questions"
            present={readable.sections.related.present}
          >
            <Lines
              lines={readable.sections.related.lines}
              empty="Nothing linked. Sub-questions captured from this page, and neighbours linked from the Inbox, collect here on their own."
            />
          </Section>
          <Section
            name="Open threads"
            present={readable.sections.openThreads.present}
          >
            <Threads
              threads={readable.sections.openThreads.threads}
              empty="None recorded. Threads usually appear once you have read enough to know what is missing."
            />
          </Section>
          <Section
            name="Position history"
            present={readable.sections.positionHistory.present}
          >
            {readable.sections.positionHistory.text !== "" && (
              <pre className={styles.history}>
                {readable.sections.positionHistory.text}
              </pre>
            )}
            {readable.sections.positionHistory.text === "" && (
              <Outline>
                Nothing has changed yet. The first revision is written when the
                working answer first moves.
              </Outline>
            )}
            <p className={styles.baseLine}>{baseLine(readable.frontmatter)}</p>
          </Section>
        </div>
      )}
      {hasFooter && (
        <footer className={styles.footer}>
          {problems.length > 0 && (
            <span className={styles.footerLine}>
              could not show: {problems.map(describeProblem).join(" · ")}
            </span>
          )}
          {status.lines}
        </footer>
      )}
    </section>
  );
}

/** The question in the serif, then where and when it was first wondered, then its status. */
function Header({ frontmatter }: { frontmatter: ResearchQuestionFrontmatter }) {
  const now = new Date();
  return (
    <header className={styles.header}>
      <div className={styles.kicker}>
        <span>Research Question</span>
        {/* The status word is the page's own — *abandoned*, where the Inbox
            says *dropped* — and the glyph already announces it. */}
        <span className={styles.status}>
          <StatusGlyph status={frontmatter.status} label={frontmatter.status} />
          <span aria-hidden="true">{frontmatter.status}</span>
        </span>
        {frontmatter.promoted !== undefined && (
          <span>promoted {formatAge(frontmatter.promoted, now)}</span>
        )}
      </div>
      <h1 className={styles.question}>{frontmatter.question}</h1>
      <p className={styles.provenance}>{provenanceLine(frontmatter)}</p>
    </header>
  );
}

/**
 * `first wondered 14 August 2026 · 09:12 · while reading Rasch & Born 2013 ·
 * p.699`. The context is the Provenance's own word (CONTEXT.md); `from` is
 * shown without its brackets — how a Source reads here is the Reader
 * slice's call, as on the Inbox.
 */
function provenanceLine(fm: ResearchQuestionFrontmatter): string {
  const parts: string[] = [];
  if (fm.captured !== undefined) {
    parts.push(`first wondered ${localDateTime(fm.captured)}`);
  }
  parts.push(whileDoing(fm));
  return parts.join(" · ");
}

function whileDoing(fm: ResearchQuestionFrontmatter): string {
  if (fm.from === undefined) return "unattached";
  const where =
    fm.page === undefined
      ? linkText(fm.from)
      : `${linkText(fm.from)} · p.${fm.page}`;
  return fm.context === "other" ? where : `while ${fm.context} ${where}`;
}

/** The history's base line, derived from the frontmatter and never written as an entry (spec #206 story 39). */
function baseLine(fm: ResearchQuestionFrontmatter): string {
  const when = fm.promoted === undefined ? "" : `, ${localDate(fm.promoted)}`;
  return `promoted from a capture made ${whileDoing(fm)}${when}`;
}

/** `20 September 2026`: the date part of `localDateTime`. */
const localDate = (iso: string) => localDateTime(iso).split(" · ")[0] ?? "";

/** `[[Rasch & Born 2013]]` → `Rasch & Born 2013`; an alias shows in place of the target. */
function linkText(from: string): string {
  const inner = /^\[\[(.*)\]\]$/.exec(from)?.[1];
  if (inner === undefined) return from;
  const alias = inner.split("|")[1];
  return alias ?? inner;
}

const paragraphs = (text: string) =>
  text
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");

/**
 * One of the six, as a landmark so the outline is navigable. A section the
 * file lacks — its heading retyped — is drawn in place with a line saying so,
 * and named again in the footer: the page never loses its shape because one
 * heading did.
 */
function Section({
  name,
  present,
  children,
}: {
  name: string;
  present: boolean;
  children: ReactNode;
}) {
  const id = `rq-${name.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.label}>
        {name}
      </h2>
      {present ? (
        children
      ) : (
        <p className={styles.missing}>
          not in the file — no ## {name} heading was found.
        </p>
      )}
    </section>
  );
}

/** An empty section: a quiet outline around one sentence on what belongs there. */
function Outline({ children }: { children: ReactNode }) {
  return <p className={styles.outline}>{children}</p>;
}

/** Source and related lines: the link as written, its note, and what the index says about where it lands. */
function Lines({ lines, empty }: { lines: LinkLine[]; empty: string }) {
  if (lines.length === 0) return <Outline>{empty}</Outline>;
  return (
    <ul className={styles.lines}>
      {lines.map((line, i) => (
        <li key={i} className={styles.line}>
          {line.link === null ? (
            <span className={styles.note}>{line.text}</span>
          ) : (
            <>
              <span className={styles.target}>
                {line.link.target}
                {line.link.blockId !== null && `#^${line.link.blockId}`}
              </span>
              {line.link.resolution !== "resolved" && (
                <span className={styles.resolution}>
                  {line.link.resolution}
                </span>
              )}
              {line.note !== "" && (
                <span className={styles.note}>{line.note}</span>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Open threads as a read-only task list; a line that is not a task is shown as it is. */
function Threads({ threads, empty }: { threads: OpenThread[]; empty: string }) {
  if (threads.length === 0) return <Outline>{empty}</Outline>;
  return (
    <ul className={styles.lines}>
      {threads.map((thread, i) => (
        <li key={i} className={styles.thread}>
          {thread.done !== null && (
            <span
              role="checkbox"
              aria-checked={thread.done}
              aria-disabled="true"
              className={styles.box}
            >
              {thread.done ? "☑" : "☐"}
            </span>
          )}
          <span className={thread.done === true ? styles.done : undefined}>
            {thread.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One problem as the footer says it: the section named, the fault in plain words. */
function describeProblem(problem: ShapeProblem): string {
  const block = problem.block ?? "";
  switch (problem.problem) {
    case "sectionMissing":
      return `${block} is not in the file`;
    case "sectionDuplicated":
    case "ownedSectionDuplicated":
      return `${block} is in the file twice`;
    default:
      return `${problem.problem}${block === "" ? "" : ` (${block})`}`;
  }
}
