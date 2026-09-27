import type {
  ListedQuestion,
  Listing,
  PartialQuestion,
  QuestionStatus,
} from "core";

/** One line of the Inbox: a Question, or a partial file standing in for one. */
export type Row =
  | { kind: "question"; path: string; question: ListedQuestion; when: string }
  | { kind: "partial"; path: string; partial: PartialQuestion; when: string };

/**
 * Questions and partial files in one list, ordered together: a partial file
 * has no `captured`, so its modification time is where it sits.
 */
export function rowsOf(listing: Listing, order: "newest" | "oldest"): Row[] {
  const rows: Row[] = [
    ...listing.questions.map((question): Row => ({
      kind: "question",
      path: question.path,
      question,
      when: question.captured,
    })),
    ...listing.partial.map((partial): Row => ({
      kind: "partial",
      path: partial.path,
      partial,
      when: partial.mtime,
    })),
  ];
  const sign = order === "newest" ? -1 : 1;
  return rows.sort((a, b) => sign * (Date.parse(a.when) - Date.parse(b.when)));
}

// Every status ships with a glyph and a label (BRAND.md law 6); only open is
// coloured, and that colour is the accent.
export const STATUS: Record<QuestionStatus, { glyph: string; label: string }> =
  {
    open: { glyph: "◆", label: "open" },
    promoted: { glyph: "■", label: "promoted" },
    answered: { glyph: "●", label: "answered" },
    abandoned: { glyph: "×", label: "dropped" },
  };

/**
 * Where a Question came from, as one line: *Unattached* when nothing was
 * open. `from` is shown as the file holds it; how a Source reads here is the
 * Reader slice's call, not this one's.
 */
export function provenanceOf(question: ListedQuestion): string {
  if (question.from === undefined) return "Unattached";
  const { from, page } = question;
  return page === undefined ? from : `${from} · p.${page}`;
}

/** Month names, for the date forms below; index 0 is January. */
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `since Aug 2026`: the month the oldest row was captured. */
export function monthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]?.slice(0, 3)} ${d.getFullYear()}`;
}

/** The full local date, `14 August 2026`. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** The full local date and time, `14 August 2026 · 09:12`. */
export function localDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${localDate(iso)} · ${hh}:${mm}`;
}
