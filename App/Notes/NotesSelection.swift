import Index
import Library
import Observation

/// What the Notes tab has selected: the sidebar row, which scopes the note
/// list, the filter chips that narrow that scope, the note open in the
/// editor, the back / forward history of notes opened this session, and
/// Recent — the same notes by when they were last opened. Plain view
/// state, shared by the panes because each is hosted on its own (spec #8
/// § Selection state); the note list, editor, rail, and command palette
/// derive everything from it, `Library`, `Index`, and `Search`.
@Observable
final class NotesSelection {
    private(set) var sidebar: SidebarSelection = .allNotes
    /// The filter chips (CONTEXT.md § Note list): tag paths in the order
    /// they were added. A scope change leaves them; a library switch
    /// clears them.
    private(set) var chips: [String] = []
    /// The note open in the editor; `nil` leaves the editor empty.
    private(set) var openNote: Note?
    /// Recent (CONTEXT.md): every note opened this session, the one opened
    /// last first and each once — the open note at the front while one is
    /// open. Never persisted, cleared with the library.
    private(set) var recent: [Note] = []
    /// The notes opened this session up to and including the open one, as
    /// browsers keep them: never persisted, cleared with the library
    /// (spec #25 § History).
    private var history: [Note] = []
    /// The notes gone back from, nearest last; opening anything discards them.
    private var forward: [Note] = []
    /// Whether the editor should put the caret in the title of the note
    /// opened last — a note ⌘N just created — once it shows it.
    private var isTitleFocusRequested = false

    var canGoBack: Bool { history.count > 1 }
    var canGoForward: Bool { !forward.isEmpty }

    func selectAllNotes() {
        sidebar = .allNotes
    }

    func selectUntagged() {
        sidebar = .untagged
    }

    func selectRecent() {
        sidebar = .recent
    }

    /// Selecting a tag by its path (a `TagTreeNode`'s) deselects whatever
    /// folder or note was selected: the sidebar is one scope.
    func select(tagAt path: String) {
        sidebar = .tag(path: path)
    }

    func select(_ folder: Folder) {
        sidebar = .folder(folder)
    }

    /// Adds a chip for `tag` — a tag without its `#`, as displayed, as
    /// written, or as a tag tree node's path — at the path the Index gives
    /// it, so a click on `Reading/Notes` and a pick of `reading/notes` are
    /// one chip. A tag already chipped, or a spelling that is no tag, adds
    /// nothing.
    func addChip(forTag tag: String) {
        guard let path = Index.tagPath(of: tag), !chips.contains(path) else { return }
        chips.append(path)
    }

    /// The chip's `×`: the list widens by that one tag.
    func removeChip(_ path: String) {
        chips.removeAll { $0 == path }
    }

    /// Selecting a note in the file tree scopes the list to its folder and
    /// opens it, so both panes stay in step.
    func select(_ note: Note, in folder: Folder) {
        sidebar = .note(note, in: folder)
        push(note)
        openNote = note
        remember(note)
    }

    /// Opening a note — from a note list row, a link, or a backlink — shows
    /// it in the editor and pushes it onto history. The scope stays; a tree
    /// highlight on a different note gives way to its folder, so the tree
    /// never points at one note while the list and editor show another.
    func open(_ note: Note) {
        push(note)
        show(note)
    }

    /// The note opened last is one ⌘N just created: the editor should put
    /// the caret in its title, its text selected, so typing names it.
    func requestTitleFocus() {
        isTitleFocusRequested = true
    }

    /// Whether the title should take focus now — answered once per request.
    func takeTitleFocusRequest() -> Bool {
        defer { isTitleFocusRequested = false }
        return isTitleFocusRequested
    }

    /// The bar's *Close* on a note removed from disk: the editor empties,
    /// and the note leaves the history it can no longer be opened from.
    func close() {
        guard let openNote else { return }
        history.removeAll { $0.path == openNote.path }
        forward.removeAll { $0.path == openNote.path }
        recent.removeAll { $0.path == openNote.path }
        self.openNote = nil
    }

    /// The open note was renamed by its title field: everything held here
    /// as `note` is `renamed` now — the folder around it is found again
    /// when the library's change arrives.
    func renamed(_ note: Note, to renamed: Note) {
        let replacing = { (held: Note) in held.path == note.path ? renamed : held }
        openNote = openNote.map(replacing)
        history = history.map(replacing)
        forward = forward.map(replacing)
        recent = recent.map(replacing)
        if case .note(let highlighted, in: let folder) = sidebar, highlighted.path == note.path {
            sidebar = .note(renamed, in: folder)
        }
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

    /// The library changed under this selection — a save, or another
    /// tool's doing — so every note and folder held here is a copy from
    /// before it, and the panes compare by value. Each is found again by
    /// its path, the identity a note keeps (CONTEXT.md, Note); one that is
    /// gone is dropped — a scope falls back to its folder or All Notes,
    /// history closes over it — except the open note, which stays open as
    /// it was: the editor keeps its text behind the *Removed from disk*
    /// bar (ADR 0014) until it is closed or saved again.
    func refresh(from library: Library) {
        sidebar = sidebar.refreshed(from: library)
        openNote = openNote.map { library.note(at: $0.path) ?? $0 }
        let refreshed = { (note: Note) -> Note? in
            library.note(at: note.path) ?? (note.path == self.openNote?.path ? self.openNote : nil)
        }
        history = withoutRepeats(history.compactMap(refreshed))
        forward = withoutRepeats(forward.compactMap(refreshed))
        recent = recent.compactMap(refreshed)
    }

    /// A library that has been replaced takes its selection, history, and
    /// Recent with it.
    func clear() {
        sidebar = .allNotes
        chips = []
        openNote = nil
        history = []
        forward = []
        recent = []
        isTitleFocusRequested = false
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
        remember(note)
        if case .note(let highlighted, in: let folder) = sidebar, highlighted != note {
            sidebar = .folder(folder)
        }
    }

    /// `note` was just opened — by any route, Back and Forward included —
    /// so it moves to the front of Recent.
    private func remember(_ note: Note) {
        recent.removeAll { $0.path == note.path }
        recent.insert(note, at: 0)
    }
}
