import CoreGraphics

/// Fixed dimensions of the sidebar at compact density (design/README.md
/// § Spacing; the spec's file tree).
enum SidebarMetrics {
    static let rowHeight: CGFloat = 24
    /// How much further each depth of the file tree is inset.
    static let depthIndent: CGFloat = 14
    static let glyphSize: CGFloat = 11
    static let chevronSize: CGFloat = 8
    /// A row's content sits this far in from the selected-row pill's rule,
    /// so the text lines up with the section labels at `labelInset`.
    static let contentInset: CGFloat = 6
    static let chevronSpacing: CGFloat = 6
    static let glyphSpacing: CGFloat = 8
    static let labelInset: CGFloat = 12
    static let topInset: CGFloat = 5
    /// Between a section label and its first row.
    static let labelGap: CGFloat = 4
    static let sectionSpacing: CGFloat = 11
}
