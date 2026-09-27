/** The message of whatever was thrown, for a reason a user will read. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The same message with the path Node appended cut off, for the reasons a
 * surface shows. The machine's filesystem layout is never something a reader
 * can use, and a window, a screenshot and a bug report all carry it onward,
 * so no reason printed on a surface keeps it (#277, #285).
 *
 * Node states an errno as `${code}: ${description}, ${syscall} '${path}'`
 * and carries the last two as fields, so the text it appended is cut by what
 * it *is* rather than matched back to a quote: a vault folder may hold an
 * apostrophe of its own — `Wan Shi Tong's Library` is the one this was found
 * in — and a strip that stopped at that quote would leave the whole path on
 * screen. An error carrying no path (EISDIR names no file) has nothing to
 * cut, and neither has anything that is not an errno.
 *
 * What a reason says *instead* of an errno stays with the call site, which
 * is the only place that knows what its own absence means.
 */
export const errorMessageWithoutPath = (error: unknown): string => {
  // `?? {}` for the same reason `errorMessage` takes an `unknown`: a `catch`
  // binds whatever was thrown, and a helper beside it must not be the one
  // that throws.
  const { syscall, path } = (error ?? {}) as NodeJS.ErrnoException;
  const message = errorMessage(error);
  if (path === undefined) return message;
  // Cut *at* what Node appended rather than removing it, so a call that
  // names two paths (`rename 'a' -> 'b'`, which the write protocol makes)
  // loses the second one with the first.
  const at = message.lastIndexOf(`, ${syscall} '${path}'`);
  return at === -1 ? message : message.slice(0, at);
};

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
