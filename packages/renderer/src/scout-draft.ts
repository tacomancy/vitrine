import type { FormValues, Tried } from "./ScoutForm";

/**
 * A Scout form's draft: what was typed and what *try* last said, held under
 * the form's own Address so a reload, a trip to Settings for *Add a key* and
 * the back button all find it as left (ADR 0025 decision 3; ADR 0053
 * decision 5). Session storage, not the vault: a draft is not a note, and
 * nothing here should outlast the window that wrote it.
 */
export type Draft = { values: FormValues | null; tried: Tried | null };

const NONE: Draft = { values: null, tried: null };

/** Per vault, and per form: a new Scout's draft is never an edit's. */
const keyOf = (vault: string, scout: string | undefined) =>
  `vitrine.scout-draft:${vault}:${scout ?? "new"}`;

// Storage can be full, blocked or hold what an older build wrote; a draft
// that cannot be kept or read is a form that opens fresh, never an error.
export function readDraft(vault: string, scout: string | undefined): Draft {
  try {
    const raw = sessionStorage.getItem(keyOf(vault, scout));
    return raw === null ? NONE : (JSON.parse(raw) as Draft);
  } catch {
    return NONE;
  }
}

export function writeDraft(
  vault: string,
  scout: string | undefined,
  draft: Draft
): void {
  try {
    sessionStorage.setItem(keyOf(vault, scout), JSON.stringify(draft));
  } catch {
    // See readDraft.
  }
}

export function dropDraft(vault: string, scout: string | undefined): void {
  try {
    sessionStorage.removeItem(keyOf(vault, scout));
  } catch {
    // See readDraft.
  }
}
