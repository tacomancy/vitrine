/// The structure the editor colors (CONTEXT.md, Parsing): the body's
/// headings, fenced code blocks, and inline code spans, each as UTF-8
/// offsets. Emphasis, lists, block quotes, and tables are not reported.
public struct Structure: Sendable, Equatable {
    /// Every ATX heading in the body, in order of appearance.
    public let headings: [Heading]
    /// Every fenced code block, in order of appearance: from its opening
    /// fence to the end of its closing fence's line — or of the text, for
    /// a block that never closes — line ending excluded.
    public let fencedCodeBlocks: [Range<Int>]
    /// Every inline code span, in order of appearance, both backtick runs
    /// included. An unclosed run is text, not a span.
    public let inlineCodeSpans: [Range<Int>]
}
