import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LinkLine,
  OpenThread,
  ResearchQuestionFrontmatter,
  ResearchQuestionStatus,
  ResolveResult,
  Revision,
  Side,
  ShapeProblem,
  WriteResult,
} from "core";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { formatAge } from "./age";
import { AttachSource } from "./AttachSource";
import { FrameLines, usePageFrame } from "./page-frame";
import { addressOf } from "./kinds";
import { PositionHistory } from "./PositionHistory";
import type { Base, DiskCopy } from "./page-procedures";
import { ChangedOnDisk, PositionField } from "./PositionField";
import styles from "./ResearchQuestion.module.css";
import { localDate, localDateTime } from "./rows";
import { StatusGlyph } from "./StatusGlyph";
import { useTRPC } from "./trpc";
import { linkLabel } from "./wikilink";
import { pushRoute } from "./router";
import { useVaultStatusLines } from "./VaultStatusLines";
import { WhyLine } from "./WhyLine";

/**
 * The Research Question view (brief § Surfaces; prompt 3; ADR 0020): one
 * page per promoted question, at `#/research-question/<path>` (ADR 0026: an
 * Address takes its Kind's name). The page read (#209)
 * — the question, its provenance and status, and the six sections as the
 * file holds them — and, from #213, the working answer as a text field
 * whose every save the core records as a Revision. The most common state
 * is a freshly promoted page with almost nothing in it, so an empty section
 * is drawn as a quiet outline with one sentence on what belongs there,
 * never as a gap. The other sections become editable in the tickets that
 * own them.
 */
export function ResearchQuestion({
  path,
  attachOnArrival = false,
  onArrival,
}: {
  path: string;
  /** A Loose Ends *attach a source* landed here: open the form with the page. */
  attachOnArrival?: boolean;
  onArrival?: () => void;
}) {
  const trpc = useTRPC();
  const page = useQuery(trpc.researchQuestions.page.queryOptions({ path }));
  const status = useVaultStatusLines();

  const data = page.data;
  // Arrival, focus, following the file, and the Address that did not
  // resolve: the frame every Kind's page shares (`page-frame.tsx`).
  const { sectionRef, removed, resolved } = usePageFrame(
    "research-question",
    path,
    data
  );

  // The attach form, opened by ⌘⇧A from any focus on the page (prompt 3).
  // A chord rather than a letter: the page is mostly text fields, and a
  // bare key would be typing.
  const [attaching, setAttaching] = useState(attachOnArrival);
  // The arrival spends the intent, so coming back to this address later is
  // an ordinary visit and the form does not open itself again.
  useEffect(() => {
    if (attachOnArrival) onArrival?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const readable = removed === null && data?.readable === true ? data : null;
  const problems = readable?.problems ?? [];
  const hasFooter = problems.length > 0 || status.hasLines;

  return (
    <section
      ref={sectionRef}
      className={styles.page}
      aria-label="Research Question view"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          readable !== null &&
          event.key.toLowerCase() === "a" &&
          event.metaKey &&
          event.shiftKey
        ) {
          event.preventDefault();
          setAttaching(true);
        }
      }}
    >
      <FrameLines
        error={page.isError ? page.error : null}
        removed={removed}
        resolved={resolved}
        data={data}
      />
      {readable !== null && (
        <div className={styles.scroll}>
          <Header
            path={readable.path}
            frontmatter={readable.frontmatter}
            entries={readable.sections.positionHistory.entries}
          />
          <Section
            name="Working answer"
            present={readable.sections.workingAnswer.present}
          >
            <PositionField
              position={{ kind: "research-question", field: FIELD }}
              path={readable.path}
              hash={readable.hash}
              text={readable.sections.workingAnswer.text}
              labelledBy="rq-working-answer"
              empty={
                <Outline>
                  Nothing written yet. What you currently believe goes here —
                  provisional, and every change to it is kept.
                </Outline>
              }
            />
          </Section>
          <div className={styles.evidence}>
            <Balance
              supporting={readable.sections.supporting.lines.length}
              opposing={readable.sections.opposing.lines.length}
            />
            <div className={styles.sides}>
              <Section
                name="Supporting sources"
                present={readable.sections.supporting.present}
              >
                <Sources
                  path={readable.path}
                  hash={readable.hash}
                  side="supporting"
                  lines={readable.sections.supporting.lines}
                  empty="Nothing attached yet. Papers that argue for the working answer collect here, each with a note on which finding does."
                />
              </Section>
              <Section
                name="Opposing sources"
                present={readable.sections.opposing.present}
              >
                <Sources
                  path={readable.path}
                  hash={readable.hash}
                  side="opposing"
                  lines={readable.sections.opposing.lines}
                  empty="Nothing yet. When you find a paper that undercuts the answer, it goes here — and a page where nothing does is worth noticing."
                />
              </Section>
            </div>
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
            <PositionHistory
              entries={readable.sections.positionHistory.entries}
              current={{ [FIELD]: readable.sections.workingAnswer.text }}
              // A why written months after the fact (#216): the page's own
              // hash, because no save of the page's stands between the
              // read and this write.
              whyLine={({ at, field }, close) => (
                <WhyLine
                  kind="research-question"
                  path={readable.path}
                  at={at}
                  field={field}
                  basedOn={readable.hash}
                  onClose={close}
                />
              )}
            />
            {/* Always last and always there: the history's floor, derived
                from the frontmatter and never written as an entry. */}
            <p className={styles.baseLine}>{baseLine(readable.frontmatter)}</p>
          </Section>
        </div>
      )}
      {attaching && readable !== null && (
        <AttachSource
          path={readable.path}
          hash={readable.hash}
          onClose={() => setAttaching(false)}
        />
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

/**
 * The balance strip over the two columns (spec #206 story 28; brief
 * § Surfaces, prompt 3): the counts in words, and — when one side is empty
 * and the other is not — a sentence saying what that means. This is the
 * whole reason the sides are structurally separate rather than a tag on one
 * bibliography: a literature that only agrees with you must raise its voice
 * before you have to think to look. A page with nothing on either side is
 * not one-sided, it is new, and stays quiet.
 */
function Balance({
  supporting,
  opposing,
}: {
  supporting: number;
  opposing: number;
}) {
  const lopsided =
    (supporting === 0) !== (opposing === 0) ? sideEmpty(supporting) : null;
  return (
    <section
      className={styles.balance}
      aria-label="Balance of sources"
      data-lopsided={lopsided === null ? undefined : true}
    >
      <p className={styles.balanceCount}>
        {lopsided !== null && (
          <span
            className={styles.lopsidedGlyph}
            role="img"
            aria-label="one-sided"
          >
            !
          </span>
        )}
        <span>{balanceWords(supporting, opposing)}</span>
        <span className={styles.balanceKey}>⌘⇧A attach a source</span>
      </p>
      {lopsided !== null && <p className={styles.lopsided}>{lopsided}</p>}
    </section>
  );
}

/** `4 supporting · 2 opposing`; a side with none says so in the same breath. */
function balanceWords(supporting: number, opposing: number): string {
  if (supporting === 0 && opposing === 0) {
    return "nothing attached on either side";
  }
  return `${counted(supporting, "supporting")} · ${counted(opposing, "opposing")}`;
}

const counted = (n: number, side: string) =>
  n === 0 ? `nothing ${side}` : `${n} ${side}`;

/** What a one-sided page means, said as a fact about the reading rather than a fault. */
const sideEmpty = (supporting: number) =>
  supporting === 0
    ? "Nothing attached so far argues for the working answer. That is a property of your reading as much as of the literature."
    : "Everything attached so far argues for the working answer. That is a property of your reading as much as of the literature.";

/** The question in the serif, then where and when it was first wondered, then its status, how settled the answer is, and the page's own verbs. */
function Header({
  path,
  frontmatter,
  entries,
}: {
  path: string;
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
  const resolving = usePageWrite("resolve");
  const reopening = usePageWrite("reopen");
  const sharpening = usePageWrite("promote to hypothesis");
  // The write-back moves the Question's status, which the Inbox's row reads.
  const rereadRow = () =>
    void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
  const resolve = useMutation(
    trpc.researchQuestions.resolve.mutationOptions({
      onSuccess: (result: ResolveResult) => {
        resolving.settle(result.page);
        rereadRow();
        // The page is resolved even when its Question could not be marked,
        // so the line names the half that did not happen — *could not
        // resolve* would be a lie about the half that did.
        if (result.page.written && !result.question.written) {
          resolving.say(
            `the Question was not marked: ${result.question.reason}`
          );
        }
      },
      onError: resolving.fail,
    })
  );
  const reopen = useMutation(
    trpc.researchQuestions.reopen.mutationOptions({
      onSuccess: (result: WriteResult) => {
        reopening.settle(result);
        rereadRow();
      },
      onError: reopening.fail,
    })
  );
  // Sharpen into a Hypothesis (#332): the page stays open with its new
  // related line, and the window moves to the Hypothesis, which takes the
  // keyboard (ADR 0010) — the same landing as `h` in the Inbox.
  const promote = useMutation(
    trpc.researchQuestions.promoteToHypothesis.mutationOptions({
      onSuccess: ({ path: landed }) => {
        void queryClient.invalidateQueries(
          trpc.researchQuestions.page.pathFilter()
        );
        pushRoute({ surface: "hypothesis", path: landed });
      },
      onError: sharpening.fail,
    })
  );
  // The claim being typed, or null while the line is closed. Held until ↵
  // writes it or esc discards it, as the Inbox's typed line holds it.
  const [claim, setClaim] = useState<string | null>(null);
  const claimRef = useRef<HTMLInputElement>(null);
  const promoteRef = useRef<HTMLButtonElement>(null);
  const claiming = claim !== null;
  useEffect(() => {
    if (claiming) claimRef.current?.focus();
  }, [claiming]);

  const busy = resolve.isPending || reopen.isPending || promote.isPending;
  const ask = (next: "answered" | "abandoned") => {
    reopening.clear();
    resolve.mutate({ path, status: next });
  };
  /** ↵: the claim, trimmed. A stray ↵ never writes a Hypothesis with no claim. */
  const submitClaim = () => {
    const text = claim?.trim() ?? "";
    if (text === "" || promote.isPending) return;
    sharpening.clear();
    promote.mutate({ path, claim: text });
  };
  return (
    <>
      <span className={styles.actions}>
        {status === "open" ? (
          <>
            <button
              type="button"
              className={styles.action}
              disabled={busy}
              onClick={() => ask("answered")}
            >
              resolve
            </button>
            <button
              type="button"
              className={styles.action}
              disabled={busy}
              onClick={() => ask("abandoned")}
            >
              abandon
            </button>
            <button
              ref={promoteRef}
              type="button"
              className={styles.action}
              disabled={busy}
              onClick={() => {
                sharpening.clear();
                setClaim("");
              }}
            >
              promote to hypothesis
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.action}
            disabled={busy}
            onClick={() => {
              resolving.clear();
              reopen.mutate({ path });
            }}
          >
            reopen
          </button>
        )}
      </span>
      {status === "open" && claim !== null && (
        <form
          className={styles.claimLine}
          aria-label="Promote to Hypothesis"
          onSubmit={(event) => {
            event.preventDefault();
            submitClaim();
          }}
        >
          <input
            ref={claimRef}
            className={styles.claimInput}
            type="text"
            aria-label="Claim"
            autoComplete="off"
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                submitClaim();
              } else if (event.key === "Escape") {
                // esc discards the typing and writes nothing; the control
                // that opened the line takes the keyboard back.
                event.preventDefault();
                setClaim(null);
                sharpening.clear();
                promoteRef.current?.focus();
              }
            }}
          />
          <span className={styles.claimHint}>
            ↵ promote to hypothesis · esc discards
          </span>
        </form>
      )}
      {/* Under the kicker rather than in a dialog: a write that did not
          happen is said where it was asked for. */}
      <Refusal refusal={resolving.refusal} className={styles.inKicker} />
      <Refusal refusal={reopening.refusal} className={styles.inKicker} />
      <Refusal refusal={sharpening.refusal} className={styles.inKicker} />
    </>
  );
}

/** The Provenance keys a page's frontmatter carries, whichever Kind the page is. */
type ProvenanceKeys = Pick<
  ResearchQuestionFrontmatter,
  "captured" | "context" | "from" | "page"
>;

/**
 * `first wondered 14 August 2026 · 09:12 · while reading Rasch & Born 2013 ·
 * p.699`. The context is the Provenance's own word (CONTEXT.md); `from` is
 * shown without its brackets — how a Source reads here is the Reader
 * slice's call, as on the Inbox.
 */
export function provenanceLine(fm: ProvenanceKeys): string {
  const parts: string[] = [];
  if (fm.captured !== undefined) {
    parts.push(`first wondered ${localDateTime(fm.captured)}`);
  }
  parts.push(whileDoing(fm));
  return parts.join(" · ");
}

export function whileDoing(fm: ProvenanceKeys): string {
  if (fm.from === undefined) return "unattached";
  const where =
    fm.page === undefined
      ? linkLabel(fm.from)
      : `${linkLabel(fm.from)} · p.${fm.page}`;
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

/** The history's base line, derived from the frontmatter and never written as an entry (spec #206 story 39). */
function baseLine(fm: ResearchQuestionFrontmatter): string {
  const when = fm.promoted === undefined ? "" : `, ${localDate(fm.promoted)}`;
  return `promoted from a capture made ${whileDoing(fm)}${when}`;
}

/**
 * One of the six, as a landmark so the outline is navigable. A section the
 * file lacks — its heading retyped — is drawn in place with a line saying so,
 * and named again in the footer: the page never loses its shape because one
 * heading did.
 */
export function Section({
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
export function Outline({ children }: { children: ReactNode }) {
  return <p className={styles.outline}>{children}</p>;
}

/** `rasch2013#^h4`: the link's target as written, with its block id. */
const targetText = ({ link }: LinkLine) =>
  link === null
    ? ""
    : `${link.target}${link.blockId === null ? "" : `#^${link.blockId}`}`;

/**
 * Source and related lines: the link as written, its note, and what the
 * index says about where it lands. `actions` is what a side hangs off each
 * line; the Related column passes none, because *move to opposing* on a
 * neighbouring question means nothing.
 */
export function Lines({
  lines,
  empty,
  actions,
}: {
  lines: LinkLine[];
  empty: string;
  actions?: (line: LinkLine) => ReactNode;
}) {
  if (lines.length === 0) return <Outline>{empty}</Outline>;
  return (
    <ul className={styles.lines}>
      {lines.map((line, i) => {
        // Where the link points, when what it points at has a surface of its
        // own; a Question's Address is the Inbox on that row (#300).
        const address =
          line.link === null || line.link.resolvedPath === null
            ? null
            : addressOf(line.link.resolvedKind, line.link.resolvedPath);
        return (
          <li key={i} className={styles.line}>
            {line.link === null ? (
              <span className={styles.note}>{line.text}</span>
            ) : (
              <>
                {address !== null ? (
                  <a className={styles.target} href={address}>
                    {targetText(line)}
                  </a>
                ) : (
                  <span className={styles.target}>{targetText(line)}</span>
                )}
                {line.link.resolution !== "resolved" && (
                  <>
                    <span className={styles.resolution}>
                      {line.link.resolution}
                    </span>
                    <span className={styles.wentNowhere}>
                      {wentNowhere(line.link)}
                    </span>
                  </>
                )}
                {line.note !== "" && (
                  <span className={styles.note}>{line.note}</span>
                )}
                {actions?.(line)}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Where a link that did not resolve went instead (spec #206 story 30). The
 * three cases are told apart by what the *name* reached, because the fix
 * differs: a pair of files wants the path-qualified rewrite, a file whose
 * `#^id` is gone wants the annotation re-matched, and nothing at all wants
 * the citekey retyped. Saying "nothing has this name" about the middle one
 * would send the reader to fix the half that is right.
 */
function wentNowhere(link: NonNullable<LinkLine["link"]>): string {
  const reached = link.candidates ?? [];
  if (link.resolution === "ambiguous") {
    return reached.length === 0
      ? "more than one file carries this name"
      : `caught between ${reached.join(" · ")}`;
  }
  const [found] = reached;
  if (found === undefined) return "nothing in the vault has this name";
  return `${found} has no ${link.blockId === null ? "such heading" : `^${link.blockId}`}`;
}

/** The other side; there are only two (ADR 0020 decision 5). */
const otherSide = (side: Side): Side =>
  side === "supporting" ? "opposing" : "supporting";

/**
 * One side's lines, each with the two verbs that can change where the paper
 * sits (#219; spec #206 story 27): *move to the other side* and *detach*.
 * Both name the line by its text and carry the hash the page was read at,
 * and neither records a Revision — the history is of positions, not of the
 * bibliography (ADR 0020 decision 4). A refused write is a line under the
 * column, never a button that quietly did nothing.
 */
function Sources({
  path,
  hash,
  side,
  lines,
  empty,
}: {
  path: string;
  hash: string;
  side: Side;
  lines: LinkLine[];
  empty: string;
}) {
  const trpc = useTRPC();
  const moving = usePageWrite("move the source");
  const detaching = usePageWrite("detach the source");
  const move = useMutation(
    trpc.researchQuestions.moveSource.mutationOptions({
      onSuccess: moving.settle,
      onError: moving.fail,
    })
  );
  const detach = useMutation(
    trpc.researchQuestions.detachSource.mutationOptions({
      onSuccess: detaching.settle,
      onError: detaching.fail,
    })
  );
  const busy = move.isPending || detach.isPending;
  return (
    <>
      <Lines
        lines={lines}
        empty={empty}
        actions={(line) => (
          <span className={styles.lineActions}>
            <button
              type="button"
              className={styles.edit}
              disabled={busy}
              onClick={() => {
                detaching.clear();
                move.mutate({
                  path,
                  from: side,
                  text: line.text,
                  basedOn: hash,
                });
              }}
            >
              move to {otherSide(side)}
            </button>
            <button
              type="button"
              className={styles.edit}
              disabled={busy}
              onClick={() => {
                moving.clear();
                detach.mutate({ path, side, text: line.text, basedOn: hash });
              }}
            >
              detach
            </button>
          </span>
        )}
      />
      <Refusal refusal={moving.refusal} />
      <Refusal refusal={detaching.refusal} />
    </>
  );
}

/**
 * The section as the file holds it now, for an Edited section's field —
 * read afresh, not from the page's cache, because the point of the read is
 * that the cache is behind. Both resolutions of *changed on disk* need it:
 * *keep mine* saves over it, *take the disk copy* shows it. A read that
 * failed is a line, never a button that quietly does nothing (CLAUDE.md
 * § Invariants, no silent failures).
 */
function useDiskCopy(
  path: string
): (name: "Open threads" | "Related questions") => Promise<DiskCopy> {
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
    const { openThreads, related } = page.sections;
    const text = name === "Open threads" ? openThreads.text : related.text;
    return { read: true, base: { hash: page.hash, text } };
  };
}

/**
 * A write the page makes to its own file: the result is the protocol's, and
 * a refusal is kept to show as a line where it was asked for — never a
 * silent no-op (brief § Ingest review's rule, applied to every write). A
 * write that landed re-reads the page; the own write's `vaultChanged` does
 * the same, so this is only what makes the re-read immediate. `verb` is the
 * word the refusal line uses, because *could not save* is wrong for a
 * resolve and the line must say what did not happen.
 */
function usePageWrite(verb: string, onConflict?: () => void) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  const reread = () =>
    void queryClient.invalidateQueries(
      trpc.researchQuestions.page.pathFilter()
    );
  const refused = (detail: string) =>
    setRefusal(`could not ${verb}: ${detail}`);
  const settle = (result: WriteResult) => {
    if (result.written) {
      setRefusal(null);
      reread();
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
    } else refused(`${result.reason} — ${result.detail}`);
  };
  return {
    refusal,
    settle,
    /** A line in the caller's own words, for what `verb` would say wrong. */
    say: setRefusal,
    clear: () => setRefusal(null),
    fail: (error: { message: string }) => refused(error.message),
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
  const { refusal, settle, fail } = usePageWrite("save", () =>
    setConflict(true)
  );
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

/** A refusal line, in the footer's quiet voice, where the write was asked for. */
function Refusal({
  refusal,
  className,
}: {
  refusal: string | null;
  /** What the line needs where it sits; the kicker's own row is one. */
  className?: string | undefined;
}) {
  if (refusal === null) return null;
  return (
    <p
      role="status"
      className={
        className === undefined
          ? styles.refusal
          : `${styles.refusal} ${className}`
      }
    >
      {refusal}
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
  const { refusal, settle, fail } = usePageWrite("save");
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
export function describeProblem(problem: ShapeProblem): string {
  const block = problem.block ?? "";
  switch (problem.problem) {
    case "sectionMissing":
      return `${block} is not in the file`;
    case "sectionDuplicated":
    case "ownedSectionDuplicated":
      return `${block} is in the file twice`;
    case "historyEntryUnparsed":
      return `a line under Position history is not a revision (${block})`;
    case "criteriaMissing":
      return "Criteria is not in the file";
    case "criterionWithoutId":
      return `a criterion has no ^c id (${block})`;
    case "fieldOutsideVocabulary":
      return `^${block} has a field outside its vocabulary`;
  }
}
