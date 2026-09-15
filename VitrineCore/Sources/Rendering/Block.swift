/// One block of a rendered note (ADR 0019): what it is, and where in the
/// note's text it came from.
public struct Block: Sendable, Equatable {
    /// What the block is, with everything it contains.
    public let kind: Kind
    /// The block's source as UTF-8 offsets into the note's original text —
    /// frontmatter and all, exactly the text it was rendered from, trailing
    /// whitespace excluded — so scroll sync and click-to-source can be built
    /// on the seam later without changing it (ADR 0019).
    public let sourceRange: Range<Int>

    /// Memberwise, so a test's expected value can be written as a literal.
    public init(_ kind: Kind, sourceRange: Range<Int>) {
        self.kind = kind
        self.sourceRange = sourceRange
    }

    /// The kinds of block Preview draws. Footnotes, math, and HTML are not
    /// among them: HTML is reduced to its text, the rest is parked
    /// (`BACKLOG.md`).
    public indirect enum Kind: Sendable, Equatable {
        /// A heading of `level` 1 to 6.
        case heading(level: Int, inlines: [Inline])
        /// A run of inline text.
        case paragraph([Inline])
        /// A bulleted or numbered list; `start` is the first number of an
        /// ordered list and 1 for an unordered one. Each item is the blocks
        /// it holds.
        case list(isOrdered: Bool, start: Int, items: [[Block]])
        /// A list whose every item carries a checkbox.
        case taskList(items: [TaskItem])
        /// A fenced code block: the info string's first word, if any, and
        /// the lines between the fences.
        case codeBlock(language: String?, text: String)
        /// A block quote and the blocks it contains.
        case quote([Block])
        /// A table: the header row's cells, each body row's cells, and one
        /// alignment per column, nil where the column declares none.
        case table(header: [[Inline]], rows: [[[Inline]]], alignments: [ColumnAlignment?])
        /// A horizontal rule.
        case thematicBreak
        /// An image on its own: from an embed (`![[figure.png|800]]`, the
        /// width honored) or a Markdown image (`![alt](figure.png)`).
        case image(source: ImageSource, alt: String, width: Int?)
    }
}
