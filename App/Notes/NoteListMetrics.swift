import CoreGraphics

/// Fixed dimensions of the note list at compact density (design/README.md
/// § Spacing: rows padded 7 × 11 px).
enum NoteListMetrics {
    static let rowPaddingVertical: CGFloat = 7
    static let rowPaddingHorizontal: CGFloat = 11
    /// Between a row's title and its date.
    static let dateSpacing: CGFloat = 6
    static let headerPaddingVertical: CGFloat = 7
    /// The header starts where the rows' titles do: past the pill's inset,
    /// the rule's slot, and the row padding.
    static let headerInset =
        SelectedRowPill.inset + SelectedRowPill.ruleWidth + rowPaddingHorizontal
}
