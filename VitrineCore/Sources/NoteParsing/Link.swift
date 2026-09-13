/// A reference from this note to another, in either syntax Obsidian writes
/// (CONTEXT.md § Links). What it resolves to is the Index's business.
public enum Link: Sendable, Equatable {
    case wikilink(Wikilink)
    case markdown(MarkdownLink)

    /// The whole token in the note as UTF-8 offsets, whichever syntax.
    public var range: Range<Int> {
        switch self {
        case .wikilink(let link): link.range
        case .markdown(let link): link.range
        }
    }
}
