import type { CandidateKind } from "core";

/**
 * A Kind's glyph and its name, the vocabulary `docs/architecture.md`
 * § Vault sets (◆ question · ● source · ○ stub) extended to the two the
 * picker also shows. Every glyph ships with a label (BRAND.md law 6), and
 * none of them is coloured: the Inbox's amber means *an open Question* and
 * nothing else. A Note is the quietest mark there is, which is what an
 * ordinary Markdown file deserves.
 */
export const KIND: Record<string, { glyph: string; label: string }> = {
  question: { glyph: "◆", label: "question" },
  "research-question": { glyph: "■", label: "research question" },
  source: { glyph: "●", label: "source" },
  "source-stub": { glyph: "○", label: "source stub" },
  note: { glyph: "·", label: "note" },
};

/**
 * The Kinds Link offers (§ Research Question view and triage, One picker).
 * Module-level, so the picker's query key does not change on every render.
 */
export const LINKABLE: CandidateKind[] = [
  "question",
  "research-question",
  "note",
  "source",
  "source-stub",
];
