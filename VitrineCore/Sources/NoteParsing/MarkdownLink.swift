/// `[shown](destination)`, resolved later by path relative to this note.
public struct MarkdownLink: Sendable, Equatable {
    /// The destination as a path or URL, percent-decoded, so Obsidian's
    /// `My%20Note.md` is `My Note.md`.
    public let destination: String
    /// The text between the square brackets.
    public let displayText: String
    /// Whether the destination has a URL scheme (`https:`, `mailto:`) and so
    /// can never be a note in the library.
    public let isExternal: Bool
    /// The token in the note as UTF-8 offsets, brackets and parentheses included.
    public let range: Range<Int>

    /// Memberwise, so a caller — the Index, or a test's expected value — can
    /// build one directly.
    public init(destination: String, displayText: String, isExternal: Bool, range: Range<Int>) {
        self.destination = destination
        self.displayText = displayText
        self.isExternal = isExternal
        self.range = range
    }
}
