import Library

/// What the sidebar has selected: All Notes, one folder, or one note. An
/// attachment cannot be selected.
enum SidebarSelection: Equatable {
    case allNotes
    case folder(Folder)
    case note(Note)
}
