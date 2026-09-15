/// `![[filename]]` or `![alt](filename)`: a file shown inline in the note
/// (CONTEXT.md § Links). In v1 only images embed.
public struct Embed: Sendable, Equatable {
    /// The file embedded, with any display width (`![[image.png|800]]`)
    /// dropped: a path percent-decoded, a URL exactly as written, as a
    /// Markdown link's destination is.
    public let filename: String
    /// The token in the note as UTF-8 offsets, `!` included.
    public let range: Range<Int>

    /// Memberwise, so a caller — the Index, or a test's expected value — can
    /// build one directly.
    public init(filename: String, range: Range<Int>) {
        self.filename = filename
        self.range = range
    }
}
