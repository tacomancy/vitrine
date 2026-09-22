import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LinkLine,
  OpenThread,
  ResearchQuestionFrontmatter,
  ResearchQuestionStatus,
  ResolveResult,
  ShapeProblem,
  WriteResult,
} from "core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { formatAge } from "./age";
import { useVaultChanged } from "./events";
import styles from "./ResearchQuestion.module.css";
import { hashOf, replaceRoute } from "./router";
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

  // The surface the object landed in takes the keyboard (ADR 0010): a
  // promotion from the Inbox arrives here, and the page is what should
  // answer the next key, not the list that is gone. The section is the
  // focus target until a field on it is, and it wears the brass ring like
  // the list does; the window mounts the page afresh per address, so every
  // arrival takes it.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    sectionRef.current?.focus();
  }, []);

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
    <section
      ref={sectionRef}
      className={styles.page}
      aria-label="Research Question view"
      tabIndex={-1}
    >
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
          <Header path={readable.path} frontmatter={readable.frontmatter} />
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
          <Editable
            name="Related questions"
            present={readable.sections.related.present}
            path={readable.path}
            hash={readable.hash}
            text={readable.sections.related.text}
          >
            <Lines
              lines={readable.sections.related.lines}
              empty="Nothing linked. Sub-questions captured from this page, and neighbours linked from the Inbox, collect here on their own."
            />
          </Editable>
          <Editable
            name="Open threads"
            present={readable.sections.openThreads.present}
            path={readable.path}
            hash={readable.hash}
            text={readable.sections.openThreads.text}
          >
            <Threads
              path={readable.path}
              threads={readable.sections.openThreads.threads}
              empty="None recorded. Threads usually appear once you have read enough to know what is missing."
            />
          </Editable>
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
function Header({
  path,
  frontmatter,
}: {
  path: string;
  frontmatter: ResearchQuestionFrontmatter;
}) {
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
        <Resolving path={path} status={frontmatter.status} />
      </div>
      <h1 className={styles.question}>{frontmatter.question}</h1>
      <p className={styles.provenance}>{provenanceLine(frontmatter)}</p>
    </header>
  );
}

/**
 * Resolve, abandon, reopen (ADR 0020 decision 6; § Vault layout, Research
 * Question): the Working answer as it stands is the answer, so each is one
 * button and there is no second field. Resolving writes the page and then
 * the Question it came from; a write-back that reached no Question is a line
 * here, because the page is resolved either way and the user is the only one
 * who can put that right. Reopen is offered whenever the page is resolved —
 * resolving is a status, not an archive.
 */
function Resolving({
  path,
  status,
}: {
  path: string;
  status: ResearchQuestionStatus;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  const reread = () => {
    void queryClient.invalidateQueries(
      trpc.researchQuestions.page.pathFilter()
    );
    // The Inbox's row reads the Question, whose status the write-back moved.
    void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
  };
  const fail = (error: { message: string }) => setRefusal(error.message);
  const resolve = useMutation(
    trpc.researchQuestions.resolve.mutationOptions({
      onSuccess: (result: ResolveResult) => {
        reread();
        if (!result.page.written) {
          setRefusal(
            `could not resolve: ${result.page.reason} — ${result.page.detail}`
          );
        } else if (!result.question.written) {
          setRefusal(`the Question was not marked: ${result.question.reason}`);
        } else setRefusal(null);
      },
      onError: fail,
    })
  );
  const reopen = useMutation(
    trpc.researchQuestions.reopen.mutationOptions({
      onSuccess: (result: WriteResult) => {
        reread();
        setRefusal(
          result.written
            ? null
            : `could not reopen: ${result.reason} — ${result.detail}`
        );
      },
      onError: fail,
    })
  );
  const busy = resolve.isPending || reopen.isPending;
  return (
    <>
      <span className={styles.actions}>
        {status === "open" ? (
          <>
            <button
              type="button"
              className={styles.action}
              disabled={busy}
              onClick={() => resolve.mutate({ path, status: "answered" })}
            >
              resolve
            </button>
            <button
              type="button"
              className={styles.action}
              disabled={busy}
              onClick={() => resolve.mutate({ path, status: "abandoned" })}
            >
              abandon
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.action}
            disabled={busy}
            onClick={() => reopen.mutate({ path })}
          >
            reopen
          </button>
        )}
      </span>
      {/* The line sits under the kicker, in the footer's voice: a write that
          did not happen is said where it was asked for. */}
      {refusal !== null && (
        <p role="status" className={styles.wroteNothing}>
          {refusal}
        </p>
      )}
    </>
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
  action,
  children,
}: {
  name: string;
  present: boolean;
  /** What sits beside the label: the Edited sections' *edit*. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = `rq-${name.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.labelRow}>
        <h2 id={id} className={styles.label}>
          {name}
        </h2>
        {action}
      </div>
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

// The one Kind with a surface to open: `#/questions/<path>` is the Research
// Question view. A link resolving to anything else — a Note, a Source, and a
// Question, which has a row in the Inbox but no address yet — is inert until
// its surface exists (spec #206 story 56).
const OPENABLE = new Set(["research-question"]);

/** `rasch2013#^h4`: the link's target as written, with its block id. */
const targetText = ({ link }: LinkLine) =>
  link === null
    ? ""
    : `${link.target}${link.blockId === null ? "" : `#^${link.blockId}`}`;

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
              {line.link.resolvedPath !== null &&
              OPENABLE.has(line.link.resolvedKind ?? "") ? (
                <a
                  className={styles.target}
                  href={hashOf({
                    surface: "questions",
                    path: line.link.resolvedPath,
                  })}
                >
                  {targetText(line)}
                </a>
              ) : (
                <span className={styles.target}>{targetText(line)}</span>
              )}
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

/**
 * A write the page makes to its own file: the result is the protocol's, and
 * a refusal is kept to show as a line in the section that asked — never a
 * silent no-op (brief § Ingest review's rule, applied to every write). A
 * write that landed re-reads the page; the own write's `vaultChanged` does
 * the same, so this is only what makes the re-read immediate.
 */
function useSectionWrite() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  const settle = (result: WriteResult) => {
    if (result.written) {
      setRefusal(null);
      void queryClient.invalidateQueries(
        trpc.researchQuestions.page.pathFilter()
      );
    } else {
      setRefusal(`${result.reason} — ${result.detail}`);
    }
  };
  return {
    refusal,
    settle,
    fail: (error: { message: string }) => setRefusal(error.message),
  };
}

/**
 * An Edited section as a plain text field (§ Research Question view and
 * triage, Editing on the page): *edit* opens the section's text as it is in
 * the file, blur and ⌘↵ save it whole with `replaceSection`, esc reverts
 * unsaved typing. No Revision — these are prose, not Positions (ADR 0020
 * decision 4). A refused save keeps the field open with the typing and says
 * why beneath it; the next save carries the same typing again.
 */
function Editable({
  name,
  present,
  path,
  hash,
  text,
  children,
}: {
  name: "Open threads" | "Related questions";
  present: boolean;
  path: string;
  hash: string;
  text: string;
  children: ReactNode;
}) {
  const trpc = useTRPC();
  const { refusal, settle, fail } = useSectionWrite();
  const [draft, setDraft] = useState<string | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;

  const close = () => setDraft(null);
  const save = useMutation(
    trpc.researchQuestions.saveSection.mutationOptions({
      onSuccess: (result) => {
        settle(result);
        if (result.written) close();
      },
      onError: fail,
    })
  );
  const submit = () => {
    if (draft === null || save.isPending) return;
    // Nothing typed is nothing written: a blur that changed nothing must
    // not rewrite the section, or every glance would be a save.
    if (draft === text) {
      close();
      return;
    }
    save.mutate({ path, section: name, body: draft, basedOn: hash });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && event.metaKey) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  // The keyboard follows the field: into it as it opens, back to *edit* as
  // it closes — the button is not in the tree until then.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) fieldRef.current?.focus();
    else if (wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  return (
    <Section
      name={name}
      present={present}
      action={
        present &&
        !editing && (
          <button
            ref={editRef}
            type="button"
            className={styles.edit}
            onClick={() => setDraft(text)}
          >
            edit
          </button>
        )
      }
    >
      {editing ? (
        <textarea
          ref={fieldRef}
          className={styles.field}
          aria-label={name}
          value={draft}
          rows={Math.max(3, draft.split("\n").length + 1)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={submit}
        />
      ) : (
        children
      )}
      <Refusal refusal={refusal} />
    </Section>
  );
}

/** The section's refusal line, in the footer's quiet voice, inside the section it belongs to. */
function Refusal({ refusal }: { refusal: string | null }) {
  if (refusal === null) return null;
  return (
    <p role="status" className={styles.refusal}>
      could not save: {refusal}
    </p>
  );
}

/**
 * Open threads as a task list that ticks in place: a resolved thread is
 * ticked, never removed, so what was once not known stays beside what was
 * learned (CONTEXT.md *Open thread*). A line that is not a task is shown as
 * it is.
 */
function Threads({
  path,
  threads,
  empty,
}: {
  path: string;
  threads: OpenThread[];
  empty: string;
}) {
  const trpc = useTRPC();
  const { refusal, settle, fail } = useSectionWrite();
  const tick = useMutation(
    trpc.researchQuestions.tickThread.mutationOptions({
      onSuccess: settle,
      onError: fail,
    })
  );
  if (threads.length === 0) return <Outline>{empty}</Outline>;
  return (
    <>
      <ul className={styles.lines}>
        {threads.map((thread, i) => (
          <li key={i} className={styles.thread}>
            {thread.done !== null && (
              <button
                type="button"
                role="checkbox"
                aria-checked={thread.done}
                aria-label={thread.text}
                className={styles.box}
                onClick={() =>
                  tick.mutate({ path, text: thread.text, done: !thread.done })
                }
              >
                {thread.done ? "☑" : "☐"}
              </button>
            )}
            <span className={thread.done === true ? styles.done : undefined}>
              {thread.text}
            </span>
          </li>
        ))}
      </ul>
      <Refusal refusal={refusal} />
    </>
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
