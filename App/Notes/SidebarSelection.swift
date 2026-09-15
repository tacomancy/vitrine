import Index
import Library

/// What the sidebar has selected — its one scope (CONTEXT.md § Sidebar): All
/// Notes, Untagged, one folder, one note in the folder that holds it, or one
/// tag by its path. An attachment cannot be selected.
enum SidebarSelection: Equatable {
    case allNotes
    case untagged
    case folder(Folder)
    case note(Note, in: Folder)
    case tag(path: String)

    /// The notes this selection scopes the note list to: the whole library, the
    /// untagged ones, a folder's at every depth — a selected note scopes to
    /// its folder — or those carrying a tag or any tag under it.
    func notes(in library: Library, index: Index) -> [Note] {
        switch self {
        case .allNotes: library.allNotes
        case .untagged: index.untagged
        case .folder(let folder): folder.allNotes
        case .note(_, let folder): folder.allNotes
        case .tag(let path): index.notes(tagged: path)
        }
    }
}
