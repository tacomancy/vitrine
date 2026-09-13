/// A filesystem directory inside the library. It carries no semantics of its
/// own; its three lists are already in display order (CONTEXT.md).
public struct Folder: Sendable, Equatable {
    /// The directory's name.
    public let name: String
    /// The directory's path relative to the library root; empty for the root.
    public let path: String
    /// Subfolders, in case-insensitive natural order.
    public let folders: [Folder]
    /// Notes directly in this folder, in case-insensitive natural order.
    public let notes: [Note]
    /// Attachments directly in this folder, in case-insensitive natural order.
    public let attachments: [Attachment]
}

extension Folder {
    /// This folder's notes followed by each subfolder's, in tree order.
    var allNotes: [Note] {
        notes + folders.flatMap(\.allNotes)
    }
}
