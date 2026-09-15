import CoreGraphics

/// Fixed dimensions of the rail at compact density: its sections inset as
/// the editor's breadcrumb is, so the two surfaces read as one line.
enum RailMetrics {
    static let inset: CGFloat = 16
    /// Centres the first label in a band the height of the editor's breadcrumb.
    static let topInset: CGFloat = 11
    /// Between a section label and its first entry.
    static let labelGap: CGFloat = 4
    static let sectionSpacing: CGFloat = 11
    /// Between the lines of INFO.
    static let infoSpacing: CGFloat = 4
    static let entryPaddingVertical: CGFloat = 5
    /// A backlink entry's text starts at `inset`: past the pill's inset and
    /// the rule's slot, this much more.
    static let entryPaddingHorizontal = inset - SelectedRowPill.inset - SelectedRowPill.ruleWidth
    /// Between an entry's title and its context lines.
    static let contextSpacing: CGFloat = 2
}
