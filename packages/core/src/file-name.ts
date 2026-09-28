/**
 * The file-name rule every page named from typed text shares (§ Vault
 * layout): a Question from its text, a Hypothesis from its claim.
 */

const NAME_LIMIT = 80;
// Obsidian refuses these in a file name; the second set breaks wikilinks.
const FORBIDDEN = /[*"\\/<>:|?#^[\]]/g;

/**
 * The file name typed text yields — a Question's text, a Hypothesis's
 * claim — or the id when nothing survives.
 * Pure, so the rules can be read off a table of cases.
 */
export function fileName(text: string, id: string): string {
  let name = text.replace(FORBIDDEN, "").replace(/\s+/g, " ").trim();
  // A leading dot would make the file a dot-entry, which every scan of the
  // vault skips — a captured Question that never appears in the Inbox.
  name = name.replace(/^\.+/, "").trimStart();
  if (name.length > NAME_LIMIT) {
    const cut = name.lastIndexOf(" ", NAME_LIMIT);
    name = name.slice(0, cut > 0 ? cut : NAME_LIMIT).trimEnd();
  }
  return name === "" ? id : name;
}

/**
 * The name a stored Artifact keeps in its Experiment's folder: the file's
 * own, less what would break the `![[…]]` that embeds it (Obsidian's
 * forbidden set, which is `fileName`'s) and a leading dot that would hide
 * it from every scan. Unlike `fileName` it is never cut: the extension is
 * what says whether the page draws an image. Empty when nothing survives.
 */
export function artifactName(name: string): string {
  return name
    .replace(FORBIDDEN, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trimStart();
}

/** `plot.png` → `plot (2).png`: the Question's suffix rule, before the extension. */
export function suffixed(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)} (${n})${name.slice(dot)}`
    : `${name} (${n})`;
}
