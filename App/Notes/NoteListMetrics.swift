import CoreGraphics

/// Fixed dimensions of the note list at compact density (design/README.md
/// § Spacing: rows padded 7 × 11 px).
enum NoteListMetrics {
    static let rowPaddingVertical: CGFloat = 7
    static let rowPaddingHorizontal: CGFloat = 11
    /// Between a row's title and its date.
    static let dateSpacing: CGFloat = 6
    /// Between a row's title line and its tag row.
    static let tagRowSpacing: CGFloat = 3
    static let headerPaddingVertical: CGFloat = 7
    /// The chip row's height and the gaps within it (screen 01: chips 20 px
    /// tall, 5 px apart).
    static let chipHeight: CGFloat = 20
    static let chipSpacing: CGFloat = 5
    static let chipPaddingHorizontal: CGFloat = 7
    /// Between a chip's `#tag` and its `×`.
    static let chipRemoveSpacing: CGFloat = 5
    static let addFilterPaddingHorizontal: CGFloat = 6
    /// The header starts where the rows' titles do: past the pill's inset,
    /// the rule's slot, and the row padding.
    static let headerInset =
        SelectedRowPill.inset + SelectedRowPill.ruleWidth + rowPaddingHorizontal
}
