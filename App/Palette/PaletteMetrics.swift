import CoreGraphics
import SwiftUI

/// Fixed dimensions of the command palette (design/README.md § 08;
/// spec #67 § The command palette).
enum PaletteMetrics {
    static let panelWidth: CGFloat = 760
    static let railWidth: CGFloat = 268
    /// The panel's top edge sits this far below the window's.
    static let panelTopInset: CGFloat = 110
    /// The least of the window kept clear under the panel.
    static let panelBottomInset: CGFloat = 40
    /// The results column and the rail share this height; the column
    /// scrolls past it.
    static let bodyHeight: CGFloat = 440
    static let headerPadding = EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16)
    /// Between the search glyph and the query.
    static let headerSpacing: CGFloat = 11
    static let glyphSize: CGFloat = 15
    static let columnPaddingVertical: CGFloat = 8
    /// A group label's padding: 4 above, 6 below, at the column's inset.
    static let groupLabelPadding = EdgeInsets(top: 4, leading: 16, bottom: 6, trailing: 16)
    static let rowPaddingVertical: CGFloat = 7
    /// A row's content starts at the column's 16 px inset: past the pill's
    /// inset and the rule's slot, this much more.
    static let rowPaddingHorizontal = inset - SelectedRowPill.inset - SelectedRowPill.ruleWidth
    /// Between a row's kind tag, label, and meta.
    static let rowSpacing: CGFloat = 11
    static let inset: CGFloat = 16
    static let railPadding = EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16)
    /// Between the rail's lines.
    static let railSpacing: CGFloat = 10
    static let footerPadding = EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16)
    /// Between the footer's key hints.
    static let footerSpacing: CGFloat = 16
    /// Between a key and its word.
    static let keySpacing: CGFloat = 6
}
