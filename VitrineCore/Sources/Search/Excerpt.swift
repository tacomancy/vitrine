/// The line of a note the preview rail shows for a result (CONTEXT.md
/// § Command palette): the first line of the original text containing
/// any term, or — when the match was in the title or an alias alone —
/// the first non-empty line.
public struct Excerpt: Sendable, Equatable {
    /// The line, without its line ending. Empty for a note with no text.
    public let text: String
    /// Every occurrence of a term in the line, as UTF-8 ranges of `text`
    /// in order of position; none when no term is on the line.
    public let ranges: [Range<Int>]
}
