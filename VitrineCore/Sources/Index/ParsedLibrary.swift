import Library
import NoteParsing

/// The library as the Index keeps it between changes (ADR 0017): every
/// note in library display order, the parse of each whose text could be
/// read, and every attachment. Every table the Index answers with derives
/// from this alone, so a change is folded in here — one note at a time,
/// with no I/O — and the tables recomputed.
struct ParsedLibrary: Sendable {
    /// Every note, skipped ones included, in library display order.
    private(set) var notes: [Note]
    /// Every attachment, in library display order.
    let attachments: [Attachment]
    /// Each read note's parse, by path.
    private var parses: [String: ParsedNote]

    /// Reads and parses every note in `library` — the one place the Index
    /// touches the disk. A note that cannot be read has no parse.
    init(reading library: Library) {
        notes = library.allNotes
        attachments = library.root.allAttachments
        var parses: [String: ParsedNote] = [:]
        for note in notes {
            guard let text = try? library.read(note) else { continue }
            parses[note.path] = ParsedNote.parse(text)
        }
        self.parses = parses
    }

    /// The notes whose text could not be read, in library display order.
    var skipped: [Note] {
        notes.filter { parses[$0.path] == nil }
    }

    /// Every read note with its parse, in library display order.
    var parsed: [(note: Note, parsed: ParsedNote)] {
        notes.compactMap { note in parses[note.path].map { (note, $0) } }
    }

    /// `note` — as the library holds it now — with `parsed` as its parse,
    /// in the place the note at its path already has.
    mutating func update(_ note: Note, parsed: ParsedNote) {
        guard let index = notes.firstIndex(where: { $0.path == note.path }) else {
            return add(note, parsed: parsed)
        }
        notes[index] = note
        parses[note.path] = parsed
    }

    /// `note` placed in library display order, with `parsed` as its parse;
    /// a note already at its path is replaced.
    mutating func add(_ note: Note, parsed: ParsedNote) {
        remove(note)
        insert(note)
        parses[note.path] = parsed
    }

    /// Without the note at `note`'s path, or its parse.
    mutating func remove(_ note: Note) {
        notes.removeAll { $0.path == note.path }
        parses[note.path] = nil
    }

    /// `renamed` in place of `note`, in its own place in library display
    /// order, carrying whatever parse `note` had.
    mutating func rename(_ note: Note, to renamed: Note) {
        let parsed = parses[note.path]
        remove(note)
        insert(renamed)
        parses[renamed.path] = parsed
    }

    /// `note` placed in library display order among the others.
    private mutating func insert(_ note: Note) {
        let index =
            notes.firstIndex { LibraryDisplayOrder.precedes(note.path, $0.path) } ?? notes.count
        notes.insert(note, at: index)
    }
}
