/// One ATX heading — a line opening with one to six `#` and a space.
public struct Heading: Sendable, Equatable {
    /// How many `#` open the line: 1 for `# Title`, up to 6.
    public let level: Int
    /// The whole line as UTF-8 offsets, `#` included and line ending
    /// excluded.
    public let range: Range<Int>
}
