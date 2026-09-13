import Library

/// One row of the file tree: a folder, note, or attachment, and how deep it
/// sits under the library root.
struct FileTreeEntry: Identifiable {
    enum Kind {
        case folder(Folder)
        case note(Note)
        case attachment(Attachment)
    }

    let kind: Kind
    let depth: Int

    /// The entry's path relative to the library root — its identity.
    var id: String {
        switch kind {
        case .folder(let folder): folder.path
        case .note(let note): note.path
        case .attachment(let attachment): attachment.path
        }
    }
}
