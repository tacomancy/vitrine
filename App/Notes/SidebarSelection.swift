import Library

/// What the sidebar has selected: All Notes, one folder, or one note in the
/// folder that holds it. An attachment cannot be selected.
enum SidebarSelection: Equatable {
    case allNotes
    case folder(Folder)
    case note(Note, in: Folder)

    /// The notes this selection scopes the note list to: the whole library,
    /// or a folder's at every depth — a selected note scopes to its folder.
    func notes(in library: Library) -> [Note] {
        switch self {
        case .allNotes: library.allNotes
        case .folder(let folder): folder.allNotes
        case .note(_, let folder): folder.allNotes
        }
    }
}
