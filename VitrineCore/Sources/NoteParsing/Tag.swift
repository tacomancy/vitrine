/// One `#tag` as written in a note's body (CONTEXT.md § Tags).
public struct Tag: Sendable, Equatable {
    /// The tag without its `#`, spelled as written — `parent/child` for a
    /// nested tag; the Index reads the hierarchy out of the name.
    public let name: String
    /// The token in the note as UTF-8 offsets, `#` included.
    public let range: Range<Int>

    /// Memberwise, so a caller — the Index, or a test's expected value — can
    /// build one directly.
    public init(name: String, range: Range<Int>) {
        self.name = name
        self.range = range
    }
}
