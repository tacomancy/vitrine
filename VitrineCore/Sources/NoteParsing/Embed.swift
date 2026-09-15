/// `![[filename]]` or `![alt](filename)`: a file shown inline in the note
/// (CONTEXT.md § Links). In v1 only images embed.
public struct Embed: Sendable, Equatable {
    /// The file embedded, with any display width (`![[image.png|800]]`)
    /// dropped: a path percent-decoded, a URL exactly as written, as a
    /// Markdown link's destination is.
    public let filename: String
    /// The display width Obsidian writes after the last `|` of a wikilink
    /// embed (`![[image.png|800]]`), when it is one: digits and nothing
    /// else. Preview honors it (CONTEXT.md § Links).
    public let width: Int?
    /// The token in the note as UTF-8 offsets, `!` included.
    public let range: Range<Int>

    /// An embed without a display width. Memberwise, so a caller — the
    /// Index, or a test's expected value — can build one directly.
    public init(filename: String, range: Range<Int>) {
        self.init(filename: filename, width: nil, range: range)
    }

    /// Memberwise, for an embed with or without a display width.
    public init(filename: String, width: Int?, range: Range<Int>) {
        self.filename = filename
        self.width = width
        self.range = range
    }
}
