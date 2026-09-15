import AppKit
import Library
import NoteParsing
import Observation

/// The open note's text as the editor holds it — the buffer (CONTEXT.md
/// § Editor) — with whether it is ahead of the disk. Each edit's parse
/// replaces the last; a save writes the text in place through
/// `CurrentLibrary` about a second after the last edit, and at once on a
/// note switch, on the window or app going inactive, on quit, and on ⌘S
/// (ADR 0014). Clean, a save does nothing. When another tool changes the
/// note underneath, a clean buffer takes the disk's text; a dirty one
/// keeps its own and holds every save until the bar in the editor is
/// answered — and a note removed from disk keeps its text the same way.
@Observable
final class NoteBuffer {
    /// What another tool did to the open note on disk while the buffer
    /// was ahead of it or held its only copy (ADR 0014). Until the bar in
    /// the editor is answered, no save runs.
    enum Conflict {
        /// The file changed under a dirty buffer: overwrite it, or reload.
        case changedOnDisk
        /// The file is gone: save the text as a new note there, or close.
        case removedFromDisk
    }

    /// The note the text belongs to, as the library held it at the last
    /// read or save; nil while no note is open.
    private(set) var note: Note?
    /// The text and its parse; nil while no note is open or its text could
    /// not be read.
    private(set) var parsed: ParsedNote?
    /// Why the open note's text is not here, when it is not.
    private(set) var readFailure: LibraryError?
    /// Why the last save did not write, while the text is still ahead of
    /// the disk; cleared by the save that does.
    private(set) var saveFailure: LibraryError?
    /// Whether the text is ahead of the disk.
    private(set) var isDirty = false
    /// What the bar in the editor is asking, while it is up.
    private(set) var conflict: Conflict?

    /// The library the note was read from: a save goes to it and no other,
    /// so a switch that outruns a save can never write into the new one.
    private var rootURL: URL?
    private let currentLibrary: CurrentLibrary
    @ObservationIgnored private var autosave: Task<Void, Never>?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    /// How long after the last edit the buffer writes itself out.
    static let autosaveDelay: Duration = .seconds(1)

    init(currentLibrary: CurrentLibrary) {
        self.currentLibrary = currentLibrary
        // Synchronous delivery, on the main thread: the process may exit as
        // soon as the termination notification has been posted.
        let boundaries: [Notification.Name] = [
            NSApplication.didResignActiveNotification, NSWindow.didResignKeyNotification,
            NSApplication.willTerminateNotification,
        ]
        observers = boundaries.map { name in
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) {
                [weak self] _ in
                MainActor.assumeIsolated { self?.save() }
            }
        }
    }

    isolated deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    /// Saves whatever is here, then takes `note`'s text from the library —
    /// or empties the buffer for nil. What a failed save could not write,
    /// or a bar still up, goes with it. The note already here is left as
    /// it is.
    func open(_ note: Note?) {
        guard note?.path != self.note?.path else { return }
        save()
        self.note = note
        parsed = nil
        readFailure = nil
        saveFailure = nil
        isDirty = false
        conflict = nil
        rootURL = currentLibrary.library?.rootURL
        guard let note, let library = currentLibrary.library else { return }
        do {
            parsed = ParsedNote.parse(try library.read(note))
        } catch {
            readFailure = error
        }
    }

    /// The text as the editor now has it, parsed. Dirty from here until
    /// the save that follows — which waits, while the bar is up.
    func edit(_ parsed: ParsedNote) {
        self.parsed = parsed
        isDirty = true
        autosave?.cancel()
        guard conflict == nil else { return }
        autosave = Task {
            try? await Task.sleep(for: Self.autosaveDelay)
            guard !Task.isCancelled else { return }
            save()
        }
    }

    /// Writes the text to the note now, when it is ahead of the disk and
    /// no bar is up — the bar answers instead (ADR 0014). A write that
    /// fails leaves it ahead, with `saveFailure` saying why, to be tried at
    /// the next save — and lost with the buffer if none comes before the
    /// note changes.
    func save() {
        autosave?.cancel()
        guard isDirty, conflict == nil, let note, let parsed,
            currentLibrary.library?.rootURL == rootURL
        else { return }
        do {
            self.note = try currentLibrary.save(parsed, to: note)
            isDirty = false
            saveFailure = nil
        } catch {
            saveFailure = error
        }
    }

    /// The library changed under the buffer — a save of its own, or
    /// another tool's doing folded in (ADR 0014). A note whose file has
    /// gone keeps its text behind the *Removed from disk* bar; one whose
    /// file another tool wrote is taken from the disk again when the
    /// buffer is clean, and kept behind the *Changed on disk* bar when it
    /// is dirty. The buffer's own save is what it already holds.
    func reconcile(with library: Library) {
        guard let note, library.rootURL == rootURL else { return }
        guard let current = library.note(at: note.path) else {
            autosave?.cancel()
            conflict = .removedFromDisk
            return
        }
        guard current.modifiedAt != note.modifiedAt else { return }
        if isDirty {
            autosave?.cancel()
            conflict = .changedOnDisk
        } else {
            reload(current, from: library)
        }
    }

    /// The bar's *Overwrite*: the buffer's text over what another tool
    /// wrote, saved now.
    func overwrite() {
        conflict = nil
        save()
    }

    /// The bar's *Reload*: the disk's text in place of the buffer's, the
    /// edits discarded.
    func reload() {
        conflict = nil
        guard let note, let library = currentLibrary.library,
            let current = library.note(at: note.path)
        else { return }
        reload(current, from: library)
    }

    /// The bar's *Save as new*: the note created again at its own path,
    /// with the buffer's text. A refusal — the folder gone too, or the
    /// path unwritable — leaves the bar up, with `saveFailure` saying why.
    func saveAsNew() {
        guard let note, let library = currentLibrary.library else { return }
        // The folder is gone with the note: nowhere to write.
        guard let folder = library.folder(at: note.folderPath) else {
            saveFailure = .unwritable
            return
        }
        do {
            self.note = try currentLibrary.createNote(named: note.title, in: folder)
            conflict = nil
            isDirty = true
            save()
        } catch {
            saveFailure = error
        }
    }

    /// The note's path changed under the text — the title field renamed
    /// it — so the text is `renamed`'s now.
    func renamed(to renamed: Note) {
        note = renamed
    }

    /// The disk's text in place of the buffer's — a removed note come back
    /// is a note again, so any bar comes down with it.
    private func reload(_ current: Note, from library: Library) {
        note = current
        isDirty = false
        saveFailure = nil
        conflict = nil
        do {
            parsed = ParsedNote.parse(try library.read(current))
            readFailure = nil
        } catch {
            parsed = nil
            readFailure = error
        }
    }
}
