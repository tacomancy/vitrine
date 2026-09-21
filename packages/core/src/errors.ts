/** The message of whatever was thrown, for a reason a user will read. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type VaultErrorKind =
  | "notAFolder"
  | "unreadable"
  | "noVault"
  | "writeFailed"
  | "outsideVault"
  | "notMarkdown";

/** Why the vault refused an open or a write, with a message fit to show as it is. */
export class VaultError extends Error {
  constructor(
    readonly kind: VaultErrorKind,
    message: string
  ) {
    super(message);
    this.name = "VaultError";
  }
}
