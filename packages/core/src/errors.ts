/** The message of whatever was thrown, for a reason a user will read. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type VaultErrorKind =
  | "notAFolder"
  | "unreadable"
  | "noVault"
  | "writeFailed"
  | "outsideVault"
  | "notMarkdown"
  // A write the protocol would not make (the file changed underneath and
  // the operations could not be re-applied, or verification failed), or a
  // triage action the object's state does not allow.
  | "refused";

/** Why the vault refused an open, a write, or an action, with a message fit to show as it is. */
export class VaultError extends Error {
  constructor(
    readonly kind: VaultErrorKind,
    message: string
  ) {
    super(message);
    this.name = "VaultError";
  }
}
