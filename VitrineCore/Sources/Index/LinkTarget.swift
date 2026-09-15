import Foundation
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

extension LinkTarget {
    /// The title a note created for an unresolved link takes (CONTEXT.md,
    /// Unresolved link): the target's last path component, without the
    /// `.md` a path-form wikilink or a Markdown link may carry — the note
    /// is created in one folder, never along the target's path. Nil for a
    /// target that resolved.
    public var titleForNewNote: String? {
        guard case .unresolved(let target) = self else { return nil }
        let name = target.split(separator: "/").last.map(String.init) ?? target
        // The title rule the scan applies to a file (CONTEXT.md § Note).
        return Library.isNote(name)
            ? URL(filePath: name).deletingPathExtension().lastPathComponent : name
    }
}
