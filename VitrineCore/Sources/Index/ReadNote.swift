import Library
import NoteParsing

/// A note whose text was read and parsed while the Index was being built.
/// It lives only that long: the Index keeps what it answers with, not the
/// text (ADR 0012).
struct ReadNote {
    let note: Note
    let text: String
    let parsed: ParsedNote
}
