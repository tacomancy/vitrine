import Library

/// What a link's target *is* once the Index has resolved it (CONTEXT.md
/// § Links): a note, an attachment, or nothing in the library. Public as
/// `ResolvedLink.target`, so following a link is a switch over three cases.
public enum LinkTarget: Sendable, Equatable {
    /// The note the link resolves to.
    case note(Note)
    /// The attachment the link or embed resolves to; following it opens the
    /// file with the system.
    case attachment(Attachment)
    /// The target as written, when it matches no note, alias, or attachment
    /// (CONTEXT.md, Unresolved link).
    case unresolved(String)
}
