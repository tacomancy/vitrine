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

    /// The rule behind `isExternal`, for the Index to apply to an embed's
    /// file too. RFC 3986: a scheme is a letter, then letters, digits, `+`,
    /// `-`, or `.`, then `:` — so `https://…` and `mailto:…` are external
    /// and a relative path is not.
    public static func hasURLScheme(_ destination: String) -> Bool {
        var scalars = destination.unicodeScalars[...]
        guard let first = scalars.popFirst(), isASCIILetter(first) else { return false }
        for scalar in scalars {
            if scalar == ":" { return true }
            guard
                isASCIILetter(scalar) || ("0"..."9").contains(scalar)
                    || "+-.".unicodeScalars.contains(scalar)
            else { return false }
        }
        return false
    }

    private static func isASCIILetter(_ scalar: Unicode.Scalar) -> Bool {
        ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar)
    }
}
