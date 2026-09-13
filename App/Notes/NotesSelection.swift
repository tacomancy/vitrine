import Library
import Observation

/// What the Notes tab has selected: the sidebar row, which scopes the note
/// list, and the note open in the editor. Plain view state, shared by the
/// three panes because each is hosted on its own (spec #8 § Selection
/// state); the note list and editor derive everything from it and `Library`.
@Observable
final class NotesSelection {
    var sidebar: SidebarSelection = .allNotes
    /// The note open in the editor; `nil` leaves the editor empty.
    private(set) var note: Note?

    /// Selecting a note in the file tree scopes the list to its folder and
    /// opens it, so both panes stay in step.
    func select(_ note: Note, in folder: Folder) {
        sidebar = .note(note, in: folder)
        self.note = note
    }

    /// Selecting a row in the note list opens the note; the scope stays.
    func open(_ note: Note) {
        self.note = note
    }

    /// A library that has been replaced takes its selection with it.
    func clear() {
        sidebar = .allNotes
        note = nil
    }
}
