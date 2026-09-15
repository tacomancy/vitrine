import Library

/// The commands the menu bar and the command palette both run on the key
/// window: they reach the same library, selection, and buffer, so the two
/// routes cannot drift. The menu has no window of its own, so its
/// selection and buffer are nil when none is key — then a note is not
/// created and there is nothing to save.
struct WindowCommands {
    let currentLibrary: CurrentLibrary
    let selection: NotesSelection?
    let buffer: NoteBuffer?

    /// ⌘N: an Untitled note in the folder the sidebar has selected, or the
    /// root, opened with the caret in its title (spec #38 § Creating).
    func newUntitledNote() {
        guard let library = currentLibrary.library, let selection else { return }
        let folder = selection.sidebar.folderForNewNotes(in: library)
        do throws(LibraryError) {
            let note = try currentLibrary.createUntitledNote(in: folder)
            selection.requestTitleFocus()
            selection.open(note)
        } catch {
            currentLibrary.createFailure = error
        }
    }

    /// The palette's *New note titled "…"*: the note the search did not
    /// find, created in the same folder ⌘N would use and opened with the
    /// caret in its body — the title is already what was typed.
    func newNote(titled title: String) {
        guard let library = currentLibrary.library, let selection else { return }
        let folder = selection.sidebar.folderForNewNotes(in: library)
        do throws(LibraryError) {
            selection.open(try currentLibrary.createNote(named: title, in: folder))
        } catch {
            currentLibrary.createFailure = error
        }
    }

    /// Open Library…: the panel, then the chosen folder replaces the
    /// library — the open note saved first (ADR 0014). Cancelling the
    /// panel changes nothing.
    func openLibrary() {
        guard let folder = LibraryOpenPanel.chooseFolder() else { return }
        buffer?.save()
        currentLibrary.open(folderAt: folder)
    }
}
