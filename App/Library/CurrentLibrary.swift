import Foundation
import Index
import Library
import LibraryWatcher
import NoteParsing
import Observation

/// The one library open in the window (ADR 0007), its Index, and the rule
/// for opening another: a successful open replaces both and remembers the
/// path; a failed open changes nothing. No library is First run. While a
/// library is open it is watched (ADR 0014): what another tool does to it
/// is folded into the library and the Index as it happens.
@Observable
final class CurrentLibrary {
    private(set) var library: Library?
    /// The open library's Index, built with it; `nil` exactly when `library` is.
    private(set) var index: Index?
    /// Why the last open from the panel failed; cleared when the alert closes.
    var openFailure: LibraryError?
    /// Why the last note ⌘N or a link tried to create was not; cleared
    /// when the alert closes.
    var createFailure: LibraryError?

    /// The watch over the open library, ended when another replaces it.
    @ObservationIgnored private var watcher: Task<Void, Never>?

    // App-level user defaults: nothing is written into the library and no
    // sidecar is created (ADR 0002).
    private static let lastLibraryPathKey = "lastLibraryPath"

    /// At launch, the last library reopens. One that has gone or cannot be
    /// read leaves First run showing, silently: a missing folder is not a
    /// fault, and its path stays remembered in case it comes back.
    func reopenLast() {
        guard let path = UserDefaults.standard.string(forKey: Self.lastLibraryPathKey),
            let library = try? Library.open(at: URL(filePath: path))
        else { return }
        replace(with: library)
    }

    /// Opens the folder as the library. On success it replaces the current
    /// one and its path is remembered; on failure `openFailure` carries the
    /// reason and neither the library nor the remembered path changes.
    func open(folderAt url: URL) {
        do {
            replace(with: try Library.open(at: url))
            UserDefaults.standard.set(
                url.path(percentEncoded: false), forKey: Self.lastLibraryPathKey)
        } catch {
            openFailure = error
        }
    }

    /// Writes `parsed.text` to `note` in place and folds the parse into
    /// the Index (ADR 0014, ADR 0017): the library and Index on screen are
    /// replaced together, and the note comes back as the library holds it
    /// now, with its new modification date. Throws what `Library.write`
    /// throws, and then nothing has changed.
    func save(_ parsed: ParsedNote, to note: Note) throws(LibraryError) -> Note {
        var (library, index) = opened()
        try library.write(parsed.text, to: note)
        guard let saved = library.note(at: note.path) else { throw .noteMissing }
        self.index = index.updating(saved, parsed: parsed)
        self.library = library
        return saved
    }

    /// Creates an empty note titled `title` in `folder` and folds it into
    /// the Index, so links elsewhere to that title resolve at once; the
    /// note comes back as the library holds it. Throws what
    /// `Library.createNote` throws, and then nothing has changed.
    func createNote(named title: String, in folder: Folder) throws(LibraryError) -> Note {
        var (library, index) = opened()
        let note = try library.createNote(named: title, in: folder)
        index = index.adding(note, parsed: ParsedNote.parse(""))
        self.index = index
        self.library = library
        return note
    }

    /// The new note ⌘N makes: `Untitled`, or the first `Untitled N` the
    /// folder does not have (CONTEXT.md § Note).
    func createUntitledNote(in folder: Folder) throws(LibraryError) -> Note {
        let (library, _) = opened()
        return try createNote(named: library.uniqueUntitledName(in: folder), in: folder)
    }

    /// Renames `note` to `title` within its folder and tells the Index, so
    /// links by either title re-resolve; the note comes back as the
    /// library holds it. Links elsewhere are not rewritten (CONTEXT.md
    /// § Note). Throws what `Library.renameNote` throws, and then nothing
    /// has changed.
    func renameNote(_ note: Note, to title: String) throws(LibraryError) -> Note {
        var (library, index) = opened()
        let renamed = try library.renameNote(note, to: title)
        index = index.renaming(note, to: renamed)
        self.index = index
        self.library = library
        return renamed
    }

    /// A note is saved, created, or renamed in an open library — every
    /// caller reads it from this one — so having none is a programming
    /// error, not a case.
    private func opened() -> (Library, Index) {
        guard let library, let index else {
            preconditionFailure("A note is written into the library it was read from.")
        }
        return (library, index)
    }

    // ADR 0012: the Index is built here, synchronously, so a library is never
    // on screen without its tags — no loading state.
    private func replace(with library: Library) {
        index = Index.build(from: library)
        self.library = library
        watch(library)
    }

    /// Every change another tool makes to `library` from now on, folded in
    /// as it arrives; the watch before this one ends. A change the old
    /// watch had in hand as it ended is dropped, not applied to the new
    /// library.
    private func watch(_ library: Library) {
        watcher?.cancel()
        watcher = Task { [weak self] in
            for await change in LibraryWatcher.watch(library) {
                guard let self, self.library?.rootURL == library.rootURL else { return }
                apply(change)
            }
        }
    }

    /// The library and Index with `change` reflected (ADR 0014, ADR 0017),
    /// replaced together so no pane sees one without the other.
    private func apply(_ change: LibraryChange) {
        let (library, index) = opened()
        let changed = library.applying(change)
        self.index = index.applying(change, in: changed)
        self.library = changed
    }
}
