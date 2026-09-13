/// `[[Title]]` or `[[Title|shown]]`, resolved later by title.
public struct Wikilink: Sendable, Equatable {
    /// The title linked to, trimmed. A heading or block fragment
    /// (`[[Note#Heading]]`, `[[Note#^id]]`) is parsed and dropped: v1 links
    /// point to whole notes (CONTEXT.md § Links).
    public let target: String
    /// The text after `|`, when the link shows something other than its target.
    public let displayText: String?
    /// The token in the note as UTF-8 offsets, both bracket pairs included.
    public let range: Range<Int>

    /// Memberwise, so a caller — the Index, or a test's expected value — can
    /// build one directly.
    public init(target: String, displayText: String?, range: Range<Int>) {
        self.target = target
        self.displayText = displayText
        self.range = range
    }
}
