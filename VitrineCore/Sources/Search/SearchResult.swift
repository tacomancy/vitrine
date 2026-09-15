import Library

/// One note a query matched, with what the palette needs to show why
/// (CONTEXT.md § Search, § Command palette).
public struct SearchResult: Sendable, Equatable {
    /// The note that matched.
    public let note: Note
    /// Whether the title, or one alias, contains every term — the first
    /// group of results (ADR 0018).
    public let matchedInTitle: Bool
    /// Every occurrence of a term in the original title, as UTF-8 ranges
    /// in order of position — for the highlight wash. Empty when the
    /// match was elsewhere.
    public let titleRanges: [Range<Int>]
    /// The line the preview rail shows, with the terms on it.
    public let excerpt: Excerpt
}
