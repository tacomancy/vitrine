import type { Heading, ListItem, Outline, Range } from "markdown";
import { localIso } from "./questions.js";

/**
 * Position history (brief § Position history; ADR 0006 decision 5; ADR
 * 0020 decisions 1–2): the Revision grammar as a pure format ↔ parse pair,
 * the section read off the outline's list items, and the coalescing rule.
 * Keyed by field name and Vitrine-agnostic about which Kind owns the field,
 * so a Hypothesis claim or an Experiment design registers a field here and
 * inherits the rest. Load-bearing per `CLAUDE.md`: the history is the
 * app's real subject, and it must read in Obsidian without the app.
 */

/** One entry: when the field changed, what it changed from, in full, and — optionally — why. */
export type Revision = {
  /** ISO 8601 with local offset; the entry's identity — it carries no id. */
  at: string;
  field: string;
  why: string | null;
  /** The full previous text; empty when the field was empty before. */
  from: string;
};

// The grammar's fixed parts. `·` separates the timestamp from the field;
// `why:` and `from:` are continuation lines two spaces in; the previous
// text sits four spaces in so a blank line between its paragraphs stays
// inside the list item (ADR 0020's reason for the extra level).
const FIRST_LINE = /^- (\S+) · (.+)$/;
const WHY = "  why: ";
const FROM = "  from:";
const TEXT_INDENT = "    ";

/**
 * The list item for one Revision, LF, no trailing newline — what
 * `prependEntry` takes. An empty `from` is the bare `from:` line.
 */
export function formatRevision(revision: Revision): string {
  const lines = [`- ${revision.at} · ${revision.field}`];
  if (revision.why !== null) lines.push(WHY + revision.why);
  lines.push(FROM);
  if (revision.from !== "") {
    for (const line of revision.from.split("\n")) {
      // A blank line stays blank rather than carrying four spaces.
      lines.push(line === "" ? "" : TEXT_INDENT + line);
    }
  }
  return lines.join("\n");
}

/**
 * The inverse, from a list item's text as the outline ranges it. Null when
 * the item is not an entry — a note someone typed under the heading — so
 * the caller can leave it in place rather than lose it.
 */
export function parseRevision(item: string): Revision | null {
  const lines = item.split("\n");
  const first = FIRST_LINE.exec(lines[0] ?? "");
  if (first === null) return null;
  let why: string | null = null;
  let next = 1;
  if (lines[next]?.startsWith(WHY)) {
    why = lines[next]!.slice(WHY.length);
    next++;
  }
  if (lines[next] !== FROM) return null;
  const from = lines
    .slice(next + 1)
    .map((line) =>
      line.startsWith(TEXT_INDENT) ? line.slice(TEXT_INDENT.length) : line
    )
    .join("\n")
    // The item's range ends at its last non-blank line, but an entry
    // written by hand may still carry trailing whitespace.
    .replace(/\s+$/, "");
  return { at: first[1]!, field: first[2]!, why, from };
}

/**
 * The top-level list items inside a section: those within its body that
 * no other item contains. A nested item belongs to its parent line — a
 * source's note may run on to an indented line, a Revision's previous
 * text may itself be a list.
 */
export function topLevelItems(
  outline: Pick<Outline, "listItems">,
  heading: Heading
): ListItem[] {
  const inside = outline.listItems.filter(
    (item) =>
      item.range.start >= heading.body.start &&
      item.range.end <= heading.body.end
  );
  return inside.filter(
    (item) =>
      !inside.some(
        (other) =>
          other !== item &&
          other.range.start <= item.range.start &&
          other.range.end >= item.range.end
      )
  );
}

/** One item under `## Position history`: its range, and the entry it parses as, or null. */
export type RevisionItem = { range: Range; revision: Revision | null };

/**
 * The section's items in file order — newest first when the file is as the
 * app writes it — each with its range, so a rewrite can re-stamp one entry
 * and leave every other byte of the section as it was.
 */
export function readRevisions(
  content: string,
  outline: Pick<Outline, "listItems">,
  heading: Heading
): RevisionItem[] {
  return topLevelItems(outline, heading).map((item) => ({
    range: item.range,
    revision: parseRevision(content.slice(item.range.start, item.range.end)),
  }));
}

export type Save = {
  field: string;
  /** The field's text before this save. */
  from: string;
  at: Date;
  windowMs: number;
};

/**
 * Which entry a save records (ADR 0020 decision 2). Saves to one field
 * within the window are one entry: the head is re-stamped with this save
 * and keeps the `from:` of before the first, so the entry reads "by this
 * time the answer had moved from X". A save after the window, to another
 * field, or over a head that carries a why (a why closes the window, ADR
 * 0006 decision 5) opens a new entry. Only the section's head is ever
 * re-stamped: re-stamping a lower entry would put a newer timestamp under
 * an older one and break newest-first.
 */
export function coalesce(
  head: Revision | null,
  save: Save
): { coalesced: boolean; revision: Revision } {
  const at = localIso(save.at);
  if (head !== null && head.field === save.field && head.why === null) {
    const since = save.at.getTime() - Date.parse(head.at);
    if (!Number.isNaN(since) && since >= 0 && since < save.windowMs) {
      return { coalesced: true, revision: { ...head, at } };
    }
  }
  return {
    coalesced: false,
    revision: { at, field: save.field, why: null, from: save.from },
  };
}
