import AppKit
import Library
import NoteParsing
import Observation

/// The open note's text as the editor holds it — the buffer (CONTEXT.md
/// § Editor) — with whether it is ahead of the disk. Each edit's parse
/// replaces the last; a save writes the text in place through
/// `CurrentLibrary` about a second after the last edit, and at once on a
/// note switch, on the window or app going inactive, on quit, and on ⌘S
/// (ADR 0014). Clean, a save does nothing.
@Observable
final class NoteBuffer {
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
    /// or empties the buffer for nil. What a failed save could not write
    /// goes with it.
    func open(_ note: Note?) {
        save()
        self.note = note
        parsed = nil
        readFailure = nil
        saveFailure = nil
        isDirty = false
        rootURL = currentLibrary.library?.rootURL
        guard let note, let library = currentLibrary.library else { return }
        do {
            parsed = ParsedNote.parse(try library.read(note))
        } catch {
            readFailure = error
        }
    }

    /// The text as the editor now has it, parsed. Dirty from here until
    /// the save that follows.
    func edit(_ parsed: ParsedNote) {
        self.parsed = parsed
        isDirty = true
        autosave?.cancel()
        autosave = Task {
            try? await Task.sleep(for: Self.autosaveDelay)
            guard !Task.isCancelled else { return }
            save()
        }
    }

    /// Writes the text to the note now, when it is ahead of the disk. A
    /// write that fails leaves it ahead, with `saveFailure` saying why, to
    /// be tried at the next save — and lost with the buffer if none comes
    /// before the note changes.
    func save() {
        autosave?.cancel()
        guard isDirty, let note, let parsed, currentLibrary.library?.rootURL == rootURL else {
            return
        }
        do {
            self.note = try currentLibrary.save(parsed, to: note)
            isDirty = false
            saveFailure = nil
        } catch {
            saveFailure = error
        }
    }
}
