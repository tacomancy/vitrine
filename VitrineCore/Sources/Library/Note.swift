import Foundation

/// One Markdown file in the library, identified by its `path`.
public struct Note: Sendable, Hashable {
    /// The filename, extension included.
    public let name: String
    /// The file's path relative to the library root — the note's identity.
    /// Two notes may share a `title` in different folders; never a `path`.
    public let path: String
    /// The filename without its extension (CONTEXT.md).
    public let title: String
    /// The file's modification date, as the file system reports it.
    public let modifiedAt: Date
}

extension Note {
    /// This note carrying `modifiedAt` instead; the rest untouched.
    func with(modifiedAt: Date) -> Note {
        Note(name: name, path: path, title: title, modifiedAt: modifiedAt)
    }
}
