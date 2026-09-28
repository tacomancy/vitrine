/**
 * The file-name rule every page named from typed text shares (§ Vault
 * layout): a Question from its text, a Hypothesis from its claim.
 */

const NAME_LIMIT = 80;
// Obsidian refuses these in a file name; the second set breaks wikilinks.
const FORBIDDEN = /[*"\\/<>:|?#^[\]]/g;

/**
 * The file name a Question's text yields, or the id when nothing survives.
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
