/**
 * What the core asks the shell for: the one thing it cannot do itself. A
 * desktop shell shows the folder chooser; a browser client (the iPad PWA)
 * has no host and no chooser, which is correct — the vault lives on the Mac.
 */
export type Host = {
  /** Show a folder chooser; resolves to the chosen path, or null if cancelled. */
  pickFolder: () => Promise<string | null>;
};
