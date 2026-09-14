import Library
import NoteParsing

/// A note whose text was read and parsed while the Index was being built;
/// it lives only that long (ADR 0012: nothing is kept but what the Index
/// answers with).
struct ReadNote {
    let note: Note
    let text: String
    let parsed: ParsedNote
}
