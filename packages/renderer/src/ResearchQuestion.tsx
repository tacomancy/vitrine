import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LinkLine,
  OpenThread,
  ResearchQuestionFrontmatter,
  Revision,
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
 * page per promoted question, at `#/questions/<path>`. The page read (#209)
 * — the question, its provenance and status, and the six sections as the
 * file holds them — and, from #213, the working answer as a text field
 * whose every save the core records as a Revision. The most common state
 * is a freshly promoted page with almost nothing in it, so an empty section
 * is drawn as a quiet outline with one sentence on what belongs there,
 * never as a gap. The other sections become editable in the tickets that
 * own them.
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
          <Header
            frontmatter={readable.frontmatter}
            entries={readable.sections.positionHistory.entries}
          />
          <Section
            name="Working answer"
            present={readable.sections.workingAnswer.present}
          >
            <WorkingAnswer
              path={readable.path}
              hash={readable.hash}
              text={readable.sections.workingAnswer.text}
            />
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

/** The question in the serif, then where and when it was first wondered, then its status and how settled the answer is. */
function Header({
  frontmatter,
  entries,
}: {
  frontmatter: ResearchQuestionFrontmatter;
  entries: Revision[];
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
        <span>{revisionLine(entries)}</span>
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

const FIELD = "working answer";

/**
 * `revision 3 of 3 · held since 8 September 2026`, derived from the
 * entries (spec #206 story 18): the answer on the page is always the latest
 * revision, held since the newest entry — the first in the section, as the
 * app writes them — recorded it.
 */
function revisionLine(entries: Revision[]): string {
  const ofField = entries.filter((e) => e.field === FIELD);
  const newest = ofField[0];
  if (newest === undefined) return "no revisions yet";
  return `revision ${ofField.length} of ${ofField.length} · held since ${localDate(newest.at)}`;
}

/**
 * The working answer as a plain text field (§ Research Question view and
 * triage, Editing on the page): autosave on blur, ⌘↵ saves now, esc
 * reverts unsaved typing. A save carries the hash the page was given; the
 * core diffs and records the Revision, so nothing here knows the grammar.
 * A refusal is a line under the field with its reason, and the typing
 * stays — never silent, never lost (CLAUDE.md § Invariants).
 */
function WorkingAnswer({
  path,
  hash,
  text,
}: {
  path: string;
  hash: string;
  text: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const diskCopy = useDiskCopy(path);
  // Null while the field shows the file's text; the typing otherwise.
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Up while the *changed on disk* line is: autosave is suspended until
  // one of its two actions is chosen (#215).
  const [conflict, setConflict] = useState(false);
  // What the typing is a change *to*, captured when the field went dirty
  // and not re-taken from a re-read underneath it — an Obsidian edit to
  // another section must not make this save look based on the new file.
  const [base, setBase] = useState<Base | null>(null);
  // Set while a save is in flight, so a blur right after ⌘↵ is one save.
  const inFlight = useRef(false);
  const save = useMutation(
    trpc.researchQuestions.saveWorkingAnswer.mutationOptions({
      onSuccess: async (result, { text: saved, basedOn }) => {
        if (!result.written) {
          if (result.reason === "changedAndUnreapplyable") setConflict(true);
          else setRefusal(`not saved — ${result.detail}`);
          return;
        }
        setRefusal(null);
        setConflict(false);
        await queryClient.invalidateQueries(
          trpc.researchQuestions.page.queryFilter({ path })
        );
        // Typing that went on past the save is kept; the field shows the
        // re-read page only when it holds what was typed. Typing that
        // stayed is now a change to what this save put on disk.
        setDraft((current) => (current === saved ? null : current));
        setBase((current) =>
          current === null || current.hash === basedOn
            ? { hash: result.hash, text: saved.trim() }
            : current
        );
      },
      onError: (error) => setRefusal(`not saved — ${error.message}`),
    })
  );

  const send = (text: string, on: Base) => {
    inFlight.current = true;
    save.mutate(
      { path, text, basedOn: on.hash, was: on.text },
      {
        onSettled: () => {
          inFlight.current = false;
        },
      }
    );
  };
  const commit = () => {
    if (draft === null || inFlight.current || conflict) return;
    if (draft.trim() === text) {
      setDraft(null);
      setBase(null);
      return;
    }
    send(draft, base ?? { hash, text });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && event.metaKey) {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
      setBase(null);
    }
  };
  const type = (typed: string) => {
    setBase((current) => current ?? { hash, text });
    setDraft(typed);
  };
  // *Keep mine*: the disk copy read afresh, then the typing saved over it.
  const keepMine = async () => {
    const disk = await diskCopy("Working answer");
    setConflict(false);
    if (!disk.read) return setRefusal(`not saved — ${disk.reason}`);
    if (draft === null) return;
    setBase(disk.base);
    send(draft, disk.base);
  };
  // *Take the disk copy*: the typing let go, the field showing the file.
  // The read is also what puts that file in the page's cache — `text`
  // arrives as a prop, and a field showing the file is one with no draft.
  const takeTheDiskCopy = async () => {
    const disk = await diskCopy("Working answer");
    setConflict(false);
    // Nothing to take: the typing stays rather than being dropped for a
    // copy that could not be read.
    if (!disk.read) return setRefusal(`not saved — ${disk.reason}`);
    setDraft(null);
    setBase(null);
  };
  const shown = draft ?? text;
  return (
    <>
      {shown === "" && (
        <Outline>
          Nothing written yet. What you currently believe goes here —
          provisional, and every change to it is kept.
        </Outline>
      )}
      <textarea
        className={styles.field}
        aria-labelledby="rq-working-answer"
        value={shown}
        rows={shown === "" ? 2 : undefined}
        onChange={(event) => type(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {conflict && (
        <ChangedOnDisk
          keepMine={() => void keepMine()}
          takeTheDiskCopy={() => void takeTheDiskCopy()}
        />
      )}
      {refusal !== null && (
        <p role="status" className={styles.refusal}>
          {refusal}
        </p>
      )}
    </>
  );
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

/** The Edited sections the page holds a text field for (core's `EditedSection`, plus the Position). */
type EditableSection = "Working answer" | "Open threads" | "Related questions";

/** What a field is editing against: the file's hash and the section's text, as it read them. */
type Base = { hash: string; text: string };

/** The disk copy, or why there is none — a read that failed is a line, never a shrug. */
type DiskCopy = { read: true; base: Base } | { read: false; reason: string };

/**
 * The section as the file holds it now — read afresh, not from the page's
 * cache, because the point of the read is that the cache is behind. Both
 * resolutions of *changed on disk* need it: *keep mine* saves over it,
 * *take the disk copy* shows it. `changedAndUnreapplyable` also covers a
 * file that is gone, so this read is where that case separates itself: the
 * typing stays in the field and the reason is said, rather than a button
 * that quietly does nothing (CLAUDE.md § Invariants, no silent failures).
 */
function useDiskCopy(
  path: string
): (name: EditableSection) => Promise<DiskCopy> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return async (name) => {
    let page;
    try {
      page = await queryClient.fetchQuery({
        ...trpc.researchQuestions.page.queryOptions({ path }),
        staleTime: 0,
      });
    } catch (error) {
      return { read: false, reason: (error as Error).message };
    }
    if (!page.readable) return { read: false, reason: page.reason };
    const { workingAnswer, openThreads, related } = page.sections;
    const text =
      name === "Working answer"
        ? workingAnswer.text
        : name === "Open threads"
          ? openThreads.text
          : related.text;
    return { read: true, base: { hash: page.hash, text } };
  };
}

/**
 * The Vault editor's *changed on disk* line (ADR 0015 decision 5), inside
 * the section that refused: the section was edited elsewhere between the
 * page's read and this save, so re-applying would have replaced those words
 * with these. Not a modal and not a silent overwrite — the typing stays in
 * the field, autosave is suspended until one of the two is chosen, and
 * *keep mine* is the one place a byte the user did not type is overwritten
 * on their explicit say-so.
 */
function ChangedOnDisk({
  keepMine,
  takeTheDiskCopy,
}: {
  keepMine: () => void;
  takeTheDiskCopy: () => void;
}) {
  return (
    <p role="status" className={styles.conflict}>
      <span>changed on disk</span>
      <button type="button" className={styles.edit} onClick={keepMine}>
        keep mine
      </button>
      <button type="button" className={styles.edit} onClick={takeTheDiskCopy}>
        take the disk copy
      </button>
    </p>
  );
}

/**
 * A write the page makes to its own file: the result is the protocol's, and
 * a refusal is kept to show as a line in the section that asked — never a
 * silent no-op (brief § Ingest review's rule, applied to every write). A
 * write that landed re-reads the page; the own write's `vaultChanged` does
 * the same, so this is only what makes the re-read immediate.
 */
function useSectionWrite(onConflict?: () => void) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  const settle = (result: WriteResult) => {
    if (result.written) {
      setRefusal(null);
      void queryClient.invalidateQueries(
        trpc.researchQuestions.page.pathFilter()
      );
    } else if (
      result.reason === "changedAndUnreapplyable" &&
      onConflict !== undefined
    ) {
      // The protocol's one word for "the file moved under this write". A
      // field save reaches it only by landing on its own section, so the
      // caller that has a field shows the *changed on disk* line instead
      // of the plain one; a tick has no field and keeps the plain one.
      setRefusal(null);
      onConflict();
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
  // Up while the *changed on disk* line is: autosave is suspended until
  // one of its two actions is chosen (#215).
  const [conflict, setConflict] = useState(false);
  const { refusal, settle, fail } = useSectionWrite(() => setConflict(true));
  const refuse = (message: string) => fail({ message });
  const [draft, setDraft] = useState<string | null>(null);
  // What the typing is a change *to*: the file as the field opened on it,
  // kept across a re-read underneath, so an Obsidian edit to another
  // section does not make this save look based on the new file.
  const [base, setBase] = useState<Base>({ hash, text });
  const diskCopy = useDiskCopy(path);
  const editRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;

  const close = () => {
    setDraft(null);
    setConflict(false);
  };
  const save = useMutation(
    trpc.researchQuestions.saveSection.mutationOptions({
      onSuccess: (result) => {
        settle(result);
        if (result.written) close();
      },
      onError: fail,
    })
  );
  const send = (body: string, on: Base) =>
    save.mutate({ path, section: name, body, basedOn: on.hash, was: on.text });
  const submit = () => {
    if (draft === null || save.isPending || conflict) return;
    // Nothing typed is nothing written: a blur that changed nothing must
    // not rewrite the section, or every glance would be a save.
    if (draft === text) {
      close();
      return;
    }
    send(draft, base);
  };
  // *Keep mine*: the disk copy read afresh, then the typing saved over it.
  const keepMine = async () => {
    const disk = await diskCopy(name);
    setConflict(false);
    if (!disk.read) return refuse(disk.reason);
    if (draft === null) return;
    setBase(disk.base);
    send(draft, disk.base);
  };
  // *Take the disk copy*: the typing replaced by what the file holds, the
  // field left open on it. A copy that could not be read replaces nothing.
  const takeTheDiskCopy = async () => {
    const disk = await diskCopy(name);
    setConflict(false);
    if (!disk.read) return refuse(disk.reason);
    setBase(disk.base);
    setDraft(disk.base.text);
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
            onClick={() => {
              setBase({ hash, text });
              setDraft(text);
            }}
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
      {conflict && (
        <ChangedOnDisk
          keepMine={() => void keepMine()}
          takeTheDiskCopy={() => void takeTheDiskCopy()}
        />
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
    case "historyEntryUnparsed":
      return `a line under Position history is not a revision (${block})`;
    default:
      return `${problem.problem}${block === "" ? "" : ` (${block})`}`;
  }
}
