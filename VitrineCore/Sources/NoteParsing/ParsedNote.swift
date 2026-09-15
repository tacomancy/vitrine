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
    /// Every link in the note in order of appearance: the wikilinks in
    /// frontmatter values first, then the body's wikilinks and Markdown links
    /// together. None is resolved (CONTEXT.md, Parsing).
    public let links: [Link]
    /// Every embed in the body, in order of appearance.
    public let embeds: [Embed]

    /// Reads `text` into a `ParsedNote`. Never fails: text that is not a note
    /// in any recognisable way is a note whose whole text is body.
    public static func parse(_ text: String) -> ParsedNote {
        let end = text.utf8.count
        let frontmatter = Frontmatter.read(from: text)
        let bodyStart =
            frontmatter.map { startOfLine(after: $0.rawRange.upperBound, in: text) } ?? 0
        var scanner = BodyScanner(text, from: bodyStart)
        scanner.scan()
        return ParsedNote(
            frontmatter: frontmatter, bodyRange: bodyStart..<end, bodyTags: scanner.tags,
            links: (frontmatter?.links ?? []).map(Link.wikilink) + scanner.links,
            embeds: scanner.embeds)
    }

    /// The body starts on the line after the closing `---`; the line ending
    /// that follows it — `\n` or `\r\n` — belongs to neither.
    private static func startOfLine(after offset: Int, in text: String) -> Int {
        var bytes = text.utf8.dropFirst(offset)
        if bytes.first == UInt8(ascii: "\r") { bytes = bytes.dropFirst() }
        if bytes.first == UInt8(ascii: "\n") { bytes = bytes.dropFirst() }
        return text.utf8.count - bytes.count
    }
}
