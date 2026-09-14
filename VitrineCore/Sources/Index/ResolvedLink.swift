/// One link or embed in a note, with what its target turned out to be —
/// what `Index.links(from:)` answers, and all the editor needs to draw and
/// follow it.
public struct ResolvedLink: Sendable, Equatable {
    /// The note, attachment, or nothing the link points at.
    public let target: LinkTarget
    /// The whole token in the linking note as UTF-8 offsets — what the
    /// editor makes clickable.
    public let range: Range<Int>
    /// What the link shows: its `|` or `[…]` text, or the target as written
    /// when it has none.
    public let displayText: String
    /// Whether the link was written inside a frontmatter value.
    public let isFromFrontmatter: Bool
}
