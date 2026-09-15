/// A reference from this note to another, in either syntax Obsidian writes
/// (CONTEXT.md § Links). What it resolves to is the Index's business.
public enum Link: Sendable, Equatable {
    /// `[[Title]]`, resolved by title.
    case wikilink(Wikilink)
    /// `[text](destination)`, resolved by path.
    case markdown(MarkdownLink)

    /// The whole token in the note as UTF-8 offsets, whichever syntax.
    public var range: Range<Int> {
        switch self {
        case .wikilink(let link): link.range
        case .markdown(let link): link.range
        }
    }

    /// Whether the link was written inside a frontmatter value. Only a
    /// wikilink can be: Obsidian reads no Markdown link out of frontmatter.
    public var isFromFrontmatter: Bool {
        switch self {
        case .wikilink(let link): link.isFromFrontmatter
        case .markdown: false
        }
    }
}
