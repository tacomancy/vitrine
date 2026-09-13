/// One note's text read into its frontmatter, tags, links, and embeds,
/// without reference to any other note (CONTEXT.md, Parsing).
public struct ParsedNote: Sendable, Equatable {
    /// The YAML block at the top of the note, when there is one.
    public let frontmatter: Frontmatter?
    /// Where the body is, as UTF-8 offsets: everything after the frontmatter,
    /// or the whole text when there is none.
    public let bodyRange: Range<Int>
    /// Every `#tag` in the body in order of appearance, repeats included —
    /// deduplication is the Index's job, not the parser's.
    public let bodyTags: [Tag]
    /// Every link in the body, wikilinks and Markdown links together, in
    /// order of appearance. None is resolved (CONTEXT.md, Parsing).
    public let links: [Link]
    /// Every embed in the body, in order of appearance.
    public let embeds: [Embed]

    /// Reads `text` into a `ParsedNote`. Never fails: text that is not a note
    /// in any recognisable way is a note whose whole text is body.
    public static func parse(_ text: String) -> ParsedNote {
        let end = text.utf8.count
        let frontmatter = Frontmatter.read(from: text)
        // The body starts on the line after the closing `---`, so the newline
        // that ends that line belongs to neither.
        let bodyStart = frontmatter.map { min($0.rawRange.upperBound + 1, end) } ?? 0
        var scanner = BodyScanner(text, from: bodyStart)
        scanner.scan()
        return ParsedNote(
            frontmatter: frontmatter, bodyRange: bodyStart..<end, bodyTags: scanner.tags,
            links: scanner.links, embeds: scanner.embeds)
    }
}
