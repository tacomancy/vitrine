import Index
import Library

/// What the sidebar has selected — its one scope (CONTEXT.md § Sidebar): All
/// Notes, Recent, Untagged, one folder, one note in the folder that holds
/// it, or one tag by its path. An attachment cannot be selected.
enum SidebarSelection: Equatable {
    case allNotes
    case recent
    case untagged
    case folder(Folder)
    case note(Note, in: Folder)
    case tag(path: String)

    /// The notes this selection scopes the note list to, in the order the
    /// list shows them: the whole library, the untagged ones, a folder's at
    /// every depth — a selected note scopes to its folder — or those
    /// carrying a tag or any tag under it, each newest first (notes
    /// modified at the same instant keep library display order); or
    /// `recent` as given, in recency order (CONTEXT.md, Recent).
    func notes(in library: Library, index: Index, recent: [Note]) -> [Note] {
        switch self {
        case .allNotes: byDate(library.allNotes)
        case .recent: recent
        case .untagged: byDate(index.untagged)
        case .folder(let folder): byDate(folder.allNotes)
        case .note(_, let folder): byDate(folder.allNotes)
        case .tag(let path): byDate(index.notes(tagged: path))
        }
    }

    /// The folder a note created now goes in (spec #38 § Creating): the
    /// selected folder, or a selected note's; the root for All Notes,
    /// Recent, Untagged, or a tag — found in `library` as it is now.
    func folderForNewNotes(in library: Library) -> Folder {
        switch self {
        case .allNotes, .recent, .untagged, .tag: library.root
        case .folder(let folder), .note(_, let folder):
            library.folder(at: folder.path) ?? library.root
        }
    }

    /// This selection over `library` as it is now: a folder or note found
    /// again by path, or — when it has gone — the folder that held the
    /// note, or All Notes.
    func refreshed(from library: Library) -> SidebarSelection {
        switch self {
        case .allNotes, .recent, .untagged, .tag:
            self
        case .folder(let folder):
            library.folder(at: folder.path).map(SidebarSelection.folder) ?? .allNotes
        case .note(let note, let folder):
            if let folder = library.folder(at: folder.path) {
                library.note(at: note.path).map { .note($0, in: folder) } ?? .folder(folder)
            } else {
                .allNotes
            }
        }
    }

    private func byDate(_ notes: [Note]) -> [Note] {
        notes.sorted { $0.modifiedAt > $1.modifiedAt }
    }
}
