/**
 * What the core asks the shell for: the things it cannot do itself. A
 * desktop shell shows the two choosers and Finder; a browser client (the
 * iPad PWA) has no host and neither, which is correct — the vault lives on
 * the Mac.
 */
export type Host = {
  /** Show a folder chooser; resolves to the chosen path, or null if cancelled. */
  pickFolder: () => Promise<string | null>;
  /**
   * Show a file chooser for one file of any type — an Artifact is whatever
   * the run produced (ADR 0035); resolves to its path, or null if cancelled.
   */
  pickFile: () => Promise<string | null>;
  /** Show a folder in Finder. Nothing comes back: Finder is its own answer. */
  reveal: (path: string) => void;
};
