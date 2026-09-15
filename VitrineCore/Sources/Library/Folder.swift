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
    /// This folder's notes followed by each subfolder's, recursively, in
    /// tree order — what a folder selected in the sidebar scopes the note
    /// list to.
    public var allNotes: [Note] {
        notes + folders.flatMap(\.allNotes)
    }

    /// This folder's attachments followed by each subfolder's, recursively,
    /// in the same tree order — what a link to an attachment's filename is
    /// resolved against.
    public var allAttachments: [Attachment] {
        attachments + folders.flatMap(\.allAttachments)
    }

    /// This tree with the folder at `path` (this one, for its own path)
    /// replaced by what `transform` makes of it. A path outside the tree
    /// changes nothing.
    func replacingFolder(at path: String, _ transform: (Folder) -> Folder) -> Folder {
        if path == self.path { return transform(self) }
        return Folder(
            name: name,
            path: self.path,
            folders: folders.map { folder in
                guard path == folder.path || path.hasPrefix(folder.path + "/") else {
                    return folder
                }
                return folder.replacingFolder(at: path, transform)
            },
            notes: notes,
            attachments: attachments)
    }

    /// This folder with its notes swapped for `notes`; the rest untouched.
    func with(notes: [Note]) -> Folder {
        Folder(name: name, path: path, folders: folders, notes: notes, attachments: attachments)
    }
}
