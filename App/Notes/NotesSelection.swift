import Library
import Observation

/// What the Notes tab has selected: the sidebar row, which scopes the note
/// list, the note open in the editor, and the back / forward history of
/// notes opened this session. Plain view state, shared by the panes because
/// each is hosted on its own (spec #8 § Selection state); the note list,
/// editor, and rail derive everything from it, `Library`, and `Index`.
@Observable
final class NotesSelection {
    private(set) var sidebar: SidebarSelection = .allNotes
    /// The note open in the editor; `nil` leaves the editor empty.
    private(set) var openNote: Note?
    /// The notes opened this session up to and including the open one, as
    /// browsers keep them: never persisted, cleared with the library
    /// (spec #25 § History).
    private var history: [Note] = []
    /// The notes gone back from, nearest last; opening anything discards them.
    private var forward: [Note] = []

    var canGoBack: Bool { history.count > 1 }
    var canGoForward: Bool { !forward.isEmpty }

    func selectAllNotes() {
        sidebar = .allNotes
    }

    func selectUntagged() {
        sidebar = .untagged
    }

    /// Selecting a tag by its path (a `TagTreeNode`'s) deselects whatever
    /// folder or note was selected: the sidebar is one scope.
    func select(tagAt path: String) {
        sidebar = .tag(path: path)
    }

    func select(_ folder: Folder) {
        sidebar = .folder(folder)
    }

    /// Selecting a note in the file tree scopes the list to its folder and
    /// opens it, so both panes stay in step.
    func select(_ note: Note, in folder: Folder) {
        sidebar = .note(note, in: folder)
        push(note)
        openNote = note
    }

    /// Opening a note — from a note list row, a link, or a backlink — shows
    /// it in the editor and pushes it onto history. The scope stays; a tree
    /// highlight on a different note gives way to its folder, so the tree
    /// never points at one note while the list and editor show another.
    func open(_ note: Note) {
        push(note)
        show(note)
    }

    /// Back (⌘[): the note opened before this one, scope untouched.
    func goBack() {
        guard canGoBack, let current = history.popLast(), let previous = history.last else {
            return
        }
        forward.append(current)
        show(previous)
    }

    /// Forward (⌘]): the note gone back from, scope untouched.
    func goForward() {
        guard let next = forward.popLast() else { return }
        history.append(next)
        show(next)
    }

    /// The library changed under this selection — a save — so every note
    /// and folder held here is a copy from before it, and the panes compare
    /// by value. Each is found again by its path, the identity a note keeps
    /// (CONTEXT.md, Note); one that is gone is dropped — the open note
    /// closes, a scope falls back to All Notes, history closes over it.
    func refresh(from library: Library) {
        sidebar = sidebar.refreshed(from: library)
        openNote = openNote.flatMap { library.note(at: $0.path) }
        history = withoutRepeats(history.compactMap { library.note(at: $0.path) })
        forward = withoutRepeats(forward.compactMap { library.note(at: $0.path) })
    }

    /// A library that has been replaced takes its selection and history with it.
    func clear() {
        sidebar = .allNotes
        openNote = nil
        history = []
        forward = []
    }

    /// Every opening truncates what was ahead, as browsers do. The note
    /// already open is not entered twice, so back always leads somewhere else.
    private func push(_ note: Note) {
        forward = []
        guard history.last != note else { return }
        history.append(note)
    }

    /// `notes` with a note that follows itself entered once, as `push`
    /// keeps them.
    private func withoutRepeats(_ notes: [Note]) -> [Note] {
        notes.reduce(into: []) { kept, note in
            if kept.last != note { kept.append(note) }
        }
    }

    private func show(_ note: Note) {
        openNote = note
        if case .note(let highlighted, in: let folder) = sidebar, highlighted != note {
            sidebar = .folder(folder)
        }
    }
}
