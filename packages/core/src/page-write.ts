import type { Outline } from "markdown";
import {
  CRITERIA_FIELD,
  criteriaEntries,
  liveOverride,
  OVERRIDE,
  voidOf,
} from "./hypothesis-rule.js";
import { VaultError } from "./errors.js";
import type { PendingRevision, PendingRevisions } from "./pending-revisions.js";
import {
  coalesce,
  formatRevision,
  onOneLine,
  readRevisions,
  sectionWithEntry,
  type Save,
} from "./position-history.js";
import { bodyText, readPageFile, section, type PageFile } from "./page-file.js";
import { serialised } from "./serialise.js";
import {
  write,
  type Operation,
  type Write,
  type WriteResult,
} from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * How a page writes to its own file, whichever Kind the page is — the
 * Research Question's (`research-question.ts`, #213–#217) and the
 * Hypothesis's (#333): one queue for every page write in the process, the
 * pending Revisions an Obsidian edit left owing folded into whichever own
 * write comes next, a Position saved with its Revision in the same write,
 * and a why written onto an entry after the fact. Load-bearing per
 * `CLAUDE.md`: this is where the history's two paths meet (§ Research
 * Question view and triage, *The two paths meet in one write*).
 */

/**
 * What a page write needs of the open vault: where it is, the index to
 * tell afterwards, and the queue of Revisions an Obsidian edit left owing
 * (#217). The router builds one from `vault.opened()`.
 */
export type PageContext = {
  vaultPath: string;
  index: VaultIndex;
  pending: PendingRevisions;
};

/**
 * Which Kind a write expects its file to be, and how a refusal names it —
 * *not a Hypothesis: kind is research-question*. A tick must no more land
 * on a Note with an `## Open threads` heading than a claim save on a
 * Research Question with a `## Claim` one.
 */
export type PageKind = { kind: string; noun: string };

/** Thirty minutes (ADR 0006 decision 5) — a number in code, per spec #206; tests inject a shorter one. */
export const COALESCE_MS = 30 * 60 * 1000;
/** The owned section every Revision lives in; named once, because three operations target it by name. */
const HISTORY = "Position history";

/**
 * The Kinds whose files carry a Position history, and so the files a
 * parked Revision can be owed by. The splice does not know which one it is
 * writing to — the watcher parked the row by path — so it accepts any.
 * Spelled here rather than imported from each Kind's `KIND`, because both
 * Kind modules import this one; a Kind that gains a history is added here
 * as it is to `app.ts`'s `positionsOf`.
 */
const HISTORIED = ["research-question", "hypothesis"];

/**
 * What one page write does to the file it finds: the operations and the
 * hash they were computed from, or a result to answer with and write
 * nothing (a refusal, or a save that turned out to change nothing).
 * `waiting` is what this file owes the history before the write's own
 * entry — a plan that records a Revision needs to know, since an entry it
 * would otherwise coalesce into has an external edit standing in between.
 */
export type Plan = (
  read: PageFile,
  waiting: PendingRevision[]
) => OwnWrite | WriteResult;

/**
 * A page write, and — when it records a Revision of something a
 * Hypothesis's Override judged (a criterion, the claim) — that Revision's
 * timestamp, which the Override's void is stamped with if one is live
 * (`writeOwn`).
 */
export type OwnWrite = Write & { revisesJudged?: string };

// Page writes run one at a time. Planning a write means reading the file —
// which thread is ticked, what the Position changed from, whether the head
// Revision is still inside its window — so two writes that both read
// before either wrote would each plan against a file that no longer exists
// by the time they land: two Revisions where the coalescing rule wants one.
// The pending splice below reads the same way and is cleared on the same
// write, so it is inside this queue too (`serialise.ts` for why the
// protocol's hash check does not catch any of this).
//
// One queue at module scope, so every page write in the process waits on
// every other, not just the ones touching the same file or Kind. That is
// stricter than the hazard — which is per file — and deliberately so: a
// map of queues by path would have to decide when to forget an entry, and
// page writes are keystroke-rare, not hot. Contrast `questions.ts`, whose
// queue is per service because what collides there is a name in one
// vault's folder, and two services are two vaults.
const serially = serialised();

/**
 * A write that changed nothing: the file exactly as it was read. What a
 * plan answers with when there was nothing to do — typing that matched the
 * file, a splice with nothing parked — so the caller still gets the file's
 * fresh hash to base its next write on.
 */
export const unchanged = (read: PageFile): WriteResult => ({
  written: true,
  hash: read.hash,
  content: read.content,
  shape: read.shape,
});

/** The `prependEntry` for one entry the splice writes. */
const prepend = (entry: string): Operation => ({
  op: "prependEntry",
  section: HISTORY,
  entry,
});

/**
 * The entries what this file owes its history splice as, oldest row first.
 * A row is a quiet entry, its previous text in full — except a Hypothesis's
 * `## Criteria`, whose row holds the whole section as it was and is judged
 * criterion by criterion against the section that came after it
 * (`criteriaEntries`, #336): the edited-after-evidence suffix, the loud
 * *deleted after evidence* entry, and a `· state` entry are the page's to
 * write for its own edits, and the splice's for Obsidian's, so the guard
 * does not depend on which tool was used (spec #327 story 51). What came
 * after a row is the next row's `from`, or, for the last, the section as
 * the file holds it now.
 *
 * The first row that revised what a live Override judged — the claim, or
 * a criterion — is followed by the Override's void, stamped with that row,
 * as the page's own write would have voided it (#337, story 62). `voided`
 * says so, so the write's own plan does not void it a second time.
 */
function splicesOf(
  read: PageFile,
  waiting: PendingRevision[]
): { operations: Operation[]; voided: boolean } {
  const quiet = (row: PendingRevision) =>
    prepend(
      formatRevision({
        at: row.at,
        field: row.field,
        why: null,
        from: row.from,
      })
    );
  if (read.kind !== "hypothesis") {
    return { operations: waiting.map(quiet), voided: false };
  }
  const criteria = section(read.outline, "Criteria").heading;
  let live = liveOverride(historyEntries(read));
  let voided = false;
  const operations = waiting.flatMap((row, i) => {
    let entries: Operation[];
    // With no `## Criteria` heading to judge against — retyped mid-edit, as
    // `hypothesisPositions` allows for — every criterion would read as
    // deleted, and a tested one as the loudest entry there is, permanently.
    // The row is spliced unjudged instead: the section as it was, in full,
    // so nothing is lost and nothing is claimed.
    if (row.field !== CRITERIA_FIELD || criteria === undefined) {
      entries = [quiet(row)];
    } else {
      const next = waiting
        .slice(i + 1)
        .find((later) => later.field === CRITERIA_FIELD);
      const now = next?.from ?? bodyText(read.content, criteria);
      entries = criteriaEntries(row.from, now, row.at).map(prepend);
    }
    // Design notes never void it (ADR 0031 decision 7); a criteria row the
    // judge found no change in revised nothing. A row of the criteria
    // parked by an earlier build (`criterion <label>`) is a criterion
    // Revision all the same.
    const revisesJudged =
      entries.length > 0 &&
      (row.field === "claim" ||
        row.field === CRITERIA_FIELD ||
        row.field.startsWith("criterion "));
    if (live === null || !revisesJudged) return entries;
    const override = live;
    live = null;
    voided = true;
    return [...entries, prepend(voidOf(override, row.at))];
  });
  return { operations, voided };
}

/** The history's entries as the file holds them, newest first; a line that is not one is left out. */
export function historyEntries({ content, outline }: PageFile) {
  const heading = section(outline, HISTORY).heading;
  if (heading === undefined) return [];
  return readRevisions(content, outline, heading).flatMap((item) =>
    item.revision === null ? [] : [item.revision]
  );
}

/**
 * Where the parked splices sit among the write's own operations. Operations
 * apply in order, each located afresh, so a `replaceSection` on the section
 * the splices prepend into would undo them: it carries the body the plan
 * read, which is the file before the splices. The rule lives here rather
 * than in each plan, because a plan that forgot it would lose a Revision
 * and say it had written one.
 */
function orderOf(own: Operation[], splices: Operation[]): Operation[] {
  const rewritesHistory = own.some(
    (op) => op.op === "replaceSection" && op.name === HISTORY
  );
  return rewritesHistory ? [...own, ...splices] : [...splices, ...own];
}

/**
 * One planned write through the protocol, then the index told of the app's
 * own write, as a capture does — the whole of it inside the queue above.
 *
 * Whatever the write was for, it also carries whatever Obsidian edits to
 * this file are still owed the history (#217): the splice is an own write
 * like any other, and the cheapest own write is one the app was making
 * anyway. They go first, oldest first, so that the entry this write
 * records — newer than any of them — ends up above them. They are cleared
 * only once the bytes are on disk; a refused write leaves them parked for
 * the quiet window or the next attempt.
 *
 * A plan that replaces `## Position history` whole is the exception: its
 * body is computed from the file as it was read, so entries spliced above
 * it first would be written and then erased by it, in the one section
 * where a lost entry is the silent failure the brief forbids. Those go
 * after, and still land where they belong — a parked row is always newer
 * than anything the section already holds, because every own write splices
 * what is waiting, so no entry the app wrote can postdate a row still
 * parked (`orderOf`).
 */
export function writeOwn(
  { vaultPath, index, pending }: PageContext,
  path: string,
  page: PageKind | "any historied page",
  plan: Plan
): Promise<WriteResult> {
  const run = async (): Promise<WriteResult> => {
    const read =
      page === "any historied page"
        ? await readPageFile(
            vaultPath,
            path,
            HISTORIED,
            "a page with a history"
          )
        : await readPageFile(vaultPath, path, [page.kind], page.noun);
    if (!read.readable) {
      return { written: false, reason: "unreadable", detail: read.reason };
    }
    const waiting = pending.pending(read.relativePath);
    const planned = plan(read, waiting);
    let own: OwnWrite;
    if ("written" in planned) {
      // A refusal is the caller's answer, whatever else the file owes:
      // turning it into the splice's success would tell the page its tick
      // landed. The parked entries wait for the window or the next write.
      if (!planned.written || waiting.length === 0) return planned;
      // Nothing of the plan's own to write, but the parked entries still
      // want splicing — against the file as it was just read.
      own = { operations: [], basedOn: read.hash };
    } else {
      own = planned;
    }
    const splices = splicesOf(read, waiting);
    // The void goes in the write that caused it (ADR 0031 decision 7), on
    // top of that write's own entries — unless a parked Obsidian edit
    // spliced into this same write already revised what it judged.
    const judged = splices.voided ? undefined : own.revisesJudged;
    const live =
      judged === undefined ? null : liveOverride(historyEntries(read));
    const voids =
      live === null || judged === undefined
        ? []
        : [prepend(voidOf(live, judged))];
    const result = await write(vaultPath, path, {
      operations: orderOf([...own.operations, ...voids], splices.operations),
      basedOn: own.basedOn,
    });
    if (result.written) {
      // Cleared the moment the bytes are on disk, and before the index is
      // told: `own()` stats the file and can fail, and rows still parked
      // after their entries have been written would be spliced a second
      // time by the next write. A row dropped here is one entry missing
      // from a history; a row kept is the same entry twice, in a section
      // whose whole point is that it reads as a train of thought.
      pending.clear(waiting.map((row) => row.id));
      await index.own(read.relativePath, result.content);
    }
    return result;
  };
  return serially(run);
}

/**
 * The section as the page had it, against the section as the file holds it
 * now (#215; ADR 0020 consequences). The protocol re-applies a write whose
 * `basedOn` is stale by locating targets afresh — which for an Edited
 * section means replacing it whole, so an edit made to *that* section since
 * the page read it would be overwritten without a word. The page therefore
 * sends the text it was editing as well as the hash, and a section that no
 * longer reads that way refuses: the page shows the Vault editor's *changed
 * on disk* line inside it (ADR 0015 decision 5) and neither side is lost.
 * An edit to some other section is no conflict; that write re-applies.
 */
export function changedUnderneath(
  now: string,
  was: string
): WriteResult | null {
  if (now === was) return null;
  return {
    written: false,
    reason: "changedAndUnreapplyable",
    detail: "the section changed on disk since the page read it",
  };
}

/**
 * A write that names its target by what it reads rather than by where it
 * sits — a thread by its text, a source by its line, a Revision by its
 * timestamp — refuses when the file no longer holds exactly one of them:
 * none left to take the write, or two, where which was meant would be a
 * guess written to disk. The caller says what it was looking for in its
 * own nouns, because the line is the one a person reads.
 */
export function notExactlyOne(
  found: number,
  { none, several }: { none: string; several: string }
): WriteResult {
  return {
    written: false,
    reason: "changedAndUnreapplyable",
    detail: found === 0 ? none : several,
  };
}

/**
 * What a save of a Position answers with: the write's own result, and the
 * timestamp of the Revision it recorded — the name the why that may follow
 * `⌥↵` calls that entry by (#216), since an entry has no id. Null when the
 * save wrote no Revision: a refusal, or typing that matched the file and
 * was therefore not a save at all.
 */
export type SavedAnswer = WriteResult & { revision: string | null };

/**
 * A Position that is also an Edited section — a Working answer, a claim,
 * design notes — saved, and the Revision it records (#213; ADR 0020
 * decisions 1–2, 4): one write — `replaceSection` on the section, and the
 * entry either prepended or, inside the coalescing window, the head
 * re-stamped by replacing `## Position history` whole with every other
 * byte of it spliced back. Editing a Position adds to the history rather
 * than overwriting it (brief § Position history). Text the file already
 * holds is not a save, so a blur that changed nothing records nothing.
 */
export async function savePosition(
  ctx: PageContext,
  path: string,
  page: PageKind,
  {
    section: name,
    field,
    text: typed,
    basedOn,
    was,
    at,
    coalesceMs,
    judged = false,
  }: {
    /** The `##` heading the Position is the body of. */
    section: string;
    /** The field its Revisions carry: `working answer`, `claim`, `design notes`. */
    field: string;
    text: string;
    basedOn: string;
    was: string;
    at: Date;
    coalesceMs: number;
    /** Whether a Hypothesis's Override judged this Position, so its Revision voids one that is live (`writeOwn`): the claim, never design notes. */
    judged?: boolean;
  }
): Promise<SavedAnswer> {
  const text = typed.replace(/\r\n/g, "\n").trim();
  // The entry the plan settled on, kept from inside the queue where it is
  // computed: the page cannot name the Revision any other way, and reading
  // the head of the section back would be a guess about which entry was
  // this save's.
  const recorded: { at: string | null } = { at: null };
  const result = await writeOwn(ctx, path, page, (read, waiting) => {
    const { content, outline } = read;
    // The Position as the file holds it now: what the Revision is *from*.
    const from = bodyText(content, section(outline, name).heading);
    // Nothing to write, so nothing to base on: the file's hash is the
    // page's fresh view of it, whatever hash the page carried in. Nothing
    // is lost either, so a section that reached this text by another hand
    // is no conflict.
    if (from === text) return unchanged(read);
    // A section rewritten underneath would be replaced whole and its text
    // recorded as this Revision's `from` — a history entry quoting words
    // the user never saw.
    const conflict = changedUnderneath(from, was);
    if (conflict !== null) return conflict;
    const history = historyOperations(
      content,
      outline,
      { field, from, at },
      // An Obsidian edit is about to be spliced above the head entry, so
      // the head is no longer the change before this one: re-stamping it
      // would swallow the external edit's entry inside a window it does
      // not belong to. Any parked row closes the window, not only one of
      // this field: a re-stamp rewrites `## Position history` whole, and
      // `orderOf` then has to put the splices after it, which would leave
      // an older entry above a newer one.
      waiting.length > 0 ? 0 : coalesceMs
    );
    recorded.at = history.at;
    return {
      operations: [
        { op: "replaceSection", name, body: text },
        ...history.operations,
      ],
      basedOn,
      ...(judged ? { revisesJudged: history.at } : {}),
    };
  });
  // A refused write recorded nothing, whatever the plan had settled on.
  return result.written
    ? { ...result, revision: recorded.at }
    : { ...result, revision: null };
}

/**
 * The history's part of one save, and the entry it lands on: a new entry
 * is prepended; a save inside the window re-stamps the head entry, which
 * means the owned section is replaced whole — the operation set has no
 * "edit one entry", and this is the path `explainRevision` takes too. `at`
 * is the entry's timestamp either way, which is what the save answers with
 * so a why can name it. Coalescing is per field and only ever into the
 * head (`coalesce`), so on a page with more than one Position a save to
 * one field after a save to another opens a new entry.
 */
export function historyOperations(
  content: string,
  outline: Pick<Outline, "headings" | "listItems">,
  save: Save,
  coalesceMs: number
): { operations: Operation[]; at: string } {
  const history = section(outline, HISTORY).heading;
  const items =
    history === undefined ? [] : readRevisions(content, outline, history);
  const head = items[0];
  const { coalesced, revision } = coalesce(
    head?.revision ?? null,
    save,
    coalesceMs
  );
  const entry = formatRevision(revision);
  if (!coalesced || history === undefined || head === undefined) {
    return {
      operations: [{ op: "prependEntry", section: HISTORY, entry }],
      at: revision.at,
    };
  }
  return {
    operations: [
      {
        op: "replaceSection",
        name: HISTORY,
        body: sectionWithEntry(content, history.body, head.range, entry),
      },
    ],
    at: revision.at,
  };
}

/**
 * A why written onto a Revision (#216; brief § Position history, "detailed
 * when it matters"; spec #206 stories 33–36, spec #327 story 54). The
 * Revision is on disk before the why is asked for — `⌥↵` saves first, and
 * *+ why* in the history view comes months later — so this only ever adds
 * to an entry, which is what makes escaping the line a decline rather than
 * a cancel. One write: `## Position history` replaced whole with every
 * other byte of it spliced back, because the operation set has no "edit
 * one entry".
 *
 * An entry has no id; its timestamp identifies it within its field (ADR
 * 0020 decision 2), so the why names both. The timestamp alone was enough
 * while a page had one Position, and stopped being so with the
 * Hypothesis: a claim saved on blur and design notes saved on ⌘↵ can land
 * in the same second, as can a parked Obsidian edit and the save that
 * splices it (#333). A pair no entry carries — or one two entries carry —
 * refuses and says which, as a ticked thread does. Writing the why onto a
 * guess would put words in a Revision the user was not looking at.
 */
export async function explainRevision(
  ctx: PageContext,
  path: string,
  page: PageKind,
  {
    at,
    field,
    why,
    basedOn,
  }: { at: string; field: string; why: string; basedOn: string }
): Promise<WriteResult> {
  // An `· override` without a why is not an Override (`liveOverride`), so
  // nothing it came after ever voided it; a why written onto it now would
  // stand it over criteria it never judged, past every refusal the Override
  // itself makes (ADR 0031 decision 7). A fresh call is a fresh Override.
  if (field === OVERRIDE) {
    throw new VaultError(
      "refused",
      "An override's why is written with it; make a new override instead."
    );
  }
  return writeOwn(ctx, path, page, ({ content, outline }) => {
    const heading = section(outline, HISTORY).heading;
    if (heading === undefined) {
      return {
        written: false,
        reason: "changedAndUnreapplyable",
        detail: `no ## ${HISTORY} heading was found`,
      };
    }
    const matches = readRevisions(content, outline, heading).filter(
      (item) => item.revision?.at === at && item.revision.field === field
    );
    const [only] = matches;
    if (matches.length !== 1 || only?.revision == null) {
      return notExactlyOne(matches.length, {
        none: `no ${field} revision in ## ${HISTORY} is stamped ${at}`,
        several: `${matches.length} ${field} revisions in ## ${HISTORY} are stamped ${at}`,
      });
    }
    // A why is a sentence the user wrote, and this write replaces the
    // entry whole: taking one that is already there would lose it with
    // nothing said. Neither caller can reach this — a save never coalesces
    // into an explained entry, and *+ why* is offered on quiet ones — so
    // it guards the procedure rather than the page.
    if (only.revision.why !== null) {
      return {
        written: false,
        reason: "changedAndUnreapplyable",
        detail: `the revision stamped ${at} already carries a why`,
      };
    }
    const entry = formatRevision({ ...only.revision, why: onOneLine(why) });
    return {
      operations: [
        {
          op: "replaceSection",
          name: HISTORY,
          body: sectionWithEntry(content, heading.body, only.range, entry),
        },
      ],
      basedOn,
    };
  });
}

/**
 * Splice what one file owes its history and nothing else (#217): the quiet
 * window's timer and vault close both come here. It is `writeOwn` with an
 * empty plan — the parked entries are the whole of the write — so it
 * shares the page writes' queue and can never land on a file the page is
 * mid-write on. A file with nothing parked writes nothing. Whichever Kind
 * the file is: the row was parked by path, and any page with a history
 * takes its entries the same way.
 */
export async function splicePendingRevisions(
  ctx: PageContext,
  path: string
): Promise<WriteResult> {
  return writeOwn(ctx, path, "any historied page", unchanged);
}
