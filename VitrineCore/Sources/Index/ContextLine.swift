/// The full line of a note's text around a link — what the rail shows as a
/// backlink's context (CONTEXT.md, Editor). For a frontmatter link that is
/// its property line.
struct ContextLine: Sendable, Equatable {
    /// The UTF-8 offset where the line begins: its identity within the note,
    /// so two links on one line are one context (ADR 0016).
    let start: Int
    /// The line without its line ending.
    let text: String

    /// The line of `text` containing `range`.
    init(around range: Range<Int>, in text: [UInt8]) {
        let newline = UInt8(ascii: "\n")
        var start = range.lowerBound
        while start > 0, text[start - 1] != newline { start -= 1 }
        var end = range.upperBound
        while end < text.count, text[end] != newline { end += 1 }
        // A Windows line ending leaves its `\r` before the `\n`.
        if end > start, text[end - 1] == UInt8(ascii: "\r") { end -= 1 }
        self.start = start
        self.text = String(decoding: text[start..<end], as: UTF8.self)
    }
}
