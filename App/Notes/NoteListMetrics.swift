import CoreGraphics

/// Fixed dimensions of the note list at compact density (design/README.md
/// § Spacing: rows padded 7 × 11 px).
enum NoteListMetrics {
    static let rowPaddingVertical: CGFloat = 7
    static let rowPaddingHorizontal: CGFloat = 11
    /// A row's pill sits this far in from the pane's edges, as in the sidebar.
    static let rowInset: CGFloat = 4
    /// The selected row's sapphire rule (ADR 0008, Update).
    static let ruleWidth: CGFloat = 2
    /// Between a row's title and its date.
    static let dateSpacing: CGFloat = 6
    static let headerPaddingVertical: CGFloat = 7
    /// The header starts where the rows' titles do: past the inset, the
    /// rule's slot, and the row padding.
    static let headerInset = rowInset + ruleWidth + rowPaddingHorizontal
}
