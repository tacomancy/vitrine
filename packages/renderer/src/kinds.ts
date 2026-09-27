import type { CandidateKind } from "core";
import { hashOf } from "./router";

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
 * The Address of a file of this Kind, or null for a Kind with nowhere to open
 * yet — a Note, a Source, a Source stub, and a `kind:` the app does not know,
 * each named rather than linked until its surface exists (spec #206 story 56;
 * the Vault editor is beat 11). The Kind is a bare string because that is how
 * the index carries it: one the app does not know is stored verbatim, and
 * there is nothing to open for it either way. One function, so every surface
 * says the same thing about the same file and one edit wakes them all.
 */
export function addressOf(
  kind: string | null | undefined,
  path: string
): string | null {
  switch (kind) {
    case "question":
      return hashOf({ surface: "inbox", question: path });
    case "research-question":
      return hashOf({ surface: "research-question", path });
    default:
      return null;
  }
}

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

/**
 * The Kinds the attach form offers (§ Research Question view and triage):
 * a paper, with or without its PDF yet. Attaching is the judgement that
 * something is evidence, and only a Source or a stub can be.
 */
export const ATTACHABLE: CandidateKind[] = ["source", "source-stub"];
